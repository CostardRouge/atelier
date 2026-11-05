import { describe, expect, it } from 'vitest';
import { createRecapDoc, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { carouselSlides, layoutRecap } from './recap-layout';
import { arrangeSheet, readSheet, sheetSlides, sheetView, SHEET_ARRANGEMENTS, type SheetArea, type SheetItem } from './recap-sheet';
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
      const laid = arrangeSheet(list, area(5), arrangement);
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
    const laid = arrangeSheet(items(22, () => 0), area(5), 'rows');
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
    expect(readSheet({ arrangement: 'film', slides: 40, camera: 'glide' })).toEqual({ arrangement: 'film', slides: 10, camera: 'glide' });
    expect(readSheet(null)).toEqual({ arrangement: 'rows', slides: null, camera: 'stops' });
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
});
