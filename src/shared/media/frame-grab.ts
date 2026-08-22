/**
 * Still capture: render the composed frame the stage is showing — the graded
 * video plus the overlays and their theme — into a JPEG, at the source's full
 * resolution rather than the preview's.
 *
 * This is the photo half of the export story: scrub to the frame you want,
 * press the shutter, get a thumbnail-ready still with the burn-in already on
 * it. Editor-only chrome (guides, the A/B divider, the selection outline)
 * never takes part: the still is rendered fresh here through the same
 * `drawOverlays` the video export uses, not scraped from the preview canvas.
 */

import type { Cue } from '../telemetry/srt-parser';
import { findCue } from '../telemetry/find-cue';
import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import { drawOverlays } from '../overlay/draw-overlays';
import { ensureOverlayFonts } from '../overlay/fonts';
import type { OverlayElement } from '../overlay/overlay-types';
import type { StyleTheme } from '../overlay/title-styles';
import type { Scene } from '../overlay/scenes';
import type { TimeShift } from '../telemetry/time-format';

export interface FrameGrabOptions {
  elements: OverlayElement[];
  cues: Cue[];
  lut: CubeLut | null;
  intensity: number;
  theme: StyleTheme | null;
  timeShift?: TimeShift | null;
  /** The project's scenes — so a still taken during the intro shows it. */
  scenes?: readonly Scene[];
  /** Media time of the clip's in point; windows are counted from it. */
  originSeconds?: number;
  /** Burn the overlays in, or capture the clean graded frame. */
  overlays: boolean;
  /** JPEG quality 0..1. */
  quality?: number;
}

/**
 * Capture `video`'s current frame. Returns null when the element has no
 * decoded frame yet (nothing to grab).
 */
export async function grabFrame(
  video: HTMLVideoElement,
  opts: FrameGrabOptions,
): Promise<Blob | null> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;

  if (opts.overlays) await ensureOverlayFonts(opts.elements, opts.theme);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Grade exactly like the preview and the video export do.
  let source: CanvasImageSource = video;
  const grader = opts.lut ? makeFrameGrader(opts.lut, w, h, opts.intensity) : null;
  try {
    if (grader) source = grader.render(video);
    ctx.drawImage(source, 0, 0, w, h);
  } finally {
    grader?.dispose();
  }

  if (opts.overlays) {
    const t = video.currentTime;
    drawOverlays(ctx, opts.elements, findCue(opts.cues, t), w, h, {
      theme: opts.theme,
      timeShift: opts.timeShift,
      cues: opts.cues,
      timeSeconds: t,
      scenes: opts.scenes,
      originSeconds: opts.originSeconds ?? 0,
    });
  }

  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', opts.quality ?? 0.92),
  );
}

/** `clip` at 72.4s → `clip-frame-1m12s.jpg` — sortable, no punctuation. */
export function frameGrabName(base: string, seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const stamp = m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
  const clean = base.trim().replace(/\.[^.]+$/, '') || 'frame';
  return `${clean}-frame-${stamp}.jpg`;
}
