import { describe, expect, it } from 'vitest';
import {
  laneLeaders,
  motionDraws,
  presetMotion,
  QUEUE_LAPS,
  readWallMotion,
  SETTLE_AT,
  SETTLE_FOR,
  SLIDE_CELLS,
  smartRate,
  travelled,
  wallCapacity,
  wallMotionOf,
  type MotionGrid,
  type MotionPlace,
} from './wall-motion';

/** A 4 × 3 grid of 100 px cells starting at (−50, 0). */
const GRID: MotionGrid = { x0: -50, y0: 0, cols: 4, rows: 3, cellW: 100, cellH: 100 };
const PLACES: MotionPlace[] = [];
for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) PLACES.push({ x: -50 + c * 100, y: r * 100, w: 100, h: 100, row: r, col: c, span: 1 });

describe('wall motion settings', () => {
  it('is still by default, and a preset fills the rest', () => {
    const m = wallMotionOf(null);
    expect(m.preset).toBe('none');
    expect(m.lanes.every((l) => l.mode === 'still')).toBe(true);
    expect(wallMotionOf({ preset: 'metro' }).lanes.map((l) => l.dir)).toEqual([-1, 1]);
    expect(wallMotionOf({ preset: 'marquee', speed: 2 }).speed).toBe(2);
  });
  it('reads a script leniently', () => {
    expect(readWallMotion({ preset: 'calm', speed: 9, lanes: [{ mode: 'slide', dir: -1 }, { mode: 'nope' }], axis: 'diag' })).toEqual({ preset: 'calm', speed: 3, lanes: [{ mode: 'slide', dir: -1 }] });
    expect(readWallMotion('x')).toBeUndefined();
  });
  it('counts more pictures only for a queue that moves', () => {
    expect(wallCapacity(100, null, 400)).toBe(100);
    expect(wallCapacity(100, { preset: 'marquee' }, 400)).toBe(100 * QUEUE_LAPS);
    expect(wallCapacity(200, { preset: 'marquee' }, 400)).toBe(400);
    expect(wallCapacity(100, { preset: 'marquee', queue: false }, 400)).toBe(100);
  });
});

describe('travelled', () => {
  it('plain: speed × time, the lane’s way', () => {
    const m = { ...presetMotion('marquee'), smart: false };
    expect(travelled(2, m, -1)).toBeCloseTo(-2 * SLIDE_CELLS);
  });
  it('smart: still on the hero, then settles on a whole cell', () => {
    const m = presetMotion('marquee');
    expect(travelled(0.4, m, 1)).toBeCloseTo(0, 3);
    const end = travelled(SETTLE_AT + SETTLE_FOR, m, 1);
    expect(end).toBe(Math.round(end));
    expect(end).toBeGreaterThan(0);
    expect(travelled(SETTLE_AT + SETTLE_FOR + 2, m, 1)).toBe(end);
  });
  it('slower under the voice, a cell a beat with music', () => {
    const m = presetMotion('marquee');
    expect(smartRate(1.5, { speech: [[1.2, 1.8]] })).toBeLessThan(smartRate(1.5, {}) * 0.5);
    expect(travelled(1.85, m, 1, { beats: [1.1, 1.5] })).toBeCloseTo(2, 1);
  });
});

describe('laneLeaders', () => {
  it('ties a big picture’s two lanes, and a band’s lanes under smart motion', () => {
    const places: MotionPlace[] = [
      { x: 0, y: 0, w: 200, h: 200, row: 0, col: 0, span: 2, band: 0 },
      { x: 0, y: 200, w: 100, h: 100, row: 2, col: 0, span: 1, band: 1 },
      { x: 0, y: 300, w: 100, h: 100, row: 3, col: 0, span: 1, band: 1 },
    ];
    expect([...laneLeaders(places, 'rows', 4, false)]).toEqual([0, 0, 2, 3]);
    expect([...laneLeaders(places, 'rows', 4, true)]).toEqual([0, 0, 2, 2]);
  });
});

describe('motionDraws', () => {
  it('still moves nothing', () => {
    expect(motionDraws(PLACES, GRID, presetMotion('none'), 3).flat().every((d) => d.dx === 0 && d.dy === 0 && d.sx === 1)).toBe(true);
  });
  it('a slide wraps a place across the seam, its other half on the next lap', () => {
    const m = { ...presetMotion('marquee'), smart: false, lanes: [{ mode: 'slide' as const, dir: 1 as const }], speed: 1 };
    // 0.5 cell after 1/0.45 × 0.5 s: the last column straddles the seam.
    const t = 0.5 / SLIDE_CELLS;
    const draws = motionDraws(PLACES, GRID, m, t);
    const last = draws[3];
    expect(last).toHaveLength(2);
    expect(last[0].dx).toBeCloseTo(50);
    expect(last[1].dx).toBeCloseTo(50 - 400);
    expect(last[1].lap).toBe(1);
  });
  it('metro: neighbours go opposite ways', () => {
    const m = { ...presetMotion('metro'), smart: false };
    const draws = motionDraws(PLACES, GRID, m, 1);
    // The second place of each row (the first of a row going left wraps to its far end).
    expect(Math.sign(draws[1][0].dx)).toBe(-1);
    expect(Math.sign(draws[5][0].dx)).toBe(1);
  });
  it('a shuffle shows another place’s picture once two have swapped, and crosses them while it does', () => {
    const m = { ...presetMotion('shuffle'), smart: false };
    const later = motionDraws(PLACES, GRID, m, 6).flat();
    expect(later.some((d) => d.shows !== undefined)).toBe(true);
    const mid = Array.from({ length: 60 }, (_, k) => motionDraws(PLACES, GRID, m, k * 0.1).flat()).flat();
    expect(mid.some((d) => d.dx !== 0)).toBe(true);
  });
  it('a flip turns each picture to the next, the queue’s turn counted', () => {
    const m = { ...presetMotion('flipboard'), smart: false };
    const before = motionDraws(PLACES, GRID, m, 0.01)[0][0];
    expect(before.lap).toBe(0);
    const after = motionDraws(PLACES, GRID, m, 1.6 + 0.5)[0][0];
    expect(after.lap).toBeGreaterThanOrEqual(1);
  });
  it('the same moment draws the same: an export draws what plays', () => {
    const m = presetMotion('metro');
    expect(motionDraws(PLACES, GRID, m, 1.37)).toEqual(motionDraws(PLACES, GRID, m, 1.37));
  });
});

describe('the script', () => {
  it('a post’s motion over the series’, each level taken away alone', async () => {
    const { newScript } = await import('./story-script');
    const { motionIn, withWallMotion, nextLane, spelled } = await import('./wall-motion');
    let s = withWallMotion(newScript('S'), 'series', 'ep01', { preset: 'metro' });
    s = withWallMotion(s, 'post', 'ep01', { speed: 2 });
    expect(motionIn(s, 'ep01')).toMatchObject({ preset: 'metro', speed: 2 });
    expect(motionIn(s, 'ep02').speed).toBe(1.1);
    s = withWallMotion(s, 'post', 'ep01', null);
    expect(motionIn(s, 'ep01').speed).toBe(1.1);
    expect(withWallMotion(s, 'series', 'ep01', null).look).toBeUndefined();
    expect(nextLane({ mode: 'slide', dir: -1 })).toEqual({ mode: 'slide', dir: 1 });
    expect(nextLane({ mode: 'breathe', dir: 1 }).mode).toBe('still');
    expect(spelled(motionIn(s, 'ep01'), 3).map((l) => l.dir)).toEqual([-1, 1, -1]);
  });
});

describe('smart: the hero holds', () => {
  it('keeps the hero’s lane still, the others move', () => {
    const places = PLACES.map((p) => ({ ...p, centre: p.row === 1 && p.col === 1 }));
    const draws = motionDraws(places, GRID, presetMotion('marquee'), 1.6);
    expect(draws[5][0].dx).toBe(0);
    expect(draws[1][0].dx).not.toBe(0);
  });
});
