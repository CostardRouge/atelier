import { describe, expect, it } from 'vitest';
import { contactSheetLayout, sheetPage } from './contact-sheet';

describe('contactSheetLayout', () => {
  it('lays pictures in rows that fit the width', () => {
    const sheet = contactSheetLayout([1.5, 1.5, 1.5, 1.5, 1.5], 1000);
    expect(sheet.columns).toBe(2);
    expect(sheet.cells).toHaveLength(5);
    for (const c of sheet.cells) {
      expect(c.x + c.w).toBeLessThanOrEqual(1000);
      expect(c.y + c.h).toBeLessThanOrEqual(sheet.height);
    }
  });

  it('fits a portrait and a landscape inside the same box', () => {
    const [land, port] = contactSheetLayout([2, 0.5], 800, 2).cells;
    expect(land.image.w).toBe(land.w);
    expect(land.image.h).toBeLessThan(port.image.h);
    expect(port.image.w).toBeLessThan(port.w);
    expect(port.image.x).toBeGreaterThan(port.x);
  });

  it('reads a broken aspect as a landscape rather than dividing by it', () => {
    const [cell] = contactSheetLayout([0], 600, 1).cells;
    expect(cell.image.w).toBeGreaterThan(0);
    expect(Number.isFinite(cell.image.h)).toBe(true);
  });

  it('puts the label under the picture box, inside the cell', () => {
    const [cell] = contactSheetLayout([1], 400, 1).cells;
    expect(cell.label.y).toBeGreaterThan(cell.image.y + cell.image.h);
    expect(cell.label.y).toBeLessThanOrEqual(cell.y + cell.h);
  });
});

describe('sheetPage', () => {
  it('pages a long roll', () => {
    expect(sheetPage(100, 1, 48)).toEqual({ start: 0, end: 48, pages: 3 });
    expect(sheetPage(100, 3, 48)).toEqual({ start: 96, end: 100, pages: 3 });
  });

  it('keeps the page inside the roll', () => {
    expect(sheetPage(10, 9, 48)).toEqual({ start: 0, end: 10, pages: 1 });
    expect(sheetPage(0, 1, 48)).toEqual({ start: 0, end: 0, pages: 1 });
  });
});
