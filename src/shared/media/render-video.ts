/**
 * Encoding a video that has NO source clip: frames we paint ourselves.
 *
 * The rest of the media pipeline starts from a file — demux, decode, transform
 * each decoded frame, re-encode (`webcodecs-export.ts`). That is the right
 * shape when there is footage, and it is a dead end when there is none: an
 * animated badge over a photograph, a deck of stills played in order, a card
 * held for three seconds. `exportProcessedVideo` refuses those before it
 * starts, because with no samples there is nothing to decode and no codec
 * description to configure a decoder with.
 *
 * So this is the same pipeline with its first half removed: plan the frames,
 * ask the caller to paint each one, encode, mux. Everything it can share it
 * shares — the codec pick, the bitrate, the queue back-pressure, the colour-tag
 * guard and the frame plan — so a change to how this suite encodes still lands
 * in one place.
 *
 * Two things it deliberately does not do, both stated wherever it is offered:
 *
 * - **No audio.** Audio is copied bit-for-bit and never re-encoded (the
 *   pipeline's founding rule), and a painted timeline has no demuxed track to
 *   copy from. A painted clip is silent, and the caller says so.
 * - **No source cadence to inherit.** There is no clip whose rate could be
 *   passed through, so the frame rate is a delivery choice with a default
 *   ({@link DEFAULT_PAINTED_FPS}) rather than a resample of anything.
 */

import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { safeChunkMetadata } from './colour-tag';
import { framePlan } from './frame-plan';
import {
  awaitQueue,
  deriveBitrate,
  isEncodeSupported,
  pickAvcCodec,
  type ExportProgress,
} from './webcodecs-export';

/**
 * The cadence a painted clip is delivered at. 30 is the platforms' own
 * default for a vertical piece, and doubling it would double the encode for a
 * badge that moves through a handful of keyframed steps.
 */
export const DEFAULT_PAINTED_FPS = 30;

/** Sanity ceiling: past this a "clip" is a render job, not a hook. */
const MAX_PAINTED_FPS = 60;

export interface EncodeFramesOptions {
  /** Output size in pixels; both are rounded to even for H.264. */
  width: number;
  height: number;
  /** How long the clip runs. Zero or less is refused, not silently empty. */
  seconds: number;
  /** Delivery cadence; {@link DEFAULT_PAINTED_FPS} when absent. */
  fps?: number;
  /**
   * Paint the frame at `tSeconds` into the clip's life and return the surface
   * to encode, at the output size. Called once per frame, so a still is cheap
   * and an animation plays. May be async: unlike the decode pipeline's own
   * `FrameProcessor`, nothing here is racing a decoder queue.
   */
  draw: (tSeconds: number) => CanvasImageSource | Promise<CanvasImageSource>;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

/**
 * The encodable size for a painted clip: even in both axes, never zero.
 * H.264 cannot encode an odd dimension, and a canvas fitted to an aspect
 * lands on one about half the time.
 */
export function paintedOutputSize(
  width: number,
  height: number,
): { w: number; h: number } {
  const even = (n: number) => Math.max(2, 2 * Math.round((Number.isFinite(n) ? n : 0) / 2));
  return { w: even(width), h: even(height) };
}

/** The cadence actually used: the ask, clamped, or the default. */
export function paintedFps(fps: number | undefined): number {
  if (fps === undefined || !Number.isFinite(fps) || fps <= 0) return DEFAULT_PAINTED_FPS;
  return Math.min(MAX_PAINTED_FPS, Math.max(1, Math.round(fps)));
}

/**
 * Paint `seconds` of video and return it as an MP4 Blob. H.264, no audio
 * track, timestamps starting at zero.
 *
 * Throws with a sentence a human can act on when the browser has no encoder,
 * or when the clip would be empty — an empty MP4 that downloads and plays
 * nothing is worse than a refusal that says why.
 */
export async function encodeFrames(opts: EncodeFramesOptions): Promise<Blob> {
  if (!isEncodeSupported()) {
    throw new Error(
      'This browser cannot encode video: WebCodecs’ VideoEncoder is missing. The slides still export as images.',
    );
  }

  const { w, h } = paintedOutputSize(opts.width, opts.height);
  const fps = paintedFps(opts.fps);
  const plan = framePlan(opts.seconds, fps);
  if (plan.length === 0) {
    throw new Error('Nothing to encode: this clip would be zero frames long.');
  }

  const throwIfAborted = () => {
    if (opts.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  };
  throwIfAborted();

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    // No audio track is declared at all: a painted clip has nothing to copy,
    // and an empty track would be a silent lie about what the file holds.
    video: { codec: 'avc', width: w, height: h, rotation: 0 },
    fastStart: 'in-memory',
  });

  let pipelineError: Error | null = null;

  const encoderConfig: Omit<VideoEncoderConfig, 'codec'> = {
    width: w,
    height: h,
    bitrate: deriveBitrate(w, h, fps),
    framerate: fps,
  };
  const codec = await pickAvcCodec(encoderConfig);

  // The encoder is created before the try so that EVERY exit path below closes
  // it: an encoder left open still holds a hardware encode session, the
  // browser caps how many a page may have, and leaking one breaks every
  // export after it rather than only this one (the same reason
  // `exportProcessedVideo` wraps its whole run).
  const encoder = new VideoEncoder({
    // Guarded: a colour space the muxer cannot encode would become a WRONG
    // `colr` box rather than an absent one — see `colour-tag.ts`.
    output: (chunk, meta) => muxer.addVideoChunk(chunk, safeChunkMetadata(meta)),
    error: (e) => {
      pipelineError = e instanceof Error ? e : new Error(String(e));
    },
  });

  try {
    encoder.configure({ codec, ...encoderConfig, avc: { format: 'avc' } });

    const gop = Math.max(1, fps * 2); // keyframe every ~2s
    let done = 0;
    for (const f of plan) {
      throwIfAborted();
      if (pipelineError) throw pipelineError;
      const painted = await opts.draw(f.tSeconds);
      const frame = new VideoFrame(painted, {
        timestamp: f.timestampMicros,
        duration: f.durationMicros,
      });
      try {
        encoder.encode(frame, { keyFrame: done % gop === 0 });
      } finally {
        // Closed whatever the encoder did with it: a VideoFrame holds a real
        // buffer, and the painter usually hands back the SAME canvas every
        // time, so a leaked frame is a leak per frame.
        frame.close();
      }
      done += 1;
      opts.onProgress?.({ phase: 'encoding', ratio: done / plan.length });
      await awaitQueue(() => encoder.encodeQueueSize, 24);
    }

    await encoder.flush();
    if (pipelineError) throw pipelineError;

    opts.onProgress?.({ phase: 'finalizing', ratio: null });
    muxer.finalize();
    const { buffer } = muxer.target as ArrayBufferTarget;
    return new Blob([buffer], { type: 'video/mp4' });
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}
