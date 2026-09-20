/**
 * Painting a badge over a picture: the cover-crop maths (pure), decoding a
 * library file into something drawable, and the one render both the preview
 * and the PNG export go through.
 *
 * The preview and the export MUST be the same code at two sizes — a badge that
 * looks right at 480 px and lands differently at 2160 px is worse than no
 * preview. Everything the render needs is a fraction of the frame, so the only
 * difference between the two is the canvas they are handed.
 */

import { isRawImage } from '../library/assets';
import { extractRawPreview } from '../exif/raw-probe';
import type { CubeLut } from '../lib/cube-parser';
import { drawLayout, type LayoutPicture } from '../media/cell-paint';
import { DEFAULT_FRAMING, drawFramed, type Framing } from '../media/framing';
import { fitPhotoForRender } from '../media/photo-frame';
import type { HalfImage } from '../render/half-image';
import type { SavedMediaRef } from '../projects/project-types';
import {
  collageCellAt,
  collageCellCount,
  collageCellMotions,
  resolveCollage,
  type CollageLead,
  type SlideCollage,
} from './collage';
import type { DevelopSettings } from '../develop/develop';
import { makeFrameGrader, type FrameGrader } from '../lut/frame-grader';
import { drawQr, type QrDraw } from '../overlay/draw-qr';
import { MAX_STAGE_PIXELS, stageFrameSize } from '../overlay/stage-size';
import { shadeGradient, type HookBlock, type Shade } from './shades';
import type { ResolvedHook } from './hooks/hook-variant';
import { seek as seekVideo } from './video-frames';
import {
  drawOverlays,
  measureOverlays,
  type DrawOptions,
  type ElementBox,
} from '../overlay/draw-overlays';
import { ensureOverlayFonts } from '../overlay/fonts';
import type { OverlayElement } from '../overlay/overlay-types';
import type { StyleTheme } from '../overlay/title-styles';

/** A decoded picture plus its natural size. */
export interface BadgeSource {
  image: CanvasImageSource;
  width: number;
  height: number;
  /**
   * The picture as the GPU takes it, when it is more than `image` can hold:
   * a decoded RAW's half-floats (`render/half-image.ts`). A grader renders
   * this when it is here; `image` is then the same picture AS SHOT, 8-bit,
   * for every 2D draw (the wipe's untouched side, the dropper, a thumbnail).
   */
  gpu?: HalfImage;
  /** Frees the decoded bitmap / detaches the video element. */
  release: () => void;
  /**
   * Move a CLIP to another moment, resolving once the frame is there. Absent
   * for a photo, which has only one.
   *
   * It exists so scrubbing does not re-decode: tearing the video element down
   * and building a new one (with a fresh object URL) for every nudge of the
   * frame picker is what made choosing a hook frame stutter, and it flashed
   * "decoding…" the whole way across.
   */
  seek?: (seconds: number) => Promise<void>;
  /** The clip's length, or 0 for a photo. */
  duration?: number;
}

/** Longest edge a preview canvas is worth drawing at. */
export const PREVIEW_LONG_EDGE = 720;

/**
 * The most a preview bitmap grows to when the stage is large or the screen
 * dense: beyond this every frame of the badge's transport would repaint a
 * near-4K canvas for a difference no eye sees at arm's length.
 */
export const MAX_PREVIEW_LONG_EDGE = 1600;

/**
 * Pixel size of a frame with the given aspect, whose longest edge is `longEdge`.
 * Rounded to whole pixels — a canvas cannot be 1079.6 wide, and a fractional
 * size silently resamples every element.
 */
export function frameSize(aspect: number, longEdge: number): { w: number; h: number } {
  const w = aspect >= 1 ? longEdge : Math.round(longEdge * aspect);
  const h = aspect >= 1 ? Math.round(longEdge / aspect) : longEdge;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/**
 * Decode a library file into something a canvas can draw. Photos go through
 * `createImageBitmap`; a video is loaded and seeked so a badge can sit on a
 * frame of a clip rather than only on a still.
 *
 * Throws with a sentence a human can act on: camera RAW that the browser has
 * no decoder for is an ordinary thing to point this at, and "nothing happened"
 * would read as a bug in the tool rather than a limit of the format.
 */
export async function loadBadgeSource(
  file: File,
  videoTimeSeconds = 0,
  maxWidth?: number,
): Promise<BadgeSource> {
  if (file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
    return loadVideoFrame(file, videoTimeSeconds);
  }
  try {
    // `maxWidth` bounds the DECODE, for a caller that only needs a small
    // picture (the slide rail's thumbnails): a 48-megapixel still is 194 MB
    // decoded, and a carousel would put one up per cell. The WIDTH alone,
    // because the natural size is unknown until the decode happens and the
    // browser preserves the aspect from the one dimension given — a 9:16
    // frame comes out under twice the cap, which is the point. It can enlarge
    // a picture smaller than the cap; harmless at thumbnail sizes, and a
    // browser that ignores the option simply decodes at full size.
    const bitmap = await createImageBitmap(file, decodeOptions(maxWidth));
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    // A RAW: no browser decodes a sensor plane, but the camera wrote its own
    // JPEG inside the file, and that needs no decoder at all
    // (`shared/exif/raw-probe.ts`). It is a RENDER, not the sensor's data —
    // `pictureFidelity` is what says so where the picture is shown.
    if (isRawImage(file.name)) {
      try {
        const preview = await extractRawPreview(file);
        if (preview) {
          const bitmap = await createImageBitmap(preview, decodeOptions(maxWidth));
          return {
            image: bitmap,
            width: bitmap.width,
            height: bitmap.height,
            release: () => bitmap.close(),
          };
        }
      } catch {
        // A previewless or malformed RAW falls through to the honest refusal.
      }
    }
    throw new Error(
      `The browser cannot decode ${file.name}, and the file carries no render of its own — point this at an exported JPEG instead.`,
    );
  }
}

/**
 * How a still is decoded here: UPRIGHT, the way `decodePhoto` and every other
 * file decode in the suite does it, so a phone portrait sits the same way on
 * a badge as on the Studio stage; and, for a rail cell, bounded on its width.
 */
function decodeOptions(maxWidth?: number): ImageBitmapOptions {
  return maxWidth
    ? { imageOrientation: 'from-image', resizeWidth: maxWidth, resizeQuality: 'high' }
    : { imageOrientation: 'from-image' };
}

/**
 * A decoded STILL brought within an editor's pixel budget (`stage-size.ts`):
 * a picture already inside it — and every clip, whose element cannot be
 * resampled once for all its frames — comes back untouched; a bigger one is
 * resampled down from the decoded bitmap and the big bitmap released at once.
 *
 * An editor decodes as-is and bounds here, never through `loadBadgeSource`'s
 * `maxWidth`: that option ENLARGES a smaller picture up to the cap (right for
 * a rail cell, wrong for a preview — a 1600 px probe came back at 3840).
 *
 * Why the budget, measured on a 1600 px Trips stage: a graded 48 MP still
 * costs a 194 MB bitmap and a paint several times slower than a 4K frame's,
 * for detail no preview shows. A preview budget only — every deliverable
 * decodes the file again at its own density.
 */
export async function boundSource(
  source: BadgeSource,
  budget = MAX_STAGE_PIXELS,
): Promise<BadgeSource> {
  if (typeof ImageBitmap === 'undefined' || !(source.image instanceof ImageBitmap)) return source;
  const { w, h } = stageFrameSize(source.width, source.height, budget);
  if (w === source.width && h === source.height) return source;
  let small: ImageBitmap;
  try {
    small = await createImageBitmap(source.image, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: 'high',
    });
  } catch {
    // A browser without resize options keeps the picture as decoded.
    return source;
  }
  source.release();
  return { image: small, width: small.width, height: small.height, release: () => small.close() };
}

function loadVideoFrame(file: File, timeSeconds: number): Promise<BadgeSource> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const release = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };
    const fail = (message: string) => {
      release();
      reject(new Error(message));
    };
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      // A seek past the end never fires `seeked`, so clamp before asking.
      const target = Math.min(
        Math.max(timeSeconds, 0),
        Math.max(video.duration - 0.05, 0),
      );
      video.currentTime = target;
    };
    video.onseeked = () => {
      // Handed over once; from here the caller seeks this same element.
      video.onseeked = null;
      resolve({
        image: video,
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        release,
        seek: (seconds) => seekVideo(video, seconds),
      });
    };
    video.onerror = () =>
      fail(
        `The browser cannot decode ${file.name}. Some HEVC clips need the Studio's transcode first.`,
      );
    video.src = url;
  });
}

// The QR painter moved to `shared/overlay/draw-qr.ts` when the Studio's
// outro card became its second consumer; re-exported so tool code keeps one
// import site for "render a badge".
export { drawQr, type QrDraw };

export interface RenderBadgeOptions {
  source: BadgeSource | null;
  elements: OverlayElement[];
  theme: StyleTheme | null;
  /**
   * Where the badge's animations are up to, in seconds from the first frame.
   * Windows and entrances are counted from zero here — a badge has no clip to
   * be trimmed against, so `originSeconds` is always 0.
   */
  timeSeconds?: number;
  /** Painted where no picture covers the frame. */
  background?: string;
  /** Darkening painted over the picture and under the badge. */
  shades?: readonly Shade[];
  /** The badge block's extent, for a shade that follows the hook. */
  block?: HookBlock | null;
  /**
   * The piece's prepared OPENER, painted between the picture and the shades —
   * so a variant that owns the frame covers the picture, while the shades and
   * the badge still sit above whatever it drew. Null for every slide that is
   * not a hook, and a no-op for the badge variant, which draws nothing.
   *
   * It is painted at `timeSeconds`: preview and export hand the same clock to
   * the same closure, which is the only reason the two can be relied on to
   * agree. See `shared/roadtrip/hooks/`.
   */
  hook?: ResolvedHook | null;
  /**
   * The badge's elements AT a moment, for a hook that rewrites its text — the
   * scrub's numeral counting with the head. When set it wins over `elements`
   * for both the paint and the measure, evaluated at `timeSeconds`, so a click
   * lands on the numeral it is currently showing. Null for every badge whose
   * words do not move, which keeps their elements built once per edit.
   */
  elementsAt?: ((tSeconds: number) => OverlayElement[]) | null;
  /** A QR square, drawn under the text — the call-to-action slide's hero. */
  qr?: QrDraw | null;
  /**
   * The grade, as a grader the CALLER owns, sized to the source's own pixels
   * (or fewer, of the same aspect — the picture is drawn at the source's size
   * whatever the grader hands back). A grader is a WebGL2 context, and a
   * context per repaint would be built and lost on every frame of the stage's
   * transport (contexts are only reclaimed on GC or a forced loss): the stage
   * keeps one, HOLDING its grades (`held-grader.ts`), and re-makes it when the
   * LUT or the source size changes; `badgeToPng` makes and disposes one per
   * slide.
   */
  grader?: FrameGrader | null;
  /**
   * How the picture sits in the frame — pan, zoom, rotation over the
   * cover-crop. Absent is the centred cover this always did.
   */
  framing?: Framing | null;
  /**
   * Several pictures in the frame instead of `source` + `framing`: the
   * collage's cells, each with its own decoded picture, framing and (caller-
   * owned) grader. When set, `source`, `framing` and `grader` are not read —
   * the lead picture is `items[0]`. Built by `loadCollageSources` + the
   * caller's graders; see `collage.ts` for why cell 1 is the slide.
   */
  collage?: CollageRender | null;
  /**
   * EDITOR ONLY: the selected element, drawn faintly even outside its window
   * so a piece that has exited stays visible and selectable while chosen.
   * Never set by an export — `badgeToPng` and `renderDeck` do not know it.
   */
  ghostId?: string | null;
}

/** One cell of a collage, ready to paint. */
export interface CollageItem {
  source: BadgeSource | null;
  framing: Framing;
  /** This cell's own cube as a grader the CALLER owns — see `grader` above. */
  grader?: FrameGrader | null;
}

export interface CollageRender {
  collage: SlideCollage;
  /** Cell by cell, the lead first; a short list leaves the rest empty. */
  items: readonly CollageItem[];
  /**
   * The slide's screen time — what the cells' exit is laid against. Absent
   * (a still, a surface with no clock) means the cells never leave.
   */
  seconds?: number | null;
}

/** A collage's decoded pictures, cell by cell, and one call to free them all. */
export interface CollageSources {
  items: { source: BadgeSource | null; framing: Framing; develop: DevelopSettings | null }[];
  release: () => void;
}

/**
 * Decode every DRAWN cell's picture — the lead's included, as item 0 — from
 * the files `resolve` finds. A cell whose file is gone or cannot be decoded
 * is an empty cell, not a failed slide: losing one photograph of six must
 * never cost the piece. `maxWidth` bounds every decode, as `loadBadgeSource`
 * does for one; a collage shares the budget its consumer gives it.
 */
export async function loadCollageSources(
  lead: CollageLead & { videoTimeSeconds: number },
  collage: SlideCollage,
  resolve: (ref: SavedMediaRef | null) => File | null,
  maxWidth?: number,
): Promise<CollageSources> {
  const count = collageCellCount(collage);
  const items: CollageSources['items'] = [];
  for (let i = 0; i < count; i++) {
    const cell = collageCellAt(lead, collage, i);
    let source: BadgeSource | null = null;
    const file = resolve(cell.media);
    if (file) {
      try {
        source = await loadBadgeSource(file, i === 0 ? lead.videoTimeSeconds : 0, maxWidth);
      } catch {
        source = null;
      }
    }
    items.push({ source, framing: cell.framing, develop: cell.develop });
  }
  return {
    items,
    release: () => {
      for (const item of items) item.source?.release();
    },
  };
}

/** Paint a collage's cells over its background — the picture step of `renderBadge` when a slide holds several. */
function paintCollage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  render: CollageRender,
  timeSeconds: number,
): void {
  ctx.fillStyle = render.collage.background;
  ctx.fillRect(0, 0, w, h);
  const cells = resolveCollage(render.collage, w, h);
  // The cells' entrances and exits at this moment — the engine's own
  // transform per cell, from the same clock the badge is drawn at.
  const motions = collageCellMotions(render.collage, cells, { w, h }, timeSeconds, render.seconds ?? null);
  const pictures: (LayoutPicture | null)[] = cells.map((_, i) => {
    const item = render.items[i];
    if (!item?.source || item.source.width <= 0 || item.source.height <= 0) return null;
    // Graded at the source's own density, then framed — the photo-frame rule,
    // per cell.
    return {
      image: item.grader ? item.grader.render(item.source.image) : item.source.image,
      width: item.source.width,
      height: item.source.height,
    };
  });
  drawLayout(ctx, w, h, cells, {
    picture: (i) => pictures[i] ?? null,
    framing: (i) => render.items[i]?.framing ?? DEFAULT_FRAMING,
    spacing: render.collage.spacing,
    motion: motions ? (i) => motions[i] ?? null : undefined,
  });
}

/** The overlay engine's options for a badge, shared by the paint and the measure. */
function overlayOptions(opts: RenderBadgeOptions): DrawOptions {
  return {
    theme: opts.theme,
    timeSeconds: opts.timeSeconds ?? 0,
    originSeconds: 0,
    ghostId: opts.ghostId ?? null,
  };
}

/**
 * The hit boxes of a badge's elements, measured exactly as `renderBadge`
 * would draw them — same context, same elements, same options — so a click on
 * the stage lands on what the eye sees. Pixel space of the canvas.
 */
export function measureBadge(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: RenderBadgeOptions,
): ElementBox[] {
  return measureOverlays(ctx, elementsFor(opts), null, w, h, overlayOptions(opts));
}

/** The elements a paint or a measure uses — rewritten at the clock when a hook says so. */
function elementsFor(opts: RenderBadgeOptions): OverlayElement[] {
  return opts.elementsAt ? opts.elementsAt(opts.timeSeconds ?? 0) : opts.elements;
}

/** `#rrggbb` → `rgba(r,g,b,a)`; anything else is passed through unchanged. */
function rgba(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!m) return color;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Paint the shades over the picture. They run BEFORE the badge, never after:
 * darkening the text you just drew would defeat the point.
 *
 * Exported because the video burn-in needs the same treatment on every frame,
 * through the Studio's export pipeline rather than through `renderBadge` — a
 * gradient that appeared in the PNG and vanished in the reel would be a
 * different picture.
 *
 * The geometry is `shades.ts`'s; this only translates fractions into pixels.
 */
export function paintShades(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  shades: readonly Shade[],
  block: HookBlock | null,
): void {
  const short = Math.min(w, h);
  for (const shade of shades) {
    const g = shadeGradient(shade, block);
    if (!g) continue;

    let gradient: CanvasGradient;
    if (g.kind === 'linear') {
      if (typeof ctx.createLinearGradient !== 'function') continue;
      gradient = ctx.createLinearGradient(g.x0 * w, g.y0 * h, g.x1 * w, g.y1 * h);
    } else {
      if (typeof ctx.createRadialGradient !== 'function') continue;
      // Radii are fractions of the SHORTER side, so a radial keeps its shape
      // on a 9:16 frame instead of turning into a stripe.
      gradient = ctx.createRadialGradient(
        g.cx * w,
        g.cy * h,
        g.r0 * short,
        g.cx * w,
        g.cy * h,
        Math.max(g.r1 * short, 1),
      );
    }
    for (const stop of g.stops) gradient.addColorStop(stop.at, rgba(shade.color, stop.alpha));

    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

/**
 * Draw one badge frame into `canvas` at whatever size it already is. The
 * canvas's own dimensions decide the resolution, which is what keeps the
 * preview and the export identical bar their scale.
 */
export async function renderBadge(
  canvas: HTMLCanvasElement,
  opts: RenderBadgeOptions,
): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // The fonts are waited for FIRST, and everything after is synchronous.
  // Reading the canvas size before an await and drawing after it is how a
  // stale render paints a miniature into a canvas a newer one has resized —
  // measured, and it left a ghost badge in the corner of the stage. Keeping
  // the whole paint in one synchronous block also makes two overlapping
  // renders idempotent: each draws a complete, self-consistent frame.
  await ensureOverlayFonts(opts.elements, opts.theme);
  const { width: w, height: h } = canvas;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = opts.background ?? '#100f0d';
  ctx.fillRect(0, 0, w, h);

  if (opts.collage) {
    paintCollage(ctx, w, h, opts.collage, opts.timeSeconds ?? 0);
  } else if (opts.source && opts.source.width > 0 && opts.source.height > 0) {
    // Grade at the source's own density, THEN frame it: grading the cropped
    // frame would give a different result at every output size (the
    // photo-frame rule). Shades, QR and the badge stay after.
    const picture = opts.grader ? opts.grader.render(opts.source.image) : opts.source.image;
    drawFramed(
      ctx,
      picture,
      opts.source.width,
      opts.source.height,
      w,
      h,
      opts.framing ?? DEFAULT_FRAMING,
    );
  }

  opts.hook?.paint(ctx, opts.timeSeconds ?? 0, { width: w, height: h });

  if (opts.shades?.length) paintShades(ctx, w, h, opts.shades, opts.block ?? null);
  if (opts.qr) drawQr(ctx, w, h, opts.qr);

  drawOverlays(ctx, elementsFor(opts), null, w, h, overlayOptions(opts));
}

/**
 * Render at full size and hand back a PNG — lossless, since text is the point.
 * A LUT, when given, is applied through a grader made for this one render and
 * disposed after it: an export is a handful of slides, and a context per slide
 * is the correct lifetime there.
 */
export async function badgeToPng(
  opts: RenderBadgeOptions & {
    width: number;
    height: number;
    lut?: CubeLut | null;
    /** A collage's cube per cell (its own develop baked in); absent leaves every cell as shot. */
    collageLuts?: readonly (CubeLut | null)[];
  },
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = opts.width;
  canvas.height = opts.height;
  // A still past what the GPU takes on one edge is fitted to it first; the
  // copy is released with the grader. A clip's frame is never past it.
  const fit =
    !opts.collage && opts.lut && opts.source && opts.source.width > 0 && opts.source.image instanceof ImageBitmap
      ? await fitPhotoForRender(opts.source.image)
      : null;
  const source: BadgeSource | null | undefined =
    fit && opts.source
      ? { ...opts.source, image: fit.image, width: fit.width, height: fit.height }
      : opts.source;
  const grader =
    !opts.collage && opts.lut && source && source.width > 0
      ? makeFrameGrader(opts.lut, source.width, source.height)
      : null;
  // One grader per cell, for this one render, as the single picture's above.
  const cellGraders = (opts.collage?.items ?? []).map((item, i) => {
    const lut = opts.collageLuts?.[i] ?? null;
    return lut && item.source && item.source.width > 0
      ? makeFrameGrader(lut, item.source.width, item.source.height)
      : null;
  });
  const collage = opts.collage
    ? { ...opts.collage, items: opts.collage.items.map((item, i) => ({ ...item, grader: cellGraders[i] })) }
    : opts.collage;
  try {
    await renderBadge(canvas, { ...opts, source, grader, collage });
  } finally {
    grader?.dispose();
    fit?.release();
    for (const g of cellGraders) g?.dispose();
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
