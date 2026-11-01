import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../lib/prng';
import type { Raster } from '../media/thumb-metrics';
import { cellGridsOf, cellMeansLab, forceInto, gridShape, matchCells, matchLot, pickCell, pickDive, pickNextTarget } from './match';
import { GRID_BYTES, descriptorsOf, dimsOf, levelOf, oklabOf } from './measure';

function raster(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

/** `n` flat grids, one colour each. */
function flatGrids(colours: [number, number, number][]): Uint8Array {
  const out = new Uint8Array(colours.length * GRID_BYTES);
  colours.forEach(([r, g, b], i) => {
    for (let c = 0; c < 36; c++) {
      out[i * GRID_BYTES + c * 3] = r;
      out[i * GRID_BYTES + c * 3 + 1] = g;
      out[i * GRID_BYTES + c * 3 + 2] = b;
    }
  });
  return out;
}

describe('gridShape', () => {
  it('cuts a 16:9 stage into cells of the frame’s shape, so rows = cols', () => {
    const s = gridShape(960, 540, 40);
    expect(s.cols).toBe(24);
    expect(s.rows).toBe(24);
    expect(s.cw).toBeCloseTo(40);
    expect(s.ch).toBeCloseTo(22.5);
  });

  it('bounds the cell size and never gives fewer than two cells', () => {
    expect(gridShape(960, 540, 1).cols).toBe(80);
    expect(gridShape(960, 540, 10000).cols).toBe(6);
    expect(gridShape(100, 100, 160).cols).toBe(2);
  });

  it('a 4K stage has more cells at the same cell size (D2)', () => {
    expect(gridShape(3840, 2160, 40).cols).toBe(96);
  });
});

describe('cellGridsOf', () => {
  it('reads each cell’s own colours', () => {
    const r = raster(48, 24, (x, y) => (x < 24 ? (y < 12 ? [255, 0, 0] : [0, 255, 0]) : y < 12 ? [0, 0, 255] : [9, 9, 9]));
    const cells = cellGridsOf(r, 2, 2);
    expect(cells.length).toBe(4 * GRID_BYTES);
    const mean = levelOf(cells, 4, 1);
    expect(Array.from(mean.slice(0, 3))).toEqual([255, 0, 0]);
    expect(Array.from(mean.slice(3, 6))).toEqual([0, 0, 255]);
    expect(Array.from(mean.slice(6, 9))).toEqual([0, 255, 0]);
    expect(Array.from(mean.slice(9, 12))).toEqual([9, 9, 9]);
  });
});

describe('matchCells', () => {
  const library = flatGrids([
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [250, 5, 5],
    [128, 128, 128],
  ]);

  it('gives each cell its nearest picture', () => {
    const cells = flatGrids([
      [240, 10, 10],
      [10, 240, 10],
      [10, 10, 240],
      [120, 130, 125],
    ]);
    const dims = dimsOf(1);
    const m = matchCells(levelOf(cells, 4, 1), levelOf(library, 5, 1), dims, 2, 2, { distinctNeighbours: false });
    expect(Array.from(m.ids)).toEqual([3, 1, 2, 4]);
    expect(m.dist[1]).toBeCloseTo(Math.sqrt((100 + 225 + 100) / 3), 5);
  });

  it('never repeats the left or upper neighbour when asked, and takes the second best instead', () => {
    const cells = flatGrids([
      [255, 0, 0],
      [255, 0, 0],
      [255, 0, 0],
      [255, 0, 0],
    ]);
    const dims = dimsOf(1);
    const plain = matchCells(levelOf(cells, 4, 1), levelOf(library, 5, 1), dims, 2, 2, { distinctNeighbours: false });
    expect(Array.from(plain.ids)).toEqual([0, 0, 0, 0]);
    const distinct = matchCells(levelOf(cells, 4, 1), levelOf(library, 5, 1), dims, 2, 2);
    expect(distinct.ids[0]).toBe(0);
    expect(distinct.ids[1]).toBe(3);
    expect(distinct.ids[2]).toBe(3);
    expect(distinct.ids[3]).not.toBe(distinct.ids[2]);
    expect(distinct.ids[3]).not.toBe(distinct.ids[1]);
  });

  it('leaves excluded pictures out and marks a cell with no candidate', () => {
    const cells = flatGrids([[255, 0, 0]]);
    const dims = dimsOf(1);
    const m = matchCells(levelOf(cells, 1, 1), levelOf(library, 5, 1), dims, 1, 1, { exclude: new Set([0, 3]) });
    expect(m.ids[0]).toBe(4);
    const none = matchCells(levelOf(cells, 1, 1), levelOf(library, 5, 1), dims, 1, 1, { exclude: new Set([0, 1, 2, 3, 4]) });
    expect(none.ids[0]).toBe(-1);
    expect(none.dist[0]).toBe(Infinity);
  });

  it('matches at level 2 in OKLab as well', () => {
    const target = raster(48, 48, (x) => (x < 24 ? [255, 0, 0] : [0, 0, 255]));
    const lib = new Uint8Array(2 * GRID_BYTES);
    lib.set(cellGridsOf(target, 1, 1), 0);
    lib.set(flatGrids([[0, 0, 255]]), GRID_BYTES);
    const cells = cellGridsOf(target, 1, 1);
    const m = matchCells(descriptorsOf(cells, 1, 2, 'oklab'), descriptorsOf(lib, 2, 2, 'oklab'), dimsOf(2), 1, 1);
    expect(m.ids[0]).toBe(0);
    expect(m.dist[0]).toBeCloseTo(0, 3);
  });
});

describe('pickCell', () => {
  const cols = 4;
  const rows = 4;
  const ids = new Int32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  const dist = new Float32Array(16).fill(5);

  it('is deterministic under one seed and never picks the target or the history', () => {
    const a = pickCell({ ids, dist }, cols, rows, { target: 5, history: [6, 9, 10], rnd: mulberry32(3) });
    const b = pickCell({ ids, dist }, cols, rows, { target: 5, history: [6, 9, 10], rnd: mulberry32(3) });
    expect(a).toBe(b);
    expect([5, 6, 9, 10]).not.toContain(ids[a]);
  });

  it('prefers the centre when every cell fits equally', () => {
    const picks = new Set<number>();
    for (let seed = 0; seed < 40; seed++) picks.add(pickCell({ ids, dist }, cols, rows, { target: -1, rnd: mulberry32(seed) }));
    for (const c of picks) expect([5, 6, 9, 10]).toContain(c);
  });

  it('prefers a better match over a central one', () => {
    const d = new Float32Array(16).fill(50);
    d[0] = 0;
    expect(pickCell({ ids, dist: d }, cols, rows, { target: -1, rnd: mulberry32(1), share: 0.05 })).toBe(0);
  });

  it('returns −1 when nothing qualifies', () => {
    expect(pickCell({ ids: new Int32Array([7, 7]), dist: new Float32Array(2) }, 2, 1, { target: 7, rnd: mulberry32(1) })).toBe(-1);
  });
});

describe('pickNextTarget', () => {
  it('finds the picture holding a zone close to the current picture’s colour', () => {
    const grids = new Uint8Array(4 * GRID_BYTES);
    grids.set(flatGrids([[200, 30, 30]]), 0);
    grids.set(flatGrids([[0, 0, 255]]), GRID_BYTES);
    grids.set(flatGrids([[0, 255, 0]]), 2 * GRID_BYTES);
    const mixed = flatGrids([[20, 20, 20]]);
    mixed[0] = 200;
    mixed[1] = 30;
    mixed[2] = 30;
    grids.set(mixed, 3 * GRID_BYTES);
    const lab = oklabOf(grids, 4);
    expect(pickNextTarget(lab, 4, 0, { rnd: mulberry32(2), tries: 60 })).toBe(3);
  });

  it('never answers the current picture nor the history, and −1 alone in the library', () => {
    const lab = oklabOf(flatGrids([[1, 1, 1], [2, 2, 2], [3, 3, 3]]), 3);
    for (let seed = 0; seed < 20; seed++) {
      const n = pickNextTarget(lab, 3, 1, { history: [2], rnd: mulberry32(seed) });
      expect(n).toBe(0);
    }
    expect(pickNextTarget(lab, 1, 0, { rnd: mulberry32(1) })).toBe(-1);
  });
});

describe('pickDive', () => {
  it('finds the picture whose mean sits in a cell of the current one', () => {
    const grids = new Uint8Array(4 * GRID_BYTES);
    // The current picture: dark, with one red cell.
    const current = flatGrids([[20, 20, 20]]);
    current[0] = 200;
    current[1] = 30;
    current[2] = 30;
    grids.set(current, 0);
    grids.set(flatGrids([[0, 0, 255]]), GRID_BYTES);
    grids.set(flatGrids([[0, 255, 0]]), 2 * GRID_BYTES);
    grids.set(flatGrids([[200, 30, 30]]), 3 * GRID_BYTES);
    const lab = oklabOf(grids, 4);
    expect(pickDive(lab, 4, 0, { rnd: mulberry32(2), tries: 60 })).toBe(3);
  });

  it('is deterministic, never the current nor the history, −1 alone', () => {
    const lab = oklabOf(flatGrids([[1, 1, 1], [2, 2, 2], [3, 3, 3]]), 3);
    for (let seed = 0; seed < 20; seed++) expect(pickDive(lab, 3, 1, { history: [2], rnd: mulberry32(seed) })).toBe(0);
    expect(pickDive(lab, 1, 0, { rnd: mulberry32(1) })).toBe(-1);
    expect(pickDive(lab, 3, 0, { rnd: mulberry32(9) })).toBe(pickDive(lab, 3, 0, { rnd: mulberry32(9) }));
  });
});

describe('forceInto', () => {
  it('puts the picture in the cell that resembles it most and leaves the matching untouched', () => {
    const cells = levelOf(flatGrids([[255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 0, 0]]), 4, 1);
    const pictures = levelOf(flatGrids([[255, 255, 255], [0, 10, 250]]), 2, 1);
    const m = { ids: new Int32Array([0, 0, 0, 0]), dist: new Float32Array(4) };
    const { ids, cell } = forceInto(m, cells, pictures, 3, 1);
    expect(cell).toBe(2);
    expect(Array.from(ids)).toEqual([0, 0, 1, 0]);
    expect(Array.from(m.ids)).toEqual([0, 0, 0, 0]);
  });
});

describe('cellMeansLab', () => {
  it('gives one OKLab colour per cell', () => {
    const out = cellMeansLab(flatGrids([[255, 255, 255], [0, 0, 0]]), 2);
    expect(out.length).toBe(6);
    expect(out[0]).toBeCloseTo(100, 0);
    expect(out[3]).toBeCloseTo(0, 1);
  });
});

describe('matchLot', () => {
  const library = flatGrids([
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [250, 5, 5],
    [128, 128, 128],
  ]);
  const red4 = levelOf(flatGrids([[255, 0, 0], [255, 0, 0], [255, 0, 0], [255, 0, 0]]), 4, 1);
  const lib = levelOf(library, 5, 1);

  it('lot by lot in top-down order gives exactly what one block gives', () => {
    const whole = matchCells(red4, lib, 3, 2, 2);
    const known = new Int32Array(4).fill(-1);
    for (const lot of [[0, 1], [2, 3]]) {
      const m = matchLot(red4, lib, 3, 2, lot, known);
      lot.forEach((c, k) => (known[c] = m.ids[k]));
    }
    expect(Array.from(known)).toEqual(Array.from(whole.ids));
  });

  it('reads the neighbours already decided on every side, and its own earlier cells', () => {
    const known = new Int32Array([-1, 0, 0, -1]);
    const m = matchLot(red4, lib, 3, 2, [0, 3], known);
    expect(m.ids[0]).toBe(3);
    expect(m.ids[1]).toBe(3);
    expect(matchLot(red4, lib, 3, 2, [0], known, { distinctNeighbours: false }).ids[0]).toBe(0);
  });
});
