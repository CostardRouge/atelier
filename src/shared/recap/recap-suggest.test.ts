import { describe, expect, it } from 'vitest';
import { createRecapDoc, withPictures, withRecap, type RecapDoc } from './recap-doc';
import { readyRecap, recapMonth, suggestionHint, suggestions } from './recap-suggest';

const month = (anchor: string, at = 1): RecapDoc => ({ ...createRecapDoc('month', 'local', { anchor, now: at }), updatedAt: at });
const week = (anchor: string, at = 1): RecapDoc => ({ ...createRecapDoc('week', 'local', { anchor, now: at }), updatedAt: at });
const keys = (list: { key: string }[]) => list.map((x) => x.key);
/** His Australia trip, as Trips keeps it. */
const australia = { name: 'Australie', startDate: '2025-02-16', endDate: '2026-02-10' };
const dump = (from: string, to: string, at = 1): RecapDoc => ({ ...withRecap(createRecapDoc('dump', 'local', { now: at }), { range: { from, to } }, at), updatedAt: at });

describe('the gallery’s suggestions', () => {
  it('reads the month a recap is about, and only a whole one', () => {
    expect(recapMonth(month('2026-09-01'))).toBe('2026-09');
    expect(recapMonth(dump('2026-09-01', '2026-09-30'))).toBe('2026-09');
    expect(recapMonth(dump('2026-09-01', '2026-09-29'))).toBeNull();
  });

  it('brings back for the month that ended each kind made for the month before', () => {
    const recaps = [month('2026-09-01'), dump('2026-09-01', '2026-09-30')];
    const s = suggestions(recaps, '2026-11-07');
    expect(s.map((x) => x.key).sort()).toEqual(['dump:2026-10', 'month:2026-10']);
    expect(s.find((x) => x.template === 'month')).toMatchObject({ anchor: '2026-10-01', range: null, label: 'October 2026', as: 'as in September' });
    expect(s.find((x) => x.template === 'dump')?.range).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('suggests nothing already made nor hidden for the month that ended', () => {
    expect(suggestions([month('2026-09-01'), month('2026-10-01')], '2026-11-07')).toEqual([]);
    expect(suggestions([month('2026-09-01')], '2026-11-07', new Set(['month:2026-10']))).toEqual([]);
  });

  it('follows a series of past months: after the one made last, the next, in its dress', () => {
    const june = month('2025-06-01', 1);
    const july = month('2025-07-01', 2);
    const [s, ...rest] = suggestions([june, july], '2026-11-10');
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ key: 'month:2025-08', template: 'month', anchor: '2025-08-01', range: null, label: 'August 2025', as: 'as in July 2025' });
    expect(s.model?.id).toBe(july.id);
    // Then September once August exists, and so on.
    expect(keys(suggestions([june, july, month('2025-08-01', 3)], '2026-11-10'))).toEqual(['month:2025-09']);
    // A period template about a whole month follows its own series.
    expect(suggestions([dump('2025-07-01', '2025-07-31')], '2026-11-10')[0]).toMatchObject({ key: 'dump:2025-08', range: { from: '2025-08-01', to: '2025-08-31' } });
  });

  it('never suggests a month that has not ended', () => {
    expect(suggestions([month('2026-10-01')], '2026-11-10')).toEqual([]);
    expect(suggestions([month('2026-11-01')], '2026-11-10')).toEqual([]);
    expect(keys(suggestions([month('2026-10-01')], '2026-12-01'))).toEqual(['month:2026-11', 'wrapped:2026']);
  });

  it('takes the series from the recap MADE last, and steps over what is made', () => {
    // July then September: the series is at September — August, skipped on the way, is not asked for.
    expect(keys(suggestions([month('2025-07-01', 1), month('2025-09-01', 2)], '2026-11-10'))).toEqual(['month:2025-10']);
    // September then July: he went back, so August comes next.
    expect(keys(suggestions([month('2025-09-01', 1), month('2025-07-01', 2)], '2026-11-10'))).toEqual(['month:2025-08']);
    // … and with August made last, September exists already: October.
    expect(keys(suggestions([month('2025-09-01', 1), month('2025-07-01', 2), month('2025-08-01', 3)], '2026-11-10'))).toEqual(['month:2025-10']);
  });

  it('steps over a hidden month to the next one', () => {
    const made = [month('2025-07-01')];
    expect(keys(suggestions(made, '2026-11-10', new Set(['month:2025-08'])))).toEqual(['month:2025-09']);
    expect(keys(suggestions(made, '2026-11-10', new Set(['month:2025-08', 'month:2025-09'])))).toEqual(['month:2025-10']);
  });

  it('stops a series after the last day of the trip that covers it', () => {
    // February 2026 holds the trip's last days: suggested. March does not: never.
    expect(keys(suggestions([month('2026-01-01')], '2026-11-10', new Set(), [australia]))).toEqual(['month:2026-02']);
    expect(suggestions([month('2026-02-01')], '2026-11-10', new Set(), [australia])).toEqual([]);
    expect(suggestions([month('2026-01-01')], '2026-11-10', new Set(['month:2026-02']), [australia])).toEqual([]);
    // Without the trip — or with one that does not cover the series — it goes on.
    expect(keys(suggestions([month('2026-02-01')], '2026-11-10'))).toEqual(['month:2026-03']);
    expect(keys(suggestions([month('2026-06-01')], '2026-11-10', new Set(), [australia]))).toEqual(['month:2026-07']);
  });

  it('keeps today’s rule beside a backlog, each suggestion once', () => {
    // A backlog made last, and September made live before it: both speak.
    const s = suggestions([month('2026-09-01', 1), month('2025-07-01', 2)], '2026-11-10');
    expect(keys(s)).toEqual(['month:2025-08', 'month:2026-10']);
    expect(s.map((x) => x.as)).toEqual(['as in July 2025', 'as in September']);
    // The series and today’s rule meeting on the same month give it once.
    expect(keys(suggestions([month('2026-09-01')], '2026-11-10'))).toEqual(['month:2026-10']);
    // Today’s rule is the calendar’s, not a trip’s: a trip ending in September does not hide October.
    expect(keys(suggestions([month('2026-09-01')], '2026-11-10', new Set(), [{ startDate: '2026-09-01', endDate: '2026-09-20' }]))).toEqual(['month:2026-10']);
  });

  it('follows a series of weeks, bounded the same way', () => {
    const a = week('2025-07-21', 1);
    const b = week('2025-07-28', 2);
    const [s, ...rest] = suggestions([a, b], '2026-11-10');
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ key: 'week:2025-08-04', anchor: '2025-08-04', label: 'Week of 4 Aug 2025', as: 'as the week of 28 Jul 2025' });
    expect(s.model?.id).toBe(b.id);
    expect(keys(suggestions([a, b], '2026-11-10', new Set(['week:2025-08-04'])))).toEqual(['week:2025-08-11']);
    // The trip's last week (9 → 15 Feb holds 10 Feb) is suggested, the one after is not.
    expect(keys(suggestions([week('2026-02-02')], '2026-11-10', new Set(), [australia]))).toEqual(['week:2026-02-09']);
    expect(suggestions([week('2026-02-09')], '2026-11-10', new Set(), [australia])).toEqual([]);
    // A week still running is never suggested.
    expect(suggestions([week('2026-11-02')], '2026-11-12')).toEqual([]);
  });

  it('says in one line why nothing is suggested', () => {
    expect(suggestionHint([], '2026-11-10')?.line).toBe('Make a month or a week recap: the next one will be suggested here');
    expect(suggestionHint([month('2026-10-01')], '2026-11-10')?.line).toBe('Up to date · November 2026 comes once it has ended');
    expect(suggestionHint([month('2026-02-01')], '2026-11-10', new Set(), [australia])?.line).toBe('Up to date · Australie ended on 10 Feb');
    expect(suggestionHint([month('2025-07-01')], '2026-11-10')).toBeNull();
    expect(suggestionHint([], '2026-11-10')?.why).toMatch(/series/);
  });

  it('brings back the week that ended, and the year’s Wrapped in December and January', () => {
    const w = { ...createRecapDoc('week', 'local', { anchor: '2026-10-26', now: 1 }), updatedAt: 1 };
    expect(suggestions([w], '2026-11-12').map((x) => x.key)).toEqual(['week:2026-11-02']);
    // A week later the series still follows him: the week after the one he made.
    expect(suggestions([w], '2026-11-20')[0]).toMatchObject({ key: 'week:2026-11-02', as: 'as the week of 26 Oct' });
    expect(suggestions([], '2026-12-03').map((x) => x.key)).toEqual(['wrapped:2026']);
    expect(suggestions([], '2027-01-10')[0]).toMatchObject({ key: 'wrapped:2026', range: { from: '2026-01-01', to: '2026-12-31' } });
    const made = withRecap(createRecapDoc('wrapped', 'local', { now: 1 }), { range: { from: '2026-01-01', to: '2026-12-31' } });
    expect(suggestions([made], '2026-12-03')).toEqual([]);
  });

  it('makes the recap in its model’s dress, on the new month, its old pictures left behind', () => {
    let model = month('2026-09-01');
    model = withPictures(model, [{ key: 'a', origin: 'local', name: 'a', kind: 'photo', day: '2026-09-02' }]);
    model = withRecap(model, { picks: { '2026-09-02': 'a' }, font: 'mono', background: { ...model.background, kind: 'video', video: 'clip' } });
    const [s] = suggestions([model], '2026-11-07');
    const doc = readyRecap(s, 'local', 5);
    expect(doc.id).not.toBe(model.id);
    expect(doc).toMatchObject({ template: 'month', anchor: '2026-10-01', title: 'October 2026', font: 'mono', pictures: [], picks: {} });
    expect(doc.background).toMatchObject({ kind: 'ink' });
    expect(doc.background.video).toBeUndefined();
    // A model from any earlier month, not only the one before.
    const [far] = suggestions([withRecap(model, {}, 9)], '2027-06-10', new Set(['month:2026-10']));
    expect(readyRecap(far, 'local', 5)).toMatchObject({ anchor: '2026-11-01', title: 'November 2026', font: 'mono', pictures: [], picks: {} });
    const period = readyRecap(suggestions([dump('2025-07-01', '2025-07-31')], '2026-11-10')[0], 'local', 5);
    expect(period).toMatchObject({ template: 'dump', range: { from: '2025-08-01', to: '2025-08-31' }, pictures: [] });
    const fresh = readyRecap(suggestions([], '2026-12-03')[0], 'local', 5);
    expect(fresh).toMatchObject({ template: 'wrapped', title: '2026, wrapped', range: { from: '2026-01-01', to: '2026-12-31' } });
  });
});
