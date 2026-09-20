/**
 * The studio's grade: an ordered stack of LUT layers resolved into one baked
 * cube (see lut-stack.ts). Layers can be added, removed, reordered, dialled
 * individually and switched off for a quick look/no-look comparison.
 *
 * The legacy pages keep `useLutSelection` (one look, one slider) — they are
 * scheduled for absorption and must not grow features.
 */

import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { DEFAULT_DEVELOP, isDefaultDevelop, type DevelopSettings } from '../develop/develop';
import type { FilmSettings } from '../film/emulsion';
import type { FilmTexture } from '../film/film-texture';
import { isFilmLayer, newFilmLayer, withFilmSettings } from '../film/film-layer';
import type { FilmStockId } from '../film/stocks';
import { parseCube, type CubeLut } from '../lib/cube-parser';
import { CUBE_ACCEPT, pickFile } from '../sources/file-sources';
import { isPackLayer, writePackRef, PACK_SOURCE, type PackRef } from './lut-pack';
import { composeLutStack, identityCube, reorderLayer, type LutLayer } from './lut-stack';
import { missingLookReason, packLookName, resolvePackLattice } from './pack-vault';
import { loadBuiltinLut, restoreLayers } from './restore-grade';
import type { OutputTransform } from './transfer';
import type { Interpolation } from './interpolate';
import { useLutInterpolation } from './use-lut-interpolation';

/** A layer as a project document stores it — no parsed data, just identity. */
export interface SavedLutLayer {
  id: string;
  source: string;
  name: string;
  /**
   * Raw `.cube` text for an uploaded look, a film stock's settings as JSON
   * (`shared/film/film-layer.ts`); null for built-ins.
   */
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
  /**
   * The open picture's own correction, baked as the FIRST stage of
   * `composed` (`develop/develop.ts`). Default is "as shot", which costs no
   * bake at all. Session state here; the host binds it to its document the
   * way it binds the layers.
   */
  develop: DevelopSettings;
  /** The whole stack baked into one LUT, or null when nothing is active. */
  composed: CubeLut | null;
  /**
   * The same stack WITHOUT the develop, for a source that was developed at
   * decode (a RAW): its numbers were consumed there, and grading it through
   * `composed` would apply the correction twice. Identical to `composed`
   * while the develop is default — one bake, not two.
   */
  composedForDeveloped: CubeLut | null;
  /**
   * The stack baked with SOME OTHER picture's develop — how a deck whose
   * slides each carry their own correction is graded: one cube per slide,
   * memoised on the develop's value, thrown away whenever the layers, the
   * output or the interpolation change. Null or a default develop answers
   * `composedForDeveloped`, so the common case is a lookup, not a bake.
   */
  composeWith: (develop: DevelopSettings | null) => CubeLut | null;
  /** True while a built-in is being fetched. */
  busy: boolean;
  error: string | null;
  addBuiltin: (builtinId: string) => Promise<void>;
  addCustom: () => Promise<void>;
  /** A film stock as a new layer at the end of the stack — generated, nothing to fetch. */
  addFilm: (stockId: FilmStockId) => void;
  /**
   * A purchased look from the vault (`pack-vault.ts`). The layer stores the
   * REFERENCE, never the lattice, and is added even when this device does not
   * hold the bytes — it then says so rather than grading.
   */
  addPackLook: (ref: PackRef, name?: string) => Promise<void>;
  /** Re-dial a film layer: its cube is regenerated (cached by settings), its name says where it stands. */
  setFilm: (id: string, settings: FilmSettings) => void;
  remove: (id: string) => void;
  move: (id: string, delta: -1 | 1) => void;
  setIntensity: (id: string, intensity: number) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  setOutput: (output: OutputTransform) => void;
  setInterpolation: (mode: Interpolation) => void;
  /** Replace the correction; `null` is "as shot". */
  setDevelop: (develop: DevelopSettings | null) => void;
  /**
   * The film TEXTURE this grade carries — grain and halation — or null for
   * none. NOT baked into `composed`: it is spatial, and it is drawn by one
   * node of the render graph after the cube (`render-film.md`), so it travels
   * beside the cube to whoever builds a grader.
   */
  film: FilmTexture | null;
  /**
   * Replace it. Named apart from `setFilm`, which re-dials a film LAYER's
   * emulsion: one writes a lattice, the other writes what the node draws over
   * it, and confusing them would bake grain into a cube.
   */
  setTexture: (film: FilmTexture | null) => void;
  /**
   * The uploaded cubes' own text, keyed by layer id — what `toSaved` writes so
   * a custom look survives a reload. Exposed for a host that holds the LIVE
   * stack as a value (an undo history), which has to put this back with it.
   */
  customText: Record<string, string>;
  /** Rebuild the stack from a saved document. */
  restore: (
    saved: readonly SavedLutLayer[],
    output?: OutputTransform,
    film?: FilmTexture | null,
  ) => Promise<void>;
  /**
   * Put a LIVE stack back, synchronously: the layers exactly as they were,
   * parsed cubes and all. The counterpart of `restore` for a step of history —
   * `restore` re-fetches and re-parses, which is right when a document opens
   * and wrong for a ⌘Z, where the await would land as a second, phantom step.
   */
  revert: (
    layers: LutLayer[],
    output: OutputTransform,
    customText: Record<string, string>,
    film?: FilmTexture | null,
  ) => void;
  /** The persistable shape of the current stack. */
  toSaved: () => SavedLutLayer[];
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `lut_${Math.random().toString(36).slice(2)}`;
}

export function useLutStack(): LutStack {
  const [layers, setLayers] = useState<LutLayer[]>([]);
  const [output, setOutput] = useState<OutputTransform>('none');
  const [film, setTexture] = useState<FilmTexture | null>(null);
  const [develop, setDevelopState] = useState<DevelopSettings>(DEFAULT_DEVELOP);
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
  const bakeDevelop = useDeferredValue(develop);
  const composedForDeveloped = useMemo(
    () => composeLutStack(bakeLayers, bakeOutput, bakeInterpolation),
    [bakeLayers, bakeOutput, bakeInterpolation],
  );
  // One memo per DEVELOP over the same stack, keyed on the develop's value:
  // a deck of five corrected slides bakes five cubes once and then reads
  // them, and a slider being dragged re-bakes only its own key. The cache
  // lives with the stack it was baked from — a new layers/output/mode makes
  // a new function and a new, empty cache. Bounded, so a long session of
  // dragging cannot hold a thousand cubes.
  const composeWith = useMemo(() => {
    const cache = new Map<string, CubeLut | null>();
    return (develop: DevelopSettings | null): CubeLut | null => {
      if (isDefaultDevelop(develop)) return composedForDeveloped;
      const key = JSON.stringify(develop);
      let cube = cache.get(key);
      if (cube === undefined) {
        if (cache.size >= 32) cache.clear();
        cube = composeLutStack(bakeLayers, bakeOutput, bakeInterpolation, develop);
        cache.set(key, cube);
      }
      return cube;
    };
  }, [bakeLayers, bakeOutput, bakeInterpolation, composedForDeveloped]);
  // With no correction the two are one bake: the common case pays nothing
  // for the develop existing.
  const composed = useMemo(() => composeWith(bakeDevelop), [composeWith, bakeDevelop]);

  const setDevelop = useCallback((next: DevelopSettings | null) => {
    setDevelopState(next ?? DEFAULT_DEVELOP);
  }, []);

  const addBuiltin = useCallback(async (builtinId: string) => {
    setError(null);
    setBusy(true);
    try {
      const { lut, name } = await loadBuiltinLut(builtinId);
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

  const addFilm = useCallback((stockId: FilmStockId) => {
    setError(null);
    const { layer, text } = newFilmLayer(uid(), stockId);
    setCustomText((prev) => ({ ...prev, [layer.id]: text }));
    setLayers((prev) => [...prev, layer]);
  }, []);

  const addPackLook = useCallback(async (ref: PackRef, name?: string) => {
    setError(null);
    setBusy(true);
    try {
      const lut = await resolvePackLattice(ref);
      const id = uid();
      const text = writePackRef(ref);
      const label = name || packLookName(ref) || 'Pack look';
      setCustomText((prev) => ({ ...prev, [id]: text }));
      setLayers((prev) => [
        ...prev,
        {
          id,
          source: PACK_SOURCE,
          name: label,
          lut: lut ?? identityCube(),
          intensity: 1,
          enabled: true,
          ...(lut ? {} : { missing: missingLookReason(ref) }),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }, []);

  const setFilm = useCallback((id: string, settings: FilmSettings) => {
    setLayers((prev) => {
      const current = prev.find((l) => l.id === id);
      if (!current || !isFilmLayer(current)) return prev;
      const { layer, text } = withFilmSettings(current, settings);
      setCustomText((texts) => ({ ...texts, [id]: text }));
      return prev.map((l) => (l.id === id ? layer : l));
    });
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
    savedFilm: FilmTexture | null = null,
  ) => {
    setOutput(savedOutput);
    // Set before the early return below, and before the await: a grade with no
    // layers can still carry a texture, and a restore that left the last
    // document's grain on would be the same fault as one that left its looks.
    setTexture(savedFilm);
    if (saved.length === 0) {
      // An empty grade is a real one — the picture that wears no look while
      // the trip wears one — so the stack has to EMPTY, not stay on whatever
      // the last document put in it. Only relevant since a deck's pictures
      // can each depart (`roadtrip/post-grade.ts`); before that every restore
      // that mattered carried layers.
      setCustomText({});
      setLayers([]);
      return;
    }
    setBusy(true);
    // One resolver for the whole suite (`saved-grade.ts`), shared with the
    // read-only bake of the grades nobody is editing.
    const { layers: restored, customText: texts } = await restoreLayers(saved);
    setCustomText(texts);
    setLayers(restored);
    setBusy(false);
  }, []);

  const revert = useCallback(
    (
      next: LutLayer[],
      nextOutput: OutputTransform,
      nextText: Record<string, string>,
      nextFilm: FilmTexture | null = null,
    ) => {
      // The arrays go back BY REFERENCE, never copied: a caller holding a
      // history compares what it gets back against what it put in, and a copy
      // — equal in every value — reads as a fresh edit and costs it the step
      // it just took. Everything here is treated as immutable anyway.
      setLayers(next);
      setOutput(nextOutput);
      setCustomText(nextText);
      setTexture(nextFilm);
    },
    [],
  );

  const toSaved = useCallback(
    (): SavedLutLayer[] =>
      layers.map((l) => ({
        id: l.id,
        source: l.source,
        name: l.name,
        customText:
          l.source === 'custom' || isFilmLayer(l) || isPackLayer(l)
            ? (customText[l.id] ?? null)
            : null,
        intensity: l.intensity,
        enabled: l.enabled,
      })),
    [layers, customText],
  );

  return {
    layers,
    output,
    interpolation,
    develop,
    composed,
    composedForDeveloped,
    composeWith,
    busy,
    error,
    addBuiltin,
    addCustom,
    addFilm,
    addPackLook,
    setFilm,
    remove,
    move,
    setIntensity,
    setEnabled,
    setOutput,
    setInterpolation,
    setDevelop,
    film,
    setTexture,
    customText,
    restore,
    revert,
    toSaved,
  };
}
