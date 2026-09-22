import { describe, expect, it } from 'vitest';
import {
  MAX_MONTH_CELL,
  MIN_MONTH_CELL,
  MONTH_GAP,
  blockSpan,
  monthBlocks,
  monthCell,
  monthWidth,
  scrollForWeek,
  visibleBlock,
  visibleWeekSpan,
  weekIndexOf,
  weekRuns,
  weekStart,
} from './month-grid';

describe('monthBlocks', () => {
  it('gives one block per calendar month the trip touches, in order', () => {
    const blocks = monthBlocks('2025-03-03', '2026-02-10');
    expect(blocks).toHaveLength(12);
    expect(blocks.map((b) => b.key)).toEqual([
      '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08',
      '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
    ]);
  });

  it('says the year on the first block and on every January, and nowhere else', () => {
    const blocks = monthBlocks('2025-03-03', '2026-02-10');
    expect(blocks[0].label).toBe('March 2025');
    expect(blocks[1].label).toBe('April');
    expect(blocks[10].label).toBe('January 2026');
    expect(blocks[11].label).toBe('February');
  });

  it('draws the WHOLE month, Monday first, padded with null where the month has no day', () => {
    const [july] = monthBlocks('2025-07-01', '2025-07-31');
    // 1 July 2025 is a Tuesday: one padding slot before it.
    expect(july.weeks[0].cells).toEqual([null, '2025-07-01', '2025-07-02', '2025-07-03', '2025-07-04', '2025-07-05', '2025-07-06']);
    expect(july.weeks).toHaveLength(5);
    // 31 July is a Thursday: three padding slots after it.
    expect(july.weeks[4].cells).toEqual(['2025-07-28', '2025-07-29', '2025-07-30', '2025-07-31', null, null, null]);
  });

  it('keeps the trip days apart from the month, at both edges', () => {
    const blocks = monthBlocks('2025-03-03', '2026-02-10');
    expect(blocks[0].tripDays[0]).toBe('2025-03-03');
    expect(blocks[0].tripDays).toHaveLength(29);
    expect(blocks[0].weeks[0].cells[0]).toBe(null); // March 2025 starts on a Saturday
    expect(blocks[0].weeks[0].cells[5]).toBe('2025-03-01'); // drawn, though outside the trip
    const last = blocks[11];
    expect(last.tripDays[last.tripDays.length - 1]).toBe('2026-02-10');
    expect(last.weeks[last.weeks.length - 1].cells).toContain('2026-02-28');
  });

  it('is one block for a one-day trip and nothing for a reversed or bad span', () => {
    expect(monthBlocks('2025-05-09', '2025-05-09')).toHaveLength(1);
    expect(monthBlocks('2025-05-09', '2025-05-08')).toEqual([]);
    expect(monthBlocks('2025-02-30', '2025-03-01')).toEqual([]);
  });

  it('every week has exactly seven slots', () => {
    for (const block of monthBlocks('2024-01-01', '2026-12-31')) {
      for (const week of block.weeks) expect(week.cells).toHaveLength(7);
    }
  });
});

describe('weekRuns', () => {
  const week = ['2025-07-07', '2025-07-08', '2025-07-09', '2025-07-10', '2025-07-11', '2025-07-12', '2025-07-13'];

  it('groups consecutive cells that share a value', () => {
    const legOf = (d: string) => (d <= '2025-07-09' ? 'a' : 'b');
    expect(weekRuns(week, legOf)).toEqual([
      { from: 0, to: 2, value: 'a' },
      { from: 3, to: 6, value: 'b' },
    ]);
  });

  it('breaks a run on a null cell and on a null answer', () => {
    const cells = [null, '2025-07-08', '2025-07-09', null, '2025-07-11', '2025-07-12', '2025-07-13'];
    const legOf = (d: string) => (d === '2025-07-12' ? null : 'a');
    expect(weekRuns(cells, legOf)).toEqual([
      { from: 1, to: 2, value: 'a' },
      { from: 4, to: 4, value: 'a' },
      { from: 6, to: 6, value: 'a' },
    ]);
  });

  it('is empty for a week nothing covers', () => {
    expect(weekRuns(week, () => null)).toEqual([]);
  });

  it('takes its own idea of sameness', () => {
    const legOf = (d: string) => ({ id: d <= '2025-07-09' ? 'a' : 'b' });
    expect(weekRuns(week, legOf, (x, y) => x.id === y.id).map((r) => [r.from, r.to])).toEqual([[0, 2], [3, 6]]);
  });
});

describe('monthCell', () => {
  it('is a seventh of what the gutters leave, in whole pixels', () => {
    // A 390px phone less the shell's gutter.
    expect(monthCell(358)).toBe(47);
    expect(monthWidth(47)).toBe(7 * 47 + 6 * MONTH_GAP);
    expect(monthWidth(47)).toBeLessThanOrEqual(358);
  });

  it('clamps at both ends and answers the minimum for an unmeasured box', () => {
    expect(monthCell(100)).toBe(MIN_MONTH_CELL);
    expect(monthCell(2000)).toBe(MAX_MONTH_CELL);
    expect(monthCell(0)).toBe(MIN_MONTH_CELL);
  });
});

describe('visibleBlock', () => {
  it('is the block under the upper third of the viewport', () => {
    const tops = [0, 400, 800, 1200];
    expect(visibleBlock(tops, 0, 600)).toBe(0);
    expect(visibleBlock(tops, 250, 600)).toBe(1); // eye at 450
    expect(visibleBlock(tops, 700, 600)).toBe(2); // eye at 900
    expect(visibleBlock(tops, 5000, 600)).toBe(3);
    expect(visibleBlock([], 0, 600)).toBe(-1);
  });

  it('answers the FIRST block of a row when several share a top — a wide screen reads a row from its left', () => {
    const tops = [0, 0, 0, 400, 400, 400, 800, 800, 800];
    expect(visibleBlock(tops, 0, 600)).toBe(0);
    expect(visibleBlock(tops, 300, 600)).toBe(3);
    expect(visibleBlock(tops, 900, 600)).toBe(6);
  });
});

describe('weekIndexOf', () => {
  it('counts calendar weeks from the week the trip starts in', () => {
    expect(weekIndexOf('2025-03-03', '2025-03-03')).toBe(0);
    expect(weekIndexOf('2025-03-09', '2025-03-03')).toBe(0); // the Sunday of the same week
    expect(weekIndexOf('2025-03-10', '2025-03-03')).toBe(1);
    // A trip starting mid-week: its Monday is the origin, so a later Monday is a whole number of weeks on.
    expect(weekIndexOf('2025-03-10', '2025-03-06')).toBe(1);
    expect(weekIndexOf('2025-03-05', '2025-03-06')).toBe(0);
    expect(weekIndexOf('nope', '2025-03-06')).toBe(null);
  });
});

describe('visibleWeekSpan', () => {
  // Four rows of 60px, week 0..3, then a straddling week 3 drawn again in the next block.
  const rows = [
    { top: 0, height: 60, week: 0 },
    { top: 60, height: 60, week: 1 },
    { top: 120, height: 60, week: 2 },
    { top: 180, height: 60, week: 3 },
    { top: 300, height: 60, week: 3 },
    { top: 360, height: 60, week: 4 },
  ];

  it('frames the weeks on screen, whole rows at rest', () => {
    expect(visibleWeekSpan(rows, 0, 120)).toEqual({ from: 0, to: 2 });
  });

  it('moves by the pixel: a row half under the top edge counts half', () => {
    expect(visibleWeekSpan(rows, 30, 120)).toEqual({ from: 0.5, to: 2.5 });
    expect(visibleWeekSpan(rows, 45, 120)).toEqual({ from: 0.75, to: 2.75 });
  });

  it('a straddling week drawn twice still reads as one span', () => {
    // 180..300: the first week-3 row whole, the gap, the second week-3 row starting.
    expect(visibleWeekSpan(rows, 180, 150)).toEqual({ from: 3, to: 3.5 });
  });

  it('keeps the last week framed past the end, and is null with no rows', () => {
    expect(visibleWeekSpan(rows, 1000, 120)).toEqual({ from: 5, to: 5 });
    expect(visibleWeekSpan([], 0, 120)).toBe(null);
  });
});

describe('scrollForWeek', () => {
  const rows = [
    { top: 0, height: 60, week: 0 },
    { top: 60, height: 60, week: 1 },
    { top: 200, height: 60, week: 1 },
    { top: 260, height: 60, week: 2 },
  ];

  it('is the inverse of the span: a fractional week lands inside its row', () => {
    expect(scrollForWeek(rows, 0)).toBe(0);
    expect(scrollForWeek(rows, 0.5)).toBe(30);
    expect(scrollForWeek(rows, 2.25)).toBe(275);
  });

  it('a week drawn twice answers with its first row', () => {
    expect(scrollForWeek(rows, 1)).toBe(60);
  });

  it('clamps off either end, and is null with no rows', () => {
    expect(scrollForWeek(rows, -3)).toBe(0);
    expect(scrollForWeek(rows, 9)).toBe(320);
    expect(scrollForWeek([], 1)).toBe(null);
  });
});

describe('blockSpan and weekStart', () => {
  it('names a block by its first and last trip day, or nothing', () => {
    const blocks = monthBlocks('2025-03-03', '2025-04-05');
    expect(blockSpan(blocks[0])).toEqual({ start: '2025-03-03', end: '2025-03-31' });
    expect(blockSpan(blocks[1])).toEqual({ start: '2025-04-01', end: '2025-04-05' });
    expect(blockSpan({ ...blocks[1], tripDays: [] })).toBe(null);
  });

  it('finds the Monday of a week', () => {
    expect(weekStart('2025-07-10')).toBe('2025-07-07');
    expect(weekStart('2025-07-07')).toBe('2025-07-07');
    expect(weekStart('2025-07-13')).toBe('2025-07-07');
    expect(weekStart('nope')).toBe(null);
  });
});
