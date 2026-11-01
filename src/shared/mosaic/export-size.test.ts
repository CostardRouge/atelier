import { describe, expect, it } from 'vitest';
import { exportCellPx, exportSize } from './export-size';
import { MAX_CELL_PX, gridShape } from './match';

describe('an export’s size', () => {
  it('keeps the stage’s shape on the short side asked, both sides even', () => {
    expect(exportSize(960, 540, 1080)).toEqual({ w: 1920, h: 1080 });
    expect(exportSize(960, 540, 2160)).toEqual({ w: 3840, h: 2160 });
    // Upright: the short side is the width.
    expect(exportSize(540, 960, 720)).toEqual({ w: 720, h: 1280 });
    // An odd result is rounded to even — H.264 refuses odd sides.
    const odd = exportSize(1000, 3 * 333, 721);
    expect(odd.w % 2).toBe(0);
    expect(odd.h % 2).toBe(0);
    // No stage yet: a screen's shape.
    expect(exportSize(0, 0, 1080)).toEqual({ w: 1920, h: 1080 });
  });

  it('gives a bigger file more cells, or the stage’s cells drawn bigger up to a tile’s own width', () => {
    expect(exportCellPx('pixels', 40, 960, 540, 3840)).toBe(40);
    const screen = exportCellPx('screen', 40, 960, 540, 1920);
    expect(gridShape(1920, 1080, screen).cols).toBe(gridShape(960, 540, 40).cols);
    expect(exportCellPx('screen', 120, 960, 540, 3840)).toBe(MAX_CELL_PX);
  });
});
