import { describe, expect, it } from 'vitest';
import { RULER_MAX_TICKS, rulerFraction, rulerIndex, rulerKey, rulerTicks, rulerWindow } from './roll-ruler';

describe('rulerIndex', () => {
  it('gives each picture an even share of the width', () => {
    expect(rulerIndex(0, 240, 24)).toBe(0);
    expect(rulerIndex(9.9, 240, 24)).toBe(0);
    expect(rulerIndex(10, 240, 24)).toBe(1);
    expect(rulerIndex(239.9, 240, 24)).toBe(23);
  });

  it('clamps a finger past either end', () => {
    expect(rulerIndex(-30, 240, 24)).toBe(0);
    expect(rulerIndex(400, 240, 24)).toBe(23);
  });

  it('answers -1 when there is nothing to land on', () => {
    expect(rulerIndex(10, 240, 0)).toBe(-1);
    expect(rulerIndex(10, 0, 24)).toBe(-1);
  });
});

describe('rulerFraction', () => {
  it('puts a picture in the middle of its share, and back again', () => {
    expect(rulerFraction(0, 4)).toBe(0.125);
    expect(rulerFraction(3, 4)).toBe(0.875);
    for (let i = 0; i < 24; i++) expect(rulerIndex(rulerFraction(i, 24) * 240, 240, 24)).toBe(i);
  });
});

describe('rulerTicks', () => {
  it('draws ticks up to the cap and a track past it', () => {
    expect(rulerTicks(1)).toBe(true);
    expect(rulerTicks(RULER_MAX_TICKS)).toBe(true);
    expect(rulerTicks(RULER_MAX_TICKS + 1)).toBe(false);
    expect(rulerTicks(0)).toBe(false);
  });
});

describe('rulerKey', () => {
  it('steps one picture and stops at the ends', () => {
    expect(rulerKey('ArrowRight', 3, 24)).toBe(4);
    expect(rulerKey('ArrowLeft', 0, 24)).toBe(0);
    expect(rulerKey('ArrowRight', 23, 24)).toBe(23);
    expect(rulerKey('Home', 12, 24)).toBe(0);
    expect(rulerKey('End', 2, 24)).toBe(23);
    expect(rulerKey('a', 2, 24)).toBeNull();
  });

  it('starts from the first picture when none is open', () => {
    expect(rulerKey('ArrowRight', -1, 5)).toBe(1);
  });
});

describe('rulerWindow', () => {
  // A row of 84 px cells, 5 px apart: the phone's band.
  const row = Array.from({ length: 24 }, (_, i) => ({ x: 6 + i * 89, y: 6, w: 84, h: 56 }));

  it('names the cells at least half on screen', () => {
    expect(rulerWindow(row, 0, 369, 'x')).toEqual([0, 3]);
    // Scrolled 100 px: the first cell is mostly gone, the fifth mostly in.
    expect(rulerWindow(row, 100, 369, 'x')).toEqual([1, 4]);
  });

  it('reaches the last cell at the end of the row', () => {
    const end = row[23].x + 84 + 6 - 369;
    expect(rulerWindow(row, end, 369, 'x')).toEqual([20, 23]);
  });

  it('reads a grid down its rows', () => {
    const grid = Array.from({ length: 12 }, (_, i) => ({ x: (i % 4) * 89, y: Math.floor(i / 4) * 61, w: 84, h: 56 }));
    expect(rulerWindow(grid, 61, 122, 'y')).toEqual([4, 11]);
  });

  it('answers null before the box is measured or with nothing in view', () => {
    expect(rulerWindow(row, 0, 0, 'x')).toBeNull();
    expect(rulerWindow([], 0, 369, 'x')).toBeNull();
  });
});
