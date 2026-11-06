import { describe, expect, it } from 'vitest';
import { recordingContext } from '../story/recording-context';
import { createRecapDoc, defaultTitle, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { layoutRecap, styleRoleOfText } from './recap-layout';
import { filledOf, planFilm } from './recap-motion';
import { paintRecap } from './recap-paint';
import { resolveRecap } from './recap-slots';
import { hourWord, wrappedStats } from './recap-wrapped';

const pic = (key: string, day: string, extra: Partial<RecapPicture> = {}): RecapPicture => ({ key, origin: 'local', name: key, kind: 'photo', day, ...extra });

const POOL: RecapPicture[] = [
  pic('a1', '2026-03-02', { device: 'ILCE-7M4', place: 'Albany', minute: 18 * 60 + 5 }),
  pic('a2', '2026-03-02', { device: 'ILCE-7M4', place: 'Albany', minute: 18 * 60 + 30, stars: 4 }),
  pic('a3', '2026-03-02', { device: 'iPhone 15 Pro', place: 'Albany', minute: 9 * 60 }),
  pic('b1', '2026-05-10', { device: 'ILCE-7M4', place: 'Esperance', minute: 18 * 60 + 10 }),
  pic('b2', '2026-06-11', { device: 'iPhone 15 Pro', place: 'Esperance', minute: 7 * 60, picked: true }),
  pic('c1', '2026-08-20', { device: 'ILCE-7M4', minute: 12 * 60, kind: 'video', duration: 4 }),
  pic('bg', '2026-08-21', { loose: true, kind: 'video' }),
];

describe('Wrapped', () => {
  it('counts the period: the busiest day, the camera, the place on the most days, the hour', () => {
    const s = wrappedStats(POOL);
    expect(s.shots).toBe(6);
    expect(s.clips).toBe(1);
    expect(s.days).toBe(4);
    expect(s.places).toBe(2);
    expect(s.busiest).toMatchObject({ day: '2026-03-02', count: 3 });
    expect(s.camera).toMatchObject({ device: 'ILCE-7M4', count: 4 });
    expect(s.camera!.share).toBeCloseTo(4 / 6);
    // Esperance on two days beats Albany's three pictures on one.
    expect(s.place).toMatchObject({ name: 'Esperance', days: 2, count: 2 });
    expect(s.hour).toMatchObject({ hour: 18, count: 3 });
    expect(hourWord(18)).toBe('6 pm');
    expect(hourWord(0)).toBe('12 am');
    expect(wrappedStats([pic('x', '2026-01-01')]).camera).toBeNull();
  });

  const doc = withPictures(withRecap(createRecapDoc('wrapped', 'local', { now: 1 }), { range: { from: '2026-01-01', to: '2026-12-31' }, count: 4 }), POOL);

  it('fills a slot per stat with the best of what it counts, never twice the same, then the rest', () => {
    const r = resolveRecap(doc);
    const byId = new Map(r.slots.map((s) => [s.id, s.picture?.key ?? null]));
    expect(byId.get('w:busiest')).toBe('a2');
    expect(byId.get('w:camera')).not.toBe('a2');
    expect(byId.get('w:best')).toBe('b2');
    const used = r.slots.flatMap((s) => (s.picture ? [s.picture.key] : []));
    expect(new Set(used).size).toBe(used.length);
    expect(r.slots.filter((s) => s.id.startsWith('n:')).length).toBe(4);
    expect(used).not.toContain('bg');
    // A pin corrects a stat like any slot.
    const pinned = resolveRecap(withRecap(doc, { picks: { 'w:busiest': 'a3' } }));
    expect(pinned.slots.find((s) => s.id === 'w:busiest')?.picture?.key).toBe('a3');
  });

  it('lays a slide per stat, the hours as bars, the best edge to edge, the rest as a grid', () => {
    const r = resolveRecap(doc);
    const layout = layoutRecap(doc, r);
    expect(layout.pages.map((p) => p.key)).toEqual(['first', 'w:busiest', 'w:camera', 'w:place', 'w:hour', 'w:best', 'w:rest']);
    const texts = (k: string) => layout.pages.find((p) => p.key === k)!.parts.flatMap((p) => (p.kind === 'text' ? [p.text] : []));
    expect(texts('first')).toContain('6');
    expect(texts('w:busiest')).toEqual(['The busiest day', '2 Mar', '3 pictures that day']);
    expect(texts('w:camera')).toContain('67 % of your pictures');
    expect(texts('w:hour')).toContain('6 pm');
    expect(layout.pages.find((p) => p.key === 'w:hour')!.sheet!.decor[0]).toMatchObject({ kind: 'bars' });
    expect(layout.pages.find((p) => p.key === 'w:best')!.bleed).toBe(true);
    // Every slide paints, its stat entering as its heading.
    const film = planFilm(doc, layout, () => null, filledOf(r));
    expect(film.pages[1].heading).not.toBeNull();
    const rec = recordingContext(1080, 1920);
    paintRecap(rec.ctx, 1080, doc, r, layout, film, { still: () => ({ image: {} as CanvasImageSource, width: 10, height: 10 }) }, { t: film.pages[4].allOn + 0.1, page: 4 });
    expect(rec.ops.filter((o) => o.startsWith('fillRect')).length).toBeGreaterThan(20);
  });

  it('leaves out a stat with nothing to say', () => {
    const plain = withPictures(withRecap(createRecapDoc('wrapped', 'local', { now: 1 }), { range: { from: '2026-01-01', to: '2026-12-31' } }), [pic('x', '2026-02-01'), pic('y', '2026-02-02')]);
    const keys = layoutRecap(plain, resolveRecap(plain)).pages.map((p) => p.key);
    expect(keys).not.toContain('w:camera');
    expect(keys).not.toContain('w:place');
    expect(keys).not.toContain('w:hour');
  });

  it('is titled by its year or its month, and a clicked stat opens the heading’s style', () => {
    expect(defaultTitle({ template: 'wrapped', anchor: '2026-01-01', range: { from: '2026-01-01', to: '2026-12-31' } })).toBe('2026, wrapped');
    expect(defaultTitle({ template: 'wrapped', anchor: '2026-10-01', range: { from: '2026-10-01', to: '2026-10-31' } })).toBe('October 2026, wrapped');
    expect(styleRoleOfText('stat:busiest')).toBe('heading');
    expect(styleRoleOfText('eyebrow:place')).toBe('subheading');
    expect(styleRoleOfText('header:0')).toBe('weekdays');
    expect(styleRoleOfText('cta')).toBe('cta');
  });
});
