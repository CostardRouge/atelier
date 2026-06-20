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

  // Frame rate from the actual sample durations.
  const timescale = videoSamples[0].timescale;
  let ticks = 0;
  for (const s of videoSamples) ticks += s.duration;
  const durationSec = ticks / timescale || 1;
  const framerate = Math.max(1, Math.round(videoSamples.length / durationSec));

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

  let pipelineError: Error | null = null;

  const encoderConfig: Omit<VideoEncoderConfig, 'codec'> = {
    width: outputWidth,
    height: outputHeight,
    bitrate,
    framerate,
  };
  const codec = await pickAvcCodec(encoderConfig);

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      pipelineError = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure({ codec, ...encoderConfig, avc: { format: 'avc' } });

  const total = videoSamples.length;
  const gop = Math.max(1, framerate * 2); // keyframe every ~2s
  let processed = 0;

  // Build the per-frame transform once the coded + output sizes are known.
  const processor = makeProcessor({
    codedWidth: width,
    codedHeight: height,
    outputWidth,
    outputHeight,
    rotation,
  });

  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        const timestamp = frame.timestamp;
        const duration = frame.duration ?? Math.round(1_000_000 / framerate);
        const source = processor.draw(frame, timestamp);
        frame.close();
        const out = new VideoFrame(source, { timestamp, duration });
        encoder.encode(out, { keyFrame: processed % gop === 0 });
        out.close();
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
    processor.dispose();
    if (encoder.state !== 'closed') encoder.close();
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

  try {
    for (const sample of videoSamples) {
      throwIfAborted();
      if (pipelineError) throw pipelineError;
      if (!sample.data) continue;
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
    await encoder.flush();
    if (pipelineError) throw pipelineError;

    copyAudio(muxer, audioTrack, audioSamples);

    onProgress?.({ phase: 'finalizing', ratio: null });
    muxer.finalize();
    const { buffer: output } = muxer.target as ArrayBufferTarget;
    return new Blob([output], { type: 'video/mp4' });
  } finally {
    processor.dispose();
    if (decoder.state !== 'closed') decoder.close();
    if (encoder.state !== 'closed') encoder.close();
  }
}

/** Copy the original AAC audio samples into the muxer, untouched. */
export function copyAudio(
  muxer: Muxer<ArrayBufferTarget>,
  audioTrack: Track | null,
  audioSamples: Sample[],
): void {
  if (!audioTrack || audioSamples.length === 0) return;
  const asc = buildAacAsc(
    audioTrack.audio?.sample_rate ?? 48000,
    audioTrack.audio?.channel_count ?? 2,
  );
  audioSamples.forEach((sample, i) => {
    if (!sample.data) return;
    muxer.addAudioChunkRaw(
      sample.data,
      'key',
      toMicros(sample.cts, sample.timescale),
      toMicros(sample.duration, sample.timescale),
      i === 0
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
