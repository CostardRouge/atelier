import { describe, expect, it } from 'vitest';
import {
  cellAt,
  cellCount,
  normaliseCellPlace,
  normaliseSpacing,
  parseAreas,
  resolveLayout,
  type CellRect,
  type LayoutTemplate,
} from './media-layout';
import { LAYOUT_TEMPLATES, isLayoutId, layoutCellCount, layoutTemplate } from './layout-templates';

const NO_SPACING = { gap: 0, padding: 0, radius: 0 };

describe('parseAreas', () => {
  it('reads boxes in reading order, letter order being the cell order', () => {
    const boxes = parseAreas('a a b / a a c / d d c');
    expect(boxes?.map((b) => b.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(boxes?.[0]).toEqual({ id: 'a', r0: 0, r1: 1, c0: 0, c1: 1 });
    expect(boxes?.[2]).toEqual({ id: 'c', r0: 1, r1: 2, c0: 2, c1: 2 });
  });

  it('skips a dot as an empty track cell', () => {
    expect(parseAreas('a . / . b')?.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('refuses ragged rows, an empty string and a non-rectangular area', () => {
    expect(parseAreas('a b / c')).toBeNull();
    expect(parseAreas('')).toBeNull();
    expect(parseAreas('. .')).toBeNull();
    // An L-shaped 'a' is not one rectangle: refused, never guessed.
    expect(parseAreas('a a / a b')).toBeNull();
  });
});

describe('resolveLayout · tracks', () => {
  it('cuts a 2 × 2 grid with gap and padding in short-side fractions', () => {
    const t: LayoutTemplate = { kind: 'tracks', cols: [1, 1], rows: [1, 1], areas: 'a b / c d' };
    const cells = resolveLayout(t, 1000, 2000, { gap: 0.02, padding: 0.05, radius: 0 });
    // short side 1000: gap 20, padding 50.
    expect(cells).toHaveLength(4);
    expect(cells[0]).toMatchObject({ x: 50, y: 50, w: 440, h: 940, rotation: 0, mount: 'none' });
    expect(cells[1]).toMatchObject({ x: 510, y: 50, w: 440, h: 940 });
    expect(cells[3]).toMatchObject({ x: 510, y: 1010, w: 440, h: 940 });
  });

  it('spans an area over the tracks it names, gaps included', () => {
    const t: LayoutTemplate = { kind: 'tracks', cols: [1, 1, 1], rows: [1, 1, 1], areas: 'a a b / a a c / d d c' };
    const [a, b, c, d] = resolveLayout(t, 900, 900, { gap: 0.1, padding: 0, radius: 0 });
    // Tracks are (900 − 2·90) / 3 = 240 wide, 90 apart.
    expect(a).toMatchObject({ x: 0, y: 0, w: 570, h: 570 });
    expect(b).toMatchObject({ x: 660, y: 0, w: 240, h: 240 });
    expect(c).toMatchObject({ x: 660, y: 330, w: 240, h: 570 });
    expect(d).toMatchObject({ x: 0, y: 660, w: 570, h: 240 });
  });

  it('shares a track by weight', () => {
    const t: LayoutTemplate = { kind: 'tracks', cols: [1], rows: [3, 2], areas: 'a / b' };
    const [a, b] = resolveLayout(t, 500, 1000, NO_SPACING);
    expect(a.h).toBeCloseTo(600);
    expect(b.y).toBeCloseTo(600);
    expect(b.h).toBeCloseTo(400);
  });

  it('resolves to the same fractions at the stage size and the export size', () => {
    const t = layoutTemplate('bento-six')!.template;
    const small = resolveLayout(t, 405, 720);
    const big = resolveLayout(t, 1215, 2160);
    small.forEach((c, i) => {
      expect(big[i].x / 3).toBeCloseTo(c.x, 6);
      expect(big[i].y / 3).toBeCloseTo(c.y, 6);
      expect(big[i].w / 3).toBeCloseTo(c.w, 6);
      expect(big[i].h / 3).toBeCloseTo(c.h, 6);
    });
  });

  it('yields no cells for a template whose areas do not parse', () => {
    const t: LayoutTemplate = { kind: 'tracks', cols: [1, 1], rows: [1], areas: 'a a / a b' };
    expect(resolveLayout(t, 100, 100)).toEqual([]);
    expect(cellCount(t)).toBe(0);
  });
});

describe('resolveLayout · inset and free', () => {
  it('lays an inset in its corner over the full cell, framed', () => {
    const t: LayoutTemplate = { kind: 'inset', insets: [{ corner: 'br', width: 0.5, aspect: 1 }] };
    const [full, pip] = resolveLayout(t, 1000, 2000, NO_SPACING);
    expect(full).toMatchObject({ x: 0, y: 0, w: 1000, h: 2000, mount: 'none' });
    expect(pip).toMatchObject({ w: 500, h: 500, mount: 'stroke' });
    // margin = max(gap 0, 3.5% of the short side) = 35
    expect(pip.x).toBeCloseTo(1000 - 35 - 500);
    expect(pip.y).toBeCloseTo(2000 - 35 - 500);
  });

  it('places a print at its centre, turned, and moves it by its place', () => {
    const t: LayoutTemplate = {
      kind: 'free',
      prints: [{ cx: 0.5, cy: 0.5, width: 0.5, aspect: 1, rotation: -6 }],
    };
    const [rest] = resolveLayout(t, 1000, 2000, NO_SPACING);
    expect(rest).toMatchObject({ x: 250, y: 750, w: 500, h: 500, rotation: -6, mount: 'print' });
    const [moved] = resolveLayout(t, 1000, 2000, NO_SPACING, [{ dx: 0.1, dy: -0.1, rotation: 4 }]);
    expect(moved.x).toBeCloseTo(350);
    expect(moved.y).toBeCloseTo(550);
    expect(moved.rotation).toBe(-2);
  });

  it('caps a print at a third of the frame height, keeping its shape', () => {
    const t: LayoutTemplate = {
      kind: 'free',
      prints: [{ cx: 0.5, cy: 0.5, width: 0.9, aspect: 0.5, rotation: 0 }],
    };
    const [p] = resolveLayout(t, 1000, 1000, NO_SPACING);
    expect(p.h).toBeCloseTo(360);
    expect(p.w).toBeCloseTo(180);
  });

  it('ignores a place kept from a bigger layout', () => {
    const t = layoutTemplate('prints-3')!.template;
    const places = [null, null, null, { dx: 0.3, dy: 0.3, rotation: 10 }];
    expect(resolveLayout(t, 900, 1600, NO_SPACING, places)).toHaveLength(3);
  });
});

describe('the registry', () => {
  const inside = (c: CellRect, w: number, h: number) =>
    c.x >= -1e-6 && c.y >= -1e-6 && c.x + c.w <= w + 1e-6 && c.y + c.h <= h + 1e-6;

  it('resolves every template inside a 9:16, a 4:5 and a 1:1 frame', () => {
    for (const { id, template } of LAYOUT_TEMPLATES) {
      for (const [w, h] of [
        [1080, 1920],
        [1080, 1350],
        [1080, 1080],
      ]) {
        const cells = resolveLayout(template, w, h);
        expect(cells.length, id).toBe(cellCount(template));
        expect(cells.length, id).toBeGreaterThan(1);
        for (const c of cells) {
          expect(c.w, id).toBeGreaterThan(0);
          expect(c.h, id).toBeGreaterThan(0);
          // A tilted print's corners may poke out; its box must not.
          if (template.kind !== 'free') expect(inside(c, w, h), `${id} at ${w}×${h}`).toBe(true);
        }
      }
    }
  });

  it('has unique ids and answers them', () => {
    const ids = LAYOUT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isLayoutId('bento-six')).toBe(true);
    expect(isLayoutId('bento-seven')).toBe(false);
    expect(layoutCellCount('grid-3x3')).toBe(9);
    expect(layoutCellCount('nope')).toBe(0);
    expect(layoutTemplate(undefined)).toBeNull();
  });
});

describe('cellAt', () => {
  it('finds the cell under a point, the last drawn winning', () => {
    const t = layoutTemplate('inset-1')!.template;
    const cells = resolveLayout(t, 1000, 2000, NO_SPACING);
    expect(cellAt(cells, 10, 10)).toBe(0);
    expect(cellAt(cells, 900, 1900)).toBe(1);
    expect(cellAt(cells, -5, 10)).toBe(-1);
  });

  it('honours a print\'s tilt', () => {
    const cells: CellRect[] = [{ x: 0, y: 0, w: 100, h: 20, rotation: 90, mount: 'print' }];
    // Turned a quarter, the box stands 20 wide and 100 tall about (50, 10).
    expect(cellAt(cells, 50, 55)).toBe(0);
    expect(cellAt(cells, 95, 10)).toBe(-1);
  });
});

describe('normalisers', () => {
  it('reads a spacing out of junk and clamps it', () => {
    expect(normaliseSpacing(undefined)).toEqual({ gap: 0.012, padding: 0.016, radius: 0.016 });
    expect(normaliseSpacing({ gap: -1, padding: 9, radius: 'x' })).toEqual({
      gap: 0,
      padding: 0.2,
      radius: 0.016,
    });
  });

  it('clamps a place to what a print may travel', () => {
    expect(normaliseCellPlace({ dx: 2, dy: -2, rotation: 90 })).toEqual({ dx: 0.4, dy: -0.4, rotation: 30 });
    expect(normaliseCellPlace(null)).toEqual({ dx: 0, dy: 0, rotation: 0 });
  });
});
