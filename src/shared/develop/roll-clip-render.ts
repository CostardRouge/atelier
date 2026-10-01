/**
 * The CLIP export a roll makes (2026-09-30): ONE clip, every frame graded
 * through the picture's own cube — its develop under its own look — and the
 * film node after it, re-encoded to H.264 through the suite's one WebCodecs
 * pipeline (`media/webcodecs-export.ts`), its sound copied as recorded.
 *
 * What a clip takes is what the pipeline's fast path carries and nothing
 * more: `SOURCE → CUBE → [FILM] → OUTPUT`, the same chain a Studio variant and
 * a Trips hook clip run (`export-variant.ts`). A crop, a border, the warps,
 * detail, repair and the layers are passes over one still frame and never
 * reach a clip (`roll-types.ts`, `isClipPicture`), so nothing here draws them.
 *
 * The size is a CAP, the roll's rule: the first target's size, read against
 * the clip's display frame (`longEdgeFor`), and never an upscale. Uncapped,
 * the frames stay in coded orientation with the container's rotation flag
 * standing (the LUT tool's cheap path); capped, each frame is turned upright
 * and drawn into the smaller canvas, so the file carries no flag to honour.
 * The container is read FIRST (`demuxSource`), because the pipeline reads
 * its output size before it asks for a processor, and only the track and its
 * matrix say what frame the cap is read against.
 */

import { isSilentTexture, type FilmTexture } from '../film/film-texture';
import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import {
  demuxSource,
  drawRotatedFrame,
  exportProcessedVideo,
  makeExportCanvas,
  rotationFromMatrix,
  type ExportProgress,
  type FrameProcessor,
} from '../media/webcodecs-export';
import { longEdgeFor, type ExportSize } from './export-targets';
import type { PictureSize } from './roll-export';

export interface ClipRenderOptions {
  /** The run's cancel — the pipeline stops between two frames on it. */
  signal?: AbortSignal;
  /** The picture's own cube — its develop under its own look — or null as shot. */
  lut: CubeLut | null;
  /** The look's film texture, drawn by the node LAST on every frame; null for none. */
  film?: FilmTexture | null;
  /** The size the file is capped at (the first target's), or null for the clip's own frame. */
  size: ExportSize | null;
  onProgress?: (p: ExportProgress) => void;
}

export interface ClipRendered {
  blob: Blob;
  /** The file's frame. */
  width: number;
  height: number;
  /** The clip's own display frame — what the cap was read against. */
  source: PictureSize;
}

/** An even size, the encoder's rule, from a frame and a cap that never upscales. */
export function clipOutputSize(display: PictureSize, longEdge: number | null): PictureSize {
  const long = Math.max(display.width, display.height);
  const k = longEdge !== null && longEdge > 0 && longEdge < long ? longEdge / long : 1;
  const even = (n: number) => Math.max(2, 2 * Math.round((n * k) / 2));
  return { width: even(display.width), height: even(display.height) };
}

export async function renderRollClip(file: File, opts: ClipRenderOptions): Promise<ClipRendered> {
  opts.onProgress?.({ phase: 'demuxing', ratio: null });
  const demuxed = await demuxSource(file);
  if (opts.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  const track = demuxed.videoTrack;
  const codedWidth = track.video?.width ?? track.track_width;
  const codedHeight = track.video?.height ?? track.track_height;
  const rotation = rotationFromMatrix(track.matrix);
  const turned = rotation === 90 || rotation === 270;
  const display: PictureSize = { width: turned ? codedHeight : codedWidth, height: turned ? codedWidth : codedHeight };
  const out = clipOutputSize(display, longEdgeFor(opts.size, { w: display.width, h: display.height }));
  const capped = out.width !== display.width || out.height !== display.height;
  const grained = (opts.film?.grain ?? 0) > 0;

  const blob = await exportProcessedVideo(
    demuxed,
    ({ codedWidth: cw, codedHeight: ch, rotation: rot }): FrameProcessor => {
      // A texture with no look is still a render: the node is the only thing
      // that draws it (`export-variant.ts`'s rule).
      const grade =
        opts.lut || !isSilentTexture(opts.film ?? null)
          ? makeFrameGrader(opts.lut as CubeLut, cw, ch, 1, [], [], opts.film ?? null)
          : null;
      if (!capped) {
        // The clip's own frame: the graded picture in coded orientation, the
        // container's rotation flag standing — nothing is resampled that the
        // encoder would not resample anyway.
        const canvas = makeExportCanvas(cw, ch);
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (!ctx) throw new Error('Could not create a 2D canvas for export.');
        return {
          draw(frame, tMicros) {
            const source = grade ? grade.render(frame, tMicros / 1_000_000) : frame;
            ctx.drawImage(source, 0, 0, cw, ch);
            return canvas;
          },
          dispose() {
            grade?.dispose();
          },
        };
      }
      // Capped: turned upright and drawn smaller into the file's frame, the
      // rotation baked in (`outputSize` forces the muxer's flag to 0).
      const canvas = makeExportCanvas(out.width, out.height);
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) throw new Error('Could not create a 2D canvas for export.');
      ctx.imageSmoothingQuality = 'high';
      const sx = out.width / display.width;
      const sy = out.height / display.height;
      return {
        draw(frame, tMicros) {
          const source = grade ? grade.render(frame, tMicros / 1_000_000) : frame;
          ctx.save();
          ctx.scale(sx, sy);
          drawRotatedFrame(ctx, source, cw, ch, rot, display.width, display.height);
          ctx.restore();
          return canvas;
        },
        dispose() {
          grade?.dispose();
        },
      };
    },
    opts.onProgress,
    opts.signal,
    {
      grained,
      ...(capped ? { outputSize: { width: out.width, height: out.height } } : {}),
    },
  );
  return { blob, width: out.width, height: out.height, source: display };
}
