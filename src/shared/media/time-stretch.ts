/**
 * Changing how long a sound lasts without changing its pitch — what a
 * re-timed clip's own sound goes through, so a 0.5× clip keeps its voices and
 * music at their pitch, only slower (the "maintain pitch" of an editor).
 *
 * WSOLA (waveform-similarity overlap-add): the output is built from 40 ms
 * grains laid every 20 ms under a Hann window; each grain is read near where
 * the speed puts it in the source, nudged by up to 12 ms to where it best
 * continues the grain before it, so the waveforms meet in phase instead of
 * beating. Every channel takes the same nudge (chosen on their mix), which
 * keeps the stereo image whole.
 *
 * Its limits are WSOLA's: very fast speeds (4× and more) skip most of the
 * source and sound choppy, very slow ones repeat grains and sound grainy.
 * Nothing else in the suite has a better answer for a talking clip; a tape
 * effect (pitch moving with speed) would be a plain resample, not this.
 *
 * Pure and DOM-free.
 */

import { planar, type PlanarAudio } from './audio-mix';

/** Grain length and spacing, and how far a grain may move to stay in phase. */
const GRAIN_SECONDS = 0.04;
const SEARCH_SECONDS = 0.012;
/** The search's coarse stride, in samples and in candidates; refined after. */
const COARSE = 4;

function periodicHann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** The plain resample a too-short sound gets: no grain fits in it. */
function resample(audio: PlanarAudio, outLen: number): PlanarAudio {
  const channels: Float32Array[] = [];
  const ratio = audio.length / outLen;
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const src = audio.getChannelData(c);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const x = i * ratio;
      const a = Math.floor(x);
      const b = Math.min(src.length - 1, a + 1);
      out[i] = a < src.length ? src[a] + (src[b] - src[a]) * (x - a) : 0;
    }
    channels.push(out);
  }
  return planar(audio.sampleRate, channels);
}

/**
 * Where, in `[lo, hi]`, a grain of `mono` best continues the reference
 * `mono[target .. target + m)` — the largest dot product, searched coarsely
 * then refined around the best coarse answer. Every index read is inside
 * `mono`: `hi` is at most `length − 2m` and `target` at most `hi + m`, so
 * the loop carries no bounds test (it is the whole cost of a stretch).
 */
function bestStart(mono: Float32Array, target: number, lo: number, hi: number, m: number): number {
  const score = (cand: number, step: number) => {
    let s = 0;
    for (let i = 0; i < m; i += step) s += mono[target + i] * mono[cand + i];
    return s;
  };
  let best = lo;
  let bestScore = -Infinity;
  for (let cand = lo; cand <= hi; cand += COARSE) {
    const s = score(cand, COARSE);
    if (s > bestScore) {
      bestScore = s;
      best = cand;
    }
  }
  const from = Math.max(lo, best - COARSE + 1);
  const to = Math.min(hi, best + COARSE - 1);
  bestScore = -Infinity;
  for (let cand = from; cand <= to; cand++) {
    const s = score(cand, 1);
    if (s > bestScore) {
      bestScore = s;
      best = cand;
    }
  }
  return best;
}

/**
 * `audio` played at `speed` (2 = twice as fast, half as long; 0.5 = twice as
 * long), its pitch kept. The result lasts `round(length / speed)` samples, so
 * it ends where the re-timed picture does.
 */
export function stretchPlanar(audio: PlanarAudio, speed: number): PlanarAudio {
  const len = audio.length;
  const outLen = Math.max(1, Math.round(len / speed));
  if (!(speed > 0) || Math.abs(speed - 1) < 1e-6) {
    const channels: Float32Array[] = [];
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const out = new Float32Array(outLen);
      out.set(audio.getChannelData(c).subarray(0, outLen));
      channels.push(out);
    }
    return planar(audio.sampleRate, channels);
  }

  const rate = audio.sampleRate;
  const hop = Math.max(2, Math.round((GRAIN_SECONDS * rate) / 2));
  const grain = hop * 2;
  if (len < grain * 2) return resample(audio, outLen);
  const search = Math.max(1, Math.round(SEARCH_SECONDS * rate));
  const window = periodicHann(grain);

  const sources: Float32Array[] = [];
  for (let c = 0; c < audio.numberOfChannels; c++) sources.push(audio.getChannelData(c));
  const mono = new Float32Array(len);
  for (const src of sources) for (let i = 0; i < len; i++) mono[i] += src[i] / sources.length;

  const outs = sources.map(() => new Float32Array(outLen + grain));
  const weight = new Float32Array(outLen + grain);
  const lastStart = len - grain;
  let prev = -1;
  for (let outPos = 0; outPos < outLen; outPos += hop) {
    const nominal = Math.min(lastStart, Math.max(0, Math.round(outPos * speed)));
    let start = nominal;
    if (prev >= 0) {
      const lo = Math.max(0, nominal - search);
      const hi = Math.min(lastStart, nominal + search);
      start = bestStart(mono, prev + hop, lo, hi, hop);
    }
    for (let c = 0; c < sources.length; c++) {
      const src = sources[c];
      const out = outs[c];
      for (let i = 0; i < grain; i++) out[outPos + i] += src[start + i] * window[i];
    }
    for (let i = 0; i < grain; i++) weight[outPos + i] += window[i];
    prev = start;
  }

  const channels = outs.map((out) => {
    const result = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const w = weight[i];
      result[i] = w > 1e-3 ? out[i] / w : out[i];
    }
    return result;
  });
  return planar(rate, channels);
}
