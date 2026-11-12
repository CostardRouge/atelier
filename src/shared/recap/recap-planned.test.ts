import { describe, expect, it } from 'vitest';
import type { PostizPost } from '../sources/postiz/client';
import { createRecapDoc, withRecap } from './recap-doc';
import { atelierPosts, hiddenInWeek, plannedPeek, plannedTiles, plannedWeeks, sameDayClash, tileState, weekStrip } from './recap-planned';
import { DEFAULT_RHYTHM } from '../sources/postiz/rhythm';

/** A post Atelier sent (tagged), unless `tags` says otherwise. */
const post = (id: string, at: string, state: PostizPost['state'] = 'queue', content = 'A caption\nmore', tags: string[] = ['Atelier']): PostizPost => ({ id, group: null, tags, content, publishDate: at, state, releaseURL: null, error: state === 'error' ? 'media' : null, channel: null });

describe('the planned weeks', () => {
  const doc = withRecap(createRecapDoc('week', 'local', { anchor: '2026-10-05', now: 1 }), {
    title: 'Tasmania · week 45',
    publish: { caption: null, captions: {}, titles: {}, music: { source: 'own', tracks: {}, musicVolume: 100, filmVolume: 0 }, approved: true, publications: [{ postId: 'p2', channelId: 'c', channel: 'Steeve', kind: 'reel', trial: true, at: '2026-11-17T08:00:00.000Z', sentAt: 1, caption: '', network: 'instagram', group: null }] },
  });
  const posts = [post('p1', '2026-11-10T08:00:00Z', 'published'), post('p2', '2026-11-17T08:00:00Z'), post('p3', '2026-11-20T18:00:00Z', 'error', '\n  Bali, the departure'), post('p4', '2026-11-12T07:00:00Z')];

  it('groups by week from Monday, in time order, tied to the recap that sent it', () => {
    const weeks = plannedWeeks(posts, [doc], 'Europe/Paris');
    expect(weeks.map((w) => [w.monday, w.items.map((i) => i.postId)])).toEqual([
      ['2026-11-09', ['p1', 'p4']],
      ['2026-11-16', ['p2', 'p3']],
    ]);
    expect(weeks[1].items[0]).toMatchObject({ recapId: doc.id, title: 'Tasmania · week 45', kind: 'reel', trial: true });
    expect(weeks[1].items[1]).toMatchObject({ recapId: null, title: 'Bali, the departure', state: 'error', error: 'media' });
  });

  it('says the week at a glance, and a clash the same day', () => {
    const weeks = plannedWeeks(posts, [doc], 'Europe/Paris');
    expect(plannedPeek(weeks, 'Europe/Paris', new Date('2026-11-11T12:00:00Z'), (d) => d.toISOString().slice(5, 10))).toBe('2 this week · next 11-12 · 1 failed');
    expect(sameDayClash(weeks[0], 'Europe/Paris')).toBe(false);
    expect(sameDayClash(plannedWeeks([post('a', '2026-11-10T08:00:00Z'), post('b', '2026-11-10T17:00:00Z')], [], 'Europe/Paris')[0], 'Europe/Paris')).toBe(true);
    expect(plannedPeek([], 'Europe/Paris', new Date(), String)).toBe('nothing planned');
  });
});

describe('the week strip', () => {
  it('lays a week day by day, today marked, the rhythm’s free slots where nothing goes out', async () => {
    const { weekStrip, mondayOf, weekLabel } = await import('./recap-planned');
    const { DEFAULT_RHYTHM } = await import('../sources/postiz/rhythm');
    const now = new Date('2026-11-10T10:00:00Z'); // Tue 10 Nov, 11:00 in Paris
    expect(mondayOf(now, 'Europe/Paris')).toBe('2026-11-09');
    expect(mondayOf(now, 'Europe/Paris', 1)).toBe('2026-11-16');
    expect(weekLabel('2026-11-09')).toBe('9–15 Nov');
    expect(weekLabel('2026-11-30')).toBe('30 Nov – 6 Dec');
    const posts = [post('a', '2026-11-09T19:48:00Z', 'published', 'Ceci est un test'), post('b', '2026-11-13T18:00:00Z'), post('c', '2026-11-12T22:55:00Z', 'error', '')];
    const days = weekStrip(posts, [], DEFAULT_RHYTHM, '2026-11-09', now);
    expect(days.map((d) => d.label)).toEqual(['Mon 9', 'Tue 10', 'Wed 11', 'Thu 12', 'Fri 13', 'Sat 14', 'Sun 15']);
    expect(days[0]).toMatchObject({ past: true, today: false });
    expect(days[1].today).toBe(true);
    expect(days[0].items.map((i) => i.postId)).toEqual(['a']);
    expect(days[3].items[0]).toMatchObject({ postId: 'c', state: 'error', title: '' });
    // Tuesday 9:00 is past at 11:00; Friday's slot holds a post; Sunday's is free.
    expect(days[1].free).toEqual([]);
    expect(days[4].free).toEqual([]);
    expect(days[6].free.map((d) => d.toISOString())).toEqual(['2026-11-15T09:00:00.000Z']);
  });
});

describe('one send on several networks', () => {
  const ch = (id: string, identifier: string) => ({ id, name: id, identifier, picture: null });
  const pub = (postId: string, network: string) => ({ postId, channelId: network, channel: network, kind: 'reel' as const, trial: false, at: '2026-11-13T18:00:00.000Z', sentAt: 1, caption: '', network, group: 'g1' });
  const doc = withRecap(createRecapDoc('week', 'local', { anchor: '2026-10-05', now: 1 }), {
    title: 'Tasmania',
    publish: { caption: null, captions: {}, titles: {}, music: { source: 'own', tracks: {}, musicVolume: 100, filmVolume: 0 }, approved: true, publications: [pub('a', 'instagram'), pub('b', 'tiktok'), pub('c', 'bluesky')] },
  });
  const posts: PostizPost[] = [
    { ...post('a', '2026-11-13T18:00:00Z', 'published'), channel: ch('ig', 'instagram') },
    { ...post('b', '2026-11-13T20:00:00Z', 'error'), channel: ch('tt', 'tiktok') },
    { ...post('c', '2026-11-13T20:00:00Z'), channel: ch('bs', 'bluesky') },
    { ...post('x', '2026-11-13T09:00:00Z'), group: 'pz', channel: ch('ig', 'instagram') },
    { ...post('y', '2026-11-13T09:00:00Z'), group: 'pz', channel: ch('th', 'threads') },
    { ...post('z', '2026-11-14T09:00:00Z'), group: 'alone', channel: ch('ig', 'instagram') },
  ];
  const items = plannedWeeks(posts, [doc], 'Europe/Paris')[0].items;

  it('draws it as one tile, failed as soon as one network failed', () => {
    const tiles = plannedTiles(items);
    expect(tiles.map((t) => t.items.map((i) => i.postId))).toEqual([['x', 'y'], ['a', 'b', 'c'], ['z']]);
    expect(tiles[1].at.toISOString()).toBe('2026-11-13T18:00:00.000Z');
    expect(tiles.map(tileState)).toEqual(['queue', 'error', 'queue']);
    expect(tiles[1].items.map((i) => i.network)).toEqual(['instagram', 'tiktok', 'bluesky']);
  });

  it('counts it once in the week, and never as a clash with itself', () => {
    const weeks = plannedWeeks(posts, [doc], 'Europe/Paris');
    expect(plannedPeek(weeks, 'Europe/Paris', new Date('2026-11-12T10:00:00Z'), () => 'then')).toBe('3 this week · next then · 1 failed');
    // Two SENDS the same day (the 9:00 pair and the 19:00 recap) are a clash; a send's own networks are not.
    expect(sameDayClash(weeks[0], 'Europe/Paris')).toBe(true);
    expect(sameDayClash({ monday: weeks[0].monday, items: items.filter((i) => ['a', 'c'].includes(i.postId)) }, 'Europe/Paris')).toBe(false);
  });
});

describe('only Atelier’s posts are drawn, every post still counts', () => {
  const doc = withRecap(createRecapDoc('week', 'local', { anchor: '2026-10-05', now: 1 }), {
    title: 'Before the tag',
    publish: { caption: null, captions: {}, titles: {}, music: { source: 'own', tracks: {}, musicVolume: 100, filmVolume: 0 }, approved: true, publications: [{ postId: 'old', channelId: 'c', channel: 'Steeve', kind: 'reel', trial: false, at: '2026-11-11T18:00:00.000Z', sentAt: 1, caption: '', network: 'instagram', group: null }] },
  });
  const posts: PostizPost[] = [
    post('mine', '2026-11-13T18:00:00Z'),
    post('lower', '2026-11-16T18:00:00Z', 'queue', 'x', ['atelier']),
    post('old', '2026-11-11T18:00:00Z', 'queue', 'x', []),
    { ...post('twin', '2026-11-11T20:00:00Z', 'queue', 'x', []), group: 'g-old' },
    { ...post('old', '2026-11-11T18:00:00Z', 'queue', 'x', []), id: 'old-sibling', group: 'g-old' },
    post('sketch', '2026-11-15T07:00:00Z', 'queue', 'A p5 sketch', []),
    post('sketch-tagged', '2026-11-14T07:00:00Z', 'queue', 'Sketchbook', ['Sketchbook']),
  ];

  it('knows a post by the Atelier tag, by a recap’s publication, or by the group of one', () => {
    // `twin` and `old-sibling` share a Postiz group, but neither is tied to a recap: they stay out.
    const { mine, others } = atelierPosts(posts, [doc]);
    expect(mine.map((p) => p.id)).toEqual(['mine', 'lower', 'old']);
    expect(others).toBe(4);
    const grouped = atelierPosts([{ ...posts[2], group: 'g-old' }, posts[3]], [doc]);
    expect(grouped.mine.map((p) => p.id)).toEqual(['old', 'twin']);
  });

  it('draws only them, and says how many of another app’s it left out', () => {
    const items = plannedWeeks(posts, [doc], 'Europe/Paris').flatMap((w) => w.items.map((i) => i.postId));
    expect(items).toEqual(['old', 'mine', 'lower']);
    expect(hiddenInWeek(posts, [doc], 'Europe/Paris', '2026-11-09')).toBe(4);
    expect(hiddenInWeek(posts, [doc], 'Europe/Paris', '2026-11-16')).toBe(0);
  });

  it('keeps another app’s post taking its day: no free slot is offered there', () => {
    const now = new Date('2026-11-10T10:00:00Z');
    const days = weekStrip(posts, [doc], DEFAULT_RHYTHM, '2026-11-09', now);
    const sunday = days[6];
    expect(sunday.items).toEqual([]);
    expect(sunday.free).toEqual([]);
    // Without the sketch, Sunday's slot is free again.
    const without = weekStrip(posts.filter((p) => p.id !== 'sketch'), [doc], DEFAULT_RHYTHM, '2026-11-09', now);
    expect(without[6].free.map((d) => d.toISOString())).toEqual(['2026-11-15T09:00:00.000Z']);
  });
});
