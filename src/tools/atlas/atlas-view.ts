/**
 * Where Flight Atlas looks — the camera, pure.
 *
 * A view is a centre in Web Mercator world units and a scale NORMALISED by
 * the frame's short side (world units across the short side = 1 / scale), so
 * the same view draws the same picture in a 640 px preview and a 2160 px
 * export. On top of it two looks no slippy map offers: a BEARING (the whole
 * map turned) and a TILT (the map squashed vertically, a cheap perspective
 * that, with the altitude lift, reads as a landscape seen from an angle).
 *
 * The projection is one affine map, recomputed per frame and applied by hand
 * to every point (`project`), so line widths stay in pixels whatever the zoom
 * and the doubles never pass through a 32-bit canvas transform.
 *
 * The FOLLOW camera is a function of time, never an accumulator: a track is
 * simulated once at a fixed step and read back by interpolation, so a frame
 * drawn at 24 fps in an export is the frame the preview drew at 60.
 */

import { unionBox, type WorldBox } from './atlas-flight';

export interface AtlasView {
  /** World x of the frame's centre. */
  cx: number;
  /** World y of the frame's centre. */
  cy: number;
  /** Short sides per world unit — `scale × short side` is pixels per world unit. */
  scale: number;
}

/** The two looks every view is drawn with. */
export interface ViewLook {
  /** Degrees, clockwise. */
  bearing: number;
  /** Vertical squash, `0.3..1` (1 = straight down). */
  tilt: number;
}

/** `sx = a·x + c·y + e`, `sy = b·x + d·y + f`. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** The deepest zoom a view may take, as normalised scale (≈ zoom 19 on a 1080 short side). */
export const MAX_SCALE = (256 * 2 ** 19) / 1080;
/** The widest: the whole world across the short side. */
export const MIN_SCALE = 0.5;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** The affine map from world to pixels for a `width × height` frame. */
export function viewAffine(view: AtlasView, look: ViewLook, width: number, height: number): Affine {
  const s = view.scale * Math.min(width, height);
  const r = (look.bearing * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const tilt = Math.min(1, Math.max(0.2, look.tilt));
  // Rotate, then squash the screen's vertical, then centre.
  const a = s * cos;
  const c = -s * sin;
  const b = s * sin * tilt;
  const d = s * cos * tilt;
  return {
    a,
    b,
    c,
    d,
    e: width / 2 - (a * view.cx + c * view.cy),
    f: height / 2 - (b * view.cx + d * view.cy),
  };
}

/** The inverse map, pixels to world. */
export function invertAffine(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c || 1e-12;
  const a = m.d / det;
  const b = -m.b / det;
  const c = -m.c / det;
  const d = m.a / det;
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
}

/** The world box a frame shows (its four corners unprojected). */
export function visibleBox(view: AtlasView, look: ViewLook, width: number, height: number): WorldBox {
  const inv = invertAffine(viewAffine(view, look, width, height));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ]) {
    xs.push(inv.a * px + inv.c * py + inv.e);
    ys.push(inv.b * px + inv.d * py + inv.f);
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * The view that shows `box` inside a `width × height` frame with `padding`
 * (a fraction of the short side) on every edge, under the look's bearing and
 * tilt. A box of no size (a hover) is opened to `minSpan` world units.
 */
export function fitView(
  box: WorldBox,
  look: ViewLook,
  width: number,
  height: number,
  padding = 0.08,
  minSpan = 0.00004,
): AtlasView {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const hw = Math.max(minSpan, box.x1 - box.x0) / 2;
  const hh = Math.max(minSpan, box.y1 - box.y0) / 2;
  const r = (look.bearing * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  const tilt = Math.min(1, Math.max(0.2, look.tilt));
  // Half-extents of the turned box on screen, per unit of scale.
  const ex = hw * cos + hh * sin;
  const ey = (hw * sin + hh * cos) * tilt;
  const short = Math.min(width, height);
  const pad = Math.min(0.45, Math.max(0, padding)) * short;
  // Never less than a twentieth of the short side, in whatever unit the frame is given.
  const availX = Math.max(short * 0.05, width / 2 - pad);
  const availY = Math.max(short * 0.05, height / 2 - pad);
  const px = Math.min(availX / ex, availY / ey); // pixels per world unit
  return { cx, cy, scale: clampScale(px / short) };
}

/** Zoom by `factor` keeping the world point under pixel `(px, py)` still. */
export function zoomViewAbout(
  view: AtlasView,
  look: ViewLook,
  width: number,
  height: number,
  factor: number,
  px: number,
  py: number,
): AtlasView {
  const before = invertAffine(viewAffine(view, look, width, height));
  const wx = before.a * px + before.c * py + before.e;
  const wy = before.b * px + before.d * py + before.f;
  const next = { ...view, scale: clampScale(view.scale * factor) };
  const m = viewAffine(next, look, width, height);
  const sx = m.a * wx + m.c * wy + m.e;
  const sy = m.b * wx + m.d * wy + m.f;
  return panView(next, look, width, height, px - sx, py - sy);
}

/** Move the view by a pixel delta (the map follows the hand). */
export function panView(view: AtlasView, look: ViewLook, width: number, height: number, dx: number, dy: number): AtlasView {
  const inv = invertAffine(viewAffine(view, look, width, height));
  // A pixel delta is a direction: only the linear part of the inverse applies.
  const wx = inv.a * dx + inv.c * dy;
  const wy = inv.b * dx + inv.d * dy;
  return { ...view, cx: clampWorld(view.cx - wx), cy: clampWorld(view.cy - wy) };
}

function clampWorld(v: number): number {
  return Math.min(1.5, Math.max(-0.5, v));
}

/** One sample of a follow track. */
export interface CameraSample {
  cx: number;
  cy: number;
  /** log2 of the normalised scale, so a zoom eases evenly. */
  ls: number;
}

export interface CameraTrack {
  step: number;
  samples: CameraSample[];
}

/**
 * A camera that follows what is in the air. `targetAt(t)` names the box to
 * frame (the flights flying, or the last ones seen); the camera eases to it
 * with a time constant set by `tightness` (0 lazy … 1 snappy). When the next
 * box is far — another town, another country — the zoom is pulled out first
 * so the move reads as a flight across the map rather than a smear.
 */
export function buildCameraTrack(
  targetAt: (t: number) => WorldBox | null,
  total: number,
  look: ViewLook,
  width: number,
  height: number,
  padding: number,
  tightness: number,
  step = 1 / 30,
): CameraTrack {
  const tau = 0.25 + (1 - Math.min(1, Math.max(0, tightness))) * 3; // seconds
  const samples: CameraSample[] = [];
  let cur: CameraSample | null = null;
  let lastBox: WorldBox | null = null;
  const count = Math.max(2, Math.ceil(total / step) + 1);
  for (let k = 0; k < count; k++) {
    const t = k * step;
    const box: WorldBox | null = targetAt(t) ?? lastBox;
    if (box) lastBox = box;
    if (!box) {
      samples.push(cur ?? { cx: 0.5, cy: 0.5, ls: 0 });
      continue;
    }
    const target = fitView(box, look, width, height, padding);
    const tl = Math.log2(target.scale);
    if (!cur) {
      cur = { cx: target.cx, cy: target.cy, ls: tl };
      samples.push(cur);
      continue;
    }
    // How far the target is, in frames of the current view: past ~0.6 the
    // zoom is held back so the whole move fits on screen.
    const dist = Math.hypot(target.cx - cur.cx, target.cy - cur.cy);
    const seen = 0.6 / Math.max(1e-12, 2 ** cur.ls); // world units across 0.6 short sides
    const travelLs = dist > seen ? Math.log2(0.6 / dist) : Infinity;
    const goalLs: number = Math.min(tl, travelLs);
    const kMove = 1 - Math.exp(-step / tau);
    // Out faster than in: a camera that lingers zoomed-in while the subject
    // leaves the frame loses it.
    const kZoom: number = 1 - Math.exp(-step / (goalLs < cur.ls ? tau * 0.6 : tau * 1.2));
    cur = {
      cx: cur.cx + (target.cx - cur.cx) * kMove,
      cy: cur.cy + (target.cy - cur.cy) * kMove,
      ls: cur.ls + (goalLs - cur.ls) * kZoom,
    };
    samples.push(cur);
  }
  return { step, samples };
}

/** The follow camera's view at `t`, interpolated. */
export function cameraAt(track: CameraTrack, t: number): AtlasView {
  const { samples, step } = track;
  if (samples.length === 0) return { cx: 0.5, cy: 0.5, scale: 1 };
  const f = Math.max(0, t / step);
  const i = Math.min(samples.length - 1, Math.floor(f));
  const j = Math.min(samples.length - 1, i + 1);
  const k = Math.min(1, f - i);
  const a = samples[i];
  const b = samples[j];
  return {
    cx: a.cx + (b.cx - a.cx) * k,
    cy: a.cy + (b.cy - a.cy) * k,
    scale: clampScale(2 ** (a.ls + (b.ls - a.ls) * k)),
  };
}

/** Apply a slow zoom (a Ken Burns drift) of `drift` over the animation to a fixed view. */
export function driftView(view: AtlasView, drift: number, progress: number): AtlasView {
  if (!drift) return view;
  const p = Math.min(1, Math.max(0, progress));
  return { ...view, scale: clampScale(view.scale * 2 ** (drift * p)) };
}

/** Boxes of the given indices, unioned. */
export function boxOf(boxes: readonly WorldBox[], indices: Iterable<number>): WorldBox | null {
  const picked: WorldBox[] = [];
  for (const i of indices) if (boxes[i]) picked.push(boxes[i]);
  return unionBox(picked);
}
