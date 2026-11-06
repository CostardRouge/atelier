import { describe, expect, it } from 'vitest';
import { recordingContext } from '../story/recording-context';
import { createRecapDoc, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { clipSlideNumbers, layoutRecap } from './recap-layout';
import { filledOf, planFilm } from './recap-motion';
import { exifLine, isLightGround, paintRecap, type PaintSources } from './recap-paint';
import { resolveRecap } from './recap-slots';

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
