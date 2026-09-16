/**
 * Painting pictures into cells — the canvas half of `media-layout.ts`, and the
 * tile the Itinerary opener mounts a stop's photograph on. Lifted out of
 * `roadtrip/hooks/map-paint.ts` when the collage became its second consumer:
 * a second copy of "clip, translate, drawFramed" is how a preview and an
 * export start disagreeing about a crop.
 *
 * Everything here draws THROUGH `drawFramed`, so a cell honours the same
 * `Framing` (pan, zoom, rotation, flips, fill or whole) a full-frame picture
 * does — at the cell's size, which is what makes the pan a fraction of the
 * cell's long edge rather than the frame's.
 *
 * An empty cell draws nothing. Not a slot, not a stand-in: the export of a
 * half-filled collage shows the background where a picture is missing, and
 * the editor draws its own placeholder over that on the overlay canvas.
 */

import { drawFramed, type Framing } from './framing';
import type { CellRect, LayoutSpacing } from './media-layout';
import type { AnimDirection, Transform } from '../overlay/animation';

export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A decoded picture plus its natural size — `BadgeSource` and `HookPicture` both fit. */
export interface LayoutPicture {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/** The paper a tile is mounted on, and the ink of a caption on it. */
export const TILE_PAPER = '#f4efe4';
export const TILE_PAPER_INK = '#1c1a17';
/** The suite's face with a fallback: a glyph must survive a stack we do not control. */
export const TILE_LABEL_FONT = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";

export type TileFrame = 'paper' | 'bare';

export function roundedRect(g: Canvas2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr);
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  g.lineTo(x + rr, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rr);
  g.lineTo(x, y + rr);
  g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}

/**
 * One picture in a box, cover-cropped, on paper or bare. A caption, when there
 * is one, sits in the paper below the picture — which is why a paper tile is
 * the default: the mount is where a name can go. `u` is the frame's unit (a
 * 1080-wide frame's pixel), so the tile draws the same at every size.
 */
export function tile(
  g: Canvas2D,
  picture: LayoutPicture,
  x: number,
  y: number,
  w: number,
  h: number,
  frame: TileFrame,
  u: number,
  caption = '',
): void {
  const paper = frame === 'paper';
  const border = paper ? Math.max(3 * u, Math.min(w, h) * 0.045) : 0;
  const captionH = paper && caption ? Math.max(18 * u, h * 0.16) : 0;
  const radius = 5 * u;
  g.save();
  // A shadow under the tile, not under everything drawn after it.
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 10 * u;
  g.shadowOffsetY = 3 * u;
  if (paper) {
    g.fillStyle = TILE_PAPER;
    roundedRect(g, x, y, w, h + captionH, radius);
    g.fill();
  }
  g.restore();

  const px = x + border;
  const py = y + border;
  const pw = Math.max(1, w - border * 2);
  const ph = Math.max(1, h - border * 2);
  g.save();
  g.beginPath();
  if (paper) g.rect(px, py, pw, ph);
  else roundedRect(g, px, py, pw, ph, radius);
  g.clip();
  g.translate(px, py);
  try {
    drawFramed(g, picture.image, picture.width, picture.height, pw, ph);
  } catch {
    // A bitmap closed under a render still in flight throws; that frame shows
    // the stop without its picture rather than killing the paint loop.
  }
  g.restore();

  if (!paper) {
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2 * u;
    roundedRect(g, px, py, pw, ph, radius);
    g.stroke();
    g.restore();
  }

  if (captionH > 0) {
    g.save();
    g.fillStyle = TILE_PAPER_INK;
    g.font = `600 ${Math.min(captionH * 0.52, 30 * u)}px ${TILE_LABEL_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(caption, x + w / 2, y + h + captionH / 2 - border / 2, w - border * 2);
    g.restore();
  }
}

/** The paper mount a print sits on: border as a fraction of the short side. */
const PRINT_BORDER = 0.02;
const PRINT_RADIUS = 0.004;

/**
 * Where cell `i` is in its entrance or exit at the moment being painted —
 * the overlay engine's own `Transform` plus how it is applied to a picture.
 * Null (or absent) paints the cell at rest.
 */
export interface CellMotion {
  transform: Transform;
  /** The edge a reveal grows from; `right` when unsaid (today's left→right wipe). */
  direction?: AnimDirection;
  /** Move the picture inside the mask rather than the cell. */
  inside?: boolean;
}

export interface DrawLayoutOptions {
  /** The picture for cell `i`, or null for an empty cell (which draws nothing). */
  picture: (i: number) => LayoutPicture | null;
  /** How cell `i`'s picture sits in it. */
  framing: (i: number) => Framing;
  spacing: LayoutSpacing;
  /** Cell `i`'s motion at this moment; absent paints every cell at rest. */
  motion?: (i: number) => CellMotion | null;
}

/** Clip to the revealed share of a box, growing from `direction`'s far edge. */
function clipReveal(
  ctx: Canvas2D,
  x: number,
  y: number,
  w: number,
  h: number,
  reveal: number,
  direction: AnimDirection | undefined,
): void {
  const r = Math.max(0, Math.min(1, reveal));
  ctx.beginPath();
  if (direction === 'left') ctx.rect(x + w * (1 - r), y, w * r, h);
  else if (direction === 'down') ctx.rect(x, y, w, h * r);
  else if (direction === 'up') ctx.rect(x, y + h * (1 - r), w, h * r);
  else ctx.rect(x, y, w * r, h);
  ctx.clip();
}

/**
 * Draw every cell of a resolved layout into a `frameW`×`frameH` frame. The
 * caller has already painted the background; a cell without a picture leaves
 * it showing. Radii and mounts scale with the frame's short side, so the stage
 * and the export draw the same collage.
 */
export function drawLayout(
  ctx: Canvas2D,
  frameW: number,
  frameH: number,
  cells: readonly CellRect[],
  opts: DrawLayoutOptions,
): void {
  const short = Math.min(frameW, frameH);
  cells.forEach((cell, i) => {
    const picture = opts.picture(i);
    if (!picture || picture.width <= 0 || picture.height <= 0) return;
    if (cell.w <= 0 || cell.h <= 0) return;
    drawCell(ctx, short, cell, picture, opts.framing(i), opts.spacing, opts.motion?.(i) ?? null);
  });
}

/**
 * One cell: its mount, its clip, its picture — about the cell's centre so a
 * print can turn. With a motion, the transform is applied the way the overlay
 * engine applies it to text (alpha, an offset in short-side fractions, a scale
 * about the centre, a reveal clip), either to the whole cell or, `inside`, to
 * the picture behind the cell's mask.
 */
export function drawCell(
  ctx: Canvas2D,
  short: number,
  cell: CellRect,
  picture: LayoutPicture,
  framing: Framing,
  spacing: LayoutSpacing,
  motion: CellMotion | null = null,
): void {
  const tr = motion?.transform ?? null;
  if (tr && (tr.alpha <= 0.001 || tr.reveal <= 0)) return;
  const print = cell.mount === 'print';
  const radius = print ? PRINT_RADIUS * short : spacing.radius * short;
  const border = print ? PRINT_BORDER * short : 0;
  const inside = Boolean(motion?.inside) && tr !== null;
  ctx.save();
  if (tr && tr.alpha < 1) ctx.globalAlpha *= tr.alpha;
  ctx.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
  if (cell.rotation) ctx.rotate((cell.rotation * Math.PI) / 180);
  if (tr && tr.reveal < 1) {
    clipReveal(
      ctx,
      -cell.w / 2 - border,
      -cell.h / 2 - border,
      cell.w + 2 * border,
      cell.h + border * 3.4,
      tr.reveal,
      motion?.direction,
    );
  }
  if (tr && !inside) {
    ctx.translate(tr.dx * short, tr.dy * short);
    if (tr.scale !== 1) ctx.scale(tr.scale, tr.scale);
  }

  if (print) {
    // A print's paper, deeper at the foot the way a real one is, with its
    // shadow under the paper alone — never under the picture drawn after it.
    ctx.save();
    ctx.shadowColor = 'rgba(20,14,8,0.42)';
    ctx.shadowBlur = short * 0.035;
    ctx.shadowOffsetY = short * 0.012;
    ctx.fillStyle = TILE_PAPER;
    roundedRect(
      ctx,
      -cell.w / 2 - border,
      -cell.h / 2 - border,
      cell.w + 2 * border,
      cell.h + border * 3.4,
      short * 0.006,
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  roundedRect(ctx, -cell.w / 2, -cell.h / 2, cell.w, cell.h, radius);
  ctx.clip();
  if (tr && inside) {
    // Behind the mask the offset is read against the CELL, so a slide travels
    // the whole cell whatever its size, and a zoom only ever settles from
    // larger — a picture smaller than its mask would show the ground.
    const long = Math.max(cell.w, cell.h);
    ctx.translate(tr.dx * long, tr.dy * long);
    const s = tr.scale < 1 ? 1 + (1 - tr.scale) : tr.scale;
    if (s !== 1) ctx.scale(s, s);
  }
  ctx.translate(-cell.w / 2, -cell.h / 2);
  try {
    drawFramed(ctx, picture.image, picture.width, picture.height, cell.w, cell.h, framing);
  } catch {
    // A bitmap closed under a render still in flight: this frame loses the
    // picture, the paint loop survives. Same rule as `tile`.
  }
  ctx.restore();

  if (cell.mount === 'stroke') {
    ctx.save();
    ctx.lineWidth = short * 0.009;
    ctx.strokeStyle = 'rgba(251,248,241,0.95)';
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = short * 0.02;
    roundedRect(ctx, -cell.w / 2, -cell.h / 2, cell.w, cell.h, radius);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
