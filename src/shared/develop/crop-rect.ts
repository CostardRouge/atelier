/**
 * The Develop tool's crop as a ZONE drawn over the whole picture — the
 * arithmetic of the classic crop the maintainer asked for (2026-09-19), pure,
 * DOM-free and tested.
 *
 * The roll does not store a zone: it stores what it always stored, an
 * `aspect` and a `Framing` (`shared/media/framing.ts`, `fit: 'cover'`), which
 * every renderer already draws. The editor manipulates a zone and converts
 * both ways, so nothing migrates and the export, the filmstrip cell and the
 * Develop viewport are untouched by the change of gesture.
 *
 * The zone lives in the TURNED picture's frame: source pixels, origin at the
 * picture's centre, the picture rotated (and mirrored) about that centre the
 * way `drawFramed` turns it — so on the crop stage the picture turns UNDER an
 * axis-aligned zone. Written out:
 *
 *   screen = R(θ)·M·q        (q: a source pixel from the picture's centre)
 *   the frame shows [cx ± w/2] × [cy ± h/2] of that screen
 *   scale = 1 / max((w·c + h·s)/W, (w·s + h·c)/H)       c = |cos θ|, s = |sin θ|
 *   (px, py) = R(−θ)·(−cx, −cy),  x = px / max(w, h),  y = py / max(w, h)
 *
 * which is exactly `framingTransform`'s cover condition run backwards: a zone
 * whose four corners, turned back into the picture's axes, stay inside
 * `|qx| ≤ W/2, |qy| ≤ H/2` is a framing that never shows a gap — Fill's
 * invariant, the same inequality read from the other side.
 *
 * Every gesture produces a CANDIDATE zone and is then CLAMPED: from the last
 * zone that was valid toward the candidate, by bisection over the four edges
 * interpolated together. That one rule is what keeps a handle anchored on its
 * opposite edge (both zones share the anchor, so every zone between them
 * does), keeps a locked ratio (two zones of one ratio interpolate at that
 * ratio) and stops a drag at the picture's edge instead of letting it jump.
 */

import { ASPECT_PRESETS } from '../projects/project-types';
import {
  MAX_FRAMING_SCALE,
  framingTransform,
  wrapDegrees,
  type Framing,
} from '../media/framing';
import { FREE_ASPECT_MAX, FREE_ASPECT_MIN, freeAspectId, type CropHandle } from './crop-aspect';

/** A crop zone in the turned picture's frame, in source pixels from its centre. */
export interface CropZone {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface PictureDims {
  width: number;
  height: number;
}

const RAD = Math.PI / 180;

/** How far a zone may overhang the picture before it reads as a gap — float noise, never a pixel. */
const EPS = 1e-9;

function turn(deg: number): { cos: number; sin: number; c: number; s: number } {
  const a = wrapDegrees(deg) * RAD;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { cos, sin, c: Math.abs(cos), s: Math.abs(sin) };
}

/** The zone's centre in the picture's own (un-turned) axes: R(−θ)·c. */
function intoPicture(cx: number, cy: number, deg: number): { qx: number; qy: number } {
  const { cos, sin } = turn(deg);
  return { qx: cx * cos + cy * sin, qy: -cx * sin + cy * cos };
}

/**
 * How much of the picture a zone of this size takes, the larger of its two
 * axes once turned back: 1 is a zone that exactly covers at scale 1, 1/8 the
 * smallest `MAX_FRAMING_SCALE` allows.
 */
export function zoneBase(w: number, h: number, deg: number, src: PictureDims): number {
  const { c, s } = turn(deg);
  return Math.max((w * c + h * s) / src.width, (w * s + h * c) / src.height);
}

// --- the stored crop, both ways --------------------------------------------

/**
 * The aspect id a zone of this ratio is stored as: one of the suite's named
 * formats when it IS one (to a thousandth), else a free zone carrying its
 * own ratio. `original` is the caller's to ask for — it names the picture's
 * own shape, which only the caller knows is what was chosen.
 */
export function aspectIdFor(ratio: number): string {
  const preset = ASPECT_PRESETS.find((p) => Math.abs(p.w / p.h / ratio - 1) < 1e-3);
  return preset ? preset.id : freeAspectId(ratio);
}

/**
 * The framing a zone is stored as — always `fit: 'cover'`, the rotation and
 * the flips as given (the zone does not carry them: it is drawn over a
 * picture ALREADY turned by them).
 */
export function cropFromZone(
  src: PictureDims,
  zone: CropZone,
  rotation: number,
  flipX: boolean,
  flipY: boolean,
): Framing {
  const { cos, sin } = turn(rotation);
  const base = zoneBase(zone.w, zone.h, rotation, src);
  const scale = Math.min(MAX_FRAMING_SCALE, Math.max(1, base > 0 ? 1 / base : 1));
  const unit = Math.max(zone.w, zone.h);
  const px = -(zone.cx * cos + zone.cy * sin);
  const py = -(-zone.cx * sin + zone.cy * cos);
  return {
    scale,
    x: unit > 0 ? px / unit || 0 : 0,
    y: unit > 0 ? py / unit || 0 : 0,
    rotation: wrapDegrees(rotation),
    flipX,
    flipY,
    fit: 'cover',
  };
}

/**
 * The zone a stored crop shows — read through `framingTransform` itself, so
 * the pan is clamped exactly as the renderers clamp it and the zone is what
 * the export will cut, not what the numbers merely say. A `contain` framing
 * (the retired Whole) is read as its cover twin: the caller decides what to
 * do with a legacy picture (`legacyWholeBorder`).
 */
export function zoneFromCrop(src: PictureDims, aspectRatio: number, framing: Framing): CropZone {
  const r = aspectRatio > 0 ? aspectRatio : src.width / src.height;
  const { c, s } = turn(framing.rotation);
  const zoom = Math.min(MAX_FRAMING_SCALE, Math.max(1, framing.scale));
  // The zone of ratio r that exactly covers at scale 1, shrunk by the zoom.
  const h = 1 / zoom / Math.max((r * c + s) / src.width, (r * s + c) / src.height);
  const w = h * r;
  const t = framingTransform(src.width, src.height, w, h, { ...framing, fit: 'cover' });
  const px = t.scale > 0 ? t.panX / t.scale : 0;
  const py = t.scale > 0 ? t.panY / t.scale : 0;
  // c = −R(θ)·p
  const { cos, sin } = turn(framing.rotation);
  return { cx: -(px * cos - py * sin) || 0, cy: -(px * sin + py * cos) || 0, w, h };
}

// --- validity and the clamp -------------------------------------------------

/** Every corner of the zone inside the turned picture — Fill's invariant. */
export function zoneContained(zone: CropZone, deg: number, src: PictureDims): boolean {
  const { c, s } = turn(deg);
  const { qx, qy } = intoPicture(zone.cx, zone.cy, deg);
  const tol = EPS * Math.max(src.width, src.height);
  return (
    Math.abs(qx) + (zone.w * c + zone.h * s) / 2 <= src.width / 2 + tol &&
    Math.abs(qy) + (zone.w * s + zone.h * c) / 2 <= src.height / 2 + tol
  );
}

/**
 * A zone the roll can store: inside the picture, no smaller than the deepest
 * zoom a framing allows, and no stranger a shape than a free aspect may be.
 */
export function zoneValid(zone: CropZone, deg: number, src: PictureDims): boolean {
  if (!(zone.w > 0 && zone.h > 0) || !Number.isFinite(zone.cx) || !Number.isFinite(zone.cy)) return false;
  const ratio = zone.w / zone.h;
  if (ratio < FREE_ASPECT_MIN * (1 - 1e-4) || ratio > FREE_ASPECT_MAX * (1 + 1e-4)) return false;
  if (zoneBase(zone.w, zone.h, deg, src) < 1 / MAX_FRAMING_SCALE - 1e-9) return false;
  return zoneContained(zone, deg, src);
}

function lerpZone(a: CropZone, b: CropZone, t: number): CropZone {
  // The four EDGES interpolated, not the centre and size: the same thing
  // numerically, but it is the edges that must stay put under a handle.
  const l = a.cx - a.w / 2 + (b.cx - b.w / 2 - (a.cx - a.w / 2)) * t;
  const r = a.cx + a.w / 2 + (b.cx + b.w / 2 - (a.cx + a.w / 2)) * t;
  const top = a.cy - a.h / 2 + (b.cy - b.h / 2 - (a.cy - a.h / 2)) * t;
  const bot = a.cy + a.h / 2 + (b.cy + b.h / 2 - (a.cy + a.h / 2)) * t;
  return { cx: (l + r) / 2, cy: (top + bot) / 2, w: r - l, h: bot - top };
}

/**
 * The candidate if it is valid, else the zone furthest along the way from
 * `from` (the last valid one) toward it that still is. `from` itself is
 * returned when it is not valid either — a zone the editor did not draw (an
 * undo, a legacy framing) is left for the next gesture to replace.
 */
export function clampToward(
  from: CropZone,
  to: CropZone,
  deg: number,
  src: PictureDims,
  valid: (z: CropZone) => boolean = (z) => zoneValid(z, deg, src),
): CropZone {
  if (valid(to)) return to;
  if (!valid(from)) return from;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (valid(lerpZone(from, to, mid))) lo = mid;
    else hi = mid;
  }
  return lo === 0 ? from : lerpZone(from, to, lo);
}

// --- gestures ---------------------------------------------------------------

/**
 * The zone moved by (dx, dy), SLIDING along the picture's edge: the whole move
 * as far as it goes, then what is left of it on x alone, then on y — so a drag
 * into a corner keeps travelling along the side it reached instead of sticking.
 */
export function moveZone(zone: CropZone, dx: number, dy: number, deg: number, src: PictureDims): CropZone {
  const shift = (z: CropZone, x: number, y: number) => ({ ...z, cx: z.cx + x, cy: z.cy + y });
  const full = clampToward(zone, shift(zone, dx, dy), deg, src);
  const alongX = clampToward(full, shift(full, zone.cx + dx - full.cx, 0), deg, src);
  return clampToward(alongX, shift(alongX, 0, zone.cy + dy - alongX.cy), deg, src);
}

/** The smallest a side is let get while a handle is dragged across its anchor. */
function minSide(src: PictureDims): number {
  return Math.max(src.width, src.height) * 1e-3;
}

/**
 * What a handle asks for, before the clamp: the handle's edge (or corner)
 * follows the pointer and the OPPOSITE edge (or corner) stays where it was
 * when the drag began. With a locked ratio a corner keeps it from the
 * opposite corner, taking the larger of the two sides the pointer asks for;
 * an edge adjusts the other side about the centre.
 */
export function resizeCandidate(
  start: CropZone,
  handle: CropHandle,
  px: number,
  py: number,
  lock: number | null,
  src: PictureDims,
): CropZone {
  const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  const m = minSide(src);
  // The anchor: the opposite edge on each axis the handle moves.
  const ax = start.cx - (sx * start.w) / 2;
  const ay = start.cy - (sy * start.h) / 2;
  let w = sx ? Math.max(m, sx * (px - ax)) : start.w;
  let h = sy ? Math.max(m, sy * (py - ay)) : start.h;
  if (lock && lock > 0) {
    if (sx && sy) {
      w = Math.max(w, h * lock);
      h = w / lock;
    } else if (sx) {
      h = w / lock;
    } else {
      w = h * lock;
    }
  }
  return {
    cx: sx ? ax + (sx * w) / 2 : start.cx,
    cy: sy ? ay + (sy * h) / 2 : start.cy,
    w,
    h,
  };
}

/** A handle dragged to (px, py): the candidate, clamped from the zone on screen now. */
export function resizeZone(
  start: CropZone,
  current: CropZone,
  handle: CropHandle,
  px: number,
  py: number,
  lock: number | null,
  deg: number,
  src: PictureDims,
): CropZone {
  return clampToward(current, resizeCandidate(start, handle, px, py, lock, src), deg, src);
}

/**
 * A zone drawn from `anchor` to the pointer — the rectangle between them, at
 * the locked ratio when there is one (the larger side wins, as a corner's).
 * Grown about the anchor to the smallest zone a framing allows, so the first
 * few pixels of a draw do not read as refused.
 */
export function drawCandidate(
  anchor: { x: number; y: number },
  px: number,
  py: number,
  lock: number | null,
  deg: number,
  src: PictureDims,
): CropZone {
  const dirX = px >= anchor.x ? 1 : -1;
  const dirY = py >= anchor.y ? 1 : -1;
  const m = minSide(src);
  let w = Math.max(m, Math.abs(px - anchor.x));
  let h = Math.max(m, Math.abs(py - anchor.y));
  if (lock && lock > 0) {
    w = Math.max(w, h * lock);
    h = w / lock;
  } else {
    const ratio = Math.min(FREE_ASPECT_MAX, Math.max(FREE_ASPECT_MIN, w / h));
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
  }
  const base = zoneBase(w, h, deg, src);
  const grow = base > 0 && base < 1 / MAX_FRAMING_SCALE ? 1 / MAX_FRAMING_SCALE / base : 1;
  w *= grow;
  h *= grow;
  return { cx: anchor.x + (dirX * w) / 2, cy: anchor.y + (dirY * h) / 2, w, h };
}

/**
 * The largest zone of `w : h` centred on (cx, cy) — no larger than `cap`
 * times the size given — that fits the turned picture, the centre pulled
 * toward the middle only as far as a zone of the smallest allowed size needs.
 * One function behind choosing a format, swapping it, the double-click and
 * straightening from an intent.
 */
export function fitAround(
  cx: number,
  cy: number,
  w: number,
  h: number,
  deg: number,
  src: PictureDims,
  cap = Infinity,
): CropZone {
  if (!(w > 0 && h > 0)) return { cx: 0, cy: 0, w: src.width, h: src.height };
  const { c, s } = turn(deg);
  const halfX = (w * c + h * s) / 2;
  const halfY = (w * s + h * c) / 2;
  const kMin = 1 / MAX_FRAMING_SCALE / zoneBase(w, h, deg, src);
  const kAt = (x: number, y: number) => {
    const { qx, qy } = intoPicture(x, y, deg);
    return Math.min(cap, (src.width / 2 - Math.abs(qx)) / halfX, (src.height / 2 - Math.abs(qy)) / halfY);
  };
  let x = cx;
  let y = cy;
  let k = kAt(x, y);
  if (!(k >= kMin)) {
    // Pulled toward the middle, as little as it takes.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i += 1) {
      const mid = (lo + hi) / 2;
      if (kAt(cx * (1 - mid), cy * (1 - mid)) >= kMin) hi = mid;
      else lo = mid;
    }
    x = cx * (1 - hi);
    y = cy * (1 - hi);
    k = Math.max(kMin, kAt(x, y));
  }
  // A hair inside, so float noise never reads as a gap on the next check.
  const kk = k * (1 - 1e-9);
  return { cx: x, cy: y, w: w * kk, h: h * kk };
}

/** The largest zone of this ratio in the turned picture, centred — the double-click. */
export function maxZone(ratio: number, deg: number, src: PictureDims): CropZone {
  return fitAround(0, 0, ratio, 1, deg, src);
}

/**
 * After a rotation: the INTENT (the last zone the author drew) shrunk just
 * enough to fit the picture at its new angle, never grown past it — so a
 * straighten to 3° and back to 0° gives the drawn zone back, not a zone that
 * shrank twice.
 */
export function fitIntent(intent: CropZone, deg: number, src: PictureDims): CropZone {
  return fitAround(intent.cx, intent.cy, intent.w, intent.h, deg, src, 1);
}

/** The zone turned with the picture by a quarter: clockwise (cx, cy, w, h) → (−cy, cx, h, w). */
export function quarterTurnZone(zone: CropZone, dir: 1 | -1): CropZone {
  return dir === 1
    ? { cx: -zone.cy || 0, cy: zone.cx, w: zone.h, h: zone.w }
    : { cx: zone.cy, cy: -zone.cx || 0, w: zone.h, h: zone.w };
}

/** The zone mirrored with what the frame shows: its centre across that axis (`flipFraming`'s zone). */
export function flipZone(zone: CropZone, axis: 'x' | 'y'): CropZone {
  return axis === 'x' ? { ...zone, cx: -zone.cx || 0 } : { ...zone, cy: -zone.cy || 0 };
}

/**
 * The correction a Level line asks for, in degrees: the line drawn along what
 * should be the horizon (or a vertical — whichever it is closer to) turned
 * level. On screen, y down, so a line falling to the right is a clockwise
 * tilt and is corrected anticlockwise.
 */
export function levelDelta(x1: number, y1: number, x2: number, y2: number): number {
  if (x1 === x2 && y1 === y2) return 0;
  let a = Math.atan2(y2 - y1, x2 - x1) / RAD; // (−180, 180]
  // A line drawn right-to-left is the same line.
  if (a > 90) a -= 180;
  else if (a <= -90) a += 180;
  const delta = Math.abs(a) <= 45 ? -a : -(a - Math.sign(a) * 90);
  return delta || 0;
}

/** The fine angle within its quarter, and the quarter it sits in: 93° → 90 + 3. */
export function splitRotation(deg: number): { quarter: number; fine: number } {
  const d = wrapDegrees(deg);
  const quarter = Math.round(d / 90) * 90;
  return { quarter: wrapDegrees(quarter), fine: d - quarter };
}

/** The turned picture's four corners in the zone's frame — the outline the stage dashes. */
export function turnedCorners(deg: number, src: PictureDims): { x: number; y: number }[] {
  const { cos, sin } = turn(deg);
  const hw = src.width / 2;
  const hh = src.height / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => ({ x: x * cos - y * sin, y: x * sin + y * cos }));
}

/** Whether a point of the zone's frame falls on the turned picture — where a draw may begin. */
export function pointOnPicture(x: number, y: number, deg: number, src: PictureDims): boolean {
  const { qx, qy } = intoPicture(x, y, deg);
  return Math.abs(qx) <= src.width / 2 && Math.abs(qy) <= src.height / 2;
}

/**
 * A stored crop's zone, scaled to the full-size source: the stage works on
 * the decoded preview, and the tag says what the FILE will give.
 */
export function zoneInSourcePixels(zone: CropZone, preview: PictureDims, source: PictureDims | null): { w: number; h: number } {
  const k = source && preview.width > 0 ? source.width / preview.width : 1;
  return { w: Math.round(zone.w * k), h: Math.round(zone.h * k) };
}

export type { CropHandle };
