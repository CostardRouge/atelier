/**
 * The arithmetic behind `develop.crop` and `develop.getCrop`: an agent's
 * crop, in words a script can write — a RECTANGLE in fractions of the picture
 * as turned, a format, a straighten, quarter turns and flips — turned into the
 * `aspect` + `Framing` the roll stores, by the very rules the Crop tab's zone
 * follows (`use-crop-zone.ts`), applied in the order its gestures would be:
 * reset · quarter turns · flips · format · rectangle · straighten.
 *
 * A rectangle is read in the picture turned by its QUARTER turns only — the
 * frame the zone lives in before a fine straighten — with (0, 0) the top-left
 * corner and (1, 1) the bottom-right. A straighten then turns the picture
 * UNDER the zone, which is shrunk just enough to stay on the picture (Fill's
 * rule, never a gap) and the answer says so (`adjusted`), exactly as the
 * slider does. A rectangle that does not match a locked format, or a zone
 * smaller or stranger than a framing may be, is REFUSED.
 *
 * Pure and DOM-free.
 */

import { CommandError } from '../commands/registry';
import { DEFAULT_FRAMING, wrapDegrees, type Framing } from '../media/framing';
import { ASPECT_PRESETS } from '../projects/aspect-presets';
import { FREE_ASPECT_MAX, FREE_ASPECT_MIN, pictureAspectRatio } from './crop-aspect';
import {
  aspectIdFor,
  cropFromZone,
  fitAround,
  fitIntent,
  flipZone,
  quarterTurnZone,
  splitRotation,
  zoneFromCrop,
  zoneValid,
  type CropZone,
  type PictureDims,
} from './crop-rect';
import { numberIn } from './develop-record-commands';

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StoredCropValue {
  aspect: string;
  framing: Framing;
}

/** What the agent asks for; every field optional. */
export interface CropRequest {
  reset?: boolean;
  /** Quarter turns clockwise, −3..3. */
  turn?: number;
  /** The flips wanted, absolute. */
  flipX?: boolean;
  flipY?: boolean;
  /** `free`, `original`, or a format id (`1:1`, `4:5`, `16:9`…). */
  aspect?: string;
  rect?: unknown;
  /** The fine angle, −45..45, within the current quarter. */
  straighten?: number;
}

/** What a crop IS, as an agent reads it. */
export interface CropState {
  aspect: string;
  /** The zone's own shape, width over height. */
  ratio: number;
  rect: CropRect;
  /** Quarter turns clockwise, 0..3. */
  quarter: number;
  straighten: number;
  flipX: boolean;
  flipY: boolean;
  cropped: boolean;
}

export const CROP_FORMATS: readonly string[] = ['free', 'original', ...ASPECT_PRESETS.map((p) => p.id)];

const invalid = (message: string) => new CommandError('invalid', message);

/** The picture as turned by its quarter turns: the frame a rectangle is read in. */
function turnedDims(src: PictureDims, rotation: number): { w: number; h: number } {
  const odd = Math.abs(Math.round(splitRotation(rotation).quarter / 90)) % 2 === 1;
  return odd ? { w: src.height, h: src.width } : { w: src.width, h: src.height };
}

export function zoneFromRect(rect: CropRect, src: PictureDims, rotation: number): CropZone {
  const t = turnedDims(src, rotation);
  return { cx: (rect.x + rect.w / 2 - 0.5) * t.w, cy: (rect.y + rect.h / 2 - 0.5) * t.h, w: rect.w * t.w, h: rect.h * t.h };
}

export function rectFromZone(zone: CropZone, src: PictureDims, rotation: number): CropRect {
  const t = turnedDims(src, rotation);
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    x: round(zone.cx / t.w + 0.5 - zone.w / t.w / 2),
    y: round(zone.cy / t.h + 0.5 - zone.h / t.h / 2),
    w: round(zone.w / t.w),
    h: round(zone.h / t.h),
  };
}

/** A rectangle as an agent writes it, every edge inside the picture. */
export function readRect(raw: unknown): CropRect {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('rect must be {x, y, w, h} in fractions of the picture');
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!['x', 'y', 'w', 'h'].includes(k)) throw invalid(`rect has no "${k}" — it takes x, y, w, h`);
  const rect = { x: numberIn('rect.x', r.x, 0, 1), y: numberIn('rect.y', r.y, 0, 1), w: numberIn('rect.w', r.w, 0, 1), h: numberIn('rect.h', r.h, 0, 1) };
  if (!(rect.w > 0 && rect.h > 0)) throw invalid('rect needs a width and a height above 0');
  if (rect.x + rect.w > 1 + 1e-9) throw invalid(`rect reaches past the right edge (x + w = ${rect.x + rect.w})`);
  if (rect.y + rect.h > 1 + 1e-9) throw invalid(`rect reaches past the bottom edge (y + h = ${rect.y + rect.h})`);
  return rect;
}

/** The ratio a format holds on a picture whose turned shape is `shown`; null for free. */
function formatRatio(aspect: string, shown: number): number | null {
  if (aspect === 'free') return null;
  if (aspect === 'original') return shown;
  const preset = ASPECT_PRESETS.find((p) => p.id === aspect);
  if (!preset) throw invalid(`no format "${aspect}" — the formats are ${CROP_FORMATS.join(', ')}`);
  return preset.w / preset.h;
}

/** The crop as an agent reads it. */
export function cropState(stored: StoredCropValue, src: PictureDims): CropState {
  const ratio = pictureAspectRatio(stored.aspect, src.width, src.height);
  const zone = zoneFromCrop(src, ratio, stored.framing);
  const { quarter, fine } = splitRotation(stored.framing.rotation);
  const full = rectFromZone(zone, src, stored.framing.rotation);
  return {
    aspect: stored.aspect,
    ratio: Math.round((zone.w / zone.h) * 1e4) / 1e4,
    rect: full,
    quarter: ((Math.round(quarter / 90) % 4) + 4) % 4,
    straighten: Math.round(fine * 1e4) / 1e4,
    flipX: stored.framing.flipX,
    flipY: stored.framing.flipY,
    cropped: stored.aspect !== 'original' || full.w < 0.9999 || full.h < 0.9999 || fine !== 0 || quarter !== 0,
  };
}

/**
 * The stored crop `req` asks for, from `current` on a picture of `src`'s
 * size — and whether a straighten had to shrink the zone to keep it on the
 * picture.
 */
export function planCrop(
  current: StoredCropValue,
  src: PictureDims,
  req: CropRequest,
): { crop: StoredCropValue; adjusted: boolean } {
  let aspect = req.reset ? 'original' : current.aspect;
  let framing: Framing = req.reset ? { ...DEFAULT_FRAMING } : { ...current.framing, fit: 'cover' };
  let zone = zoneFromCrop(src, pictureAspectRatio(aspect, src.width, src.height), framing);
  // An 'original' kept through the gestures, as the chip would keep it.
  let format: string | null = aspect === 'original' ? 'original' : null;

  if (req.turn !== undefined) {
    const n = numberIn('turn', req.turn, -3, 3);
    if (!Number.isInteger(n)) throw invalid('turn must be a whole number of quarter turns');
    const dir = n < 0 ? -1 : 1;
    for (let i = 0; i < Math.abs(n); i++) {
      zone = quarterTurnZone(zone, dir);
      framing = { ...framing, rotation: wrapDegrees(framing.rotation + 90 * dir) };
    }
  }
  for (const axis of ['x', 'y'] as const) {
    const want = axis === 'x' ? req.flipX : req.flipY;
    const has = axis === 'x' ? framing.flipX : framing.flipY;
    if (want === undefined || want === has) continue;
    // `flipFraming`'s rule in zone terms: the angle negated, the centre mirrored.
    zone = flipZone(zone, axis);
    framing = {
      ...framing,
      rotation: wrapDegrees(-framing.rotation),
      flipX: axis === 'x' ? !framing.flipX : framing.flipX,
      flipY: axis === 'y' ? !framing.flipY : framing.flipY,
    };
  }

  const shownDims = turnedDims(src, framing.rotation);
  const shown = shownDims.w / shownDims.h;
  let lock: number | null = null;
  if (req.aspect !== undefined) {
    format = req.aspect;
    lock = formatRatio(req.aspect, shown);
    if (lock !== null && req.rect === undefined) zone = fitAround(zone.cx, zone.cy, lock, 1, framing.rotation, src);
  }

  if (req.rect !== undefined) {
    const rect = readRect(req.rect);
    const drawn = zoneFromRect(rect, src, framing.rotation);
    const ratio = drawn.w / drawn.h;
    if (lock !== null && Math.abs(ratio / lock - 1) > 0.01) {
      throw invalid(
        `rect is ${ratio.toFixed(3)}:1 in pixels, not the ${req.aspect} format (${lock.toFixed(3)}:1) — fit h = w × ${(shown / lock).toFixed(4)}, or use aspect "free"`,
      );
    }
    if (ratio < FREE_ASPECT_MIN || ratio > FREE_ASPECT_MAX) {
      throw invalid(`rect is ${ratio.toFixed(3)}:1 — a crop's shape stays within 1:${1 / FREE_ASPECT_MIN}..${FREE_ASPECT_MAX}:1`);
    }
    // Held exactly to the format when one is locked, about the rect's centre.
    zone = lock !== null ? { ...drawn, h: drawn.w / lock } : drawn;
    if (format === null || format === 'original') format = lock === null ? 'free' : format;
  }

  let adjusted = false;
  if (req.straighten !== undefined) {
    const fine = numberIn('straighten', req.straighten, -45, 45);
    const rotation = wrapDegrees(splitRotation(framing.rotation).quarter + fine);
    const fitted = fitIntent(zone, rotation, src);
    adjusted = Math.abs(fitted.w / zone.w - 1) > 1e-3;
    zone = fitted;
    framing = { ...framing, rotation };
  }

  if (!zoneValid(zone, framing.rotation, src)) {
    throw invalid('that crop leaves the picture, or is smaller than an eighth of it — draw a larger rectangle inside the picture');
  }
  const next = cropFromZone(src, zone, framing.rotation, framing.flipX, framing.flipY);
  const ratio = zone.w / zone.h;
  const own = src.width / src.height;
  aspect = format === 'original' && Math.abs(ratio / own - 1) < 1e-3 ? 'original' : aspectIdFor(ratio);
  return { crop: { aspect, framing: next }, adjusted };
}
