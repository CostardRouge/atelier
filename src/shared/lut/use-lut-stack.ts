/**
 * The studio's grade: an ordered stack of LUT layers resolved into one baked
 * cube (see lut-stack.ts). Layers can be added, removed, reordered, dialled
 * individually and switched off for a quick look/no-look comparison.
 *
 * The legacy pages keep `useLutSelection` (one look, one slider) — they are
 * scheduled for absorption and must not grow features.
 */

import { useCallback, useMemo, useState } from 'react';
import { parseCube, type CubeLut } from '../lib/cube-parser';
import { CUBE_ACCEPT, pickFile } from '../sources/file-sources';
import { BUILTIN_LUTS } from './builtin-luts';
import { composeLutStack, reorderLayer, type LutLayer } from './lut-stack';
import type { OutputTransform } from './transfer';
import type { Interpolation } from './interpolate';
import { useLutInterpolation } from './use-lut-interpolation';

/** A layer as a project document stores it — no parsed data, just identity. */
export interface SavedLutLayer {
  id: string;
  source: string;
  name: string;
  /** Raw `.cube` text for an uploaded look; null for built-ins. */
  customText: string | null;
  intensity: number;
  enabled: boolean;
}

export interface LutStack {
  layers: LutLayer[];
  /**
   * How the graded result is re-encoded for the screen it will be watched on.
   * Baked into `composed` as a final stage — transfer.ts says why it defaults
   * to 'none'.
   */
  output: OutputTransform;
  /**
   * How the LUT's lattice is read between its points. A render preference
   * (localStorage, not project data) — the bake and the shader must both use
   * it or preview and export diverge.
   */
  interpolation: Interpolation;
  /** The whole stack baked into one LUT, or null when nothing is active. */
  composed: CubeLut | null;
  /** True while a built-in is being fetched. */
  busy: boolean;
  error: string | null;
  addBuiltin: (builtinId: string) => Promise<void>;
  addCustom: () => Promise<void>;
  remove: (id: string) => void;
  move: (id: string, delta: -1 | 1) => void;
  setIntensity: (id: string, intensity: number) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  setOutput: (output: OutputTransform) => void;
  setInterpolation: (mode: Interpolation) => void;
  /** Rebuild the stack from a saved document. */
  restore: (
    saved: readonly SavedLutLayer[],
    output?: OutputTransform,
  ) => Promise<void>;
  /** The persistable shape of the current stack. */
  toSaved: () => SavedLutLayer[];
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `lut_${Math.random().toString(36).slice(2)}`;
}

/** Fetch + parse a built-in by id. Throws with a readable message. */
async function loadBuiltin(builtinId: string): Promise<{ lut: CubeLut; name: string }> {
  const entry = BUILTIN_LUTS.find((l) => l.id === builtinId);
  if (!entry) throw new Error('That look is no longer available.');
  const res = await fetch(entry.url);
  const parsed = parseCube(await res.text());
  if (!parsed) throw new Error(`Could not parse ${entry.name}.`);
  return { lut: parsed, name: entry.name };
}

export function useLutStack(): LutStack {
  const [layers, setLayers] = useState<LutLayer[]>([]);
  const [output, setOutput] = useState<OutputTransform>('none');
  const { interpolation, setInterpolation } = useLutInterpolation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Uploaded cubes keep their source text so a project can restore them.
  const [customText, setCustomText] = useState<Record<string, string>>({});

  // Baking walks a lattice, so it must not run on every render — only when the
  // stack's shape, order, strengths, switches, output transform or lattice
  // lookup actually change.
  const composed = useMemo(
    () => composeLutStack(layers, output, interpolation),
    [layers, output, interpolation],
  );

  const addBuiltin = useCallback(async (builtinId: string) => {
    setError(null);
    setBusy(true);
    try {
      const { lut, name } = await loadBuiltin(builtinId);
      setLayers((prev) => [
        ...prev,
        {
          id: uid(),
          source: `builtin:${builtinId}`,
          name,
          lut,
          intensity: 1,
          enabled: true,
        },
      ]);
    } catch (e) {
      setError((e as Error).message || 'Could not load that look.');
    } finally {
      setBusy(false);
    }
  }, []);

  const addCustom = useCallback(async () => {
    const file = await pickFile(CUBE_ACCEPT);
    if (!file) return;
    setError(null);
    const text = await file.text();
    const parsed = parseCube(text);
    if (!parsed) {
      setError(`${file.name} isn't a supported 3D .cube LUT (1D LUTs aren't).`);
      return;
    }
    const id = uid();
    setCustomText((prev) => ({ ...prev, [id]: text }));
    setLayers((prev) => [
      ...prev,
      { id, source: 'custom', name: file.name, lut: parsed, intensity: 1, enabled: true },
    ]);
  }, []);

  const remove = useCallback((id: string) => {
    setLayers((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const move = useCallback((id: string, delta: -1 | 1) => {
    setLayers((prev) => {
      const index = prev.findIndex((l) => l.id === id);
      return index === -1 ? prev : reorderLayer(prev, index, delta);
    });
  }, []);

  const setIntensity = useCallback((id: string, intensity: number) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, intensity } : l)));
  }, []);

  const setEnabled = useCallback((id: string, enabled: boolean) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, enabled } : l)));
  }, []);

  const restore = useCallback(async (
    saved: readonly SavedLutLayer[],
    savedOutput: OutputTransform = 'none',
  ) => {
    setOutput(savedOutput);
    if (saved.length === 0) return;
    setBusy(true);
    const texts: Record<string, string> = {};
    const restored: LutLayer[] = [];
    for (const s of saved) {
      try {
        if (s.source === 'custom') {
          const parsed = s.customText ? parseCube(s.customText) : null;
          // A custom look whose text didn't survive is dropped rather than
          // silently graded as identity.
          if (!parsed || !s.customText) continue;
          texts[s.id] = s.customText;
          restored.push({ ...s, lut: parsed });
        } else {
          const { lut, name } = await loadBuiltin(s.source.replace(/^builtin:/, ''));
          restored.push({ ...s, name: s.name || name, lut });
        }
      } catch {
        // A look that no longer exists just doesn't come back.
      }
    }
    setCustomText(texts);
    setLayers(restored);
    setBusy(false);
  }, []);

  const toSaved = useCallback(
    (): SavedLutLayer[] =>
      layers.map((l) => ({
        id: l.id,
        source: l.source,
        name: l.name,
        customText: l.source === 'custom' ? (customText[l.id] ?? null) : null,
        intensity: l.intensity,
        enabled: l.enabled,
      })),
    [layers, customText],
  );

  return {
    layers,
    output,
    interpolation,
    composed,
    busy,
    error,
    addBuiltin,
    addCustom,
    remove,
    move,
    setIntensity,
    setEnabled,
    setOutput,
    setInterpolation,
    restore,
    toSaved,
  };
}
