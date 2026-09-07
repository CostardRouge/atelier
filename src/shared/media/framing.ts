/**
 * How a source picture sits inside an output frame: pan, zoom and rotation on
 * top of the cover-crop every export already does.
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
 *  - **The frame is always covered.** `scale` is clamped at 1 (the scale that
 *    exactly covers, whatever the rotation) and the pan is clamped to the
 *    slack that scale leaves. No combination of stored values can show a gap,
 *    so a document written by a future version — or by hand — cannot produce a
 *    letterboxed export.
 *  - **Everything is resolution-independent.** The pan is a fraction of the
 *    output's long edge, so the preview at 720px and the export at 2160px
 *    frame the picture identically.
 *
 * The pan is expressed along the PICTURE's own axes, not the frame's: once a
 * photograph is rotated, "move it left" means along the horizon you just
 * straightened, and clamping is a rectangle rather than a rotated diamond.
 * `panBy` takes a pointer delta in frame axes and does the conversion.
 */

/** Where a picture sits in its frame. The default is the centred cover-crop. */
export interface Framing {
  /** 1 = exactly covers the frame; above that, zoomed in. */
  scale: number;
  /** Pan along the picture's own axes, as a fraction of the frame's long edge. */
  x: number;
  y: number;
  /** Clockwise, in degrees. */
  rotation: number;
}

export const DEFAULT_FRAMING: Framing = { scale: 1, x: 0, y: 0, rotation: 0 };

/** The most a picture can be zoomed in. Past this a JPEG is mush anyway. */
export const MAX_FRAMING_SCALE = 8;

export function isDefaultFraming(f: Framing | null | undefined): boolean {
  if (!f) return true;
  return f.scale === 1 && f.x === 0 && f.y === 0 && f.rotation === 0;
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
  };
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
  /** Pan actually applied, in output pixels along the picture's axes. */
  panX: number;
  panY: number;
  /** How far the pan COULD go before a gap appears, in output pixels. */
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
 */
export function framingTransform(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  framing: Framing = DEFAULT_FRAMING,
): FramingTransform {
  const angle = (wrapDegrees(framing.rotation) * Math.PI) / 180;
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { angle, scale: 1, panX: 0, panY: 0, slackX: 0, slackY: 0 };
  }
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const needW = dstW * c + dstH * s;
  const needH = dstW * s + dstH * c;

  const cover = Math.max(needW / srcW, needH / srcH);
  const scale = cover * clamp(num(framing.scale, 1), 1, MAX_FRAMING_SCALE);

  const slackX = Math.max(0, (srcW * scale - needW) / 2);
  const slackY = Math.max(0, (srcH * scale - needH) / 2);

  const unit = Math.max(dstW, dstH);
  return {
    angle,
    scale,
    panX: clamp(num(framing.x, 0) * unit, -slackX, slackX),
    panY: clamp(num(framing.y, 0) * unit, -slackY, slackY),
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
 * so what is stored is always a framing that covers.
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
  // Into the picture's axes: the stored pan runs along the rotated picture,
  // which is what makes the clamp a rectangle.
  const cos = Math.cos(-t.angle);
  const sin = Math.sin(-t.angle);
  const dx = dxPx * cos - dyPx * sin;
  const dy = dxPx * sin + dyPx * cos;

  const unit = Math.max(dstW, dstH);
  if (unit <= 0) return framing;
  return {
    ...framing,
    x: clamp(t.panX + dx, -t.slackX, t.slackX) / unit,
    y: clamp(t.panY + dy, -t.slackY, t.slackY) / unit,
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
  return { ...framing, x: t.panX / unit, y: t.panY / unit };
}

/** A 2D context, structurally — so this module needs no canvas to be tested. */
interface FramingContext {
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
  ctx.translate(dstW / 2, dstH / 2);
  ctx.rotate(t.angle);
  ctx.translate(t.panX, t.panY);
  ctx.scale(t.scale, t.scale);
  ctx.drawImage(image, -srcW / 2, -srcH / 2, srcW, srcH);
  ctx.restore();
}
