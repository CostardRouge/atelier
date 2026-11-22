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
 * Nothing else in the suite has a better answer for a talking clip; the tape
 * effect (pitch moving with speed) is {@link tapeResample}, the other choice
 * of {@link RetimeSound}.
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

/**
 * How a re-timed clip's sound follows its picture: `pitch` keeps the pitch
 * (WSOLA, the default — voices stay voices), `tape` lets the pitch move with
 * the speed as a tape or a record would (0.5× an octave lower, 2× an octave
 * higher): no grain, no artefact, the slow-motion rumble of an engine.
 */
export type RetimeSound = 'pitch' | 'tape';

/** Zero crossings each side of a tape kernel at full bandwidth. */
const HALF_TAPS = 16;
/** Kernel table steps per source sample. */
const TABLE_STEPS = 256;

/**
 * `audio` played at `speed` like a tape: every sample read `speed` times as
 * fast, so the pitch moves by the same factor. A windowed-sinc resample whose
 * cut-off follows the speed — sped up, what would land above the new Nyquist
 * is filtered out first instead of folding back as whistles. The kernel is
 * tabulated once per call and every channel shares each output's weights.
 * Lasts `round(length / speed)` samples, like {@link stretchPlanar}.
 */
export function tapeResample(audio: PlanarAudio, speed: number): PlanarAudio {
  const len = audio.length;
  const outLen = Math.max(1, Math.round(len / speed));
  const sources: Float32Array[] = [];
  for (let c = 0; c < audio.numberOfChannels; c++) sources.push(audio.getChannelData(c));
  if (!(speed > 0) || Math.abs(speed - 1) < 1e-6 || len === 0) {
    return planar(
      audio.sampleRate,
      sources.map((src) => {
        const out = new Float32Array(outLen);
        out.set(src.subarray(0, outLen));
        return out;
      }),
    );
  }

  const cutoff = Math.min(1, 1 / speed);
  const half = Math.ceil(HALF_TAPS / cutoff);
  const table = new Float32Array(half * TABLE_STEPS + 2);
  for (let j = 0; j <= half * TABLE_STEPS; j++) {
    const d = j / TABLE_STEPS;
    const sinc = d === 0 ? 1 : Math.sin(Math.PI * cutoff * d) / (Math.PI * cutoff * d);
    table[j] = cutoff * sinc * (0.5 + 0.5 * Math.cos((Math.PI * d) / half));
  }

  const channels = sources.length;
  const outs = sources.map(() => new Float32Array(outLen));
  const last = table.length - 2;
  // Mono and stereo — nearly every clip — keep their sums in locals: the
  // generic per-channel loop doubled the cost of the whole resample.
  const pair = channels <= 2;
  const s0 = sources[0];
  const s1 = channels === 2 ? sources[1] : s0;
  const acc = new Float64Array(channels);
  for (let i = 0; i < outLen; i++) {
    const x = i * speed;
    const base = Math.floor(x);
    const lo = Math.max(0, base - half + 1);
    const hi = Math.min(len - 1, base + half);
    let weights = 0;
    let a0 = 0;
    let a1 = 0;
    if (!pair) acc.fill(0);
    for (let k = lo; k <= hi; k++) {
      const pos = (x > k ? x - k : k - x) * TABLE_STEPS;
      const j = pos | 0;
      if (j > last) continue;
      const w = table[j] + (table[j + 1] - table[j]) * (pos - j);
      weights += w;
      if (pair) {
        a0 += s0[k] * w;
        a1 += s1[k] * w;
      } else {
        for (let c = 0; c < channels; c++) acc[c] += sources[c][k] * w;
      }
    }
    if (weights <= 1e-6) continue;
    if (pair) {
      outs[0][i] = a0 / weights;
      if (channels === 2) outs[1][i] = a1 / weights;
    } else {
      for (let c = 0; c < channels; c++) outs[c][i] = acc[c] / weights;
    }
  }
  return planar(audio.sampleRate, outs);
}

/** `audio` re-timed to `speed`, its pitch kept or moving like a tape. */
export function retimePlanar(audio: PlanarAudio, speed: number, sound: RetimeSound = 'pitch'): PlanarAudio {
  return sound === 'tape' ? tapeResample(audio, speed) : stretchPlanar(audio, speed);
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
  // A sound too short for a grain is re-timed like a tape: a few
  // milliseconds whose pitch moves are heard as nothing at all.
  if (len < grain * 2) return tapeResample(audio, speed);
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
