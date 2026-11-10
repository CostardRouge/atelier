import { describe, expect, it } from 'vitest';
import { createRecapDoc, withPictures, type RecapPicture } from './recap-doc';
import { chooserMonths, dayCounts, dayPictures, filterCounts, slideLabel, whereIs, withJoinedAfter } from './recap-chooser';
import { layoutRecap } from './recap-layout';
import { flowKeys } from './recap-selection';
import { resolveRecap } from './recap-slots';

const pic = (key: string, day: string, extra: Partial<RecapPicture> = {}): RecapPicture => ({ key, origin: 'local', name: key, kind: 'photo', day, device: 'ILCE-7M4', ...extra });

/** October 2026: three pictures a day for twenty days, the 14th a busy one, a background clip kept loose. */
const month = () => {
  const pics: RecapPicture[] = [];
  for (let d = 1; d <= 20; d++) for (let i = 0; i < 3; i++) pics.push(pic(`p${d}-${i}`, `2026-10-${String(d).padStart(2, '0')}`, { minute: 600 + i * 60 }));
  for (let i = 3; i < 40; i++) pics.push(pic(`p14-${i}`, '2026-10-14', { minute: 600 + i, ...(i === 30 ? { fav: true } : i % 10 === 0 ? { picked: true } : {}) }));
  pics.push(pic('sky', '2026-10-14', { kind: 'video', loose: true }));
  return withPictures(createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 }), pics);
};

describe('the day chooser', () => {
  it('counts a day’s own pictures — never the background’s loose clip — and ranks them', () => {
    const r = resolveRecap(month());
    expect(dayCounts(r).get('2026-10-14')).toBe(40);
    expect(dayCounts(r).get('2026-10-21')).toBeUndefined();
    const day = dayPictures(r, '2026-10-14');
    expect(day).toHaveLength(40);
    expect(day.some((p) => p.key === 'sky')).toBe(false);
    // The ♥ first, then the picks.
    expect(day[0].key).toBe('p14-30');
    expect(day.slice(1, 3).every((p) => p.picked)).toBe(true);
    expect(filterCounts(r, '2026-10-14')).toEqual({ fav: 1, picks: 2, all: 40 });
    expect(dayPictures(r, '2026-10-14', 'picks').map((p) => p.key).sort()).toEqual(['p14-10', 'p14-20']);
    expect(dayPictures(r, '2026-10-14', 'fav').map((p) => p.key)).toEqual(['p14-30']);
  });

  it('lays a month from its weekday', () => {
    const [oct] = chooserMonths(new Map([['2026-10-05', 1]]), 1);
    // 1 October 2026 is a Thursday: three places before it in a week from Monday, four from Sunday.
    expect(oct).toMatchObject({ month: '2026-10', lead: 3 });
    expect(oct.days).toHaveLength(31);
    expect(chooserMonths(new Map([['2026-10-05', 1]]), 0)[0].lead).toBe(4);
    expect(chooserMonths(new Map([['2026-11-02', 1], ['2026-10-05', 1]]), 1).map((m) => m.month)).toEqual(['2026-10', '2026-11']);
  });

  it('says where a picture already is, and a highlight by its slide', () => {
    const doc = month();
    const r = resolveRecap(doc);
    const layout = layoutRecap(doc, r);
    const where = whereIs(r, layout);
    const day1 = r.slots.find((s) => s.id === '2026-10-01')!.picture!;
    expect(where.get(day1.key)).toMatchObject({ flow: false, page: 0 });
    const h = r.slots.find((s) => s.flow && s.picture)!;
    expect(where.get(h.picture!.key)).toMatchObject({ flow: true, page: 1 });
    expect(slideLabel(layout, h.id)).toMatch(/^Slide 2 · 1 of \d$/);
  });

  it('+ puts a picture right after the one in hand; without one, at its moment', () => {
    const doc = month();
    const r = resolveRecap(doc);
    const keys = flowKeys(r);
    const free = dayPictures(r, '2026-10-14').find((p) => !r.slots.some((s) => s.picture?.key === p.key))!;
    const after = withJoinedAfter(doc, free.key, keys[0], 2);
    expect(after.carousel.chosen!.slice(0, 2)).toEqual([keys[0], free.key]);
    expect(flowKeys(resolveRecap(after))).toHaveLength(keys.length + 1);
    // No picture in hand: at its moment, as Add does.
    const atMoment = withJoinedAfter(doc, free.key, null, 2);
    expect(atMoment.carousel.chosen).toContain(free.key);
    // The calendar's own picture cannot join: the same picture twice reads as a mistake.
    const own = r.slots.find((s) => s.id === '2026-10-14')!.picture!;
    expect(withJoinedAfter(doc, own.key, keys[0], 2)).toBe(doc);
  });
});
