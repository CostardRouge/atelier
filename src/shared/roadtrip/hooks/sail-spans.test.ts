import { describe, expect, it } from 'vitest';
import { sailSpans } from './sail-spans';
import type { DockBeat } from './boarding';

/** A drive of 10 s: a hold to 1 s, a run 1 → 9 s over s 0 → 100 at an even pace, then the arrival. */
const plan = (docks: DockBeat[] = []) => ({
  seconds: 10,
  schedule: { docks },
  at: (t: number) =>
    t < 1 ? { s: 0, phase: 'hold' as const } : t < 9 ? { s: ((t - 1) / 8) * 100, phase: 'run' as const } : { s: 100, phase: 'arrive' as const },
});

describe('sailSpans', () => {
  it('marks the run where the road’s vehicle is at sea', () => {
    const [sail] = sailSpans(plan(), (s) => s >= 25 && s <= 75);
    expect(sail.kind).toBe('sail');
    expect(sail.start).toBeCloseTo(3, 1);
    expect(sail.end).toBeCloseTo(7, 1);
  });

  it('never marks a halt or a hold, even standing on the water', () => {
    expect(sailSpans(plan(), () => true).map((span) => span.kind)).toEqual(['sail']);
    const [sail] = sailSpans(plan(), () => true);
    expect(sail.start).toBeCloseTo(1, 1);
    expect(sail.end).toBeCloseTo(9, 1);
  });

  it('keeps the docks as their own beats, in time order', () => {
    const docks: DockBeat[] = [
      { kind: 'board', start: 0.2, end: 1, s: 0, stop: 0 },
      { kind: 'alight', start: 9, end: 9.8, s: 100, stop: 1 },
    ];
    expect(sailSpans(plan(docks), (s) => s < 50).map((span) => span.kind)).toEqual(['board', 'sail', 'alight']);
  });

  it('marks nothing on a drive that stays on land', () => {
    expect(sailSpans(plan(), () => false)).toEqual([]);
  });
});
