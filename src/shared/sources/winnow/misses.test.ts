import { describe, expect, it } from 'vitest';
import type { ThumbMetrics } from '../../media/thumb-metrics';
import { findMisses } from './misses';

const metrics = (over: { sharpness?: number; mean?: number; p99?: number; clipped?: number; crushed?: number } = {}): ThumbMetrics => ({
  sharpness: over.sharpness ?? 0.01,
  exposure: {
    mean: over.mean ?? 120,
    p1: 10,
    median: 118,
    p99: over.p99 ?? 240,
    red: 120,
    green: 120,
    blue: 120,
    clippedHighlights: over.clipped ?? 0,
    crushedShadows: over.crushed ?? 0,
  },
  colour: { chromatic: 0.5, families: { red: 0, orange: 0, yellow: 0, green: 0, cyan: 0, blue: 1, purple: 0, magenta: 0 }, dominant: 'blue', hex: '#0000ff', warmth: -1 },
  hash: '0000000000000000',
});

describe('findMisses', () => {
  it('flags blur against the batch’s median once there are enough frames', () => {
    const batch = [1, 2, 3, 4].map((id) => ({ id, metrics: metrics({ sharpness: 0.01 }) }));
    const { misses, medianSharpness } = findMisses([...batch, { id: 5, metrics: metrics({ sharpness: 0.002 }) }]);
    expect(medianSharpness).toBe(0.01);
    expect(misses).toEqual([{ id: 5, flags: [{ kind: 'blur', measure: 'sharpness 0.002 (batch median 0.01)' }] }]);
  });

  it('uses the floor alone for a small batch', () => {
    const { misses, medianSharpness } = findMisses([{ id: 1, metrics: metrics({ sharpness: 0.002 }) }, { id: 2, metrics: metrics({ sharpness: 0.0001 }) }]);
    expect(medianSharpness).toBeNull();
    expect(misses.map((m) => m.id)).toEqual([2]);
  });

  it('says dark, bright, clipped and crushed with the number behind each', () => {
    const { misses } = findMisses([
      { id: 1, metrics: metrics({ mean: 30 }) },
      { id: 2, metrics: metrics({ p99: 90 }) },
      { id: 3, metrics: metrics({ mean: 230, clipped: 0.2 }) },
      { id: 4, metrics: metrics({ crushed: 0.3 }) },
      { id: 5, metrics: null },
    ]);
    expect(misses.map((m) => [m.id, m.flags.map((f) => f.kind)])).toEqual([
      [1, ['dark']],
      [2, ['dark']],
      [3, ['bright', 'clipped']],
      [4, ['crushed']],
    ]);
    expect(misses[2].flags[1].measure).toBe('20 % at white');
  });
});
