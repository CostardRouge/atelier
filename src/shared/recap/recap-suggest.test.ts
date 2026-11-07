import { describe, expect, it } from 'vitest';
import { createRecapDoc, withPictures, withRecap, type RecapDoc } from './recap-doc';
import { readyRecap, recapMonth, suggestions } from './recap-suggest';

const month = (anchor: string, at = 1): RecapDoc => ({ ...createRecapDoc('month', 'local', { anchor, now: at }), updatedAt: at });
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

  it('suggests nothing already made, nothing hidden, nothing from an older month', () => {
    expect(suggestions([month('2026-09-01'), month('2026-10-01')], '2026-11-07')).toEqual([]);
    expect(suggestions([month('2026-09-01')], '2026-11-07', new Set(['month:2026-10']))).toEqual([]);
    expect(suggestions([month('2026-08-01')], '2026-11-07')).toEqual([]);
  });

  it('brings back the week that ended, and the year’s Wrapped in December and January', () => {
    const w = { ...createRecapDoc('week', 'local', { anchor: '2026-10-26', now: 1 }), updatedAt: 1 };
    expect(suggestions([w], '2026-11-12').map((x) => x.key)).toEqual(['week:2026-11-02']);
    expect(suggestions([w], '2026-11-20').map((x) => x.key)).toEqual([]);
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
    const fresh = readyRecap(suggestions([], '2026-12-03')[0], 'local', 5);
    expect(fresh).toMatchObject({ template: 'wrapped', title: '2026, wrapped', range: { from: '2026-01-01', to: '2026-12-31' } });
  });
});
