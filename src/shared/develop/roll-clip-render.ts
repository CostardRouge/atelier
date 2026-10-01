/**
 * The CLIP export a roll makes (2026-09-30): ONE clip, every frame graded
 * through the picture's own cube — its develop under its own look — and the
 * film node after it, re-encoded to H.264 through the suite's one WebCodecs
 * pipeline (`media/webcodecs-export.ts`), its sound copied as recorded.
 *
 * What a clip takes is what the pipeline's fast path carries and ONE thing
 * more: `SOURCE → CUBE → [FILM] → OUTPUT`, the same chain a Studio variant and
 * a Trips hook clip run (`export-variant.ts`), and since 2026-10-01 a CROP —
 * the roll's own `deliveredLayout` arithmetic (aspect, zoom, pan, straighten,
 * flips), one framing held still over every frame, drawn through the same
 * `drawDelivered` a photograph leaves by. A border, the warps, detail, repair
 * and the layers are passes over one still frame and never reach a clip
 * (`roll-types.ts`, `isClipPicture`), so nothing here draws them.
 *
 * The size is a CAP, the roll's rule: the first target's size, read against
 * the clip's DELIVERED frame (the crop at the clip's own density, `longEdgeFor`),
 * and never an upscale. Uncropped and uncapped, the frames stay in coded
 * orientation with the container's rotation flag standing (the LUT tool's
 * cheap path); cropped or capped, each frame is turned upright and drawn into
 * the file's own frame, so the file carries no flag to honour. The container
 * is read FIRST (`demuxSource`), because the pipeline reads its output size
 * before it asks for a processor, and only the track and its matrix say what
 * frame the crop and the cap are read against.
 */

import { isSilentTexture, type FilmTexture } from '../film/film-texture';
import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import { DEFAULT_FRAMING, isDefaultFraming, type Framing } from '../media/framing';
import {
  demuxSource,
  drawRotatedFrame,
  exportProcessedVideo,
  makeExportCanvas,
  rotationFromMatrix,
  type ExportProgress,
  type FrameProcessor,
} from '../media/webcodecs-export';
import type { BorderLayout } from './border-layout';
import { drawDelivered } from './border-paint';
import { pictureAspectRatio } from './crop-aspect';
import { longEdgeFor, type ExportSize } from './export-targets';
import { deliveredLayout, type PictureSize } from './roll-export';

export interface ClipRenderOptions {
  /** The run's cancel — the pipeline stops between two frames on it. */
  signal?: AbortSignal;
  /** The picture's own cube — its develop under its own look — or null as shot. */
  lut: CubeLut | null;
  /** The look's film texture, drawn by the node LAST on every frame; null for none. */
  film?: FilmTexture | null;
  /** The size the file is capped at (the first target's), or null for the clip's own frame. */
  size: ExportSize | null;
  /** The picture's crop (`RollPicture.framing` / `aspect`): one framing held still over every frame. */
  framing?: Framing | null;
  aspect?: string;
  onProgress?: (p: ExportProgress) => void;
}

export interface ClipRendered {
  blob: Blob;
  /** The file's frame. */
  width: number;
  height: number;
  /** The clip's own display frame — what the crop and the cap were read against. */
  source: PictureSize;
}

/** An even size, the encoder's rule, from a frame and a cap that never upscales. */
export function clipOutputSize(display: PictureSize, longEdge: number | null): PictureSize {
  const long = Math.max(display.width, display.height);
  const k = longEdge !== null && longEdge > 0 && longEdge < long ? longEdge / long : 1;
  const even = (n: number) => Math.max(2, 2 * Math.round((n * k) / 2));
  return { width: even(display.width), height: even(display.height) };
}

/** What a clip delivers: the file's frame, and whether a crop or the cap changes it from the clip's own. */
export interface ClipDelivery {
  /** The file's frame — even, the encoder's rule. */
  out: PictureSize;
  /** The whole canvas as the crop's rectangle (a clip wears no border), in output pixels. */
  layout: BorderLayout;
  /** The crop in the clip's display pixels. */
  zone: { w: number; h: number };
  /** The framing to draw every frame through — the default when none was written. */
  framing: Framing;
  /** A crop is in effect: the frame is a zone of the picture, not the picture capped. */
  cropped: boolean;
  /** The file's frame differs from the clip's own, by the crop or the cap. */
  resized: boolean;
}

/**
 * The frame a clip leaves in, the still export's arithmetic (`deliveredLayout`)
 * read against the clip's DISPLAY frame: the crop at the clip's own density,
 * capped to the target's long edge — read against the delivered frame, as for
 * a photograph — never upscaled, and rounded to even for the encoder. With no
 * crop this is `clipOutputSize` exactly.
 */
export function clipDelivery(display: PictureSize, aspect: string | undefined, framing: Framing | null | undefined, size: ExportSize | null): ClipDelivery {
  const shape = aspect ?? 'original';
  const written = framing && !isDefaultFraming(framing) ? framing : null;
  const cropped = written !== null || shape !== 'original';
  const ratio = pictureAspectRatio(shape, display.width, display.height);
  const whole = deliveredLayout(display, ratio, written, null, null);
  const cap = longEdgeFor(size, whole.out);
  const d = deliveredLayout(display, ratio, written, null, cap);
  const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));
  const out = { width: even(d.out.w), height: even(d.out.h) };
  return {
    out,
    layout: { w: out.width, h: out.height, x: 0, y: 0, pw: out.width, ph: out.height },
    zone: d.zone,
    framing: written ?? { ...DEFAULT_FRAMING },
    cropped,
    resized: out.width !== display.width || out.height !== display.height,
  };
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
  const delivery = clipDelivery(display, opts.aspect, opts.framing, opts.size);
  const { out, layout, framing, cropped } = delivery;
  // A frame drawn by hand — turned upright, cut, or both — is one the file
  // carries no rotation flag for (`outputSize`).
  const composed = cropped || delivery.resized;
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
      if (!composed) {
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
      const canvas = makeExportCanvas(out.width, out.height);
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) throw new Error('Could not create a 2D canvas for export.');
      ctx.imageSmoothingQuality = 'high';
      if (!cropped) {
        // Capped only: turned upright and drawn smaller into the file's
        // frame, the rotation baked in.
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
      }
      // Cropped: the frame is first stood upright (a turned clip's framing is
      // written in its DISPLAY frame, the one the stage showed), then cut by
      // the roll's own delivered draw — the crop at the clip's own density,
      // capped, exactly as a photograph's. An upright clip skips the scratch.
      const upright = rot !== 0 ? makeExportCanvas(display.width, display.height) : null;
      const uctx = upright ? (upright.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null) : null;
      if (upright && !uctx) throw new Error('Could not create a 2D canvas for export.');
      return {
        draw(frame, tMicros) {
          const graded = grade ? grade.render(frame, tMicros / 1_000_000) : frame;
          let source: CanvasImageSource = graded;
          if (upright && uctx) {
            drawRotatedFrame(uctx, graded, cw, ch, rot, display.width, display.height);
            source = upright;
          }
          ctx.clearRect(0, 0, out.width, out.height);
          drawDelivered(ctx as CanvasRenderingContext2D, source, display.width, display.height, framing, layout, null);
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
      ...(composed ? { outputSize: { width: out.width, height: out.height } } : {}),
    },
  );
  return { blob, width: out.width, height: out.height, source: display };
}
