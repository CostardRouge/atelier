import { describe, expect, it } from 'vitest';
import type { PostizPost } from '../sources/postiz/client';
import { createRecapDoc, withRecap } from './recap-doc';
import { plannedPeek, plannedWeeks, sameDayClash } from './recap-planned';

const post = (id: string, at: string, state: PostizPost['state'] = 'queue', content = 'A caption\nmore'): PostizPost => ({ id, group: null, content, publishDate: at, state, releaseURL: null, error: state === 'error' ? 'media' : null, channel: null });

describe('the planned weeks', () => {
  const doc = withRecap(createRecapDoc('week', 'local', { anchor: '2026-10-05', now: 1 }), {
    title: 'Tasmania · week 45',
    publish: { caption: null, approved: true, publications: [{ postId: 'p2', channelId: 'c', channel: 'Steeve', kind: 'reel', trial: true, at: '2026-11-17T08:00:00.000Z', sentAt: 1, caption: '' }] },
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
