/**
 * Generic in-browser video re-encode pipeline, via WebCodecs.
 *
 * Extracted from the LUT export so multiple tools can share the same, subtle
 * demux → decode → **per-frame transform** → encode → mux machinery. The only
 * tool-specific part is the per-frame transform, supplied as a
 * {@link FrameProcessor}: it receives each decoded frame and returns the
 * surface to encode (a graded GL canvas, a composited 2D canvas, …).
 *
 * Pipeline (faster-than-realtime, frame-accurate):
 *   mp4box.js demux → VideoDecoder → processor.draw → VideoEncoder (H.264)
 *   → mp4-muxer, with the original AAC audio track copied through untouched.
 *
 * The output cadence is the source's unless {@link ExportOptions.frameRate}
 * asks otherwise, in which case frames are resampled onto a regular grid
 * (see `frame-rate.ts`) — the duration, and therefore the audio sync, is kept.
 *
 * Nothing leaves the machine. Video is re-encoded to H.264 (broad
 * compatibility); audio is remuxed, not re-encoded, so it stays bit-for-bit
 * identical.
 */

import {
  createFile,
  DataStream,
  Endianness,
  MP4BoxBuffer,
  type ISOFile,
  type Movie,
  type Sample,
  type Track,
} from 'mp4box';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import {
  frameTimestampMicros,
  planFrameIndices,
  resolveFrameRate,
  resolveSpeed,
  type ExportFrameRate,
} from './frame-rate';
import { safeChunkMetadata } from './colour-tag';
import { tailFrames, type ExportTail } from './export-tail';
import type { TrimRange } from './trim';

export interface ExportProgress {
  phase: 'demuxing' | 'encoding' | 'finalizing';
  /** 0..1 during encoding; null when the phase has no measurable ratio. */
  ratio: number | null;
}

/**
 * What the per-frame transform is told about the source. Coded dimensions are
 * the decoder's raw orientation; output dimensions are what gets encoded — they
 * differ from coded when {@link ExportOptions.bakeRotation} is on and the clip
 * is rotated 90°/270° (portrait↔landscape swap).
 */
export interface FrameContext {
  /** Decoder's raw frame dimensions (un-rotated). */
  codedWidth: number;
  codedHeight: number;
  /** Encoded output dimensions (display orientation when baking rotation). */
  outputWidth: number;
  outputHeight: number;
  /** Container display rotation, clockwise degrees. */
  rotation: 0 | 90 | 180 | 270;
}

export interface ExportOptions {
  /**
   * When true, rotate each decoded frame into display orientation *in pixels*
   * and emit `rotation: 0`, instead of leaving frames coded and relying on a
   * rotation flag the player must honour. Essential when something is drawn at
   * specific coordinates (overlays) so the result matches the on-screen preview
   * exactly. Default false (cheaper, fine for orientation-independent passes).
   */
  bakeRotation?: boolean;
  /**
   * Encode at this exact size instead of the source video's dimensions. For
   * compositions (a frame larger/other-shaped than the clip), where the
   * processor draws the video into a pane and returns a canvas of this size.
   * The processor must orient the decoded frame itself (it gets `rotation`);
   * the muxer rotation is forced to 0.
   */
  outputSize?: { width: number; height: number };
  /**
   * Encode at this cadence instead of the clip's own. 'source' (the default)
   * keeps every decoded frame with its original timestamp — the exact
   * pass-through. A number resamples onto a regular `1/fps` grid: the clip
   * keeps its duration (the copied audio stays in sync), frames are dropped
   * below the source rate and duplicated above it. See `frame-rate.ts`.
   */
  frameRate?: ExportFrameRate;
  /**
   * Encode only `[start, end]` of the source (seconds). The output starts at
   * timestamp 0; the processor still sees SOURCE times, so overlays, cues and
   * the capture clock stay attached to the right frame.
   */
  trim?: TrimRange | null;
  /**
   * Deliver the clip at this speed: 1 (the default) as shot, 2 twice as fast,
   * 0.5 half. The source timeline is divided by it before meeting the output
   * grid, so the cadence is unchanged and the DURATION moves — frames dropped
   * when speeding up, repeated when slowing down, never interpolated.
   *
   * A re-timed export is delivered **silent**: audio is copied bit-for-bit and
   * never re-encoded here, and a copied track against a re-timed picture is a
   * desync, which is worse than no track. Callers must say so in the UI.
   */
  speed?: number;
  /**
   * Content appended AFTER the footage's last frame — the Studio's outro
   * card. Nothing already encoded moves and the audio simply ends with the
   * footage; see `export-tail.ts`. `draw` must return a surface at the
   * export's output size.
   */
  tail?: ExportTail | null;
}

/**
 * A per-frame transform. `draw` receives the decoded frame and the frame's
 * presentation time (microseconds) and must return the surface to encode. It
 * MUST NOT close `frame` — the pipeline closes it after `draw` returns.
 */
export interface FrameProcessor {
  draw(frame: VideoFrame, tMicros: number): CanvasImageSource;
  dispose(): void;
}

/**
 * Draw `source` (coded `cw`×`ch`) into a 2D context already sized to the
 * display-oriented `ow`×`oh`, applying the container's clockwise `rotation` so
 * the pixels come out upright. The single source of truth for baking rotation.
 */
export function drawRotatedFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  cw: number,
  ch: number,
  rotation: 0 | 90 | 180 | 270,
  ow: number,
  oh: number,
): void {
  ctx.save();
  switch (rotation) {
    case 90:
      ctx.translate(ow, 0);
      ctx.rotate(Math.PI / 2);
      break;
    case 180:
      ctx.translate(ow, oh);
      ctx.rotate(Math.PI);
      break;
    case 270:
      ctx.translate(0, oh);
      ctx.rotate((3 * Math.PI) / 2);
      break;
  }
  ctx.drawImage(source, 0, 0, cw, ch);
  ctx.restore();
}

/** Thrown when the browser can't decode the source codec via WebCodecs. */
export class DecodeUnsupportedError extends Error {
  readonly isHevc: boolean;
  constructor(message: string, isHevc: boolean) {
    super(message);
    this.name = 'DecodeUnsupportedError';
    this.isHevc = isHevc;
  }
}

/** True when the browser exposes the full WebCodecs surface (decode+encode). */
export function isExportSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof EncodedVideoChunk !== 'undefined'
  );
}

/** True when the browser can *encode* (the seek fallback needs only this). */
export function isEncodeSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

interface DemuxResult {
  videoTrack: Track;
  videoSamples: Sample[];
  audioTrack: Track | null;
  audioSamples: Sample[];
}

/** Convert a sample time (in its track timescale) to microseconds. */
export function toMicros(value: number, timescale: number): number {
  return Math.round((value / timescale) * 1_000_000);
}

/**
 * Derive the display rotation (0/90/180/270 clockwise) from a track's tkhd
 * matrix. The decoder emits frames in coded orientation, so the container's
 * rotation must be copied to the output or the export looks un-rotated.
 */
export function rotationFromMatrix(
  matrix: ArrayLike<number> | undefined,
): 0 | 90 | 180 | 270 {
  if (!matrix || matrix.length < 2) return 0;
  const a = matrix[0];
  const b = matrix[1];
  if (a === 0 && b === 0) return 0;
  const deg = ((Math.round((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360;
  const snapped = (Math.round(deg / 90) * 90) % 360;
  return snapped === 90 || snapped === 180 || snapped === 270 ? snapped : 0;
}

/** A box we only need to serialise; mp4box's box types aren't all exported. */
interface WritableBox {
  write(stream: unknown): void;
}

/**
 * Extract the codec configuration record (avcC/hvcC/…) a VideoDecoder needs,
 * by serialising the sample-entry's config box and stripping its 8-byte header.
 */
function extractDescription(sample: Sample): Uint8Array | undefined {
  const entry = sample.description as unknown as {
    avcC?: WritableBox;
    hvcC?: WritableBox;
    av1C?: WritableBox;
    vpcC?: WritableBox;
  };
  const box = entry.avcC ?? entry.hvcC ?? entry.av1C ?? entry.vpcC;
  if (!box) return undefined;
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(stream);
  const buffer = (stream as unknown as { buffer: ArrayBuffer }).buffer;
  return new Uint8Array(buffer, 8);
}

/** AAC sampling-frequency table (index → Hz), per ISO/IEC 14496-3. */
const AAC_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
  8000, 7350,
];

/**
 * Build a 2-byte AudioSpecificConfig for AAC-LC from sample rate and channel
 * count, so mp4-muxer can write the esds box without digging into mp4box's ES
 * descriptor internals.
 */
export function buildAacAsc(sampleRate: number, channels: number): Uint8Array {
  const objectType = 2; // AAC LC
  let freqIndex = AAC_SAMPLE_RATES.indexOf(sampleRate);
  if (freqIndex < 0) freqIndex = 4; // default to 44100 Hz
  const byte0 = (objectType << 3) | (freqIndex >> 1);
  const byte1 = ((freqIndex & 1) << 7) | (channels << 3);
  return new Uint8Array([byte0, byte1]);
}

/** Demux the file into ordered video samples (and audio, if present). */
export function demux(buffer: ArrayBuffer): Promise<DemuxResult> {
  return new Promise((resolve, reject) => {
    const file: ISOFile = createFile();
    const videoSamples: Sample[] = [];
    const audioSamples: Sample[] = [];
    let movie: Movie | null = null;

    file.onError = (_module, message) => reject(new Error(message));

    file.onReady = (info) => {
      movie = info;
      const videoTrack = info.videoTracks[0];
      if (!videoTrack) {
        reject(new Error('This file has no video track.'));
        return;
      }
      file.setExtractionOptions(videoTrack.id, null, {
        nbSamples: videoTrack.nb_samples,
      });
      const audioTrack = info.audioTracks[0];
      if (audioTrack) {
        file.setExtractionOptions(audioTrack.id, null, {
          nbSamples: audioTrack.nb_samples,
        });
      }
      file.start();
    };

    file.onSamples = (id, _user, samples) => {
      if (!movie) return;
      const videoTrack = movie.videoTracks[0];
      const audioTrack = movie.audioTracks[0] ?? null;
      const target = id === videoTrack.id ? videoSamples : audioSamples;
      for (const sample of samples) target.push(sample);

      const videoDone = videoSamples.length >= videoTrack.nb_samples;
      const audioDone = !audioTrack || audioSamples.length >= audioTrack.nb_samples;
      if (videoDone && audioDone) {
        resolve({ videoTrack, videoSamples, audioTrack, audioSamples });
      }
    };

    const mp4Buffer = MP4BoxBuffer.fromArrayBuffer(buffer, 0);
    file.appendBuffer(mp4Buffer, true);
    file.flush();
  });
}

/** The little a {@link trimWindow} needs of a demuxed sample. */
export interface TrimSample {
  cts: number;
  duration: number;
  timescale: number;
  is_sync: boolean;
}

/** Which samples to feed the decoder, and which decoded frames to keep. */
export interface TrimWindow {
  /** First sample to decode: a sync sample at or before the in point. */
  decodeFrom: number;
  /** Last sample to decode (inclusive). */
  decodeTo: number;
  /**
   * Presentation time (µs) of the first frame that is kept — the frame the
   * preview shows under the in handle. Frames before it are decoded (they are
   * references) then dropped, and every kept timestamp is shifted by this so
   * the output starts at 0.
   */
  baseMicros: number;
  /** Frames at or after this presentation time (µs) are dropped. */
  endMicros: number;
  /** How many frames get encoded — the progress denominator. */
  frameCount: number;
}

/**
 * Resolve a trim into sample indices.
 *
 * Two subtleties this encodes, so no caller has to rediscover them:
 *   - decoding must start at the **sync sample before** the in point, or the
 *     first frames come out as macroblock soup; the frames between it and the
 *     in point are decoded purely as references and thrown away;
 *   - the last sample to decode is the one with the highest index among those
 *     presented before the out point — a B-frame can only reference frames
 *     *earlier in decode order*, so nothing beyond it is ever needed, while
 *     frames inside the window that are presented late are still covered.
 *
 * `null` (no trim) returns the whole file with `baseMicros` 0, so timestamps
 * pass through exactly as they did before trimming existed.
 */
export function trimWindow(
  samples: readonly TrimSample[],
  trim: TrimRange | null | undefined,
): TrimWindow {
  const last = samples.length - 1;
  if (!trim || samples.length === 0) {
    return {
      decodeFrom: 0,
      decodeTo: last,
      baseMicros: 0,
      endMicros: Number.POSITIVE_INFINITY,
      frameCount: samples.length,
    };
  }
  const startMicros = Math.max(0, Math.round(trim.start * 1_000_000));
  const endMicros = Math.max(startMicros, Math.round(trim.end * 1_000_000));

  const cts = samples.map((s) => toMicros(s.cts, s.timescale));
  const ends = samples.map((s, i) => cts[i] + toMicros(s.duration, s.timescale));

  // The frame under the in handle is the one whose presentation *covers* it.
  let first = samples.findIndex((_, i) => ends[i] > startMicros);
  if (first < 0) first = last;

  let decodeFrom = 0;
  for (let i = first; i >= 0; i -= 1) {
    if (samples[i].is_sync && cts[i] <= cts[first]) {
      decodeFrom = i;
      break;
    }
  }

  let decodeTo = first;
  let frameCount = 0;
  for (let i = 0; i <= last; i += 1) {
    if (cts[i] < endMicros) {
      if (i > decodeTo) decodeTo = i;
      if (ends[i] > startMicros) frameCount += 1;
    }
  }

  return {
    decodeFrom,
    decodeTo,
    baseMicros: cts[first],
    endMicros,
    frameCount: Math.max(1, frameCount),
  };
}

/** Pick the highest H.264 level the encoder supports for this resolution. */
export async function pickAvcCodec(
  config: Omit<VideoEncoderConfig, 'codec'>,
): Promise<string> {
  // High profile (0x64) at descending levels, then Main/Baseline 5.2 fallbacks.
  const candidates = [
    'avc1.640034',
    'avc1.640033',
    'avc1.640032',
    'avc1.64002A',
    'avc1.640028',
    'avc1.4D4034',
    'avc1.42E034',
  ];
  for (const codec of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({ codec, ...config });
      if (support.supported) return codec;
    } catch {
      // Unsupported codec string on this platform — try the next.
    }
  }
  return 'avc1.42E01E';
}

/** Block until a codec's queue drains below `max` (simple backpressure). */
export async function awaitQueue(getSize: () => number, max: number): Promise<void> {
  while (getSize() > max) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Derive an encode bitrate from resolution and frame rate (~0.12 bpp·frame). */
export function deriveBitrate(width: number, height: number, framerate: number): number {
  return Math.max(2_000_000, Math.round(width * height * framerate * 0.12));
}

/** A throwaway canvas sized to the coded video (Offscreen where available). */
export function makeExportCanvas(
  width: number,
  height: number,
): OffscreenCanvas | HTMLCanvasElement {
  return typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
}

/**
 * Re-encode `file` through a {@link FrameProcessor} and return a new MP4 Blob.
 * Video is re-encoded to H.264; audio is copied through. `onProgress` reports
 * encoding progress. Throws {@link DecodeUnsupportedError} when the browser
 * can't decode the source codec via WebCodecs.
 */
export async function exportProcessedVideo(
  source: File | ArrayBuffer,
  makeProcessor: (ctx: FrameContext) => FrameProcessor,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
  options: ExportOptions = {},
): Promise<Blob> {
  if (!isExportSupported()) {
    throw new Error('This browser does not support WebCodecs export.');
  }

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  };

  onProgress?.({ phase: 'demuxing', ratio: null });
  // Accept already-read bytes so callers can read the file while its handle is
  // freshest (files opened via the folder picker can otherwise go unreadable).
  const buffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const { videoTrack, videoSamples, audioTrack, audioSamples } = await demux(buffer);
  throwIfAborted();

  if (videoSamples.length === 0) throw new Error('No video frames found.');

  const width = videoTrack.video?.width ?? videoTrack.track_width;
  const height = videoTrack.video?.height ?? videoTrack.track_height;

  // Display rotation from the container. Either copy it onto the output as a
  // flag (default) or bake it into the pixels so coordinate-sensitive passes
  // (overlays) come out exactly as previewed.
  const rotation = rotationFromMatrix(videoTrack.matrix);
  const bakeRotation = options.bakeRotation ?? false;
  const swap = bakeRotation && (rotation === 90 || rotation === 270);
  let outputWidth = swap ? height : width;
  let outputHeight = swap ? width : height;
  let muxerRotation = bakeRotation ? 0 : rotation;

  // A composition encodes at its own size; the processor returns a canvas of
  // this size and orients the decoded frame itself, so no rotation flag.
  if (options.outputSize) {
    outputWidth = 2 * Math.round(options.outputSize.width / 2);
    outputHeight = 2 * Math.round(options.outputSize.height / 2);
    muxerRotation = 0;
  }

  // Frame rate from the actual sample durations, then the requested output
  // cadence. Asking for the rate the clip already has resolves to the source
  // rate and keeps the exact pass-through (no resampled grid to drift on).
  const timescale = videoSamples[0].timescale;
  let ticks = 0;
  for (const s of videoSamples) ticks += s.duration;
  const durationSec = ticks / timescale || 1;
  const sourceFramerate = Math.max(1, Math.round(videoSamples.length / durationSec));
  const framerate = resolveFrameRate(options.frameRate, sourceFramerate);
  const speed = resolveSpeed(options.speed);
  // The grid path handles both knobs. A speed always needs it — even at the
  // source cadence — because every timestamp moves.
  const retime = framerate !== sourceFramerate || speed !== 1;
  // A re-timed picture cannot carry a copied audio track: see `frame-rate.ts`.
  const keepAudio = speed === 1 ? audioTrack : null;

  const bitrate = deriveBitrate(outputWidth, outputHeight, framerate);

  const description = extractDescription(videoSamples[0]);
  if (!description) {
    throw new Error('Unsupported video codec configuration in this file.');
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: outputWidth,
      height: outputHeight,
      rotation: muxerRotation,
    },
    audio: keepAudio
      ? {
          codec: 'aac',
          sampleRate: keepAudio.audio?.sample_rate ?? 48000,
          numberOfChannels: keepAudio.audio?.channel_count ?? 2,
        }
      : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'cross-track-offset',
  });

  let pipelineError: Error | null = null;

  const encoderConfig: Omit<VideoEncoderConfig, 'codec'> = {
    width: outputWidth,
    height: outputHeight,
    bitrate,
    framerate,
  };
  const codec = await pickAvcCodec(encoderConfig);

  // Everything from here on holds a VideoEncoder (and, once created, a
  // VideoDecoder) that MUST be closed on every exit path, success or not — an
  // encoder left open after e.g. configure() rejects this resolution still
  // holds a hardware encode session, and the browser caps how many a page can
  // have concurrently. Leak one and every export after it fails too, not just
  // this one, so the whole pipeline lives inside a single try/finally rather
  // than the encoder/decoder being created ahead of a narrower try block.
  const encoder = new VideoEncoder({
    // Guarded: a colour space the muxer cannot encode would become a WRONG
      // colr box, not an absent one — see media/colour-tag.ts.
      output: (chunk, meta) => muxer.addVideoChunk(chunk, safeChunkMetadata(meta)),
    error: (e) => {
      pipelineError = e instanceof Error ? e : new Error(String(e));
    },
  });
  let decoderRef: VideoDecoder | undefined;

  try {
    encoder.configure({ codec, ...encoderConfig, avc: { format: 'avc' } });

    // Which slice of the file to encode. Untrimmed exports get the whole thing
    // with a zero offset, i.e. exactly the previous behaviour.
    const win = trimWindow(videoSamples, options.trim);
    // The appended card, when there is one — planned up front so the progress
    // ratio covers the whole run, not just the footage.
    const tail = options.tail && options.tail.seconds > 0 ? options.tail : null;
    const tailPlan = tail ? tailFrames(tail.seconds, framerate, 0).length : 0;
    const total = win.frameCount + tailPlan;
    const gop = Math.max(1, framerate * 2); // keyframe every ~2s
    let processed = 0;
    // Retiming state: the grid is anchored on the first decoded frame, so a clip
    // whose first sample is not at t=0 still starts its output at index 0.
    const sourceFrameDuration = Math.round(1_000_000 / sourceFramerate);
    const outputFrameDuration = Math.round(1_000_000 / framerate);
    let origin: number | null = null;
    let nextIndex = 0;
    let emitted = 0;
    // End of the picture on the OUTPUT timeline (timestamp + duration of the
    // last emitted frame) — where an appended card starts.
    let outEndMicros = 0;

    // Build the per-frame transform once the coded + output sizes are known.
    const processor = makeProcessor({
      codedWidth: width,
      codedHeight: height,
      outputWidth,
      outputHeight,
      rotation,
    });

    try {
      const decoder = new VideoDecoder({
        output: (frame) => {
          try {
            const timestamp = frame.timestamp;
            // Outside the trim: decoded only because later frames reference it.
            if (timestamp < win.baseMicros || timestamp >= win.endMicros) {
              frame.close();
              return;
            }
            const srcDuration = frame.duration ?? sourceFrameDuration;
            // The grid is anchored on the first frame that is KEPT, so a trimmed
            // export starts its output at index 0 like any other.
            if (origin === null) origin = timestamp;

            // Which output frames this decoded frame owes. Pass-through gives one,
            // at the source's own timestamp; retiming gives none (dropped), one, or
            // several (duplicated) on the output grid. Either way the timestamp is
            // rebased by the trim's origin (0 when nothing is trimmed) so the file
            // starts at zero — while the processor keeps receiving SOURCE times,
            // or cues, the capture clock and overlays detach from the picture.
            let timestamps: number[];
            let duration: number;
            if (retime) {
              // The source span, divided by the speed: that is the whole re-time,
              // and the grid below turns it into dropped or repeated frames.
              const start = (timestamp - origin) / speed;
              const indices = planFrameIndices(
                start,
                start + srcDuration / speed,
                framerate,
                nextIndex,
              );
              if (indices.length === 0) {
                // Nothing to encode from this frame — skip the transform entirely,
                // which is what makes a downscale to 24 fps cheaper, not dearer.
                frame.close();
                processed++;
                onProgress?.({ phase: 'encoding', ratio: processed / total });
                return;
              }
              nextIndex = indices[indices.length - 1] + 1;
              timestamps = indices.map(
                (i) => origin! - win.baseMicros + frameTimestampMicros(i, framerate),
              );
              duration = outputFrameDuration;
            } else {
              timestamps = [timestamp - win.baseMicros];
              duration = srcDuration;
            }

            const source = processor.draw(frame, timestamp);
            frame.close();
            for (const ts of timestamps) {
              const out = new VideoFrame(source, { timestamp: ts, duration });
              encoder.encode(out, { keyFrame: emitted % gop === 0 });
              out.close();
              emitted++;
              outEndMicros = Math.max(outEndMicros, ts + duration);
            }
            processed++;
            onProgress?.({ phase: 'encoding', ratio: processed / total });
          } catch (e) {
            pipelineError = e instanceof Error ? e : new Error(String(e));
            frame.close();
          }
        },
        error: (e) => {
          pipelineError = e instanceof Error ? e : new Error(String(e));
        },
      });
      decoderRef = decoder;
      const decoderConfig: VideoDecoderConfig = {
        codec: videoTrack.codec,
        codedWidth: width,
        codedHeight: height,
        description,
      };
      // Fail fast with a clear, typed error when the browser can't decode this
      // source (DJI footage is often HEVC/H.265, which not every browser decodes
      // via WebCodecs) — so callers can fall back to the seek path.
      const decodeSupport = await VideoDecoder.isConfigSupported(decoderConfig).catch(
        () => ({ supported: false }) as VideoDecoderSupport,
      );
      if (!decodeSupport.supported) {
        const baseCodec = videoTrack.codec.split('.')[0];
        const isHevc = /^(hvc1|hev1|hvc|hev)/i.test(baseCodec);
        throw new DecodeUnsupportedError(
          isHevc
            ? "This browser can't decode HEVC/H.265 for export. Try Safari, or transcode the clip to H.264 first."
            : `This browser can't decode this clip's video codec (${baseCodec}) for export.`,
          isHevc,
        );
      }
      decoder.configure(decoderConfig);

      for (let i = win.decodeFrom; i <= win.decodeTo; i += 1) {
        const sample = videoSamples[i];
        throwIfAborted();
        if (pipelineError) throw pipelineError;
        if (!sample?.data) continue;
        decoder.decode(
          new EncodedVideoChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: toMicros(sample.cts, sample.timescale),
            duration: toMicros(sample.duration, sample.timescale),
            data: sample.data,
          }),
        );
        await awaitQueue(() => decoder.decodeQueueSize, 24);
        await awaitQueue(() => encoder.encodeQueueSize, 24);
      }

      await decoder.flush();

      // The appended card. It runs after the decoder has drained, so every
      // timestamp of the picture is known and the card starts exactly where
      // the footage ends — nothing already encoded moves, and the audio copy
      // below is untouched (the card plays silent, as an outro does).
      if (tail) {
        for (const f of tailFrames(tail.seconds, framerate, outEndMicros)) {
          throwIfAborted();
          if (pipelineError) throw pipelineError;
          const out = new VideoFrame(tail.draw(f.tSeconds), {
            timestamp: f.timestampMicros,
            duration: f.durationMicros,
          });
          encoder.encode(out, { keyFrame: emitted % gop === 0 });
          out.close();
          emitted++;
          processed++;
          onProgress?.({ phase: 'encoding', ratio: processed / total });
          await awaitQueue(() => encoder.encodeQueueSize, 24);
        }
      }

      await encoder.flush();
      if (pipelineError) throw pipelineError;

      // Trimmed: only the audio overlapping the window, rebased on it. Re-timed:
      // no audio at all — `keepAudio` is null (see `frame-rate.ts`).
      copyAudio(muxer, keepAudio, audioSamples, win);

      onProgress?.({ phase: 'finalizing', ratio: null });
      muxer.finalize();
      const { buffer: output } = muxer.target as ArrayBufferTarget;
      return new Blob([output], { type: 'video/mp4' });
    } finally {
      processor.dispose();
    }
  } finally {
    if (decoderRef && decoderRef.state !== 'closed') decoderRef.close();
    if (encoder.state !== 'closed') encoder.close();
  }
}

/**
 * Copy the original AAC audio samples into the muxer, untouched.
 *
 * With a `slice`, only the frames overlapping it are copied, rebased on the
 * same origin as the video so the two stay in sync. Audio is still never
 * re-encoded, so a cut lands on an AAC frame boundary (~21 ms at 48 kHz) —
 * inaudible against a video cut, and the price of keeping the track
 * bit-for-bit identical.
 */
export function copyAudio(
  muxer: Muxer<ArrayBufferTarget>,
  audioTrack: Track | null,
  audioSamples: Sample[],
  slice?: Pick<TrimWindow, 'baseMicros' | 'endMicros'>,
): void {
  if (!audioTrack || audioSamples.length === 0) return;
  const asc = buildAacAsc(
    audioTrack.audio?.sample_rate ?? 48000,
    audioTrack.audio?.channel_count ?? 2,
  );
  const base = slice?.baseMicros ?? 0;
  const until = slice?.endMicros ?? Number.POSITIVE_INFINITY;
  let written = 0;
  audioSamples.forEach((sample) => {
    if (!sample.data) return;
    const cts = toMicros(sample.cts, sample.timescale);
    const duration = toMicros(sample.duration, sample.timescale);
    if (cts + duration <= base || cts >= until) return;
    muxer.addAudioChunkRaw(
      sample.data,
      'key',
      Math.max(0, cts - base),
      duration,
      written++ === 0
        ? {
            decoderConfig: {
              codec: 'mp4a.40.2',
              sampleRate: audioTrack.audio?.sample_rate ?? 48000,
              numberOfChannels: audioTrack.audio?.channel_count ?? 2,
              description: asc,
            },
          }
        : undefined,
    );
  });
}
