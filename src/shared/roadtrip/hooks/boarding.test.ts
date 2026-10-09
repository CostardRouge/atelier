import { describe, expect, it } from 'vitest';
import { ALIGHT_SECONDS, BOARD_SECONDS, boardingAt, crossingAt, dockReach, riderBlend, riderTrack, type DockBeat } from './boarding';

const SCHEDULE = { boardAt: { start: 0.4, end: 0.4 + BOARD_SECONDS }, alightAt: { start: 10, end: 10 + ALIGHT_SECONDS } };
const LENGTH = 194;
const RIDER = 44;

describe('boardingAt', () => {
  it('waits at the quay before boarding, drives on, is aboard (nothing drawn) while the ship crosses, drives off and stays', () => {
    expect(boardingAt(SCHEDULE, 0)).toEqual({ stage: 'board', u: 0 });
    const mid = boardingAt(SCHEDULE, 0.4 + BOARD_SECONDS / 2)!;
    expect(mid.stage).toBe('board');
    expect(mid.u).toBeCloseTo(0.5, 9);
    expect(boardingAt(SCHEDULE, 0.4 + BOARD_SECONDS)).toBeNull();
    expect(boardingAt(SCHEDULE, 6)).toBeNull();
    expect(boardingAt(SCHEDULE, 10)).toEqual({ stage: 'alight', u: 0 });
    expect(boardingAt(SCHEDULE, 30)).toEqual({ stage: 'alight', u: 1 });
  });

  it('is nothing on a drive without a ferry', () => {
    expect(boardingAt({ boardAt: null, alightAt: null }, 3)).toBeNull();
  });
});

describe('riderTrack', () => {
  const half = LENGTH / 2;

  it('boards from beyond the stern ramp to wholly inside, fading only once its middle passes the transom', () => {
    const start = riderTrack({ stage: 'board', u: 0 }, LENGTH, RIDER);
    expect(start.y).toBeLessThan(-half - 18);
    expect(start.alpha).toBe(1);
    expect(start.ramp).toBe('stern');
    let last = start.y;
    for (let u = 0.05; u <= 0.8; u += 0.05) {
      const at = riderTrack({ stage: 'board', u }, LENGTH, RIDER);
      expect(at.y).toBeGreaterThanOrEqual(last);
      if (at.y <= -half) expect(at.alpha).toBe(1);
      last = at.y;
    }
    const inside = riderTrack({ stage: 'board', u: 0.8 }, LENGTH, RIDER);
    expect(inside.y).toBeGreaterThan(-half);
    expect(inside.alpha).toBe(0);
    // The ramp comes up once the car is in.
    expect(riderTrack({ stage: 'board', u: 1 }, LENGTH, RIDER).ramp).toBeNull();
  });

  it('drives off over the bow, appearing as it passes the stem, and stays out on the quay', () => {
    const start = riderTrack({ stage: 'alight', u: 0 }, LENGTH, RIDER);
    expect(start.y).toBeLessThan(half);
    expect(start.alpha).toBe(0);
    const out = riderTrack({ stage: 'alight', u: 1 }, LENGTH, RIDER);
    expect(out.y).toBeGreaterThan(half + 14);
    expect(out.alpha).toBe(1);
    expect(out.ramp).toBe('bow');
    expect(riderTrack({ stage: 'alight', u: 0.75 }, LENGTH, RIDER)).toEqual(out);
  });

  it('counts the distance driven, which turns the wheels', () => {
    expect(riderTrack({ stage: 'board', u: 0 }, LENGTH, RIDER).travelled).toBe(0);
    expect(riderTrack({ stage: 'board', u: 0.4 }, LENGTH, RIDER).travelled).toBeGreaterThan(0);
  });
});

describe('a crossing in the middle of the road', () => {
  const beat = (kind: DockBeat['kind'], start: number, s: number, stop: number | null = null): DockBeat => ({
    kind,
    start,
    end: start + (kind === 'board' ? BOARD_SECONDS : ALIGHT_SECONDS),
    s,
    stop,
  });
  const ROAD = 1000;
  const mid = { board: beat('board', 4, 300), alight: beat('alight', 9, 600) };

  it('docks the ship so the car starts aboard from where it stopped, and stops where the far shore is', () => {
    const start = riderTrack({ stage: 'board', u: 0 }, LENGTH, RIDER);
    expect(-start.y).toBeCloseTo(dockReach('board', LENGTH, RIDER), 9);
    const end = riderTrack({ stage: 'alight', u: 1 }, LENGTH, RIDER);
    expect(end.y).toBeCloseTo(dockReach('alight', LENGTH, RIDER), 9);
  });

  it('is the road’s car on the shore at first, a rider once it lines up with the ramp, the road’s car again once off', () => {
    expect(riderBlend({ stage: 'board', u: 0 })).toBe(1);
    expect(riderBlend({ stage: 'board', u: 0.2 })).toBeGreaterThan(0);
    expect(riderBlend({ stage: 'board', u: 0.35 })).toBe(0);
    expect(riderBlend({ stage: 'alight', u: 0.5 })).toBe(0);
    expect(riderBlend({ stage: 'alight', u: 0.9 })).toBeGreaterThan(0);
    expect(riderBlend({ stage: 'alight', u: 1 })).toBe(1);
  });

  it('holds from the boarding to the end of the alighting, and lets the road drive on after', () => {
    expect(crossingAt([mid], 3.9, ROAD)).toBeNull();
    expect(crossingAt([mid], 4, ROAD)).toMatchObject({ moment: { stage: 'board', u: 0 }, ends: { start: false, end: false } });
    expect(crossingAt([mid], 7, ROAD)!.moment).toBeNull();
    const off = crossingAt([mid], 9 + ALIGHT_SECONDS / 2, ROAD)!.moment!;
    expect(off.stage).toBe('alight');
    expect(off.u).toBeCloseTo(0.5, 9);
    expect(crossingAt([mid], 9 + ALIGHT_SECONDS, ROAD)).toBeNull();
  });

  it('waits at the quay from the start on the road’s first stop, and stays on the quay at its last', () => {
    const ends = { board: beat('board', 0.4, 0, 0), alight: beat('alight', 12, ROAD, 4) };
    expect(crossingAt([ends], 0, ROAD)).toMatchObject({ moment: { stage: 'board', u: 0 }, ends: { start: true, end: true } });
    expect(crossingAt([ends], 40, ROAD)!.moment).toEqual({ stage: 'alight', u: 1 });
  });
});
