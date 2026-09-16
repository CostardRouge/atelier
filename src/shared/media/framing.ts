/**
 * How a source picture sits inside an output frame: pan, zoom, rotation and a
 * mirror, over either the cover-crop every export always did or a fit that
 * shows the whole picture with black bars.
 *
 * Until now the crop was fixed — centred, exactly covering, "a badge author
 * reframes by choosing a different picture". That held while a piece was one
 * still going out as shot; it stops holding the moment the frame is 9:16 and
 * the subject is not in the middle of a 3:2 photograph. So the crop became a
 * value the document carries, and this module is the one place that turns it
 * into a transform — the preview, the PNG deck and the burned-in clip all go
 * through here, or they would disagree about where the picture is.
 *
 * Two invariants make it safe to store:
 *
 *  - **A gap is only ever asked for.** `scale` is clamped at 1 — the scale
 *    that exactly covers under `fit: 'cover'`, or that exactly shows the whole
 *    picture under `fit: 'contain'`, whatever the rotation — and the pan is
 *    clamped to the slack that scale leaves. Under `cover` no combination of
 *    stored values can show a gap; bars appear only where the author chose
 *    `contain`, and are painted black by {@link drawFramed}, never left as
 *    whatever the canvas held.
 *  - **Everything is resolution-independent.** The pan is a fraction of the
 *    output's long edge, so the preview at 720px and the export at 2160px
 *    frame the picture identically.
 *
 * Under `cover` the pan is expressed along the PICTURE's own axes, not the
 * frame's: once a photograph is rotated, "move it left" means along the horizon
 * you just straightened, and clamping is a rectangle rather than a rotated
 * diamond. Under `contain` it runs along the FRAME's axes instead, for the same
 * reason turned round: the picture floats between frame-aligned bars, and what
 * keeps the whole of it in view is a rectangle in the frame. `panBy` takes a
 * pointer delta in frame axes and does whatever conversion the fit needs.
 *
 * The mirror is stored in the picture's own axes too (applied before the
 * rotation), and {@link flipFraming} is what turns a "flip what I see" into
 * it — exactly, at any angle.
 */

import type { Fit } from './compose-layout';

/** Where a picture sits in its frame. The default is the centred cover-crop. */
export interface Framing {
  /** 1 = exactly covers the frame (or exactly fits it, under `contain`); above that, zoomed in. */
  scale: number;
  /**
   * Pan as a fraction of the frame's long edge — along the picture's own axes
   * under `cover`, along the frame's under `contain`.
   */
  x: number;
  y: number;
  /** Clockwise, in degrees. */
  rotation: number;
  /** Mirrored left ↔ right in the picture's own axes, before the rotation. */
  flipX: boolean;
  /** Mirrored top ↔ bottom in the picture's own axes, before the rotation. */
  flipY: boolean;
  /**
   * `cover` fills the frame and crops the excess; `contain` shows the whole
   * picture and leaves black bars where it falls short of the frame.
   */
  fit: Fit;
}

export const DEFAULT_FRAMING: Framing = {
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
  flipX: false,
  flipY: false,
  fit: 'cover',
};

/** The colour a `contain` framing paints where the picture does not reach. */
export const FRAMING_BARS = '#000000';

/** The most a picture can be zoomed in. Past this a JPEG is mush anyway. */
export const MAX_FRAMING_SCALE = 8;

/**
 * A zoom factor applied to a framing's scale, held between covering the frame
 * and that ceiling.
 *
 * One function for every way a zoom is asked for — a wheel notch (`factor` =
 * `exp(-deltaY / 400)`), the ratio between two fingers' distances, a button's
 * step — so the three cannot round or clamp differently, which is exactly how
 * a pinch and a slider end up disagreeing about where the picture is.
 */
export function scaleFramingBy(scale: number, factor: number): number {
  const from = Number.isFinite(scale) ? scale : 1;
  if (!Number.isFinite(factor) || factor <= 0) return clamp(from, 1, MAX_FRAMING_SCALE);
  return clamp(from * factor, 1, MAX_FRAMING_SCALE);
}

export function isDefaultFraming(f: Framing | null | undefined): boolean {
  if (!f) return true;
  return (
    f.scale === 1 &&
    f.x === 0 &&
    f.y === 0 &&
    f.rotation === 0 &&
    !f.flipX &&
    !f.flipY &&
    f.fit !== 'contain'
  );
}

/** A finite number, or the fallback — documents and files are not trusted. */
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Read a framing out of anything (a stored doc, an imported file, undefined). */
export function normaliseFraming(v: unknown): Framing {
  if (!v || typeof v !== 'object') return { ...DEFAULT_FRAMING };
  const f = v as Partial<Framing>;
  return {
    scale: clamp(num(f.scale, 1), 1, MAX_FRAMING_SCALE),
    x: num(f.x, 0),
    y: num(f.y, 0),
    rotation: wrapDegrees(num(f.rotation, 0)),
    flipX: f.flipX === true,
    flipY: f.flipY === true,
    fit: f.fit === 'contain' ? 'contain' : 'cover',
  };
}

/**
 * Mirror what the FRAME shows — left ↔ right (`x`) or top ↔ bottom (`y`) —
 * whatever the rotation and the pan.
 *
 * The stored mirror is in the picture's own axes, so toggling it alone would
 * flip a quarter-turned picture the wrong way on screen. A mirror M and a
 * rotation R commute up to the angle's sign (M·R(θ) = R(−θ)·M), so mirroring
 * the framed result is the same picture mirrored in its own axes, turned the
 * other way, and panned the mirror way — exact, not a special case per angle,
 * and the same under both fits (M·R(θ)·p = R(−θ)·M·p holds for a pan too).
 */
export function flipFraming(f: Framing, axis: 'x' | 'y'): Framing {
  const rotation = wrapDegrees(-f.rotation);
  return axis === 'x'
    ? { ...f, rotation, flipX: !f.flipX, x: -f.x || 0 }
    : { ...f, rotation, flipY: !f.flipY, y: -f.y || 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Any angle onto (-180, 180], so a stored rotation never grows without bound. */
export function wrapDegrees(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const wrapped = ((deg + 180) % 360 + 360) % 360 - 180;
  // -180 and 180 are the same angle; prefer the positive one.
  return wrapped === -180 ? 180 : wrapped;
}

/** The transform to draw with, in the output frame's pixels. */
export interface FramingTransform {
  /** Radians, clockwise. */
  angle: number;
  /** Multiplier from source pixels to output pixels. */
  scale: number;
  /** -1 where the picture is mirrored along its own axis, else 1. */
  mirrorX: 1 | -1;
  mirrorY: 1 | -1;
  /** Pan actually applied, in output pixels along the picture's axes — what to draw with. */
  panX: number;
  panY: number;
  /**
   * The same pan in the axes the framing STORES it in (the picture's under
   * `cover`, the frame's under `contain`), clamped, in output pixels.
   */
  offsetX: number;
  offsetY: number;
  /** How far `offset` COULD go, in output pixels along those same axes. */
  slackX: number;
  slackY: number;
}

/**
 * The transform that draws `srcW × srcH` into `dstW × dstH` under `framing`.
 *
 * The cover condition with rotation: rotating the destination rectangle back
 * into the picture's axes gives a bounding box of
 * `dstW·|cos| + dstH·|sin|` by `dstW·|sin| + dstH·|cos|`, and the scaled
 * source must contain that box. An axis-aligned rectangle contains a rotated
 * one exactly when it contains its bounding box, so this is tight, not
 * conservative.
 *
 * The contain condition is the same argument turned round: the rotated
 * picture's bounding box, `srcW·|cos| + srcH·|sin|` by
 * `srcW·|sin| + srcH·|cos|` (scaled), must fit inside the frame — and it is
 * exact for the same reason. Its slack is the gap between that box and the
 * frame on each of the frame's axes: a picture smaller than the frame moves
 * until its box meets the frame's edge, so a bar slides from one side to the
 * other and nothing of the picture leaves the frame; zoomed past the frame on
 * an axis, it moves until the box's edge meets the frame's.
 */
export function framingTransform(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  framing: Framing = DEFAULT_FRAMING,
): FramingTransform {
  const angle = (wrapDegrees(framing.rotation) * Math.PI) / 180;
  const mirrorX = framing.flipX ? -1 : 1;
  const mirrorY = framing.flipY ? -1 : 1;
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return {
      angle,
      scale: 1,
      mirrorX,
      mirrorY,
      panX: 0,
      panY: 0,
      offsetX: 0,
      offsetY: 0,
      slackX: 0,
      slackY: 0,
    };
  }
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const zoom = clamp(num(framing.scale, 1), 1, MAX_FRAMING_SCALE);
  const unit = Math.max(dstW, dstH);

  if (framing.fit === 'contain') {
    const boxW = srcW * c + srcH * s;
    const boxH = srcW * s + srcH * c;
    const scale = Math.min(dstW / boxW, dstH / boxH) * zoom;
    const slackX = Math.abs(dstW - boxW * scale) / 2;
    const slackY = Math.abs(dstH - boxH * scale) / 2;
    const offsetX = clamp(num(framing.x, 0) * unit, -slackX, slackX);
    const offsetY = clamp(num(framing.y, 0) * unit, -slackY, slackY);
    // Into the picture's axes, which is where `drawFramed` translates.
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      angle,
      scale,
      mirrorX,
      mirrorY,
      panX: offsetX * cos + offsetY * sin,
      panY: -offsetX * sin + offsetY * cos,
      offsetX,
      offsetY,
      slackX,
      slackY,
    };
  }

  const needW = dstW * c + dstH * s;
  const needH = dstW * s + dstH * c;
  const scale = Math.max(needW / srcW, needH / srcH) * zoom;
  const slackX = Math.max(0, (srcW * scale - needW) / 2);
  const slackY = Math.max(0, (srcH * scale - needH) / 2);
  const panX = clamp(num(framing.x, 0) * unit, -slackX, slackX);
  const panY = clamp(num(framing.y, 0) * unit, -slackY, slackY);
  return {
    angle,
    scale,
    mirrorX,
    mirrorY,
    panX,
    panY,
    offsetX: panX,
    offsetY: panY,
    slackX,
    slackY,
  };
}

/** Whether this framing leaves any room to pan at all. */
export function canPan(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  framing: Framing,
): boolean {
  const t = framingTransform(srcW, srcH, dstW, dstH, framing);
  return t.slackX > 0.5 || t.slackY > 0.5;
}

/**
 * Move the picture by a pointer delta given in the FRAME's axes (what a drag
 * on the stage produces), returning a framing whose pan is already clamped —
 * so what is stored always covers the frame (`cover`) or keeps the whole
 * picture in it (`contain`).
 */
export function panBy(
  framing: Framing,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  dxPx: number,
  dyPx: number,
): Framing {
  const t = framingTransform(srcW, srcH, dstW, dstH, framing);
  let dx = dxPx;
  let dy = dyPx;
  if (framing.fit !== 'contain') {
    // Into the picture's axes: under cover the stored pan runs along the
    // rotated picture, which is what makes the clamp a rectangle.
    const cos = Math.cos(-t.angle);
    const sin = Math.sin(-t.angle);
    dx = dxPx * cos - dyPx * sin;
    dy = dxPx * sin + dyPx * cos;
  }

  const unit = Math.max(dstW, dstH);
  if (unit <= 0) return framing;
  return {
    ...framing,
    x: clamp(t.offsetX + dx, -t.slackX, t.slackX) / unit,
    y: clamp(t.offsetY + dy, -t.slackY, t.slackY) / unit,
  };
}

/**
 * Re-clamp a framing's pan for its own scale and rotation. Zooming back out or
 * straightening a picture shrinks the slack, and a pan left beyond it would
 * silently jump the next time anything else moved.
 */
export function reclampFraming(
  framing: Framing,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Framing {
  const t = framingTransform(srcW, srcH, dstW, dstH, framing);
  const unit = Math.max(dstW, dstH);
  if (unit <= 0) return framing;
  return { ...framing, x: t.offsetX / unit, y: t.offsetY / unit };
}

/** A 2D context, structurally — so this module needs no canvas to be tested. */
interface FramingContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
}

/**
 * Draw `image` into the frame under `framing`. One implementation, called by
 * the badge renderer and by the video pipeline — a second copy of these four
 * transform calls is exactly how a preview and an export start disagreeing.
 *
 * A `contain` framing paints the whole frame black first: the video pipeline
 * reuses one canvas for every frame, and a bar left unpainted would show the
 * previous frame through it.
 */
export function drawFramed(
  ctx: FramingContext,
  image: CanvasImageSource,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  framing: Framing = DEFAULT_FRAMING,
): void {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return;
  const t = framingTransform(srcW, srcH, dstW, dstH, framing);
  ctx.save();
  if (framing.fit === 'contain') {
    ctx.fillStyle = FRAMING_BARS;
    ctx.fillRect(0, 0, dstW, dstH);
  }
  ctx.translate(dstW / 2, dstH / 2);
  ctx.rotate(t.angle);
  ctx.translate(t.panX, t.panY);
  // The mirror goes innermost: it is about the picture, before it is turned.
  ctx.scale(t.scale * t.mirrorX, t.scale * t.mirrorY);
  ctx.drawImage(image, -srcW / 2, -srcH / 2, srcW, srcH);
  ctx.restore();
}
