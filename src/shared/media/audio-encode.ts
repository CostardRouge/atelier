/**
 * Encoding a rendered `AudioBuffer` to AAC, ready for mp4-muxer.
 *
 * The rest of the pipeline never encodes audio: a clip's track is copied
 * bit-for-bit, and that rule stands. This is for audio the suite MADE — a
 * hook's tick bed — which has no track to copy from.
 *
 * The whole buffer is encoded BEFORE the muxer is created, into a list of
 * chunks. That ordering is the design: if AAC cannot be encoded here, the
 * caller learns it while it can still build a muxer with no audio track at all,
 * instead of discovering it half-way and shipping a file whose audio track is
 * declared and broken. A bed is a few seconds, so holding its chunks costs a
 * few hundred kilobytes.
 */

import { planar, type PlanarAudio } from './audio-mix';

/** What is asked of the encoder. AAC-LC — the one every platform ingests. */
export const AAC_CODEC = 'mp4a.40.2';
const AAC_BITRATE = 128_000;
/**
 * The fallback where there is no AAC encoder — Chromium on Linux, Firefox
 * (measured 2026-10-31: the cloud container's Chromium 153 refuses
 * `mp4a.40.2` and accepts `opus`). Opus in MP4 plays in every current
 * browser and in VLC/ffmpeg; AAC stays first because it is what the social
 * platforms ingest everywhere, and the maintainer's own Chrome and Safari
 * have it, so his exports never take this branch.
 */
export const OPUS_CODEC = 'opus';
const OPUS_BITRATE = 128_000;

/** The codec a made bed was encoded with — what the muxer must declare. */
export type MadeAudioCodec = 'aac' | 'opus';
/** Frames per AudioData handed to the encoder — one AAC frame's worth. */
const FRAMES_PER_CHUNK = 1024;

/**
 * The silence an AAC encoder puts in front of the signal (its "priming"), in
 * samples. MEASURED, 2026-09-13, on the maintainer's platform (Chrome, macOS,
 * whose AudioEncoder is AudioToolbox), by rendering ticks at known times,
 * muxing, and decoding the MP4 back: the first packet is stamped 0 and carries
 * 2112 samples of priming, so every tick decoded 44ms after its frame.
 *
 * Two fixes were tried and do NOT work, so they are not re-proposed: stamping
 * the audio packets early (mp4-muxer refuses a negative timestamp), and
 * stamping the picture late (mp4-muxer writes no edit list, so a track's start
 * offset is lost and both still play from zero). What works is rendering the
 * bed AHEAD of the priming — see `renderBed`'s `leadSeconds` — measured at 0ms
 * of drift. An encoder priming by 1024 instead would leave the ticks ~21ms
 * early, below what anyone hears against a picture.
 */
export const AAC_PRIMING_SAMPLES = 2112;

/** The priming, in seconds at `sampleRate` — the lead a bed is rendered with. */
export function aacPrimingSeconds(sampleRate: number): number {
  return AAC_PRIMING_SAMPLES / sampleRate;
}

export interface EncodedAudio {
  codec: MadeAudioCodec;
  sampleRate: number;
  numberOfChannels: number;
  chunks: { chunk: EncodedAudioChunk; meta: EncodedAudioChunkMetadata | undefined }[];
}

export type AudioEncodeResult =
  | { ok: true; audio: EncodedAudio }
  | { ok: false; reason: string };

async function supports(codec: string, bitrate: number, sampleRate: number, numberOfChannels: number): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
  const probe = await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels, bitrate }).catch(() => null);
  return !!probe?.supported;
}

/** Whether this browser can encode the bed to AAC, asked before anything is built. */
export function canEncodeAac(sampleRate: number, numberOfChannels: number): Promise<boolean> {
  return supports(AAC_CODEC, AAC_BITRATE, sampleRate, numberOfChannels);
}

/** The codec a bed will be encoded with here: AAC, else Opus, else none. */
export async function pickAudioCodec(sampleRate: number, numberOfChannels: number): Promise<MadeAudioCodec | null> {
  if (await canEncodeAac(sampleRate, numberOfChannels)) return 'aac';
  if (await supports(OPUS_CODEC, OPUS_BITRATE, sampleRate, numberOfChannels)) return 'opus';
  return null;
}

/**
 * The bed delayed by AAC's priming, for the Opus branch. Every caller renders
 * its bed AHEAD of the AAC priming (`aacPrimingSeconds`), because that is the
 * delay AAC puts back; Opus's own delay is declared in its header and undone
 * by the decoder, so without this the sound would land 44 ms early. (pure)
 */
export function delayedByAacPriming(buffer: PlanarAudio): PlanarAudio {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const out = new Float32Array(buffer.length + AAC_PRIMING_SAMPLES);
    out.set(buffer.getChannelData(c), AAC_PRIMING_SAMPLES);
    channels.push(out);
  }
  return planar(buffer.sampleRate, channels);
}

/** Planar Float32 frames [start, start + count) of every channel, concatenated. */
export function planarSlice(
  buffer: PlanarAudio,
  start: number,
  count: number,
): Float32Array<ArrayBuffer> {
  const channels = buffer.numberOfChannels;
  const out = new Float32Array(count * channels);
  for (let c = 0; c < channels; c++) {
    out.set(buffer.getChannelData(c).subarray(start, start + count), c * count);
  }
  return out;
}

/**
 * Encode `buffer` to AAC, or to Opus where this browser has no AAC encoder.
 * Never throws for a capability the browser lacks: it answers with a sentence
 * the export can show, and the clip goes out silent — `p5-templates`' own
 * rule, "a video without sound beats a failed job".
 */
export async function encodeAudioBuffer(source: PlanarAudio): Promise<AudioEncodeResult> {
  const codec = await pickAudioCodec(source.sampleRate, source.numberOfChannels);
  if (!codec) {
    return {
      ok: false,
      reason: 'This browser cannot encode AAC or Opus audio, so the clip went out without its sound.',
    };
  }
  // What the file must last: the source's own length, whatever is padded in front.
  const endMicros = (source.length / source.sampleRate) * 1_000_000;
  const buffer = codec === 'opus' ? delayedByAacPriming(source) : source;
  const { sampleRate, numberOfChannels, length } = buffer;

  const chunks: EncodedAudio['chunks'] = [];
  let failure: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => chunks.push({ chunk, meta }),
    error: (e) => {
      failure = e;
    },
  });
  try {
    encoder.configure(
      codec === 'aac'
        ? { codec: AAC_CODEC, sampleRate, numberOfChannels, bitrate: AAC_BITRATE }
        : { codec: OPUS_CODEC, sampleRate, numberOfChannels, bitrate: OPUS_BITRATE },
    );
    for (let start = 0; start < length; start += FRAMES_PER_CHUNK) {
      const count = Math.min(FRAMES_PER_CHUNK, length - start);
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: count,
        numberOfChannels,
        timestamp: Math.round((start / sampleRate) * 1_000_000),
        data: planarSlice(buffer, start, count),
      });
      try {
        encoder.encode(data);
      } finally {
        data.close();
      }
    }
    await encoder.flush();
  } catch (e) {
    failure = failure ?? e;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }

  if (failure || chunks.length === 0) {
    return {
      ok: false,
      reason: 'The sound could not be encoded, so the clip went out without it.',
    };
  }
  // The flush emits the encoder's tail padding as packets stamped at or past
  // the end of the signal. Kept, they made the audio track ~75ms longer than
  // the picture (measured), and a file lasts as long as its longest track.
  const kept = chunks.filter(({ chunk }) => chunk.timestamp < endMicros);
  return { ok: true, audio: { codec, sampleRate, numberOfChannels, chunks: kept.length ? kept : chunks } };
}
