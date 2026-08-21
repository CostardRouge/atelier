/**
 * The studio's grade: an ordered stack of LUT layers resolved into one baked
 * cube (see lut-stack.ts). Layers can be added, removed, reordered, dialled
 * individually and switched off for a quick look/no-look comparison.
 *
 * The legacy pages keep `useLutSelection` (one look, one slider) — they are
 * scheduled for absorption and must not grow features.
 */

import { useCallback, useDeferredValue, useMemo, useState } from 'react';
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

  // Baking walks a lattice, and `setIntensity` maps to a NEW layers array, so
  // without this the strength slider re-bakes on every drag step, in render:
  // measured 6.6 ms for one look, 28 ms with an output transform, 38 ms for
  // three looks and a transform — ~26 fps, before React's re-render and the
  // ~575 KB 3D-texture re-upload each step.
  //
  // Deferring the bake's INPUTS lets the urgent render skip the memo and commit
  // the control immediately, with the bake following in a transition. Measured
  // in a browser against a 30 ms memo: the control commits 0 ms after the
  // change instead of 31 ms.
  //
  // What it does NOT do — both measured, so do not claim otherwise: it does not
  // reduce the number of bakes (React already batches a burst of synchronous
  // updates into one either way), and it does not make the bake cheaper or
  // non-blocking. It reorders the work. On a heavy stack the image still trails
  // the thumb; the next step there is moving the bake off the render path, not
  // stacking a debounce on top of this.
  //
  // Chosen over committing on pointer-release, which would kill the live
  // preview — watching the image while dialling strength IS the interaction.
  const bakeLayers = useDeferredValue(layers);
  const bakeOutput = useDeferredValue(output);
  const bakeInterpolation = useDeferredValue(interpolation);
  const composed = useMemo(
    () => composeLutStack(bakeLayers, bakeOutput, bakeInterpolation),
    [bakeLayers, bakeOutput, bakeInterpolation],
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
