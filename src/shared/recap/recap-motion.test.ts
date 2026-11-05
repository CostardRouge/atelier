import { describe, expect, it } from 'vitest';
import { createRecapDoc, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { layoutRecap, type CellPart } from './recap-layout';
import { cellLook, cellRanks, clipTime, filledOf, loopTime, pageAt, planFilm, textLook, zoomedBox } from './recap-motion';
import { resolveRecap } from './recap-slots';

const pic = (key: string, day: string, extra: Partial<RecapPicture> = {}): RecapPicture => ({ key, origin: 'local', name: key, kind: 'photo', day, ...extra });

describe('recap motion', () => {
  const doc = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
  const layout = layoutRecap(doc, resolveRecap(doc));
  const cells = layout.pages[0].parts.filter((p): p is CellPart => p.kind === 'cell');

  it('orders a wave from the top-left corner, columns by column, a seeded shuffle the same every time', () => {
    const wave = cellRanks(cells, 'wave', 1);
    expect(wave.get('2026-10-05')).toBe(0);
    expect(wave.get('2026-10-05')).toBeLessThan(wave.get('2026-10-04')!);
    const cols = cellRanks(cells, 'columns', 1);
    expect(cols.get('2026-10-05')).toBe(0);
    expect([...cellRanks(cells, 'random', 7)]).toEqual([...cellRanks(cells, 'random', 7)]);
    expect([...cellRanks(cells, 'random', 7)]).not.toEqual([...cellRanks(cells, 'random', 8)]);
    expect(new Set(cellRanks(cells, 'spiral', 1).values()).size).toBe(31);
  });

  it('plans the heading, the cells and the hold', () => {
    const plan = planFilm(doc, layout);
    const p = plan.pages[0];
    expect(p.heading?.at).toBeCloseTo(0.25);
    const last = Math.max(...[...p.cells.values()].map((s) => s.at + s.dur));
    expect(p.allOn).toBeCloseTo(last);
    expect(plan.total).toBeCloseTo(p.allOn + doc.motion.hold);
  });

  it('plays the clips in turn after everything is on, and stretches to the sound', () => {
    let d = withPictures(doc, [pic('a', '2026-10-09', { kind: 'video', duration: 3 }), pic('b', '2026-10-16', { kind: 'video', duration: 12 })]);
    const r = resolveRecap(d);
    const len = (slot: string) => r.slots.find((s) => s.id === slot)?.picture?.duration ?? null;
    let plan = planFilm(d, layoutRecap(d, r), len);
    const [wa] = plan.pages[0].clips.get('2026-10-09')!;
    const [wb] = plan.pages[0].clips.get('2026-10-16')!;
    expect(wa.from).toBeGreaterThanOrEqual(plan.pages[0].allOn);
    expect(wa.to - wa.from).toBeCloseTo(3);
    expect(wb.to - wb.from).toBeCloseTo(5);
    expect(wb.from).toBeGreaterThan(wa.to);
    expect(clipTime([wa], 3, wa.from + 1)).toBeCloseTo(1);
    expect(clipTime([wa], 3, wa.to + 1)).toBeNull();
    d = withRecap(d, { sound: { name: 's.m4a', gain: 1, fade: 1, fit: true, seconds: 4 } });
    plan = planFilm(d, layoutRecap(d, r), len);
    expect(plan.total % 4).toBeCloseTo(0);
  });

  it('draws each entrance from nothing to fully on', () => {
    const span = { at: 1, dur: 1 };
    for (const e of ['fade', 'slide', 'pop', 'drop', 'develop', 'flicker'] as const) {
      expect(cellLook(e, span, 0.5).alpha).toBe(0);
      expect(cellLook(e, span, 2.5)).toEqual({ alpha: 1, dx: 0, dy: 0, scale: 1, whiten: 0 });
    }
    expect(cellLook('develop', span, 1.3).whiten).toBeGreaterThan(0.3);
    expect(textLook('type', span, 1.5).chars).toBeCloseTo(0.5);
    expect(textLook('none', span, 0).alpha).toBe(1);
  });

  it('zooms a playing cell toward the middle and back', () => {
    const box = { x: 0, y: 0, w: 100, h: 80 };
    const w = { from: 0, to: 4 };
    expect(zoomedBox(box, 1080, 1920, w, 2).w).toBeGreaterThan(900);
    expect(zoomedBox(box, 1080, 1920, w, 4.5)).toEqual(box);
  });

  it('loops the background between its in and out points', () => {
    expect(loopTime({ loopIn: 2, loopOut: 6, speed: 1 }, 10, 5)).toBeCloseTo(3);
    expect(loopTime({ loopIn: 0, loopOut: null, speed: 0.5 }, 10, 22)).toBeCloseTo(1);
  });

  it('finds the page of a dump at a moment', () => {
    let d = withRecap(createRecapDoc('dump', 'local', { anchor: '2026-10-01', now: 1 }), { count: 6 });
    d = withPictures(d, Array.from({ length: 6 }, (_, i) => pic(`p${i}`, '2026-10-02')));
    const plan = planFilm(d, layoutRecap(d, resolveRecap(d)));
    expect(plan.pages.length).toBe(3);
    expect(pageAt(plan, plan.pages[1].start + 0.01)).toBe(1);
  });

  it('lets only the pictures enter: an empty day takes no turn and leaves no gap in the wave', () => {
    const d = withPictures(doc, [pic('a', '2026-10-01'), pic('b', '2026-10-30')]);
    const r = resolveRecap(d);
    const plan = planFilm(d, layoutRecap(d, r), () => null, filledOf(r)).pages[0];
    expect([...plan.cells.keys()]).toEqual(['2026-10-01', '2026-10-30']);
    const [a, b] = [plan.cells.get('2026-10-01')!, plan.cells.get('2026-10-30')!];
    expect(b.at - a.at).toBeCloseTo(d.motion.stagger);
  });
});
