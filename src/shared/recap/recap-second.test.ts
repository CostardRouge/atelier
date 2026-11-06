import { describe, expect, it } from 'vitest';
import { recordingContext } from '../story/recording-context';
import { createRecapDoc, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { layoutRecap } from './recap-layout';
import { clipTime, filledOf, pageAt, planFilm } from './recap-motion';
import { paintRecap } from './recap-paint';
import { pushIn, secondIn } from './recap-second';
import { resolveRecap, templateDays } from './recap-slots';

const pic = (key: string, day: string, extra: Partial<RecapPicture> = {}): RecapPicture => ({ key, origin: 'local', name: key, kind: 'photo', day, minute: 720, ...extra });

const second = () => {
  const d = withRecap(createRecapDoc('second', 'local', { now: 1 }), { range: { from: '2026-10-01', to: '2026-10-10' } });
  return withPictures(d, [
    pic('s1', '2026-10-01', { stars: 5 }),
    pic('c1', '2026-10-01', { kind: 'video', duration: 6 }),
    pic('s3', '2026-10-03'),
    pic('s4', '2026-10-04', { picked: true }),
    pic('s7', '2026-10-07'),
  ]);
};

describe('one second a day', () => {
  it('has a slot per day of its period, a clip first, and a page per day that has a picture', () => {
    const doc = second();
    expect(templateDays(doc)).toHaveLength(10);
    const r = resolveRecap(doc);
    expect(r.slots.find((s) => s.id === '2026-10-01')?.picture?.key).toBe('c1');
    const layout = layoutRecap(doc, r);
    expect(layout.pages.map((p) => p.key)).toEqual(['first', 'd:2026-10-03', 'd:2026-10-04', 'd:2026-10-07']);
    expect(layout.pages.every((p) => p.bleed)).toBe(true);
    const date = layout.pages[1].parts.find((p) => p.kind === 'text' && p.id.startsWith('date:'));
    expect(date && date.kind === 'text' && date.text).toBe('3 Oct');
  });

  it('lasts a second a day, cut on the frame, a clip playing its middle second', () => {
    const doc = second();
    const r = resolveRecap(doc);
    const layout = layoutRecap(doc, r);
    const film = planFilm(doc, layout, (slot) => r.slots.find((s) => s.id === slot)?.picture?.duration ?? null, filledOf(r));
    expect(film.total).toBeCloseTo(4);
    expect(film.pages.map((p) => p.start)).toEqual([0, 1, 2, 3]);
    expect(pageAt(film, 2.5)).toBe(2);
    const w = film.pages[0].clips.get('2026-10-01')!;
    expect(w[0].offset).toBeCloseTo(2.5);
    expect(clipTime(w, 6, 0.4)).toBeCloseTo(2.9);
    expect(secondIn(0.5, 1)).toBe(0);
    // A longer day, from the template's own setting.
    const slow = withRecap(doc, { motion: { ...doc.motion, hold: 2 } });
    expect(planFilm(slow, layout, () => null, filledOf(r)).total).toBeCloseTo(8);
  });

  it('keeps a first page with no picture yet', () => {
    const empty = withRecap(createRecapDoc('second', 'local', { now: 1 }), { range: { from: '2026-10-01', to: '2026-10-10' } });
    const layout = layoutRecap(empty, resolveRecap(empty));
    expect(layout.pages.map((p) => p.key)).toEqual(['first']);
  });

  it('pushes a still in through its second', () => {
    expect(pushIn(0)).toBe(1);
    expect(pushIn(1)).toBeCloseTo(1.05);
    expect(pushIn(0.5)).toBeGreaterThan(1.025);
    const doc = second();
    const r = resolveRecap(doc);
    const layout = layoutRecap(doc, r);
    const film = planFilm(doc, layout, () => null, filledOf(r));
    const rec = recordingContext(1080, 1920);
    paintRecap(rec.ctx, 1080, doc, r, layout, film, { still: () => ({ image: {} as CanvasImageSource, width: 1000, height: 1500 }) }, { t: 1.9, page: 1 });
    expect(rec.ops.some((o) => o.startsWith('image'))).toBe(true);
    expect(rec.texts.join(' ')).toMatch(/3 OCT/);
  });
});
