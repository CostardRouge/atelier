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

/**
 * Longest edge of a stored thumbnail — sized for the LARGEST consumer, which
 * is the gallery card's cover, not the day row it was first written for.
 *
 * The day panel draws it 38×48 CSS (76×96 device px at 2×) and a pin tile
 * 62×82, so 224 was already generous there; the card's mosaic wants ~378×336
 * device px on its big tile and a full-bleed cover ~600×336, which 224 could
 * only reach by upscaling three times over. Every display size is CSS and none
 * is derived from the picture, so raising this changes nothing anywhere but
 * the sharpness and the bytes: ~3.6 KB per piece becomes ~25 KB.
 *
 * It is never upscaled past the source, and the badge preview canvas is at
 * least `PREVIEW_LONG_EDGE` (720), so this is always actually reached.
 *
 * A thumbnail already stored at the old size stays at it — it is a cache, and
 * it is re-baked the next time that piece is opened. There is no migration:
 * the canvas it comes from only exists in the editor.
 */
export const THUMB_LONG_EDGE = 640;

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
