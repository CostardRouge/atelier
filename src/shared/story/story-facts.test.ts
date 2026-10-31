import { describe, expect, it } from 'vitest';
import { factChanges, factsFromCalendars, factText, fillParams, fillText, spanDays } from './story-facts';
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
