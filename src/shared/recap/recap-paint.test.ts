import { describe, expect, it } from 'vitest';
import { recordingContext } from '../story/recording-context';
import { createRecapDoc, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { clipSlideNumbers, layoutRecap, runSegments } from './recap-layout';
import { PIN } from './recap-places';
import { filledOf, planFilm } from './recap-motion';
import { exifLine, isLightGround, paintRecap, type PaintSources } from './recap-paint';
import { ownSlots, resolveRecap } from './recap-slots';

const pic = (key: string, day: string, extra: Partial<RecapPicture> = {}): RecapPicture => ({ key, origin: 'local', name: key, kind: 'photo', day, ...extra });
const still = { image: {} as CanvasImageSource, width: 400, height: 300 };
const sources: PaintSources = { still: () => still };

function paint(doc: ReturnType<typeof createRecapDoc>, t: number, editing = false) {
  const resolved = resolveRecap(doc);
  const layout = layoutRecap(doc, resolved, '2026-10-14');
  const film = planFilm(doc, layout, (slot) => resolved.slots.find((s) => s.id === slot)?.picture?.duration ?? null, filledOf(resolved));
  const rec = recordingContext(1080, 1920);
  paintRecap(rec.ctx, 1080, doc, resolved, layout, film, sources, { t, page: 0, editing, clipSlides: clipSlideNumbers(doc, resolved, layout) });
  return { ...rec, film };
}

describe('recap painter', () => {
  let doc = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
  doc = withPictures(doc, [pic('a', '2026-10-02'), pic('b', '2026-10-09', { kind: 'video', duration: 3 }), pic('c', '2026-10-20')]);

  it('paints nothing of the cells before they enter, everything once on', () => {
    const early = paint(doc, 0);
    expect(early.ops.filter((o) => o.startsWith('image'))).toHaveLength(0);
    const { ops, texts, film } = paint(doc, 99);
    expect(film.total).toBeGreaterThan(1);
    expect(ops.filter((o) => o.startsWith('image'))).toHaveLength(3);
    expect(texts).toContain('OCTOBER');
    expect(texts).toContain('2026 · 3 DAYS · 3 SHOTS');
    expect(texts).toContain('▶ 2');
    expect(texts).toContain('MONDAY');
  });

  it('numbers the empty days as the recap asks', () => {
    const shown = paint(doc, 99).texts.filter((s) => /^\d+$/.test(s));
    expect(shown).toContain('5');
    const hidden = paint(withRecap(doc, { cells: { ...doc.cells, empty: 'hidden' } }), 99).texts.filter((s) => /^\d+$/.test(s));
    expect(hidden).not.toContain('5');
    expect(hidden).toContain('2');
  });

  it('knows a light ground from a dark one', () => {
    expect(isLightGround(withRecap(doc, { background: { ...doc.background, kind: 'paper' } }))).toBe(true);
    expect(isLightGround(withRecap(doc, { background: { ...doc.background, kind: 'colour', colour: '#202020' } }))).toBe(false);
  });

  it('writes the camera’s line', () => {
    expect(exifLine(pic('x', 'd', { device: 'ILCE-7M4', focal: 35, fNumber: 1.8, shutter: '1/250', iso: 100 }), { 'ILCE-7M4': 'Sony' })).toBe('Sony · 35 mm · f/1.8 · 1/250 · ISO 100');
  });
});

describe('the place pin on the cells', () => {
  let doc = createRecapDoc('grid', 'local', { anchor: '2026-10-01', now: 1 });
  doc = withRecap(doc, { grid: '2x2', range: { from: '2026-10-01', to: '2026-10-31' } });
  doc = withPictures(doc, [
    pic('a', '2026-10-02', { place: 'Esperance' }),
    pic('b', '2026-10-05', { place: 'Esperance' }),
    pic('c', '2026-10-09', { place: 'Albany', region: 'Western Australia' }),
    pic('d', '2026-10-20'),
  ]);

  it('says nothing until asked, then the town where the place changes', () => {
    expect(paint(doc, 99).texts).not.toContain('Esperance');
    const on = paint(withRecap(doc, { places: { ...doc.places, cells: 'changes' } }), 99).texts;
    expect(on.filter((s) => s === 'Esperance')).toHaveLength(1);
    expect(on).toContain('Albany');
    const every = paint(withRecap(doc, { places: { ...doc.places, cells: 'every' } }), 99).texts;
    expect(every.filter((s) => s === 'Esperance')).toHaveLength(2);
  });
});

describe('runs of days and the place in a title', () => {
  const towns = ['Esperance', 'Esperance', 'Esperance', 'Albany', 'Albany', 'Albany', 'Albany', 'Albany', 'Albany', 'Albany', 'Perth'];
  let doc = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
  // October 2026 starts on a Thursday: days 1–4 on the first row (weeks from Monday), 5–11 on the second.
  doc = withPictures(doc, towns.map((place, i) => pic(`p${i}`, `2026-10-${String(i + 1).padStart(2, '0')}`, { place })));

  it('cuts each run into its rows, its words on one stretch', () => {
    const resolved = resolveRecap(doc);
    expect(runSegments(ownSlots(resolved), 3).map((r) => [r.from, r.to, r.row, r.label])).toEqual([
      ['2026-10-01', '2026-10-03', 0, 'Esperance · 1–3'],
      // Albany's first stretch is one day (Sunday 4): its words go on the next.
      ['2026-10-04', '2026-10-04', 0, null],
      ['2026-10-05', '2026-10-10', 1, 'Albany · 4–10'],
      ['2026-10-11', '2026-10-11', 1, 'Perth · 11'],
    ]);
  });

  it('draws the runs only when he turns them on', () => {
    expect(layoutRecap(doc, resolveRecap(doc), '2026-10-14').pages[0].runs).toBeUndefined();
    const on = withRecap(doc, { places: { ...doc.places, runs: true } });
    expect(layoutRecap(on, resolveRecap(on), '2026-10-14').pages[0].runs).toHaveLength(4);
    expect(paint(on, 99).texts).toContain('Albany · 4–10');
  });

  it('fills {place} with the pin and {places} with the route', () => {
    const titled = withRecap(doc, { heading: { text: '{place}', show: true }, subheading: { text: '{places}', show: true } });
    const resolved = resolveRecap(titled);
    expect(resolved.vars.place).toBe(`${PIN}Albany`);
    expect(resolved.vars.places).toBe('Esperance → Albany → Perth');
    const { texts } = paint(titled, 99);
    // The pin is drawn, not written: the words alone reach the canvas.
    expect(texts).toContain('ALBANY');
    expect(texts.some((t) => t.includes(PIN))).toBe(false);
    const bare = withRecap(titled, { places: { ...titled.places, titlePin: false } });
    expect(resolveRecap(bare).vars.place).toBe('Albany');
  });
});
