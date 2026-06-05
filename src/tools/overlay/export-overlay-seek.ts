/**
 * Codec-agnostic overlay export — the fallback path.
 *
 * The WebCodecs path can't decode HEVC/H.265 in browsers without platform
 * support, yet many of those browsers (Safari, Chrome on supported hardware)
 * still *play* the clip in a `<video>` element. This path leans on that: it
 * seeks the element frame-by-frame, draws each frame plus the overlays to a
 * canvas, and feeds the result to the same H.264 encoder + muxer.
 *
 * Trade-offs versus the WebCodecs path:
 *   - Much slower: every seek decodes from the prior keyframe; not
 *     faster-than-realtime.
 *   - Frame timing is approximate — `currentTime = i/fps` lands on the nearest
 *     decoded frame ≤ that time. The overlay still matches the intended
 *     timeline because the cue lookup uses the same `t`.
 * Audio is still copied through (we demux the source for its audio track).
 */

import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Cue } from '../telemetry/srt-parser';
import { findCue } from '../telemetry/find-cue';
import {
  awaitQueue,
  copyAudio,
  demux,
  deriveBitrate,
  isEncodeSupported,
  makeExportCanvas,
  pickAvcCodec,
  type ExportProgress,
} from '../../shared/media/webcodecs-export';
import type { CubeLut } from '../../shared/lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import { drawOverlays } from './draw-overlays';
import { ensureOverlayFonts } from './fonts';
import type { OverlayElement } from './overlay-types';

/** Seek `video` to `t` (seconds) and resolve once the frame is ready. */
function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', finish);
      clearTimeout(timer);
      resolve();
    };
    // A same-value seek won't fire 'seeked'; a timeout keeps the loop moving.
    const timer = setTimeout(finish, 2000);
    video.addEventListener('seeked', finish);
    if (Math.abs(video.currentTime - t) < 1e-4) {
      // Already there (e.g. the very first frame at t=0).
      finish();
    } else {
      video.currentTime = t;
    }
  });
}

function waitFor(video: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('This clip could not be played for export.'));
    };
    const cleanup = () => {
      video.removeEventListener(event, onOk);
      video.removeEventListener('error', onErr);
    };
    video.addEventListener(event, onOk);
    video.addEventListener('error', onErr);
  });
}

/**
 * Render `file` with overlays burned in, decoding via a `<video>` element so
 * any browser-playable codec works. Returns a new H.264 MP4 Blob.
 */
export async function exportOverlayVideoViaSeek(
  file: File,
  cues: Cue[],
  elements: OverlayElement[],
  lut: CubeLut | null,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!isEncodeSupported()) {
    throw new Error('This browser does not support WebCodecs encoding.');
  }
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  };

  await ensureOverlayFonts(elements);

  onProgress?.({ phase: 'demuxing', ratio: null });
  // Demux only to learn dimensions / rotation / frame rate and to copy audio.
  const buffer = await file.arrayBuffer();
  const { videoTrack, videoSamples, audioTrack, audioSamples } = await demux(buffer);
  throwIfAborted();
  if (videoSamples.length === 0) throw new Error('No video frames found.');

  const timescale = videoSamples[0].timescale;
  let ticks = 0;
  for (const s of videoSamples) ticks += s.duration;
  const durationSec = ticks / timescale || 1;
  const framerate = Math.max(1, Math.round(videoSamples.length / durationSec));
  const frameCount = videoSamples.length;

  // Decode source: an offscreen, muted <video>. A <video> element applies the
  // container's display rotation itself — `videoWidth`/`videoHeight` and what
  // `drawImage` paints are already display-oriented (same as the editor
  // preview, which also draws from a <video>). So we encode those pixels
  // directly with rotation:0, and the burned-in overlays land exactly where the
  // preview shows them.
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;

  let pipelineError: Error | null = null;
  let encoder: VideoEncoder | null = null;
  let grade: ReturnType<typeof makeFrameGrader> | null = null;

  try {
    await waitFor(video, 'loadedmetadata');

    const outWidth =
      video.videoWidth || videoTrack.video?.width || videoTrack.track_width;
    const outHeight =
      video.videoHeight || videoTrack.video?.height || videoTrack.track_height;

    const canvas = makeExportCanvas(outWidth, outHeight);
    const ctx = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error('Could not create a 2D canvas for export.');

    // The <video> frame is already display-oriented, so grade at output dims.
    grade = lut ? makeFrameGrader(lut, outWidth, outHeight) : null;

    const bitrate = deriveBitrate(outWidth, outHeight, framerate);
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      // Pixels are already upright; no rotation flag.
      video: { codec: 'avc', width: outWidth, height: outHeight, rotation: 0 },
      audio: audioTrack
        ? {
            codec: 'aac',
            sampleRate: audioTrack.audio?.sample_rate ?? 48000,
            numberOfChannels: audioTrack.audio?.channel_count ?? 2,
          }
        : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'cross-track-offset',
    });

    const encoderConfig: Omit<VideoEncoderConfig, 'codec'> = {
      width: outWidth,
      height: outHeight,
      bitrate,
      framerate,
    };
    const codec = await pickAvcCodec(encoderConfig);
    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        pipelineError = e instanceof Error ? e : new Error(String(e));
      },
    });
    encoder.configure({ codec, ...encoderConfig, avc: { format: 'avc' } });

    const gop = Math.max(1, framerate * 2);
    const frameDuration = Math.round(1_000_000 / framerate);

    for (let i = 0; i < frameCount; i++) {
      throwIfAborted();
      if (pipelineError) throw pipelineError;

      const t = i / framerate;
      await seekTo(video, t);
      const source = grade ? grade.render(video) : video;
      ctx.drawImage(source, 0, 0, outWidth, outHeight);
      drawOverlays(ctx, elements, findCue(cues, t), outWidth, outHeight);

      const vf = new VideoFrame(canvas, {
        timestamp: Math.round(t * 1_000_000),
        duration: frameDuration,
      });
      encoder.encode(vf, { keyFrame: i % gop === 0 });
      vf.close();

      await awaitQueue(() => encoder!.encodeQueueSize, 24);
      onProgress?.({ phase: 'encoding', ratio: (i + 1) / frameCount });
    }

    await encoder.flush();
    if (pipelineError) throw pipelineError;

    copyAudio(muxer, audioTrack, audioSamples);
    onProgress?.({ phase: 'finalizing', ratio: null });
    muxer.finalize();
    const { buffer: output } = muxer.target as ArrayBufferTarget;
    return new Blob([output], { type: 'video/mp4' });
  } finally {
    grade?.dispose();
    if (encoder && encoder.state !== 'closed') encoder.close();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
