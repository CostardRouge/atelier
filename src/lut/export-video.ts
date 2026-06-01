/**
 * Export a LUT-graded copy of an MP4 entirely in the browser, via WebCodecs.
 *
 * Pipeline (faster-than-realtime, frame-accurate):
 *   mp4box.js demux → VideoDecoder → WebGL LUT pass → VideoEncoder (H.264)
 *   → mp4-muxer, with the original AAC audio track copied through untouched.
 *
 * Nothing leaves the machine. Re-encodes video to H.264 (broad compatibility,
 * including the user's Premiere/Resolve workflow); audio is remuxed, not
 * re-encoded, so it stays bit-for-bit identical.
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
import type { CubeLut } from '../lib/cube-parser';
import { createLutRenderer } from './lut-gl';

export interface ExportProgress {
  phase: 'demuxing' | 'encoding' | 'finalizing';
  /** 0..1 during encoding; null when the phase has no measurable ratio. */
  ratio: number | null;
}

/** True when the browser exposes the WebCodecs surface the export needs. */
export function isExportSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof EncodedVideoChunk !== 'undefined'
  );
}

interface DemuxResult {
  videoTrack: Track;
  videoSamples: Sample[];
  audioTrack: Track | null;
  audioSamples: Sample[];
}

/** Convert a sample time (in its track timescale) to microseconds. */
function toMicros(value: number, timescale: number): number {
  return Math.round((value / timescale) * 1_000_000);
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
 * count. mp4-muxer needs a description to write the esds box; deriving it
 * avoids digging into mp4box's ES descriptor internals and is correct for the
 * AAC-LC streams DJI footage uses.
 */
function buildAacAsc(sampleRate: number, channels: number): Uint8Array {
  const objectType = 2; // AAC LC
  let freqIndex = AAC_SAMPLE_RATES.indexOf(sampleRate);
  if (freqIndex < 0) freqIndex = 4; // default to 44100 Hz
  const byte0 = (objectType << 3) | (freqIndex >> 1);
  const byte1 = ((freqIndex & 1) << 7) | (channels << 3);
  return new Uint8Array([byte0, byte1]);
}

/** Demux the file into ordered video samples (and audio, if present). */
function demux(buffer: ArrayBuffer): Promise<DemuxResult> {
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
        resolve({
          videoTrack,
          videoSamples,
          audioTrack,
          audioSamples,
        });
      }
    };

    const mp4Buffer = MP4BoxBuffer.fromArrayBuffer(buffer, 0);
    file.appendBuffer(mp4Buffer, true);
    file.flush();
  });
}

/** Pick the highest H.264 level the encoder supports for this resolution. */
async function pickAvcCodec(config: Omit<VideoEncoderConfig, 'codec'>): Promise<string> {
  // High profile (0x64) at descending levels: 5.2, 5.1, 5.0, 4.2, 4.0, then
  // Main 5.2 and Baseline 5.2 as fallbacks.
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
async function awaitQueue(getSize: () => number, max: number): Promise<void> {
  while (getSize() > max) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * Grade `file` through `lut` and return a new MP4 Blob. The video is re-encoded
 * to H.264; audio is copied through. `onProgress` reports encoding progress.
 */
export async function exportGradedVideo(
  file: File,
  lut: CubeLut | null,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!isExportSupported()) {
    throw new Error('This browser does not support WebCodecs export.');
  }

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  };

  onProgress?.({ phase: 'demuxing', ratio: null });
  const buffer = await file.arrayBuffer();
  const { videoTrack, videoSamples, audioTrack, audioSamples } = await demux(buffer);
  throwIfAborted();

  if (videoSamples.length === 0) throw new Error('No video frames found.');

  const width = videoTrack.video?.width ?? videoTrack.track_width;
  const height = videoTrack.video?.height ?? videoTrack.track_height;

  // Frame rate from the actual sample durations.
  const timescale = videoSamples[0].timescale;
  let ticks = 0;
  for (const s of videoSamples) ticks += s.duration;
  const durationSec = ticks / timescale || 1;
  const framerate = Math.max(1, Math.round(videoSamples.length / durationSec));

  // ~0.12 bits per pixel·frame, clamped to a sane floor.
  const bitrate = Math.max(2_000_000, Math.round(width * height * framerate * 0.12));

  const description = extractDescription(videoSamples[0]);
  if (!description) {
    throw new Error('Unsupported video codec configuration in this file.');
  }

  // Offscreen WebGL pass (falls back to a detached canvas if needed).
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  const renderer = createLutRenderer(canvas);
  if (!renderer) throw new Error('WebGL2 is required for export.');
  renderer.setLut(lut);
  renderer.resize(width, height);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
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
    width,
    height,
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

  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        renderer.draw(frame);
        const timestamp = frame.timestamp;
        const duration = frame.duration ?? Math.round(1_000_000 / framerate);
        frame.close();
        const graded = new VideoFrame(canvas, { timestamp, duration });
        encoder.encode(graded, { keyFrame: processed % gop === 0 });
        graded.close();
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
  decoder.configure({
    codec: videoTrack.codec,
    codedWidth: width,
    codedHeight: height,
    description,
  });

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

    // Copy the original audio samples through, untouched.
    if (audioTrack && audioSamples.length > 0) {
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

    onProgress?.({ phase: 'finalizing', ratio: null });
    muxer.finalize();
    const { buffer: output } = muxer.target as ArrayBufferTarget;
    return new Blob([output], { type: 'video/mp4' });
  } finally {
    renderer.dispose();
    if (decoder.state !== 'closed') decoder.close();
    if (encoder.state !== 'closed') encoder.close();
  }
}
