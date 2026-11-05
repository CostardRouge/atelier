/**
 * How a picture (or the background) sits in its box: a FOCUS — the point of
 * the source kept in the middle, as fractions of its width and height — and a
 * ZOOM over the cover fit (1 = the box just covered). His pick (framing lab 2,
 * 2026-11-05): a focus and a zoom, never a crop rectangle, so a change of
 * format or of cell shape keeps what was framed instead of cutting it, and
 * the framing follows the PICTURE wherever it is shown.
 *
 * The box is always covered: a focus near an edge is held so no empty band
 * shows (what the window shows is clamped inside the source).
 *
 * Pure and DOM-free.
 */

export interface Frame {
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_FRAME: Frame = { x: 0.5, y: 0.5, zoom: 1 };
export const MAX_ZOOM = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function readFrame(raw: unknown): Frame | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
  const f = { x: n(r.x, 0, 1, 0.5), y: n(r.y, 0, 1, 0.5), zoom: n(r.zoom, 1, MAX_ZOOM, 1) };
  return isDefaultFrame(f) ? undefined : f;
}

export function isDefaultFrame(f: Frame | undefined): boolean {
  return !f || (Math.abs(f.x - 0.5) < 1e-4 && Math.abs(f.y - 0.5) < 1e-4 && Math.abs(f.zoom - 1) < 1e-4);
}

/** The part of a `srcW × srcH` source a `boxW × boxH` box shows under `frame`, in source pixels. */
export function coverWindow(srcW: number, srcH: number, boxW: number, boxH: number, frame: Frame = DEFAULT_FRAME): { sx: number; sy: number; sw: number; sh: number } {
  const k = Math.max(boxW / srcW, boxH / srcH) * clamp(frame.zoom, 1, MAX_ZOOM);
  const sw = Math.min(srcW, boxW / k);
  const sh = Math.min(srcH, boxH / k);
  const sx = clamp(frame.x * srcW - sw / 2, 0, srcW - sw);
  const sy = clamp(frame.y * srcH - sh / 2, 0, srcH - sh);
  return { sx, sy, sw, sh };
}

/** The frame whose window is centred on `(cx, cy)` (source pixels) at `zoom`, focus held inside the source. */
export function frameAt(cx: number, cy: number, zoom: number, srcW: number, srcH: number): Frame {
  return { x: clamp(cx / srcW, 0, 1), y: clamp(cy / srcH, 0, 1), zoom: clamp(zoom, 1, MAX_ZOOM) };
}

/**
 * The frame after a drag of `(dx, dy)` BOX pixels — the picture follows the
 * pointer, so its focus moves the other way — re-centred on what the box
 * actually shows, so a drag past an edge does not store a focus the clamp
 * hides (the next drag would first have to undo it).
 */
export function panFrame(frame: Frame, dx: number, dy: number, srcW: number, srcH: number, boxW: number, boxH: number): Frame {
  const w = coverWindow(srcW, srcH, boxW, boxH, frame);
  const perPx = w.sw / boxW;
  const cx = w.sx + w.sw / 2 - dx * perPx;
  const cy = w.sy + w.sh / 2 - dy * perPx;
  const moved = frameAt(cx, cy, frame.zoom, srcW, srcH);
  const shown = coverWindow(srcW, srcH, boxW, boxH, moved);
  return frameAt(shown.sx + shown.sw / 2, shown.sy + shown.sh / 2, frame.zoom, srcW, srcH);
}

/** The frame zoomed to `zoom`, keeping its focus. */
export function zoomFrame(frame: Frame, zoom: number): Frame {
  return { ...frame, zoom: clamp(zoom, 1, MAX_ZOOM) };
}

/**
 * Where the WHOLE source lands when `box` shows it under `frame` — the ghost
 * the stage draws around a cell being framed, so the hand sees what lies
 * outside the window. In the box's own units.
 */
export function sourceRect(srcW: number, srcH: number, box: { x: number; y: number; w: number; h: number }, frame?: Frame): { x: number; y: number; w: number; h: number } {
  const win = coverWindow(srcW, srcH, box.w, box.h, frame);
  const s = box.w / win.sw;
  return { x: box.x - win.sx * s, y: box.y - win.sy * s, w: srcW * s, h: srcH * s };
}
