import { describe, expect, it } from 'vitest';
import { createRecapDoc, readRecapDoc, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { publicationGroups, withPublications } from './recap-publish';
import { DEFAULT_CAPTION, captionText, defaultKind, hashtagOf, placeTags, readPublish, withCaption, withPublication } from './recap-publish';
import { resolveRecap } from './recap-slots';

const pic = (key: string, day: string, extra: Partial<RecapPicture> = {}): RecapPicture => ({ key, origin: 'local', name: key, kind: 'photo', day, ...extra });

describe('a recap’s post', () => {
  let doc = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
  doc = withPictures(doc, [
    pic('a', '2026-10-01', { place: 'Hobart', region: 'Tasmania', country: 'Australia' }),
    pic('b', '2026-10-02', { place: 'Hobart', region: 'Tasmania', country: 'Australia' }),
    pic('c', '2026-10-05', { place: 'Bay of Fires', region: 'Tasmania', country: 'Australia' }),
    pic('d', '2026-10-09', { place: 'Cradle Mountain', region: 'Tasmania', country: 'Australia' }),
  ]);

  it('reads nothing into an old recap: Recap’s caption, unapproved, nothing sent', () => {
    expect(doc.publish).toEqual({ caption: null, approved: false, publications: [] });
    expect(readPublish({ caption: 3, approved: 'yes', publications: [{ postId: '' }, { postId: 'p1', channelId: 'c', kind: 'bogus', at: 'never' }] })).toEqual({
      caption: null,
      approved: false,
      publications: [{ postId: 'p1', channelId: 'c', channel: '', network: 'instagram', group: null, kind: 'reel', trial: false, at: null, sentAt: 0, caption: '' }],
    });
  });

  it('turns places into hashtags, the most pictured town first', () => {
    expect(hashtagOf('Margaret River')).toBe('#margaretriver');
    expect(hashtagOf('Ésperance')).toBe('#esperance');
    expect(hashtagOf('42')).toBeNull();
    expect(placeTags(doc.pictures)).toEqual(['#hobart', '#bayoffires', '#cradlemountain', '#tasmania', '#australia']);
  });

  it('writes Recap’s own caption: the title, the route, the tags', () => {
    const text = captionText(doc, resolveRecap(doc));
    expect(text).toBe('OCTOBER — Hobart\nHobart → Bay of Fires → Cradle Mountain\n\n#hobart #bayoffires #cradlemountain #tasmania #australia'.replace('OCTOBER', 'October'));
  });

  it('fills his own template, the pin as 📍, and folds what is empty', () => {
    const own = withRecap(doc, { publish: withCaption(doc.publish, 'A year ago — {place}\n{nothing}\n\n\n\n{tags}') });
    expect(captionText(own, resolveRecap(own))).toBe('A year ago — 📍 Hobart\n{nothing}\n\n#hobart #bayoffires #cradlemountain #tasmania #australia');
  });

  it('takes the approval back when the words change, never when they stay', () => {
    const approved = { ...doc.publish, approved: true };
    expect(withCaption(approved, DEFAULT_CAPTION)).toBe(approved);
    expect(withCaption(approved, 'New words').approved).toBe(false);
    const sent = withPublication(doc.publish, { postId: 'p1', channelId: 'c', channel: 'Steeve', kind: 'reel', trial: true, at: '2026-11-17T08:00:00.000Z', sentAt: 5, caption: 'x', network: 'instagram', group: null });
    expect(sent.approved).toBe(true);
    expect(readRecapDoc(withRecap(doc, { publish: sent }), 'local')?.publish.publications[0]).toMatchObject({ postId: 'p1', trial: true });
  });

  it('keeps one send to several networks as one group, and reads an older publication as Instagram alone', () => {
    const pub = (postId: string, network: string, group: string | null, sentAt: number) => ({ postId, channelId: network, channel: network, kind: 'reel' as const, trial: false, at: null, sentAt, caption: '', network, group });
    const kept = withPublications(doc.publish, [pub('a', 'instagram', 'g1', 10), pub('b', 'tiktok', 'g1', 10), pub('c', 'bluesky', 'g2', 20)]);
    expect(publicationGroups(kept.publications).map((g) => g.map((p) => p.postId))).toEqual([['c'], ['a', 'b']]);
    expect(readPublish({ publications: [{ postId: 'old', channelId: 'c' }] }).publications[0]).toMatchObject({ network: 'instagram', group: null });
    expect(withPublications(doc.publish, [])).toBe(doc.publish);
  });

  it('proposes a carousel for a dump, a Reel for a calendar', () => {
    expect(defaultKind({ template: 'dump' }, 6)).toBe('carousel');
    expect(defaultKind({ template: 'month' }, 4)).toBe('reel');
    expect(defaultKind({ template: 'dump' }, 1)).toBe('reel');
  });
});
