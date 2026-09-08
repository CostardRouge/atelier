import { describe, expect, it } from 'vitest';
import { densityStrip, FLOOR } from './day-density';

const march = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04'];

describe('densityStrip', () => {
  it('scales to the month it is drawing, not to a fixed number', () => {
    const busy = densityStrip(march, new Map([['2026-03-02', 40]]));
    const quiet = densityStrip(march, new Map([['2026-03-02', 2]]));
    expect(busy.bars[1].fill).toBe(1);
    expect(quiet.bars[1].fill).toBe(1);
  });

  it('keeps one file visibly above nothing', () => {
    const { bars } = densityStrip(march, new Map([['2026-03-01', 60], ['2026-03-03', 1]]));
    expect(bars[0].fill).toBe(1);
    expect(bars[2].fill).toBeGreaterThanOrEqual(FLOOR);
    expect(bars[1].fill).toBe(0);
  });

  it('reads a day the instance did not mention as empty', () => {
    const { bars, peak, total } = densityStrip(march, new Map());
    expect(bars.map((b) => b.fill)).toEqual([0, 0, 0, 0]);
    expect(peak).toBe(0);
    expect(total).toBe(0);
  });

  it('carries the peak and the month total for the label', () => {
    const { peak, total } = densityStrip(
      march,
      new Map([['2026-03-01', 5], ['2026-03-02', 12], ['2026-03-04', 3]]),
    );
    expect(peak).toBe(12);
    expect(total).toBe(20);
  });

  it('echoes the days it was given, in order', () => {
    const { bars } = densityStrip(march, new Map([['2026-03-04', 9]]));
    expect(bars.map((b) => b.date)).toEqual(march);
    expect(bars[3].count).toBe(9);
  });
});
