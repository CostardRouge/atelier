/**
 * Mixing audio the suite made into a clip's own sound.
 *
 * The one place the pipeline's copy-only rule bends, and only on request
 * (`audio-plan.ts`). The clip's AAC packets that overlap the export window are
 * decoded with WebCodecs' `AudioDecoder` — straight from the samples the demux
 * already holds, so nothing re-reads the file — laid out at their own
 * timestamps, the bed is summed in, and the result is encoded once.
 *
 * Sync is kept at PARITY with the copy it replaces: decoded audio is placed at
 * the same packet times `copyAudio` would have written, so a mixed clip's own
 * sound sits exactly where a copied one would. The only new offset is this
 * encoder's own priming, which is taken off the front of the mix the same way
 * a bed is rendered ahead of it (`aacPrimingSeconds`).
 */

import type { Sample, Track } from 'mp4box';
import { aacPrimingSeconds } from './audio-encode';

/**
 * Planar floating-point audio — what `AudioBuffer` already is, and all an
 * encoder needs to read. Decoded and mixed audio are built as this shape
 * rather than as `AudioBuffer`s, which cannot be constructed off the main
 * thread in every browser.
 */
export interface PlanarAudio {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

export function planar(sampleRate: number, channels: Float32Array[]): PlanarAudio {
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    getChannelData: (c) => channels[c],
  };
}

/**
 * The bed summed into the clip's sound, sample by sample, clamped to full
 * scale. Both must share a sample rate (the bed is rendered AT the clip's).
 *
 * Channels meet sensibly rather than by index alone: a mono clip takes the
 * average of a stereo bed; a stereo clip takes the bed's left and right on its
 * own; extra clip channels are left as they are. The output is the clip's
 * length and layout — the bed never makes a clip longer or wider.
 */
export function mixPlanar(clip: PlanarAudio, bed: PlanarAudio, bedGain = 1): PlanarAudio {
  const out: Float32Array[] = [];
  for (let c = 0; c < clip.numberOfChannels; c++) {
    const channel = new Float32Array(clip.getChannelData(c));
    let add: ((i: number) => number) | null = null;
    if (bed.numberOfChannels > 0) {
      if (clip.numberOfChannels === 1 && bed.numberOfChannels >= 2) {
        const l = bed.getChannelData(0);
        const r = bed.getChannelData(1);
        add = (i) => (l[i] + r[i]) / 2;
      } else if (c < bed.numberOfChannels) {
        const b = bed.getChannelData(c);
        add = (i) => b[i];
      } else if (bed.numberOfChannels === 1 && c < 2) {
        const b = bed.getChannelData(0);
        add = (i) => b[i];
      }
    }
    if (add) {
      const n = Math.min(channel.length, bed.length);
      for (let i = 0; i < n; i++) {
        const v = channel[i] + add(i) * bedGain;
        channel[i] = v > 1 ? 1 : v < -1 ? -1 : v;
      }
    }
    out.push(channel);
  }
  return planar(clip.sampleRate, out);
}

/** The clip's real AudioSpecificConfig from its sample entry, when mp4box exposes it. */
function aacDescription(sample: Sample): Uint8Array | undefined {
  const entry = sample.description as unknown as {
    esds?: { esd?: { descs?: { descs?: { data?: Uint8Array }[] }[] } };
  };
  const data = entry.esds?.esd?.descs?.[0]?.descs?.[0]?.data;
  return data && data.length >= 2 ? new Uint8Array(data) : undefined;
}

export type DecodeResult = { ok: true; audio: PlanarAudio } | { ok: false; reason: string };

const CANNOT_MIX =
  'The clip’s sound could not be mixed here, so it kept its own sound untouched and the ticks were left out.';

/**
 * Decode `[baseMicros, endMicros)` of the clip's AAC track into planar audio,
 * `endMicros - baseMicros` long, shifted EARLY by this encoder's priming so the
 * re-encoded mix lands where the copy would have.
 */
export async function decodeAacWindow(
  track: Track,
  samples: readonly Sample[],
  baseMicros: number,
  endMicros: number,
  fallbackDescription: (sampleRate: number, channels: number) => Uint8Array,
): Promise<DecodeResult> {
  const sampleRate = track.audio?.sample_rate ?? 48000;
  const numberOfChannels = track.audio?.channel_count ?? 2;
  if (typeof AudioDecoder === 'undefined' || typeof AudioData === 'undefined') {
    return { ok: false, reason: CANNOT_MIX };
  }
  const first = samples.find((s) => s.data);
  if (!first) return { ok: false, reason: CANNOT_MIX };

  const config: AudioDecoderConfig = {
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels,
    description: aacDescription(first) ?? fallbackDescription(sampleRate, numberOfChannels),
  };
  const probe = await AudioDecoder.isConfigSupported(config).catch(() => null);
  if (!probe?.supported) return { ok: false, reason: CANNOT_MIX };

  const lead = aacPrimingSeconds(sampleRate) * 1_000_000;
  const origin = baseMicros + lead;
  const length = Math.max(1, Math.ceil(((endMicros - baseMicros) / 1_000_000) * sampleRate));
  const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));

  let failure: unknown = null;
  const decoder = new AudioDecoder({
    output: (data) => {
      try {
        const frames = data.numberOfFrames;
        const at = Math.round(((data.timestamp - origin) / 1_000_000) * sampleRate);
        const layout = Math.min(numberOfChannels, data.numberOfChannels);
        for (let c = 0; c < layout; c++) {
          const plane = new Float32Array(frames);
          data.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
          const from = Math.max(0, -at);
          const to = Math.min(frames, length - at);
          if (to > from) channels[c].set(plane.subarray(from, to), at + from);
        }
      } finally {
        data.close();
      }
    },
    error: (e) => {
      failure = e;
    },
  });

  try {
    decoder.configure(config);
    const toMicros = (v: number, timescale: number) => Math.round((v / timescale) * 1_000_000);
    // One packet of pre-roll before the window: an AAC frame decodes against
    // its predecessor, and the first one after a cold start is not clean.
    const preroll = 1;
    let started = -1;
    samples.forEach((sample, i) => {
      if (!sample.data) return;
      const cts = toMicros(sample.cts, sample.timescale);
      const duration = toMicros(sample.duration, sample.timescale);
      const inWindow = cts + duration > origin && cts < endMicros + lead;
      if (!inWindow) return;
      if (started < 0) {
        started = i;
        for (let p = Math.max(0, i - preroll); p < i; p++) {
          const pre = samples[p];
          if (!pre.data) continue;
          decoder.decode(
            new EncodedAudioChunk({
              type: 'key',
              timestamp: toMicros(pre.cts, pre.timescale),
              duration: toMicros(pre.duration, pre.timescale),
              data: pre.data,
            }),
          );
        }
      }
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: cts, duration, data: sample.data }));
    });
    await decoder.flush();
  } catch (e) {
    failure = failure ?? e;
  } finally {
    if (decoder.state !== 'closed') decoder.close();
  }

  if (failure) return { ok: false, reason: CANNOT_MIX };
  return { ok: true, audio: planar(sampleRate, channels) };
}
