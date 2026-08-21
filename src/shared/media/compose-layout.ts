/**
 * Pure layout maths for the composer — no DOM, no canvas. Given an output size
 * and a layout choice, where do the video and map panes go, and how does each
 * source map into its pane (object-fit cover/contain → drawImage rects).
 *
 * Kept pure so the same numbers drive the live preview and (later) the export,
 * and so the fiddly geometry is unit-tested.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LayoutKind = 'side-by-side' | 'stacked' | 'pip-map' | 'pip-video';
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type Fit = 'cover' | 'contain';

export interface PaneRects {
  video: Rect;
  map: Rect;
}

/** Round to the nearest even integer (encoders prefer even dimensions). */
export function even(n: number): number {
  return 2 * Math.round(n / 2);
}

/** Output pixel size from an aspect ratio and a target long edge. */
export function outputSize(aspectW: number, aspectH: number, longEdge: number): {
  w: number;
  h: number;
} {
  if (aspectW >= aspectH) {
    return { w: even(longEdge), h: even((longEdge * aspectH) / aspectW) };
  }
  return { w: even((longEdge * aspectW) / aspectH), h: even(longEdge) };
}

function cornerRect(
  corner: Corner,
  outW: number,
  outH: number,
  w: number,
  h: number,
  margin: number,
): Rect {
  const x = corner === 'tl' || corner === 'bl' ? margin : outW - w - margin;
  const y = corner === 'tl' || corner === 'tr' ? margin : outH - h - margin;
  return { x, y, w, h };
}

/**
 * The video and map pane rectangles within an `outW`×`outH` frame.
 * - side-by-side / stacked: `split` (0.1..0.9) is the video's fraction.
 * - pip-map / pip-video: the inset pane is `inset` (0.15..0.6) of the width, in
 *   `corner`, over the full-frame other pane.
 */
export function paneRects(
  outW: number,
  outH: number,
  layout: LayoutKind,
  split: number,
  inset: number,
  corner: Corner,
): PaneRects {
  const s = Math.min(0.9, Math.max(0.1, split));
  if (layout === 'side-by-side') {
    const vw = Math.round(outW * s);
    return {
      video: { x: 0, y: 0, w: vw, h: outH },
      map: { x: vw, y: 0, w: outW - vw, h: outH },
    };
  }
  if (layout === 'stacked') {
    const vh = Math.round(outH * s);
    return {
      video: { x: 0, y: 0, w: outW, h: vh },
      map: { x: 0, y: vh, w: outW, h: outH - vh },
    };
  }
  const full: Rect = { x: 0, y: 0, w: outW, h: outH };
  const frac = Math.min(0.6, Math.max(0.15, inset));
  const iw = Math.round(outW * frac);
  const ih = Math.round((iw * outH) / outW); // inset keeps the output aspect
  const margin = Math.round(outW * 0.03);
  const pip = cornerRect(corner, outW, outH, iw, ih, margin);
  return layout === 'pip-map'
    ? { video: full, map: pip }
    : { video: pip, map: full };
}

export interface DrawRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Map a `srcW`×`srcH` source into `dst` with object-fit semantics:
 * - cover: crop the source to fill the pane (no bars).
 * - contain: fit the whole source inside the pane (letterboxed).
 * Returns the source-crop and destination rects for a single `drawImage`.
 */
export function fitRect(srcW: number, srcH: number, dst: Rect, mode: Fit): DrawRect {
  if (srcW <= 0 || srcH <= 0) {
    return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: dst.x, dy: dst.y, dw: dst.w, dh: dst.h };
  }
  const srcAR = srcW / srcH;
  const dstAR = dst.w / dst.h;
  if (mode === 'cover') {
    let sw = srcW;
    let sh = srcH;
    if (srcAR > dstAR) sw = srcH * dstAR;
    else sh = srcW / dstAR;
    return {
      sx: (srcW - sw) / 2,
      sy: (srcH - sh) / 2,
      sw,
      sh,
      dx: dst.x,
      dy: dst.y,
      dw: dst.w,
      dh: dst.h,
    };
  }
  let dw = dst.w;
  let dh = dst.h;
  if (srcAR > dstAR) dh = dst.w / srcAR;
  else dw = dst.h * srcAR;
  return {
    sx: 0,
    sy: 0,
    sw: srcW,
    sh: srcH,
    dx: dst.x + (dst.w - dw) / 2,
    dy: dst.y + (dst.h - dh) / 2,
    dw,
    dh,
  };
}
