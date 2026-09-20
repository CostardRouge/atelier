/**
 * Render ONE export variant of a composition: the (optionally LUT-graded,
 * upright) clip cover-cropped into the variant's output frame, the overlay
 * elements drawn relative to THAT frame (so a 9:16 deliverable keeps its
 * titles composed for 9:16), at the variant's delivery cadence, through the
 * shared WebCodecs pipeline.
 *
 * WebCodecs-only: the seek fallback renders at source geometry and doesn't
 * reframe — undecodable HEVC surfaces a clear message pointing at the
 * in-browser transcode instead (callers already prefer a transcoded H.264
 * when one exists).
 */

import { isSilentTexture, type FilmTexture } from '../film/film-texture';
import type { Cue } from '../telemetry/srt-parser';
import { findCue } from '../telemetry/find-cue';
import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import { drawOverlays } from '../overlay/draw-overlays';
import { ensureOverlayFonts } from '../overlay/fonts';
import { prepareOutro, type OutroCard } from '../overlay/outro-card';
import type { OverlayElement } from '../overlay/overlay-types';
import type { StyleTheme } from '../overlay/title-styles';
import type { Scene } from '../overlay/scenes';
import type { TimeShift } from '../telemetry/time-format';
import type { ExportTail } from './export-tail';
import { resolveSpeed } from './frame-rate';
import type { TrimRange } from './trim';
import { DEFAULT_FRAMING, drawFramed, type Framing } from './framing';
import {
  drawRotatedFrame,
  exportProcessedVideo,
  makeExportCanvas,
  type ExportOptions,
  type ExportProgress,
  type FrameProcessor,
} from './webcodecs-export';
import {
  variantOutputSize,
  type ExportVariant,
} from '../projects/export-variants';

export interface VariantRenderOptions {
  elements: OverlayElement[];
  cues: Cue[];
  lut: CubeLut | null;
  intensity: number;
  /**
   * The grade's film TEXTURE — grain and halation — drawn by ONE node after
   * the look. A CLIP takes it: `SOURCE → CUBE → [FILM] → OUTPUT` is the fast
   * path, the node has no spatial dependency on the edit, and grain on a
   * moving picture is the point of a film stock
   * (`docs/film-simulation.md` §10).
   */
  film?: FilmTexture | null;
  theme: StyleTheme | null;
  timeShift?: TimeShift | null;
  /** The project's scenes — the intro's window, scrim and solo. */
  scenes?: readonly Scene[];
  /** Display-oriented source dimensions (from the clip's metadata). */
  srcWidth: number;
  srcHeight: number;
  /** Encode only this slice of the source; null exports the whole clip. */
  trim?: TrimRange | null;
  /**
   * How the picture sits in the variant's frame — pan, zoom and rotation over
   * the cover-crop. Absent is the centred cover, which is what every Studio
   * export does and every clip did before Road Trip could reframe a hook.
   */
  framing?: Framing | null;
  /**
   * The project's outro — a closing card appended after the footage, drawn at
   * the variant's own output frame like every overlay. Rides only variants
   * that carry the overlays: a clean master stays truly clean.
   */
  outro?: OutroCard | null;
  /**
   * Painted into the variant's frame after the picture and BEFORE the
   * overlays, once per frame. The Studio leaves it unset; Road Trip uses it
   * for the hook's scrim and vignette (which have to darken the picture
   * rather than the text drawn over it) and for a hook variant's own drawing
   * (the scrub's tape and flashes).
   */
  paintUnderOverlays?: (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    w: number,
    h: number,
    /**
     * Seconds since the first EXPORTED frame, on `overlayClock` — 0 there,
     * and at the delivered speed under `'delivered'`. The trim's in point is
     * the origin either way.
     */
    tSeconds: number,
  ) => void;
  /**
   * Which clock the overlays' animations run on.
   *
   * `source` (the default, the Studio's) hands the engine the SOURCE time
   * and the trim's in point as the origin: cues, the capture clock and the
   * heading smoothing all index the source timeline, and a re-timed variant
   * plays its intro at the re-timed pace — that IS the Studio's re-time.
   *
   * `delivered` hands it the time into the DELIVERED clip, at the delivered
   * speed, from zero: a Road Trip badge composed to slide in over 0.6 s must
   * slide in over 0.6 s of the viewer's time whatever speed its clip plays
   * at, exactly as the stage previews it. Only for a caller with no cues —
   * a source-indexed readout under a delivered clock would read the wrong
   * frame's value. `paintUnderOverlays` and `elementsAt` below are handed
   * this SAME clock, so a hook variant's own drawing (the scrub's tape) and
   * the badge's entrance never desync under a re-timed clip.
   */
  overlayClock?: 'source' | 'delivered';
  /**
   * The overlays AT a moment, for a composition whose words change as it plays
   * (Road Trip's scrub steps its numeral). Called with the same clock as
   * `paintUnderOverlays` and as `drawOverlays`' own `timeSeconds` — seconds
   * since the first delivered frame, at the delivered speed under
   * `overlayClock: 'delivered'`. `elements` is used when absent. The Studio
   * leaves it unset.
   */
  elementsAt?: (tSeconds: number) => OverlayElement[];
  /** Audio the caller made for this export — see `ExportOptions.bed`. */
  bed?: ExportOptions['bed'];
  /** Mix that bed into the clip's own sound — see `ExportOptions.mixBed`. */
  mixBed?: boolean;
  onAudioSkipped?: (reason: string) => void;
}

/**
 * The outro as an export tail: the card prepared once (the QR encode is
 * deterministic but not free) and painted per appended frame at the output
 * size, so an animated line plays and a 9:16 cut composes its card for 9:16.
 * Null when there is no card, no time, or no 2D context to paint with.
 */
export function outroTail(
  outro: OutroCard | null | undefined,
  outWidth: number,
  outHeight: number,
): ExportTail | null {
  if (!outro || outro.seconds <= 0) return null;
  const prepared = prepareOutro(outro);
  const card = makeExportCanvas(outWidth, outHeight);
  const ctx = card.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return null;
  return {
    seconds: outro.seconds,
    draw(t) {
      prepared.draw(ctx, outWidth, outHeight, t);
      return card;
    },
  };
}

export async function exportVariantVideo(
  file: File,
  variant: ExportVariant,
  opts: VariantRenderOptions,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const outro = variant.overlays ? (opts.outro ?? null) : null;
  if (variant.overlays) {
    await ensureOverlayFonts(
      outro ? [...opts.elements, ...outro.elements] : opts.elements,
      opts.theme,
    );
  }
  const out = variantOutputSize(variant, opts.srcWidth, opts.srcHeight);
  const tail = outroTail(outro, out.w, out.h);

  return exportProcessedVideo(
    file,
    ({ codedWidth, codedHeight, rotation }): FrameProcessor => {
      const canvas = makeExportCanvas(out.w, out.h);
      const ctx = canvas.getContext('2d') as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!ctx) throw new Error('Could not create a 2D canvas for export.');

      const displayW = rotation === 90 || rotation === 270 ? codedHeight : codedWidth;
      const displayH = rotation === 90 || rotation === 270 ? codedWidth : codedHeight;
      const upright = makeExportCanvas(displayW, displayH);
      const uctx = upright.getContext('2d') as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!uctx) throw new Error('Could not create a 2D canvas for export.');

      // A texture with no look is still a render: the node is the only thing
      // that draws it.
      const grade = opts.lut || !isSilentTexture(opts.film)
        ? makeFrameGrader(
            opts.lut as CubeLut,
            codedWidth,
            codedHeight,
            opts.intensity,
            [],
            [],
            opts.film ?? null,
          )
        : null;
      const framing = opts.framing ?? DEFAULT_FRAMING;
      const origin = opts.trim?.start ?? 0;
      const delivered = opts.overlayClock === 'delivered';
      const speed = resolveSpeed(variant.speed);

      return {
        draw(videoFrame, tMicros) {
          // The SOURCE instant, in the clip's own seconds: the grain field
          // re-rolls per source frame quantised to `grainFps`, so a 24 fps
          // stock over 60 fps footage re-rolls every other frame instead of
          // boiling — and a dropped or DUPLICATED frame (`frame-rate.ts`)
          // carries the grain of the frame it really is.
          const source = grade ? grade.render(videoFrame, tMicros / 1_000_000) : videoFrame;
          drawRotatedFrame(uctx, source, codedWidth, codedHeight, rotation, displayW, displayH);
          // Frame the upright picture into the variant's canvas. With no
          // framing given this is the centred cover-crop it has always been —
          // the frame fills it fully, the excess cropped symmetrically — and
          // with one it is the author's pan, zoom and rotation. Same maths as
          // the badge preview, so a hook burns in where it was composed.
          drawFramed(ctx, upright, displayW, displayH, out.w, out.h, framing);
          const t = tMicros / 1_000_000;
          // The ONE clock every per-frame callback below reads. Source: since
          // the first exported frame, unscaled (the Studio's own re-time
          // already plays cues at their source pace). Delivered: since the
          // first DELIVERED frame, at the delivered speed — a hook variant's
          // drawing (the scrub's tape) and the badge's own entrance must
          // agree on this or a re-timed hook clip desyncs the two.
          const sinceStart = delivered
            ? Math.max(0, t - origin) / speed
            : t - origin;
          opts.paintUnderOverlays?.(ctx, out.w, out.h, sinceStart);
          if (variant.overlays) {
            const elements = opts.elementsAt ? opts.elementsAt(sinceStart) : opts.elements;
            drawOverlays(ctx, elements, findCue(opts.cues, t), out.w, out.h, {
              theme: opts.theme,
              timeShift: opts.timeShift,
              cues: opts.cues,
              // `t` is the SOURCE timestamp; windows count from the first
              // exported frame, which a trim moves. On the delivered clock
              // the engine is handed `sinceStart` itself instead, so an
              // entrance keeps its own pace under a re-timed clip.
              timeSeconds: delivered ? sinceStart : t,
              scenes: opts.scenes,
              originSeconds: delivered ? 0 : origin,
            });
          }
          return canvas;
        },
        dispose() {
          grade?.dispose();
        },
      };
    },
    onProgress,
    signal,
    {
      outputSize: { width: out.w, height: out.h },
      frameRate: variant.frameRate,
      // A new noise field every frame is nothing a P-frame can predict, so a
      // grained clip is encoded at the higher bits per pixel — halation is a
      // blur and costs nothing, hence `grain` and not the whole texture.
      grained: (opts.film?.grain ?? 0) > 0,
      trim: opts.trim ?? null,
      speed: variant.speed,
      tail,
      bed: opts.bed ?? null,
      mixBed: opts.mixBed,
      onAudioSkipped: opts.onAudioSkipped,
    },
  );
}
