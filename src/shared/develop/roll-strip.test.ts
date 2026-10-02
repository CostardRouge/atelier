import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { createRollPicture, type RollPicture } from './roll-types';
import {
  ASPECT_CEILING,
  ASPECT_FLOOR,
  STRIP_METRICS,
  autoBandHeight,
  bandAfterDrag,
  bandLayout,
  bandSize,
  cellAspect,
  clampAspect,
  columnLayout,
  columnsForWidth,
  defaultStripPrefs,
  foldBelow,
  heightForRows,
  justifyRows,
  maxBandHeight,
  medianAspect,
  oneRow,
  passesStripFilter,
  readStripFilter,
  readStripPrefs,
  rowsForHeight,
  sheetLayout,
  stepThumb,
  stripFilterLabel,
  widthForColumns,
  type StripItem,
} from './roll-strip';

const D = STRIP_METRICS.desktop;
const P = STRIP_METRICS.phone;

const items = (aspects: number[]): StripItem[] => aspects.map((aspect, i) => ({ id: `p${i}`, aspect }));

const picture = (over: Partial<RollPicture> = {}): RollPicture => ({
  ...createRollPicture({ name: 'DSC07701.ARW', size: 1, lastModified: 0 }, 'p'),
  ...over,
});

describe('cellAspect', () => {
  it('reads the measured thumbnail first, then the crop, then 3:2', () => {
    expect(cellAspect({ aspect: 'original' }, 1)).toBe(1);
    expect(cellAspect({ aspect: '4:5' })).toBe(0.8);
    expect(cellAspect({ aspect: 'free:1.37' })).toBeCloseTo(1.37);
    expect(cellAspect({ aspect: 'original' })).toBe(1.5);
  });

  it('clamps between a 9:16 frame and 2:1, and answers 3:2 to nonsense', () => {
    expect(clampAspect(0.1)).toBe(ASPECT_FLOOR);
    expect(clampAspect(5)).toBe(ASPECT_CEILING);
    expect(clampAspect(Number.NaN)).toBe(1.5);
    expect(cellAspect({ aspect: 'original' }, 0)).toBe(1.5);
  });
});

describe('justifyRows', () => {
  it('fills every row edge to edge and leaves the last one at the target', () => {
    const { cells, height } = justifyRows(items([1.5, 1.5, 1.5, 1.5, 1.5]), 600, 100, 10, 0);
    // Three 3:2 cells at 100 overflow 600 (3 × 150 + 20 = 470 < 600, four = 630 ≥ 600): four per row, scaled to fit.
    const row1 = cells.filter((c) => c.y === 0);
    expect(row1).toHaveLength(4);
    const right = row1[row1.length - 1];
    expect(right.x + right.w).toBeCloseTo(600, 6);
    expect(row1.every((c) => Math.abs(c.h - row1[0].h) < 1e-9)).toBe(true);
    // The last row keeps the target — one picture does not become a poster.
    const last = cells[cells.length - 1];
    expect(last.h).toBe(100);
    expect(last.y).toBeGreaterThan(0);
    expect(height).toBeCloseTo(row1[0].h + 10 + 100, 6);
  });

  it('puts a caption under every cell and counts it in the height', () => {
    const { cells, height } = justifyRows(items([1, 1]), 300, 100, 10, 16);
    expect(cells.every((c) => c.cap === 16)).toBe(true);
    expect(height).toBe(116);
  });

  it('lays nothing out in no room', () => {
    expect(justifyRows(items([1.5]), 0, 100, 6, 0)).toEqual({ cells: [], height: 0 });
    expect(justifyRows([], 600, 100, 6, 0)).toEqual({ cells: [], height: 0 });
  });
});

describe('oneRow and the band', () => {
  it('draws one scrolling row at the body height, each cell at its aspect', () => {
    const row = oneRow(items([1.5, 0.8]), 100, 6, 0);
    expect(row.cells[0]).toMatchObject({ x: 0, y: 0, w: 150, h: 100 });
    expect(row.cells[1]).toMatchObject({ x: 156, w: 80, h: 100 });
    expect(row.width).toBe(236);
  });

  it('is one row at its default height and a grid once pulled up', () => {
    const one = bandLayout({ items: items([1.5, 1.5]), width: 800, bodyHeight: heightForRows(1, D, D.thumb) - D.head, metrics: D, thumb: D.thumb });
    expect(one.axis).toBe('x');
    expect(one.rows).toBe(1);
    expect(one.cellHeight).toBe(D.row);
    expect(one.cells[0]).toMatchObject({ x: D.pad, y: D.pad, h: D.row, cap: 0 });

    const two = bandLayout({ items: items(Array(12).fill(1.5)), width: 800, bodyHeight: heightForRows(2, D, D.thumb) - D.head, metrics: D, thumb: D.thumb });
    expect(two.axis).toBe('y');
    expect(two.rows).toBe(2);
    // Two rows share the body exactly: target + caption + target + caption + gap = avail.
    const avail = heightForRows(2, D, D.thumb) - D.head - 2 * D.pad;
    expect(2 * (two.cellHeight + D.cap) + D.gap).toBeCloseTo(avail, 6);
    expect(two.cells[0].cap).toBe(D.cap);
  });

  it('says a caption only once a cell is tall enough', () => {
    const short = bandLayout({ items: items([1.5]), width: 800, bodyHeight: 100, metrics: D, thumb: D.thumb });
    expect(short.cells[0].cap).toBe(0);
    const tall = bandLayout({ items: items([1.5]), width: 800, bodyHeight: D.capAt + D.cap + 2 * D.pad, metrics: D, thumb: D.thumb });
    expect(tall.cells[0].cap).toBe(D.cap);
    expect(tall.cells[0].h).toBe(D.capAt);
  });

  it('maps a height to its rows and back', () => {
    expect(rowsForHeight(heightForRows(1, D, D.thumb) - D.head, D, D.thumb)).toBe(1);
    expect(rowsForHeight(heightForRows(2, D, D.thumb) - D.head, D, D.thumb)).toBe(2);
    expect(rowsForHeight(heightForRows(3, P, P.thumb) - P.head, P, P.thumb)).toBe(3);
    expect(heightForRows(1, D, D.thumb)).toBe(D.head + 2 * D.pad + D.row);
  });
});

describe('the column and the sheet', () => {
  it('counts its columns from its width and lays justified rows that sit them side by side', () => {
    expect(columnsForWidth(widthForColumns(1, D), D)).toBe(1);
    expect(columnsForWidth(widthForColumns(2, D), D)).toBe(2);
    expect(columnsForWidth(widthForColumns(3, D), D)).toBe(3);
    const one = columnLayout({ items: items([1.5, 1.5, 0.67]), width: widthForColumns(1, D), metrics: D });
    expect(one.axis).toBe('y');
    expect(one.columns).toBe(1);
    // A landscape picture fills the column; the portrait one is narrower than it.
    expect(one.cells[0].w).toBeCloseTo(widthForColumns(1, D) - 2 * D.pad, 6);
    expect(one.cells[0].y).toBe(D.pad);
    expect(one.cells[1].y).toBeGreaterThan(one.cells[0].y);
  });

  it('draws the sheet with every caption', () => {
    const sheet = sheetLayout({ items: items([1.5, 1.5, 1.5]), width: 900, thumb: 176, metrics: D });
    expect(sheet.cells.every((c) => c.cap === D.cap)).toBe(true);
    expect(sheet.cellHeight).toBe(176);
  });

  it('steps a thumbnail size inside its reach', () => {
    expect(stepThumb(D.thumb, 1, D, 'band')).toBe(D.thumb + D.thumbStep);
    expect(stepThumb(D.thumbMax, 1, D, 'band')).toBe(D.thumbMax);
    expect(stepThumb(D.sheetMin, -1, D, 'sheet')).toBe(D.sheetMin);
  });
});

describe('the band after a drag', () => {
  it('folds under the threshold, else holds between the least band and the stage’s most', () => {
    const max = maxBandHeight(1000, D);
    expect(bandAfterDrag(foldBelow(D, false) - 1, D, false, max)).toEqual({ folded: true, size: null });
    // Just past the threshold: not folded, but held up to the least band worth drawing.
    expect(bandAfterDrag(foldBelow(D, false) + 1, D, false, max).size).toBe(D.head + 2 * D.pad + 52);
    expect(bandAfterDrag(5000, D, false, max).size).toBe(max);
    expect(bandAfterDrag(300, D, false, max)).toEqual({ folded: false, size: 300 });
    expect(bandAfterDrag(50, D, true, 600)).toEqual({ folded: true, size: null });
  });

  it('leaves the stage at least its minimum', () => {
    expect(maxBandHeight(1000, D)).toBe(1000 - D.grip - D.stageMin);
    expect(maxBandHeight(100, D)).toBe(D.head);
  });
});

describe('the height that follows the roll', () => {
  it('takes the room the median picture leaves, and never less than one row', () => {
    // His window: a 3:2 picture at 814 wide is 543 tall in a 1012 column.
    const h = autoBandHeight({ columnWidth: 814, columnHeight: 1012, aspect: 1.5, metrics: D });
    expect(h).toBeCloseTo(1012 - D.grip - 814 / 1.5, 6);
    // A 16:9 screen: nothing left under the picture, so one row.
    expect(autoBandHeight({ columnWidth: 1464, columnHeight: 792, aspect: 1.5, metrics: D })).toBe(heightForRows(1, D, D.thumb));
    // And never past what the stage must keep.
    expect(autoBandHeight({ columnWidth: 300, columnHeight: 1000, aspect: 2, metrics: D })).toBe(maxBandHeight(1000, D));
  });

  it('sizes against the median of the roll', () => {
    expect(medianAspect(items([0.67, 1.5, 1.5, 1.78]))).toBe(1.5);
    expect(medianAspect([])).toBe(1.5);
  });
});

describe('the device’s preferences', () => {
  it('reads a stored preference back, and a phone never keeps a column', () => {
    const d = defaultStripPrefs('desktop');
    expect(readStripPrefs(null, 'desktop')).toEqual(d);
    expect(readStripPrefs('garbage', 'phone')).toEqual(defaultStripPrefs('phone'));
    expect(readStripPrefs({ place: 'right', height: 300, folded: true, auto: true, thumb: 150, sheet: 200 }, 'desktop')).toEqual({
      place: 'right',
      height: 300,
      width: null,
      folded: true,
      auto: true,
      thumb: 150,
      sheet: 200,
    });
    expect(readStripPrefs({ place: 'right' }, 'phone').place).toBe('bottom');
    expect(readStripPrefs({ thumb: 10_000, sheet: -4 }, 'desktop')).toMatchObject({ thumb: D.thumbMax, sheet: D.sheetMin });
    expect(readStripPrefs({ height: -3, width: 'x' }, 'desktop')).toMatchObject({ height: null, width: null });
  });

  it('says the band’s extent from them: one row or column by default, the rail when folded', () => {
    const d = defaultStripPrefs('desktop');
    expect(bandSize(d, D)).toBe(heightForRows(1, D, D.thumb));
    expect(bandSize({ ...d, folded: true }, D)).toBe(D.head);
    expect(bandSize({ ...d, place: 'left' }, D)).toBe(widthForColumns(1, D));
    expect(bandSize({ ...d, place: 'right', folded: true }, D)).toBe(D.rail);
    expect(bandSize({ ...d, height: 420 }, D)).toBe(420);
  });
});

describe('the band’s filter', () => {
  const edited = picture({ id: 'e', develop: { ...DEFAULT_DEVELOP, exposure: 1 } });
  const held = picture({ id: 'h', deliver: 'no' });
  const ignored = picture({ id: 'i', deliver: 'ignore' });
  const plain = picture({ id: 'p' });

  it('reads a key back and labels it', () => {
    expect(readStripFilter('edited')).toBe('edited');
    expect(readStripFilter('cull:picks')).toBe('cull:picks');
    expect(readStripFilter('nope')).toBe('all');
    expect(stripFilterLabel('leaving')).toBe('To export');
    expect(stripFilterLabel('cull:stars:3')).toBe('Winnow: ★★★ and up');
  });

  it('shows the ignored ones only under their own filter, and Winnow’s only where it answered', () => {
    expect(passesStripFilter(ignored, 'all')).toBe(true);
    expect(passesStripFilter(ignored, 'edited')).toBe(false);
    expect(passesStripFilter(ignored, 'ignored')).toBe(true);
    expect(passesStripFilter(plain, 'ignored')).toBe(false);
    expect(passesStripFilter(edited, 'edited')).toBe(true);
    expect(passesStripFilter(held, 'held')).toBe(true);
    expect(passesStripFilter(plain, 'cull:picks')).toBe(false);
    expect(passesStripFilter(plain, 'cull:picks', { verdict: 'pick', star: 0, color: null })).toBe(true);
    expect(passesStripFilter(ignored, 'cull:picks', { verdict: 'pick', star: 0, color: null })).toBe(false);
    expect(passesStripFilter(plain, 'cull:unrejected')).toBe(true);
  });
});
