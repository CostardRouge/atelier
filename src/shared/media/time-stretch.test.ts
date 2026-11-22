import { describe, expect, it } from 'vitest';
import { planar } from './audio-mix';
import { stretchPlanar } from './time-stretch';

const RATE = 16000;

function sine(seconds: number, hz: number, amp = 0.5): Float32Array {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
}

/** Cycles per second measured by upward zero crossings, away from the edges. */
function frequency(x: Float32Array): number {
  const from = Math.round(0.1 * RATE);
  const to = x.length - Math.round(0.1 * RATE);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++;
  return crossings / ((to - from) / RATE);
}

function rms(x: Float32Array): number {
  const from = Math.round(0.1 * RATE);
  const to = x.length - Math.round(0.1 * RATE);
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
}

describe('stretchPlanar', () => {
  it('lasts the re-timed length', () => {
    const a = planar(RATE, [sine(2, 440)]);
    expect(stretchPlanar(a, 0.5).length).toBe(4 * RATE);
    expect(stretchPlanar(a, 2).length).toBe(RATE);
    expect(stretchPlanar(a, 4).length).toBe(RATE / 2);
  });

  it('keeps the pitch slowed down and sped up', () => {
    const a = planar(RATE, [sine(2, 440)]);
    for (const speed of [0.25, 0.5, 2, 4]) {
      const out = stretchPlanar(a, speed).getChannelData(0);
      expect(Math.abs(frequency(out) - 440)).toBeLessThan(440 * 0.03);
    }
  });

  it('keeps the level', () => {
    const a = planar(RATE, [sine(2, 440)]);
    const level = rms(a.getChannelData(0));
    for (const speed of [0.5, 2]) {
      expect(rms(stretchPlanar(a, speed).getChannelData(0))).toBeCloseTo(level, 1);
    }
  });

  it('moves every channel by the same grains, so a centred sound stays centred', () => {
    const tone = sine(1, 300);
    const out = stretchPlanar(planar(RATE, [tone, new Float32Array(tone)]), 0.5);
    const l = out.getChannelData(0);
    const r = out.getChannelData(1);
    for (let i = 0; i < l.length; i += 97) expect(r[i]).toBe(l[i]);
  });

  it('leaves silence silent and speed 1 untouched', () => {
    const quiet = stretchPlanar(planar(RATE, [new Float32Array(RATE)]), 0.5).getChannelData(0);
    expect(quiet.every((v) => v === 0)).toBe(true);
    const tone = sine(0.5, 440);
    expect(Array.from(stretchPlanar(planar(RATE, [tone]), 1).getChannelData(0))).toEqual(Array.from(tone));
  });

  it('resamples a sound too short for a grain', () => {
    const out = stretchPlanar(planar(RATE, [new Float32Array(100).fill(0.25)]), 0.5);
    expect(out.length).toBe(200);
    expect(out.getChannelData(0)[50]).toBeCloseTo(0.25, 6);
  });
});
