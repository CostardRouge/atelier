import { describe, expect, it } from 'vitest';
import { createRecapDoc, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { carouselSlides, layoutRecap } from './recap-layout';
import { arrangeSheet, DEFAULT_SHEET, readSheet, sheetSlides, sheetView, SHEET_ARRANGEMENTS, type SheetArea, type SheetItem } from './recap-sheet';
import { resolveRecap } from './recap-slots';

const W = 1080;
const H = 1350;
const area = (slides: number): SheetArea => ({ slides, W, H, x0: 600, x1: slides * W - 60, y0: 120, y1: H - 120, gap: 12, rows: 2 });
const items = (n: number, faces: (i: number) => number = (i) => (i % 3 === 1 ? 1 : 0)): SheetItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `n:${i}`, aspect: [1.5, 0.75, 1, 1.33][i % 4], faces: faces(i), when: i / n }));
const across = (b: { x: number; w: number }, c: number) => b.x < c - 0.5 && b.x + b.w > c + 0.5;

describe('the Sheets', () => {
  it('cuts every arrangement with no face on a cut and one picture at most per cut', () => {
    for (const arrangement of SHEET_ARRANGEMENTS) {
      const list = items(22);
      const laid = arrangeSheet(list, area(5), { ...DEFAULT_SHEET, arrangement });
      expect(laid.boxes).toHaveLength(22);
      const faces = new Map(list.map((i) => [i.id, i.faces]));
      for (const c of laid.cuts) {
        const on = laid.boxes.filter((b) => across(b, c));
        expect(on.length, `${arrangement} at ${c}`).toBeLessThanOrEqual(1);
        expect(on.every((b) => faces.get(b.id) === 0), `${arrangement} face at ${c}`).toBe(true);
      }
    }
  });

  it('runs rows the sheet’s whole length, in time order', () => {
    const laid = arrangeSheet(items(22, () => 0), area(5), DEFAULT_SHEET);
    const right = Math.max(...laid.boxes.map((b) => b.x + b.w));
    expect(right).toBeCloseTo(5 * W - 60, 0);
    expect(Math.min(...laid.boxes.map((b) => b.x))).toBeCloseTo(600, 0);
    // Some picture crosses a cut: the point of a sheet.
    expect(laid.cuts.some((c) => laid.boxes.some((b) => across(b, c)))).toBe(true);
  });

  it('counts its slides from the pictures, or takes the count set', () => {
    expect(sheetSlides(20, null)).toBe(5);
    expect(sheetSlides(3, null)).toBe(2);
    expect(sheetSlides(200, null)).toBe(10);
    expect(sheetSlides(20, 8)).toBe(8);
    expect(readSheet({ arrangement: 'film', slides: 40, camera: 'glide' })).toMatchObject({ arrangement: 'film', slides: 10, camera: 'glide' });
    expect(readSheet(null)).toEqual(DEFAULT_SHEET);
    const r = readSheet({ rows: { rows: 9, big: true }, collage: { tilt: 40, border: 'nope' }, own: { '0': { layout: 'hero' }, '2': { layout: 'pair' }, '3': { layout: 'breather', text: ' the light ' }, '4': { layout: 'x' } } });
    expect(r.rows).toMatchObject({ rows: 4, big: true });
    expect(r.collage).toMatchObject({ tilt: 12, border: 'white' });
    expect(Object.keys(r.own)).toEqual(['2', '3']);
  });

  it('moves the Reel’s camera: a hold then a glide, or one travelling shot', () => {
    const pages = [{ start: 0, length: 3 }, { start: 3, length: 2 }, { start: 5, length: 2 }];
    expect(sheetView(pages, 7, 1, 'stops')).toEqual({ page: 0, frac: 0 });
    expect(sheetView(pages, 7, 2.65, 'stops').frac).toBeCloseTo(0.5, 1);
    expect(sheetView(pages, 7, 6, 'stops')).toEqual({ page: 2, frac: 0 });
    expect(sheetView(pages, 7, 3.5, 'glide')).toEqual({ page: 1, frac: 0 });
  });

  it('slices the sheet into pages, a picture across a cut on both', () => {
    const pics: RecapPicture[] = Array.from({ length: 20 }, (_, i) => ({ key: `p${i}`, origin: 'local', name: `p${i}`, kind: 'photo', day: `2026-10-${String(i + 1).padStart(2, '0')}`, width: i % 2 ? 1200 : 800, height: 900 }));
    let doc = createRecapDoc('sheets', 'local', { anchor: '2026-10-01', now: 1 });
    doc = withRecap(withPictures(doc, pics), { range: { from: '2026-10-01', to: '2026-10-31' } });
    const r = resolveRecap(doc);
    const layout = layoutRecap(doc, r);
    expect(layout.pages.map((p) => p.key)).toEqual(['s:0', 's:1', 's:2', 's:3', 's:4']);
    const seen = layout.pages.flatMap((p) => p.parts.flatMap((q) => (q.kind === 'cell' ? [q.id] : [])));
    expect(new Set(seen).size).toBe(20);
    expect(seen.length).toBeGreaterThan(20);
    // The title is the first slide's; an order asked for is not a sheet's.
    expect(layout.pages[0].parts.some((p) => p.kind === 'text' && p.role === 'heading')).toBe(true);
    const moved = withRecap(doc, { carousel: { ...doc.carousel, order: ['s:3', 's:0'] } });
    expect(carouselSlides(moved, r, layoutRecap(moved, r)).map((s) => s.key)).toEqual(['s:0', 's:1', 's:2', 's:3', 's:4']);
  });

  it('lets a slide keep its own layout: the arrangement stops at its cuts, its pictures flow on', () => {
    const list = items(22, () => 0);
    const sheet = { ...DEFAULT_SHEET, own: { '2': { layout: 'hero' as const }, '3': { layout: 'breather' as const, text: 'the light' } } };
    const laid = arrangeSheet(list, area(5), sheet);
    expect(laid.boxes).toHaveLength(22);
    // The hero fills slide 2 edge to edge; nothing else enters slides 2 and 3.
    const inSlide = (i: number) => laid.boxes.filter((b) => b.x < (i + 1) * W - 1 && b.x + b.w > i * W + 1);
    expect(inSlide(2)).toHaveLength(1);
    expect(inSlide(2)[0]).toMatchObject({ x: 2 * W, w: W, y: 0, h: H });
    expect(inSlide(3)).toHaveLength(0);
    expect(laid.own).toEqual([{ index: 2, layout: 'hero' }, { index: 3, layout: 'breather', text: 'the light' }]);
    // Time still reads left to right: the hero is the picture after those before it.
    const order = laid.boxes.slice().sort((a, b) => a.x - b.x).map((b) => b.id);
    expect(order.indexOf(inSlide(2)[0].id)).toBeGreaterThan(0);
  });

  it('follows each arrangement’s settings', () => {
    const list = items(16, () => 0);
    const rowsY = (sheet: typeof DEFAULT_SHEET) => [...new Set(arrangeSheet(list, area(4), sheet).boxes.map((b) => Math.round(b.y)))].length;
    expect(rowsY({ ...DEFAULT_SHEET, rows: { ...DEFAULT_SHEET.rows, rows: 3 } })).toBe(3);
    const big = arrangeSheet(list, area(4), { ...DEFAULT_SHEET, rows: { ...DEFAULT_SHEET.rows, rows: 2, big: true } }).boxes;
    expect(Math.max(...big.map((b) => b.h))).toBeCloseTo(2 * Math.min(...big.map((b) => b.h)), 0);
    const film = arrangeSheet(list, area(4), { ...DEFAULT_SHEET, arrangement: 'film', film: { ...DEFAULT_SHEET.film, strips: 2, shape: '1:1' } });
    expect(film.decor.filter((d) => d.kind === 'band')).toHaveLength(2);
    expect(film.decor.some((d) => d.kind === 'marks' && d.marks.length === 16)).toBe(true);
    const tl = arrangeSheet(list, area(4), { ...DEFAULT_SHEET, arrangement: 'timeline', timeline: { ...DEFAULT_SHEET.timeline, sides: 'one', days: false } });
    const line = tl.decor.find((d) => d.kind === 'line');
    expect(line && line.kind === 'line' && tl.boxes.every((b) => b.y + b.h <= line.y)).toBe(true);
    expect(tl.decor.some((d) => d.kind === 'marks')).toBe(false);
  });
});

