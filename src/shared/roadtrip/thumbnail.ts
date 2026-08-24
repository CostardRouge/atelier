/**
 * A small JPEG of the hook, kept beside the trip so a day can be recognised at
 * a glance months later.
 *
 * It is a picture of the BADGE, not of the raw media: what the author needs to
 * remember about a day they last touched in March is what they already made of
 * it — the number, the crop, the treatment — not which file it came from. The
 * source is therefore the preview canvas itself, which costs nothing extra to
 * produce since it has just been drawn.
 *
 * It is stored, never uploaded, and it is a cache: losing it costs a row its
 * picture, never the post.
 */

/** Longest edge of a stored thumbnail. Two rows of these are ~30 KB. */
export const THUMB_LONG_EDGE = 224;

/** JPEG rather than PNG: photographic, and a tenth of the bytes. */
export const THUMB_QUALITY = 0.72;

/**
 * The thumbnail's pixel size for a source of `w`×`h`, never upscaling — a
 * 120 px preview blown up to 224 would store blur at four times the weight.
 */
export function thumbSize(
  w: number,
  h: number,
  longEdge = THUMB_LONG_EDGE,
): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const scale = Math.min(1, longEdge / Math.max(w, h));
  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * Downscale a canvas that has already been drawn into a JPEG blob. Returns
 * null when the browser refuses (a tainted canvas cannot happen here — every
 * source is a local file — but `toBlob` may still yield null).
 */
export function canvasThumbnail(
  source: HTMLCanvasElement,
  longEdge = THUMB_LONG_EDGE,
): Promise<Blob | null> {
  const { w, h } = thumbSize(source.width, source.height, longEdge);
  if (!w || !h) return Promise.resolve(null);
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return new Promise((resolve) => small.toBlob(resolve, 'image/jpeg', THUMB_QUALITY));
}
