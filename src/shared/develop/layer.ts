/**
 * An ADJUSTMENT LAYER — a develop that applies only where its mask says.
 *
 * The maintainer asked for "layers with opacity controls". This is the record
 * behind that, and the one decision it rests on:
 *
 * **A layer's adjustment IS a `DevelopSettings`.** Not a reduced set, not a
 * parallel type — the very record the global develop uses, which means the
 * same maths (`developStage`), the same bake (`composeLutStack`), the same
 * panel and the same 40-odd specs. Local exposure, local white balance, local
 * curves all arrive at once and for nothing. That reuse is what makes masking
 * affordable at all (`docs/photo-editor.md` §6), and it is why the layer lives
 * here in `develop/` rather than beside the mask in `render/`.
 *
 * What a layer does NOT have, and why:
 *
 * - **No blend mode.** It was in the plan and is not in the ask. An adjustment
 *   layer with a multiply mode is a compositing feature, and nothing in the
 *   list wants one; opacity is the control that was asked for. Adding it later
 *   is one field and one `mix`.
 * - **No look of its own.** A LUT is the picture's or the roll's; a mask
 *   choosing between two conversion LUTs is a different feature from a local
 *   correction, and mixing them would put two conversions on one picture.
 *
 * Pure and DOM-free.
 */

import {
  DEFAULT_DEVELOP,
  developOrNull,
  isDefaultDevelop,
  sameDevelop,
  type DevelopSettings,
} from './develop';
import {
  cloneMask,
  defaultMask,
  describeMask,
  normaliseMask,
  sameMask,
  type Mask,
  type MaskKind,
} from '../render/mask';

export interface AdjustLayer {
  id: string;
  /** What the list calls it. Empty means "describe the mask instead". */
  name: string;
  /** Where it applies. Null is the whole picture — a local develop with no shape yet. */
  mask: Mask | null;
  /** Apply everywhere the mask ISN'T — one flag rather than a second mask kind. */
  invert: boolean;
  develop: DevelopSettings;
  /** 0..1, how much of the adjustment lands where the mask is full. */
  opacity: number;
  enabled: boolean;
}

export const MAX_LAYERS = 12;

export function newLayerId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `ly_${Math.random().toString(36).slice(2)}`;
}

export function createLayer(kind: MaskKind | null = 'linear', id: string = newLayerId()): AdjustLayer {
  return {
    id,
    name: '',
    mask: kind ? defaultMask(kind) : null,
    invert: false,
    develop: { ...DEFAULT_DEVELOP },
    opacity: 1,
    enabled: true,
  };
}

function clamp01(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

export function normaliseLayer(raw: unknown, id: string = newLayerId()): AdjustLayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  return {
    id: typeof src.id === 'string' && src.id ? src.id : id,
    name: typeof src.name === 'string' ? src.name.slice(0, 80) : '',
    mask: normaliseMask(src.mask),
    invert: src.invert === true,
    // A layer whose develop is absent or junk is a layer that does nothing —
    // kept, because deleting somebody's layer on a read is never the answer.
    develop: developOrNull(src.develop) ?? { ...DEFAULT_DEVELOP },
    opacity: clamp01(src.opacity, 1),
    enabled: src.enabled !== false,
  };
}

/** Read a stored list, dropping what is not a layer and capping the length. */
export function readLayers(raw: unknown): AdjustLayer[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((l) => normaliseLayer(l) ?? []).slice(0, MAX_LAYERS);
}

/**
 * A layer that would change nothing: off, transparent, or carrying an
 * untouched develop. The renderers skip these, so an author can park a layer
 * at zero without paying a GPU pass for it.
 */
export function layerDraws(l: AdjustLayer): boolean {
  return l.enabled && l.opacity > 0 && !isDefaultDevelop(l.develop);
}

export function drawingLayers(layers: readonly AdjustLayer[] | null | undefined): AdjustLayer[] {
  return (layers ?? []).filter(layerDraws);
}

/**
 * The layers whose SUBJECT the model must find: every visible one with a point,
 * whether or not it draws yet. Deliberately not `drawingLayers` — a fresh
 * subject has its sliders at zero, and waiting for it to draw meant a tap
 * segmented nothing until a slider moved, a pick that looked as if it had not
 * taken. The mask is found on the tap; the layer uses it once it has a develop.
 */
export function subjectLayersToSegment(layers: readonly AdjustLayer[] | null | undefined): AdjustLayer[] {
  return (layers ?? []).filter(
    (l) => l.enabled && l.mask?.kind === 'subject' && l.mask.points.length > 0,
  );
}

export function sameLayer(a: AdjustLayer, b: AdjustLayer): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.invert === b.invert &&
    a.opacity === b.opacity &&
    a.enabled === b.enabled &&
    sameMask(a.mask, b.mask) &&
    sameDevelop(a.develop, b.develop)
  );
}

export function sameLayers(
  a: readonly AdjustLayer[] | null | undefined,
  b: readonly AdjustLayer[] | null | undefined,
): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  return x.every((l, i) => sameLayer(l, y[i]));
}

export function cloneLayer(l: AdjustLayer): AdjustLayer {
  return { ...l, mask: cloneMask(l.mask), develop: { ...l.develop } };
}

export function cloneLayers(layers: readonly AdjustLayer[] | null | undefined): AdjustLayer[] {
  return (layers ?? []).map(cloneLayer);
}

// --- the list -----------------------------------------------------------------
//
// The array is BOTTOM to TOP: entry 0 is applied first and everything after it
// reads what the one below wrote. A list on screen shows the top first, the way
// every layer UI since Photoshop has, so it renders reversed — and these
// helpers all speak the real order, so no index arithmetic crosses that seam.

/** Appended on TOP, which is where a new layer belongs. Capped at `MAX_LAYERS`. */
export function addLayer(
  layers: readonly AdjustLayer[] | null | undefined,
  layer: AdjustLayer,
): AdjustLayer[] {
  const list = layers ?? [];
  if (list.length >= MAX_LAYERS) return [...list];
  return [...list, layer];
}

export function removeLayer(
  layers: readonly AdjustLayer[] | null | undefined,
  id: string,
): AdjustLayer[] {
  return (layers ?? []).filter((l) => l.id !== id);
}

/** `delta` is in STACK terms: +1 is nearer the top, and the ends hold. */
export function moveLayer(
  layers: readonly AdjustLayer[] | null | undefined,
  id: string,
  delta: number,
): AdjustLayer[] {
  const list = [...(layers ?? [])];
  const from = list.findIndex((l) => l.id === id);
  if (from < 0) return list;
  const to = Math.max(0, Math.min(list.length - 1, from + Math.trunc(delta)));
  if (to === from) return list;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return list;
}

/** One layer's own fields changed; its id never moves. */
export function patchLayer(
  layers: readonly AdjustLayer[] | null | undefined,
  id: string,
  patch: Partial<Omit<AdjustLayer, 'id'>>,
): AdjustLayer[] {
  return (layers ?? []).map((l) => (l.id === id ? { ...l, ...patch } : l));
}

/** The layer's own name, else what its mask is — never an empty row. */
export function layerLabel(l: AdjustLayer): string {
  const named = l.name.trim();
  if (named) return named;
  const where = describeMask(l.mask);
  return l.invert ? `not ${where}` : where;
}
