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

/** The layer's own name, else what its mask is — never an empty row. */
export function layerLabel(l: AdjustLayer): string {
  const named = l.name.trim();
  if (named) return named;
  const where = describeMask(l.mask);
  return l.invert ? `not ${where}` : where;
}
