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
  MASK_OPS,
  cloneMask,
  combineMask,
  defaultMask,
  describeMask,
  normaliseMask,
  sameMask,
  type Mask,
  type MaskKind,
  type MaskOp,
} from '../render/mask';

/**
 * A further mask COMBINED with the layer's own — Lightroom's Add, Subtract,
 * Intersect (audit item 16). "The sky, minus what I painted over the
 * mountain", "the shadows, but only in this ellipse", "this blue, anywhere
 * below the horizon".
 *
 * Any kind but a SUBJECT: a subject's raster comes from a model per LAYER
 * (`use-subject-masks.ts`), and the two combinations it is wanted in already
 * exist — a subject intersected with anything is a Subject layer carrying
 * that part, and anything minus the subject is `except`.
 */
export interface MaskPart {
  op: MaskOp;
  mask: Mask;
  /** This part turned inside out before it combines — each part has its own. */
  invert: boolean;
}

/** Each part is one more shape the pass evaluates per pixel, and a painted one a texture. */
export const MAX_MASK_PARTS = 4;

/** The kinds a part may be — every kind but a subject. */
export const PART_KINDS: readonly MaskKind[] = ['linear', 'radial', 'luma', 'colour', 'brush'];

export interface AdjustLayer {
  id: string;
  /** What the list calls it. Empty means "describe the mask instead". */
  name: string;
  /** Where it applies. Null is the whole picture — a local develop with no shape yet. */
  mask: Mask | null;
  /** Apply everywhere the mask ISN'T — one flag rather than a second mask kind. */
  invert: boolean;
  /**
   * The id of a SUBJECT layer whose mask is taken OUT of this one — "the whole
   * picture except the subject", Lightroom's subtract, the maintainer's pick
   * (2026-09-23). Applied after `invert`, so the hole stays a hole whichever
   * way this mask faces. Only a subject: its mask is a raster already on the
   * GPU, so the subtraction is one texture and one multiply. Null, a missing
   * layer or one that is not a subject subtracts nothing.
   */
  except: string | null;
  /**
   * Further masks combined with `mask`, in order — each one reads what the
   * ones before it made. Empty is the layer's own mask alone, which is every
   * layer written before these existed.
   */
  parts: MaskPart[];
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
    except: null,
    parts: [],
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
    except: typeof src.except === 'string' && src.except ? src.except : null,
    parts: readParts(src.parts),
    // A layer whose develop is absent or junk is a layer that does nothing —
    // kept, because deleting somebody's layer on a read is never the answer.
    develop: developOrNull(src.develop) ?? { ...DEFAULT_DEVELOP },
    opacity: clamp01(src.opacity, 1),
    enabled: src.enabled !== false,
  };
}

/** A stored part list: junk and subjects dropped, capped at `MAX_MASK_PARTS`. */
export function readParts(raw: unknown): MaskPart[] {
  if (!Array.isArray(raw)) return [];
  const out: MaskPart[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const mask = normaliseMask(e.mask);
    if (!mask || !PART_KINDS.includes(mask.kind)) continue;
    out.push({
      op: MASK_OPS.includes(e.op as MaskOp) ? (e.op as MaskOp) : 'add',
      mask,
      invert: e.invert === true,
    });
    if (out.length >= MAX_MASK_PARTS) break;
  }
  return out;
}

export function sameParts(a: readonly MaskPart[] | null | undefined, b: readonly MaskPart[] | null | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((p, i) => p.op === y[i].op && p.invert === y[i].invert && sameMask(p.mask, y[i].mask));
}

export function cloneParts(parts: readonly MaskPart[] | null | undefined): MaskPart[] {
  return (parts ?? []).map((p) => ({ op: p.op, invert: p.invert, mask: cloneMask(p.mask) as Mask }));
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
  const list = layers ?? [];
  // A subject another layer SUBTRACTS is wanted even hidden: hiding the
  // subject's own adjustment must not fill the hole it cuts in the whole.
  const cut = new Set(list.filter((l) => l.enabled && l.except).map((l) => l.except));
  return list.filter(
    (l) => (l.enabled || cut.has(l.id)) && l.mask?.kind === 'subject' && l.mask.points.length > 0,
  );
}

/**
 * The subject layers a DELIVERY must segment: those that draw, and those a
 * drawing layer subtracts. Narrower than `subjectLayersToSegment`, which also
 * serves a subject still at zero for the author to look at — an export segments
 * nothing it would not use, since each point is an inference.
 */
export function subjectLayersForRender(layers: readonly AdjustLayer[] | null | undefined): AdjustLayer[] {
  const drawing = drawingLayers(layers);
  const needed = new Set<string>();
  for (const l of drawing) {
    if (l.mask?.kind === 'subject') needed.add(l.id);
    if (l.except) needed.add(l.except);
  }
  return subjectLayersToSegment(layers).filter((l) => needed.has(l.id));
}

/** The subject layers a layer may subtract: every other layer whose mask is a subject. */
export function exceptCandidates(
  layers: readonly AdjustLayer[] | null | undefined,
  id: string,
): AdjustLayer[] {
  return (layers ?? []).filter((l) => l.id !== id && l.mask?.kind === 'subject');
}

export function sameLayer(a: AdjustLayer, b: AdjustLayer): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.invert === b.invert &&
    a.except === b.except &&
    sameParts(a.parts, b.parts) &&
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
  return { ...l, mask: cloneMask(l.mask), parts: cloneParts(l.parts), develop: { ...l.develop } };
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
  // A layer that subtracted the one removed subtracts nothing now, rather than
  // pointing at an id that is gone.
  return (layers ?? [])
    .filter((l) => l.id !== id)
    .map((l) => (l.except === id ? { ...l, except: null } : l));
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

const OP_GLYPH: Record<MaskOp, string> = { add: '+', subtract: '−', intersect: '∩' };

/** `− painted · 2 strokes`, `∩ not shadows` — one part, as the list and a label read it. */
export function describePart(p: MaskPart): string {
  const d = describeMask(p.mask);
  return `${OP_GLYPH[p.op]} ${p.invert ? `not ${d}` : d}`;
}

/** The layer's own name, else what its mask is — never an empty row. */
export function layerLabel(l: AdjustLayer, layers?: readonly AdjustLayer[] | null): string {
  const named = l.name.trim();
  if (named) return named;
  const described = describeMask(l.mask);
  const own = l.invert ? `not ${described}` : described;
  const where = (l.parts ?? []).length ? `${own} ${l.parts.map(describePart).join(' ')}` : own;
  const cut = l.except ? layers?.find((o) => o.id === l.except && o.mask?.kind === 'subject') : null;
  return cut ? `${where} except ${cut.name.trim() || 'the subject'}` : where;
}

/**
 * How much of a layer lands on a pixel: the mask, turned by `invert`, combined
 * with each PART in order (each turned by its own invert first), holed by the
 * subtracted subject, scaled by the opacity. `layer-pass.ts`'s shader is a
 * transcription of this; the order is the point — the hole comes AFTER the
 * invert and the parts, so it stays a hole whichever way the mask faces.
 *
 * `parts` carries each part's VALUE at this pixel, already evaluated
 * (`maskAt`), beside its op and invert.
 */
export function layerWeight(
  mask: number,
  invert: boolean,
  except: number,
  opacity: number,
  parts: readonly { op: MaskOp; invert: boolean; value: number }[] = [],
): number {
  let m = invert ? 1 - mask : mask;
  for (const p of parts) m = combineMask(m, p.invert ? 1 - p.value : p.value, p.op);
  return m * (1 - except) * opacity;
}

// --- which mask the author is working on ---------------------------------------
//
// A layer's masks are the COMPONENT list: null is its own mask, 0.. its parts.
// The stage's gestures (paint, pick, sample) act on the one open in the panel.

export function componentMask(l: AdjustLayer, part: number | null): Mask | null {
  if (part === null) return l.mask;
  return l.parts?.[part]?.mask ?? null;
}

/** The layer with one component's mask replaced; an index past the list changes nothing. */
export function withComponentMask(l: AdjustLayer, part: number | null, mask: Mask | null): AdjustLayer {
  if (part === null) return { ...l, mask };
  if (!mask || !l.parts?.[part]) return l;
  return { ...l, parts: l.parts.map((p, i) => (i === part ? { ...p, mask } : p)) };
}

/** A part appended, capped at `MAX_MASK_PARTS`; a subject is refused. */
export function addPart(l: AdjustLayer, op: MaskOp, kind: MaskKind): AdjustLayer {
  const parts = l.parts ?? [];
  if (parts.length >= MAX_MASK_PARTS || !PART_KINDS.includes(kind)) return l;
  return { ...l, parts: [...parts, { op, mask: defaultMask(kind), invert: false }] };
}

export function patchPart(l: AdjustLayer, index: number, patch: Partial<MaskPart>): AdjustLayer {
  if (!l.parts?.[index]) return l;
  return { ...l, parts: l.parts.map((p, i) => (i === index ? { ...p, ...patch } : p)) };
}

export function removePart(l: AdjustLayer, index: number): AdjustLayer {
  if (!l.parts?.[index]) return l;
  return { ...l, parts: l.parts.filter((_, i) => i !== index) };
}
