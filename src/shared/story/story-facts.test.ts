import { describe, expect, it } from 'vitest';
import { deviceKey, factChanges, factsFromCalendars, factText, fillParams, fillText, gearFacts, geoFacts, spanDays, wallPicks } from './story-facts';
import { assemble, SCRIPT_KIND, type PostSkeleton, type StoryScript } from './story-script';

const values = { 'media.total': 98412, days: 178 };

describe('filling facts into words', () => {
  it('writes a counted fact the French way and leaves an uncounted one as written', () => {
    expect(fillText('{media.total} photos en {days} jours', values)).toBe(`${factText(98412)} photos en 178 jours`);
    expect(factText(98412)).toMatch(/^98\s412$/u);
    expect(fillText('{media.video} vidéos', values)).toBe('{media.video} vidéos');
    expect(fillText('{media.total}', null)).toBe('{media.total}');
  });

  it('turns a param that is exactly one fact into its number, and fills texts deep inside params', () => {
    const params = { to: '{media.total}', label: 'sur {days} jours', columns: [{ counts: ['{days}', 3] }], from: 0 };
    expect(fillParams(params, values)).toEqual({
      to: 98412,
      label: 'sur 178 jours',
      columns: [{ counts: [178, 3] }],
      from: 0,
    });
  });
});

describe('counting a trip on a Winnow', () => {
  const span = { from: '2025-09-03', to: '2025-09-05' };
  const all = {
    days: [
      { date: '2025-09-02', count: 50, cover_id: 1 },
      { date: '2025-09-03', count: 120, cover_id: 2 },
      { date: '2025-09-04', count: 0, cover_id: 3 },
      { date: '2025-09-05', count: 80, cover_id: 4 },
    ],
    bounds: null,
  };
  const photos = { days: [{ date: '2025-09-03', count: 100, cover_id: 2 }, { date: '2025-09-05', count: 75, cover_id: 4 }], bounds: null };

  it('sums the days of the span only, splits photos from videos, counts the days with media', () => {
    expect(factsFromCalendars(all, photos, span)).toEqual({
      'media.total': 200,
      'media.photo': 175,
      'media.video': 25,
      days: 2,
      'trip.days': 3,
    });
  });

  it('counts a span’s calendar days, both ends included', () => {
    expect(spanDays('2025-09-03', '2026-02-28')).toBe(179);
    expect(spanDays('2025-09-03', '2025-09-03')).toBe(1);
    expect(spanDays('2025-09-04', '2025-09-03')).toBe(0);
  });

  it('says what changed between two countings', () => {
    expect(factChanges({ 'media.total': 10, days: 2 }, { 'media.total': 12, days: 2, 'media.video': 1 })).toEqual([
      ['media.total', 10, 12],
      ['media.video', null, 1],
    ]);
  });
});

describe('assemble with facts', () => {
  const skeleton: PostSkeleton = { id: 'a', number: 'EP.00', season: 1, blocks: [{ block: 'wall', len: 4, cap: { a: 0.5, b: 3.5 } }] };
  const script: StoryScript = {
    kind: SCRIPT_KIND,
    version: 1,
    facts: { at: '2026-10-31T10:00:00Z', values },
    posts: { a: { title: '{days} jours', blocks: [{ params: { count: '{media.total}' }, caption: '{media.total} photos.' }] } },
  };

  it('fills the series’ facts into the title, the params and the captions', () => {
    const ep = assemble(skeleton, script, [skeleton]);
    expect(ep.title).toBe('178 jours');
    expect(ep.blocks[0]?.params?.count).toBe(98412);
    expect(ep.blocks[0].cap?.text).toBe(`${factText(98412)} photos.`);
  });

  it('prefers the post’s own counting', () => {
    const own = { ...script, posts: { a: { ...script.posts.a, facts: { at: 'x', values: { 'media.total': 5, days: 1 } } } } };
    expect(assemble(skeleton, own, [skeleton]).blocks[0]?.params?.count).toBe(5);
  });
});

describe('wallPicks', () => {
  const day = (date: string, cover_id: number, count = 3) => ({ date, count, cover_id });
  const span = { from: '2025-09-01', to: '2025-09-30' };

  it('takes each day’s cover in day order, inside the span, skipping empty days', () => {
    const cal = { days: [day('2025-09-03', 30), day('2025-08-31', 9), day('2025-09-01', 10), day('2025-09-02', 20, 0)], bounds: null };
    expect(wallPicks(cal, span, 180)).toEqual([10, 30]);
  });

  it('thins evenly to the wall’s size, keeping the first and last day', () => {
    const days = Array.from({ length: 30 }, (_, i) => day(`2025-09-${String(i + 1).padStart(2, '0')}`, 100 + i));
    const picks = wallPicks({ days, bounds: null }, span, 4);
    expect(picks).toEqual([100, 110, 119, 129]);
  });
});

describe('the cameras and the positions of a trip', () => {
  it('keys a camera by its squeezed name and adds names that squeeze alike', () => {
    expect(deviceKey('Sony ILCE-7CM2')).toBe('gear.sonyilce7cm2');
    expect(deviceKey('—')).toBe('gear.unknown');
    expect(gearFacts([['DJI FC8482', 120], ['dji fc-8482', 3], ['iPhone 15 Pro', 0]])).toEqual({ 'gear.djifc8482': 123 });
  });

  it('counts placed and unplaced days and finds the runs of unplaced ones', () => {
    const g = (date: string, placed: boolean, count = 4) => ({ date, lat: placed ? -33 : null, lon: placed ? 151 : null, count, measured: placed ? count : 0, source: placed ? ('measured' as const) : null });
    const days = [g('2025-09-01', true), g('2025-09-02', false), g('2025-09-04', false), g('2025-09-05', true), g('2025-09-06', false), g('2025-09-07', false, 0), g('2025-10-01', false)];
    const out = geoFacts(days, { from: '2025-09-01', to: '2025-09-30' });
    expect(out.values).toEqual({ 'geo.days.located': 2, 'geo.days.unlocated': 3 });
    // 09-02 and 09-04 are one hole (09-03 had no media); 09-06 stands alone; 10-01 is outside the span.
    expect(out.holes).toEqual([['2025-09-02', '2025-09-04'], ['2025-09-06', '2025-09-06']]);
  });
});

describe('the season recap', () => {
  const reg: PostSkeleton[] = [
    { id: 'a', number: 'EP.00', season: 1, blocks: [] },
    { id: 'b', number: 'EP.01', season: 1, blocks: [{ block: 'season-recap', len: 5, cap: null }] },
    { id: 'c', number: 'EP.00', season: 2, blocks: [] },
  ];
  const script: StoryScript = { kind: SCRIPT_KIND, version: 1, facts: { at: 'x', values: { days: 9 } }, posts: { a: { title: 'Un', cover: '{days} jours' }, b: { title: 'Deux' } } };

  it('lists the season’s own posts when the script does not spell them out', () => {
    expect(assemble(reg[1], script, reg).blocks[0]?.params?.episodes).toEqual([
      { number: 'EP.00', title: 'Un', line: '9 jours' },
      { number: 'EP.01', title: 'Deux', line: '' },
    ]);
  });

  it('keeps the episodes the script gives', () => {
    const given = { ...script, posts: { ...script.posts, b: { blocks: [{ params: { episodes: [{ number: 'X', title: 'Y', line: 'Z' }] } }] } } };
    expect(assemble(reg[1], given, reg).blocks[0]?.params?.episodes).toEqual([{ number: 'X', title: 'Y', line: 'Z' }]);
  });
});

describe('days left out', () => {
  it('are not counted, nor walled, nor holes', () => {
    const span = { from: '2025-09-03', to: '2025-09-05', skip: ['2025-09-04'] };
    const all = { days: [{ date: '2025-09-03', count: 10, cover_id: 1 }, { date: '2025-09-04', count: 7, cover_id: 2 }, { date: '2025-09-05', count: 3, cover_id: 3 }], bounds: null };
    const photos = { days: [{ date: '2025-09-04', count: 7, cover_id: 2 }], bounds: null };
    expect(factsFromCalendars(all, photos, span)).toEqual({ 'media.total': 13, 'media.photo': 0, 'media.video': 13, days: 2, 'trip.days': 2 });
    expect(wallPicks(all, span, 10)).toEqual([1, 3]);
    const g = (date: string) => ({ date, lat: null, lon: null, count: 2, measured: 0, source: null });
    expect(geoFacts([g('2025-09-03'), g('2025-09-04'), g('2025-09-05')], span).holes).toEqual([['2025-09-03', '2025-09-05']]);
  });
});
