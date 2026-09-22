import { describe, expect, it } from 'vitest';
import {
  MAX_MONTH_CELL,
  MIN_MONTH_CELL,
  MONTH_GAP,
  blockSpan,
  monthBlocks,
  monthCell,
  monthWidth,
  visibleBlock,
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
