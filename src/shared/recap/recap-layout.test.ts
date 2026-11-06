import { describe, expect, it } from 'vitest';
import { createRecapDoc, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { clipSlideNumbers, dumpPages, hitTest, layoutRecap, type CellPart } from './recap-layout';
import { resolveRecap } from './recap-slots';

const pic = (key: string, day: string, extra: Partial<RecapPicture> = {}): RecapPicture => ({ key, origin: 'local', name: key, kind: 'photo', day, ...extra });
const cells = (parts: readonly { kind: string }[]) => parts.filter((p): p is CellPart => p.kind === 'cell');

describe('recap layout', () => {
  it('lays a month under its weekdays, inside the page and the Reel’s margins', () => {
    const doc = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
    const page = layoutRecap(doc, resolveRecap(doc), '2026-10-14').pages[0];
    const c = cells(page.parts);
    expect(c).toHaveLength(31);
    // 1 October 2026 is a Thursday: the fourth column.
    expect(c[0].col).toBe(3);
    expect(c[0].row).toBe(0);
    expect(c[30].row).toBe(4);
    expect(c.find((x) => x.id === '2026-10-14')?.today).toBe(true);
    for (const x of c) {
      expect(x.box.x).toBeGreaterThanOrEqual(0);
      expect(x.box.x + x.box.w).toBeLessThanOrEqual(1080.5);
      expect(x.box.y + x.box.h).toBeLessThanOrEqual(1920 * 0.84 + 1);
    }
    expect(page.parts.filter((p) => p.kind === 'text' && p.role === 'header')).toHaveLength(7);
  });

  it('fits every format', () => {
    for (const format of ['story', 'portrait', 'square'] as const) {
      for (const template of ['month', 'week', 'onThisDay', 'grid', 'single', 'dump'] as const) {
        const doc = withRecap(createRecapDoc(template, 'local', { anchor: '2026-10-01', now: 1 }), { format });
        for (const page of layoutRecap(doc, resolveRecap(doc)).pages) {
          for (const part of page.parts) {
            expect(part.box.w).toBeGreaterThan(0);
            expect(part.box.h).toBeGreaterThan(0);
            expect(part.box.y + part.box.h).toBeLessThanOrEqual(page.height + 1);
          }
        }
      }
    }
  });

  it('hits the heading over a cell, a cell, then the background', () => {
    const doc = createRecapDoc('single', 'local', { anchor: '2026-10-01', now: 1 });
    const page = layoutRecap(doc, resolveRecap(doc)).pages[0];
    const heading = page.parts.find((p) => p.kind === 'text' && p.role === 'heading')!;
    expect(hitTest(page, heading.box.x + 5, heading.box.y + 5)).toEqual({ kind: 'text', role: 'heading', id: 'heading' });
    expect(hitTest(page, 10, 10)).toEqual({ kind: 'cell', id: 'n:0' });
    const grid = createRecapDoc('grid', 'local', { anchor: '2026-10-01', now: 1 });
    expect(hitTest(layoutRecap(grid, resolveRecap(grid)).pages[0], 2, 2)).toEqual({ kind: 'background' });
  });

  it('spreads a dump over a cover and an editorial rhythm, never past twenty slides', () => {
    expect(dumpPages(1)).toEqual(['cover']);
    expect(dumpPages(9)).toEqual(['cover', 'oneTwo', 'full', 'four']);
    expect(dumpPages(6)).toEqual(['cover', 'oneTwo', 'two']);
    expect(dumpPages(240).length).toBe(20);
  });

  it('numbers the slides a clip plays on after the recap’s own pages', () => {
    let doc = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
    doc = withPictures(doc, [pic('a', '2026-10-09', { kind: 'video' }), pic('b', '2026-10-16', { kind: 'video' }), pic('c', '2026-10-17')]);
    const r = resolveRecap(doc);
    const slides = clipSlideNumbers(doc, r, layoutRecap(doc, r));
    expect([...slides]).toEqual([
      ['2026-10-09', 2],
      ['2026-10-16', 3],
    ]);
    expect(clipSlideNumbers(withRecap(doc, { clipSlides: false }), r, layoutRecap(doc, r)).size).toBe(0);
  });
});
