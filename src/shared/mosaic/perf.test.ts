import { describe, expect, it } from 'vitest';
import { DEFAULT_PERF, planLots, sanitizePerf, workersFor } from './perf';

describe('sanitizePerf', () => {
  it('gives the defaults for nothing and bounds every field', () => {
    expect(sanitizePerf(undefined)).toEqual(DEFAULT_PERF);
    const p = sanitizePerf({ workers: 99, measure: 'gpu', lot: 7, showAsItComes: 'yes', propagation: 'left', cellAnimation: 'spin', animationMs: -5, tileCache: 1, ahead: 9, zoom: 'x', motion: 'y' });
    expect(p).toEqual({ ...DEFAULT_PERF, workers: 8, animationMs: 0 });
    expect(sanitizePerf({ workers: 3, lot: 256, propagation: 'rows', cellAnimation: 'none', tileCache: 600, ahead: 3, zoom: 'look', motion: 'reduced', measure: 'main', showAsItComes: false, animationMs: 400 })).toEqual({
      workers: 3,
      measure: 'main',
      lot: 256,
      showAsItComes: false,
      propagation: 'rows',
      cellAnimation: 'none',
      animationMs: 400,
      tileCache: 600,
      ahead: 3,
      zoom: 'look',
      motion: 'reduced',
    });
  });
});

describe('workersFor', () => {
  it('auto is cores − 1 within two to six, one or two on a phone; a number is taken as given', () => {
    expect(workersFor({ workers: 0 }, 8, false)).toBe(6);
    expect(workersFor({ workers: 0 }, 2, false)).toBe(2);
    expect(workersFor({ workers: 0 }, 8, true)).toBe(2);
    expect(workersFor({ workers: 0 }, 1, true)).toBe(1);
    expect(workersFor({ workers: 3 }, 2, true)).toBe(3);
  });
});

describe('planLots', () => {
  const covers = (lots: Int32Array[], count: number) => {
    const seen = new Set<number>();
    for (const l of lots) for (const c of l) seen.add(c);
    return seen.size === count && [...seen].every((c) => c >= 0 && c < count);
  };

  it('rows: lots of one row each by default, in order', () => {
    const lots = planLots(6, 4, { lot: 0, propagation: 'rows' });
    expect(lots.length).toBe(4);
    expect(Array.from(lots[1])).toEqual([6, 7, 8, 9, 10, 11]);
    expect(covers(lots, 24)).toBe(true);
  });

  it('none: one lot of everything; a lot size cuts the order', () => {
    expect(planLots(6, 4, { lot: 64, propagation: 'none' }).length).toBe(1);
    const lots = planLots(10, 10, { lot: 64, propagation: 'rows' });
    expect(lots.map((l) => l.length)).toEqual([64, 36]);
  });

  it('point: the origin first, then outward; the centre when none is given', () => {
    const lots = planLots(7, 5, { lot: 1, propagation: 'point' }, 0);
    expect(lots[0][0]).toBe(0);
    expect(lots[1][0] === 1 || lots[1][0] === 7).toBe(true);
    const centred = planLots(7, 5, { lot: 1, propagation: 'point' });
    expect(centred[0][0]).toBe(2 * 7 + 3);
    expect(covers(centred, 35)).toBe(true);
  });

  it('spiral: ring by ring around the centre, every cell once', () => {
    const lots = planLots(9, 9, { lot: 1, propagation: 'spiral' });
    expect(lots[0][0]).toBe(40);
    const ring1 = lots.slice(1, 9).map((l) => l[0]);
    for (const c of ring1) {
      const i = c % 9;
      const j = (c - i) / 9;
      expect(Math.max(Math.abs(i - 4), Math.abs(j - 4))).toBe(1);
    }
    expect(covers(lots, 81)).toBe(true);
  });

  it('random: seeded, every cell once, another seed another order', () => {
    const a = planLots(8, 8, { lot: 16, propagation: 'random' }, -1, 5);
    const b = planLots(8, 8, { lot: 16, propagation: 'random' }, -1, 5);
    const c = planLots(8, 8, { lot: 16, propagation: 'random' }, -1, 6);
    expect(a.map((l) => Array.from(l))).toEqual(b.map((l) => Array.from(l)));
    expect(a.map((l) => Array.from(l))).not.toEqual(c.map((l) => Array.from(l)));
    expect(covers(a, 64)).toBe(true);
  });

  it('an empty grid plans nothing', () => {
    expect(planLots(0, 4, { lot: 64, propagation: 'rows' })).toEqual([]);
  });
});
