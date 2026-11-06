import { describe, expect, it } from 'vitest';
import { recordingContext } from '../story/recording-context';
import { createRecapDoc, readRecapDoc, withPictures, withRecap, type RecapDoc, type RecapPicture } from './recap-doc';
import { layoutRecap } from './recap-layout';
import { filledOf, pageAt, planFilm } from './recap-motion';
import { readOpener, type RecapOpener } from './recap-opener';
import { badgeDate, badgeLook, defileTicks, planDefile, planOpener, placeLine, shownPictures, type DefilePlan } from './recap-opener-plan';
import { inOpener, paintFilm } from './recap-opener-paint';
import type { PaintSources } from './recap-paint';
import { resolveRecap } from './recap-slots';

const pic = (key: string, day: string, extra: Partial<RecapPicture> = {}): RecapPicture => ({ key, origin: 'local', name: key, kind: 'photo', day, ...extra });
const still = { image: {} as CanvasImageSource, width: 400, height: 300 };
const sources: PaintSources = { still: () => still };

const month = (opener: Partial<RecapOpener>): RecapDoc => {
  let d = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
  d = withPictures(d, [
    pic('a', '2026-10-02', { minute: 600 }),
    pic('b', '2026-10-09', { stars: 5, device: 'ILCE-7M4', focal: 35, place: 'Esperance', region: 'Western Australia' }),
    pic('c', '2026-10-20'),
    pic('d', '2026-10-28'),
  ]);
  return withRecap(d, { opener: { ...readOpener({}), ...opener } });
};

function film(doc: RecapDoc) {
  const resolved = resolveRecap(doc);
  const layout = layoutRecap(doc, resolved);
  return { resolved, layout, film: planFilm(doc, layout, () => null, filledOf(resolved), planOpener(doc, resolved)) };
}

describe('recap opener', () => {
  it('reads an unknown kind as none and clamps its numbers', () => {
    expect(readOpener({ kind: 'warp' }).kind).toBe('none');
    expect(readOpener({ kind: 'badge', seconds: 99 }).seconds).toBe(8);
    expect(readOpener({ kind: 'defile', seconds: 0 }).seconds).toBe(0.6);
    expect(readOpener({ lines: { place: false } }).lines).toEqual({ date: true, place: false, camera: true });
    // An old recap has none.
    expect(readRecapDoc({ id: 'x', template: 'month' }, 'local')!.opener.kind).toBe('none');
  });

  it('flicks through the shown pictures in time, landing on each at its time and on the tape at its day', () => {
    const doc = month({ kind: 'defile', seconds: 2 });
    const plan = planOpener(doc, resolveRecap(doc)) as DefilePlan;
    expect(plan.kind).toBe('defile');
    expect(plan.stops.map((s) => s.key)).toEqual(['a', 'b', 'c', 'd']);
    expect(plan.totalDays).toBe(31);
    expect(plan.stops.map((s) => s.dayNumber)).toEqual([2, 9, 20, 28]);
    expect(plan.seconds).toBeCloseTo(2);
    for (const [i, s] of plan.stops.entries()) {
      expect(plan.stopAt(s.at + 1e-6)).toBe(i);
      expect(plan.headDayAt(s.at)).toBeCloseTo(s.dayNumber, 5);
    }
    // Faster first: the second landing comes sooner after the first than the last after the one before.
    const gaps = plan.stops.slice(1).map((s, i) => s.at - plan.stops[i].at);
    expect(gaps[0]).toBeLessThan(gaps[gaps.length - 1]);
    // A tick each landing, the seat last.
    const ticks = defileTicks(plan);
    expect(ticks).toHaveLength(4);
    expect(ticks[3].voice).toBe('seat');
  });

  it('reads scattered pictures in turn when the recap has no run of days', () => {
    const plan = planDefile(readOpener({ kind: 'defile' }), [pic('x', '2020-01-01'), pic('y', '2026-05-05'), pic('z', '2026-11-01')], ['2026-11-01'])!;
    expect(plan.totalDays).toBe(3);
    expect(plan.stops.map((s) => s.dayNumber)).toEqual([1, 2, 3]);
    expect(planDefile(readOpener({ kind: 'defile' }), [pic('x', '2020-01-01')], [])).toBeNull();
  });

  it('badges the best picture with its day, its place and its camera', () => {
    const doc = month({ kind: 'badge' });
    const plan = planOpener(doc, resolveRecap(doc), { 'ILCE-7M4': 'Sony' });
    expect(plan).toMatchObject({ kind: 'badge', key: 'b', date: 'FRI 9 OCT 2026', title: 'Esperance, Western Australia', camera: 'Sony · 35 mm' });
    // His own picture and words win; a line off says nothing.
    const own = month({ kind: 'badge', picture: 'c', title: 'Back home', lines: { date: true, place: true, camera: false } });
    expect(planOpener(own, resolveRecap(own))).toMatchObject({ key: 'c', title: 'Back home', camera: null });
    // No place: the recap's own title.
    const plain = month({ kind: 'badge', picture: 'a' });
    expect(planOpener(plain, resolveRecap(plain))).toMatchObject({ title: 'October' });
    expect(badgeDate('2026-11-06')).toBe('FRI 6 NOV 2026');
    expect(placeLine({ place: 'Paris' })).toBe('Paris');
    expect(badgeLook({ seconds: 2 }, 0)).toEqual({ zoom: 1, block: 0 });
    expect(badgeLook({ seconds: 2 }, 2).block).toBe(1);
  });

  it('leads the film: every page later by its seconds, the author’s length counting it', () => {
    const plain = film(month({}));
    const led = film(month({ kind: 'badge', seconds: 2 }));
    expect(led.film.lead).toBe(2);
    expect(led.film.total).toBeCloseTo(plain.film.total + 2);
    expect(led.film.pages[0].start).toBe(2);
    expect(led.film.pages[0].allOn).toBeCloseTo(plain.film.pages[0].allOn + 2);
    expect(pageAt(led.film, 0.5)).toBe(0);
    const fixed = film(withRecap(month({ kind: 'badge', seconds: 2 }), { length: 10 }));
    expect(fixed.film.total).toBeCloseTo(10);
    // A song's whole loops are counted with the opener.
    const sung = film(withRecap(month({ kind: 'badge', seconds: 2 }), { sound: { name: 's', gain: 1, fade: 1, fit: true, seconds: 3 } }));
    expect(sung.film.total % 3).toBeCloseTo(0);
  });

  it('paints the opener while it runs, the recap after', () => {
    const doc = month({ kind: 'defile', seconds: 2 });
    const { resolved, layout, film: f } = film(doc);
    expect(inOpener(f, 1)).toBe(true);
    expect(inOpener(f, 2.5)).toBe(false);
    const rec = recordingContext(1080, 1920);
    paintFilm(rec.ctx, 1080, doc, resolved, layout, f, sources, { t: 1, page: 0 });
    // One picture full page, the tape, the day above it; no heading yet.
    expect(rec.ops.filter((o) => o.startsWith('image'))).toHaveLength(1);
    expect(rec.texts.join(' ')).not.toContain('October');
    const after = recordingContext(1080, 1920);
    paintFilm(after.ctx, 1080, doc, resolved, layout, f, sources, { t: 99, page: 0 });
    expect(after.texts.join(' ')).toContain('OCTOBER');
    const badge = month({ kind: 'badge', seconds: 2.4 });
    const b = film(badge);
    const rb = recordingContext(1080, 1920);
    paintFilm(rb.ctx, 1080, badge, b.resolved, b.layout, b.film, sources, { t: 2, page: 0 });
    expect(rb.texts.join(' ')).toMatch(/esperance/i);
    expect(shownPictures(b.resolved)).toHaveLength(4);
  });
});
