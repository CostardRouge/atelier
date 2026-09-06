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

import { drawQr, type QrDraw } from '../overlay/draw-qr';
import { shadeGradient, type HookBlock, type Shade } from './shades';
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

export interface CoverRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The source rectangle to draw so the picture COVERS the frame without
 * distortion — the crop Instagram would apply, computed here so the preview
 * shows the same framing the export writes. Centred: a badge author reframes
 * by choosing a different picture, not by nudging a crop we invented for them.
 */
export function coverRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): CoverRect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(srcW, 0), sh: Math.max(srcH, 0) };
  }
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  if (srcAspect > dstAspect) {
    // Source is wider: keep its full height, crop the sides.
    const sw = srcH * dstAspect;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  // Source is taller (or equal): keep its full width, crop top and bottom.
  const sh = srcW / dstAspect;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
}

/** Longest edge a preview canvas is worth drawing at. */
export const PREVIEW_LONG_EDGE = 720;

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
): Promise<BadgeSource> {
  if (file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
    return loadVideoFrame(file, videoTimeSeconds);
  }
  try {
    const bitmap = await createImageBitmap(file);
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    throw new Error(
      `The browser cannot decode ${file.name}. Camera RAW usually needs its JPEG beside it — point this at an exported file instead.`,
    );
  }
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
  /** A QR square, drawn under the text — the call-to-action slide's hero. */
  qr?: QrDraw | null;
  /**
   * EDITOR ONLY: the selected element, drawn faintly even outside its window
   * so a piece that has exited stays visible and selectable while chosen.
   * Never set by an export — `badgeToPng` and `renderDeck` do not know it.
   */
  ghostId?: string | null;
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
  return measureOverlays(ctx, opts.elements, null, w, h, overlayOptions(opts));
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

  if (opts.source && opts.source.width > 0 && opts.source.height > 0) {
    const { sx, sy, sw, sh } = coverRect(opts.source.width, opts.source.height, w, h);
    ctx.drawImage(opts.source.image, sx, sy, sw, sh, 0, 0, w, h);
  }

  if (opts.shades?.length) paintShades(ctx, w, h, opts.shades, opts.block ?? null);
  if (opts.qr) drawQr(ctx, w, h, opts.qr);

  drawOverlays(ctx, opts.elements, null, w, h, overlayOptions(opts));
}

/** Render at full size and hand back a PNG — lossless, since text is the point. */
export async function badgeToPng(
  opts: RenderBadgeOptions & { width: number; height: number },
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = opts.width;
  canvas.height = opts.height;
  await renderBadge(canvas, opts);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
