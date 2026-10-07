import { describe, expect, it } from 'vitest';
import type { HookDay } from './hook-variant';
import type { DrivePlan } from './drive-plan';
import { driveRibbon, ribbonGeometry, ribbonStyle } from './drive-ribbon';

function days(total: number, legs: number[] = []): HookDay[] {
  return Array.from({ length: total }, (_, i) => ({
    date: `2025-03-${String(i + 1).padStart(2, '0')}`,
    dayNumber: i + 1,
    told: false,
    legStart: legs.includes(i + 1),
    pieces: [],
  }));
}

/** A plan whose day clock is `day(t)` — all the ribbon reads. */
function planOn(day: (t: number) => number | null, clocked = true): DrivePlan {
  return { clock: clocked ? { arrive: [1], leave: [2] } : null, at: (t: number) => ({ day: day(t) }) } as unknown as DrivePlan;
}

const BOX = { x: 108, y: 461, width: 864, height: 998 };
const LABELS = { scaleBar: true, distance: 'km' as const };
const BARE = { scaleBar: false, distance: 'off' as const };

describe('what the ribbon reads', () => {
  it('stands on the day the recap’s clock reads, held between the first and the last day', () => {
    const ribbon = driveRibbon(planOn((t) => 1 + t), days(10, [1, 4]))!;
    expect(ribbon.totalDays).toBe(10);
    expect(ribbon.legStarts).toEqual([1, 4]);
    expect(ribbon.at(2.5).headDay).toBeCloseTo(3.5, 9);
    // The end of the last day is still the last day's tick.
    expect(ribbon.at(10).headDay).toBe(10);
    expect(ribbon.at(-5).headDay).toBe(1);
  });

  it('is nothing without the recap’s clock, or over a trip of one day', () => {
    expect(driveRibbon(planOn(() => null, false), days(10))).toBeNull();
    expect(driveRibbon(planOn(() => 1), days(1))).toBeNull();
  });
});

describe('where the ribbon sits', () => {
  it('hangs under the map, past the scale bar and the distance, as wide as the box', () => {
    const g = ribbonGeometry(1080, 1920, BOX, LABELS, false);
    expect(g.dir).toBe(1);
    expect(g.baseline).toBeCloseTo(BOX.y + BOX.height + 100, 6);
    expect(g.x0).toBeCloseTo(BOX.x, 6);
    expect(g.length).toBeCloseTo(BOX.width, 6);
    expect(g.band.y + g.band.height).toBeLessThan(1920);
  });

  it('comes closer when nothing is written under the map, and clears a plate’s margin', () => {
    expect(ribbonGeometry(1080, 1920, BOX, BARE, false).baseline).toBeCloseTo(BOX.y + BOX.height + 28, 6);
    expect(ribbonGeometry(1080, 1920, BOX, BARE, true).baseline).toBeCloseTo(BOX.y + BOX.height + 40, 6);
  });

  it('goes above the map, its ticks rising, where the frame has no room below', () => {
    // A landscape frame: the map's box reaches down to 461 of 607.
    const box = { x: 108, y: 146, width: 864, height: 316 };
    const g = ribbonGeometry(1080, 607, box, LABELS, false);
    expect(g.dir).toBe(-1);
    expect(g.baseline).toBeCloseTo(box.y - 28, 6);
    expect(g.band.y).toBeGreaterThan(0);
  });
});

describe('how the ribbon is inked', () => {
  const o = { inkColor: '#3a332a', trailColor: '#d9442a' };

  it('on the paper like the map: ink ahead, the trail passed, no band', () => {
    expect(ribbonStyle(o, false)).toMatchObject({ tickColor: '#3a332a', passedColor: '#d9442a', tapeBackground: false });
  });

  it('over a picture in Défilé’s white on a dark band', () => {
    expect(ribbonStyle(o, true)).toMatchObject({ tickColor: '#ffffff', passedColor: '#d9442a', tapeBackground: true });
  });
});
