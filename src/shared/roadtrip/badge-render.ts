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

import { drawOverlays } from '../overlay/draw-overlays';
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
    video.onseeked = () =>
      resolve({
        image: video,
        width: video.videoWidth,
        height: video.videoHeight,
        release,
      });
    video.onerror = () =>
      fail(
        `The browser cannot decode ${file.name}. Some HEVC clips need the Studio's transcode first.`,
      );
    video.src = url;
  });
}

export interface RenderBadgeOptions {
  source: BadgeSource | null;
  elements: OverlayElement[];
  theme: StyleTheme | null;
  /** Painted where no picture covers the frame. */
  background?: string;
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
  const { width: w, height: h } = canvas;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = opts.background ?? '#100f0d';
  ctx.fillRect(0, 0, w, h);

  if (opts.source && opts.source.width > 0 && opts.source.height > 0) {
    const { sx, sy, sw, sh } = coverRect(opts.source.width, opts.source.height, w, h);
    ctx.drawImage(opts.source.image, sx, sy, sw, sh, 0, 0, w, h);
  }

  // Fonts must be resident before the first fillText or the badge draws in a
  // fallback face and silently changes width.
  await ensureOverlayFonts(opts.elements, opts.theme);
  drawOverlays(ctx, opts.elements, null, w, h, { theme: opts.theme });
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
