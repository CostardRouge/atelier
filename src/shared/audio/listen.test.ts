import { describe, expect, it } from 'vitest';
import { beatTimes, envelope, monoOf, speechSpans } from './listen';

const RATE = 8000;
const silence = (s: number) => new Float32Array(Math.round(s * RATE));
/** A voice-like burst: a 220 Hz tone with a little noise. */
function burst(out: Float32Array, a: number, b: number, amp = 0.4) {
  let seed = 1;
  for (let i = Math.round(a * RATE); i < Math.round(b * RATE) && i < out.length; i++) {
    seed = (seed * 16807) % 2147483647;
    out[i] += amp * Math.sin((2 * Math.PI * 220 * i) / RATE) + 0.02 * (seed / 2147483647 - 0.5);
  }
}

describe('envelope and mono', () => {
  it('averages channels, and measures loudness by windows', () => {
    expect([...monoOf([Float32Array.of(1, 0), Float32Array.of(0, 1)])]).toEqual([0.5, 0.5]);
    const s = silence(1);
    burst(s, 0.5, 1);
    const env = envelope(s, RATE);
    expect(env[10]).toBeLessThan(0.01);
    expect(env[80]).toBeGreaterThan(0.2);
  });
});

describe('speechSpans', () => {
  it('finds the phrases, bridging the breaths between words', () => {
    const s = silence(6);
    burst(s, 0.5, 1.2);
    burst(s, 1.4, 2.0); // a breath of 0.2 s: one phrase
    burst(s, 3.5, 4.5);
    const spans = speechSpans(s, RATE);
    expect(spans).toHaveLength(2);
    expect(spans[0][0]).toBeCloseTo(0.5, 1);
    expect(spans[0][1]).toBeCloseTo(2.0, 1);
    expect(spans[1][0]).toBeCloseTo(3.5, 1);
  });
  it('hears nothing in silence', () => {
    expect(speechSpans(silence(2), RATE)).toEqual([]);
  });
});

describe('beatTimes', () => {
  it('finds a steady 120 BPM pulse and its phase', () => {
    const s = silence(8);
    for (let t = 0.25; t < 8; t += 0.5) burst(s, t, t + 0.06, 0.8);
    const beats = beatTimes(s, RATE);
    expect(beats.length).toBeGreaterThan(12);
    const gaps = beats.slice(1).map((b, i) => b - beats[i]);
    expect(gaps.every((g) => Math.abs(g - 0.5) < 0.02)).toBe(true);
    const off = (((beats[0] - 0.25) % 0.5) + 0.5) % 0.5;
    expect(Math.min(off, 0.5 - off)).toBeLessThan(0.04);
  });
  it('finds none in a drone', () => {
    const s = silence(5);
    burst(s, 0, 5, 0.3);
    expect(beatTimes(s, RATE)).toEqual([]);
  });
});
