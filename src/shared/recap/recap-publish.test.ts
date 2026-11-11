import { describe, expect, it } from 'vitest';
import { createRecapDoc, readRecapDoc, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { publishChecks } from './recap-publish';
import { DEFAULT_MUSIC, musicFor, readMusic, withMusic } from './recap-publish';
import { networkCaption, networkTitle, publicationGroups, withNetworkCaption, withNetworkTitle, withPublications } from './recap-publish';
import { NETWORKS, captionLength } from '../sources/postiz/networks';
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
    expect(doc.publish).toEqual({ caption: null, captions: {}, titles: {}, music: DEFAULT_MUSIC, approved: false, publications: [] });
    expect(readPublish({ caption: 3, approved: 'yes', publications: [{ postId: '' }, { postId: 'p1', channelId: 'c', kind: 'bogus', at: 'never' }] })).toEqual({
      caption: null,
      captions: {},
      titles: {},
      music: DEFAULT_MUSIC,
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

  it('fits the caption to each network, and keeps a network’s own words when he wrote some', () => {
    const long = withRecap(doc, { publish: { ...doc.publish, caption: `{heading}{at}\n${'A long day on the road. '.repeat(20)}\n{tags}` } });
    const r = resolveRecap(long);
    expect(networkCaption(long, r, 'ig', NETWORKS.instagram)).toMatchObject({ own: false, fitted: false });
    const bs = networkCaption(long, r, 'bs', NETWORKS.bluesky);
    expect(bs).toMatchObject({ own: false, fitted: true });
    expect(captionLength(bs.text, NETWORKS.bluesky)).toBeLessThanOrEqual(300);
    expect(bs.text.startsWith('October — Hobart')).toBe(true);
    const own = withRecap(long, { publish: withNetworkCaption({ ...long.publish, approved: true }, 'bs', 'Tasmania, in short. {tags}') });
    expect(own.publish.approved).toBe(false);
    expect(networkCaption(own, resolveRecap(own), 'bs', NETWORKS.bluesky)).toEqual({ text: 'Tasmania, in short. #hobart #bayoffires #cradlemountain #tasmania #australia', own: true, fitted: false });
    expect(withNetworkCaption(own.publish, 'bs', '  ').captions).toEqual({});
    expect(readRecapDoc(own, 'local')?.publish.captions).toEqual({ bs: 'Tasmania, in short. {tags}' });
  });

  it('titles a network from the heading, or from his own words there', () => {
    const r = resolveRecap(doc);
    expect(networkTitle(doc, r, 'yt', NETWORKS.youtube)).toBe('October');
    expect(networkTitle(doc, r, 'ig', NETWORKS.instagram)).toBe('');
    const own = withRecap(doc, { publish: withNetworkTitle(doc.publish, 'yt', '{month} in Tasmania') });
    expect(networkTitle(own, resolveRecap(own), 'yt', NETWORKS.youtube)).toBe('October in Tasmania');
    expect(withNetworkTitle(own.publish, 'yt', null).titles).toEqual({});
  });

  it('lays a library track over a Reel only where the account has a library, and keeps the approval', () => {
    const track = { id: '667', title: 'Oceanside', artist: 'Jasmine', image: null, seconds: 233, previewUrl: 'https://cdn/a.mp4' };
    const pub = withMusic({ ...doc.publish, approved: true }, { tracks: { instagram: track }, musicVolume: 80, filmVolume: 140 });
    expect(pub.approved).toBe(true);
    expect(musicFor(pub, 'instagram', 'reel')).toEqual({ track, musicVolume: 80, filmVolume: 100 });
    expect(musicFor(pub, 'instagram', 'carousel')).toBeNull();
    expect(musicFor(pub, 'instagram-standalone', 'reel')).toBeNull();
    expect(musicFor(pub, 'tiktok-business', 'reel')).toBeNull();
    expect(musicFor(pub, 'youtube', 'reel')).toBeNull();
    expect(musicFor(withMusic(pub, { source: 'own' }), 'instagram', 'reel')).toBeNull();
    expect(readMusic({ tracks: { instagram: { id: 'x', previewUrl: 'javascript:1', image: 'http://plain' } } }).tracks.instagram).toMatchObject({ previewUrl: null, image: null });
  });

  it('says before sending what the file is and what is worth a look', () => {
    const file = { size: '1080 × 1920', mbps: 16, lowered: 'Maximum → High', slides: 6 };
    const fine = publishChecks({ kind: 'reel', file, going: [{ label: 'Instagram', sounds: true }], unread: 0 });
    expect(fine).toEqual([{ level: 'ok', short: 'safe file', text: 'Safe file · 1080 × 1920 · 30 fps · 16 Mb/s · AAC 128 kb/s (Maximum → High for publishing)' }]);
    const look = publishChecks({ kind: 'reel', file, going: [{ label: 'Instagram', sounds: true }, { label: 'YouTube', sounds: false }, { label: 'Bluesky', sounds: false }], unread: 2 });
    expect(look.filter((c) => c.level === 'look').map((c) => c.short)).toEqual(['words to read', 'no sound on 2']);
    expect(look[2].text).toBe('No sound on YouTube, Bluesky: the recap has none of its own');
    expect(publishChecks({ kind: 'carousel', file, going: [{ label: 'X', sounds: false }], unread: 0 })).toEqual([{ level: 'ok', short: 'safe files', text: 'Safe files · 6 slides, pictures as JPEG, 1080 × 1920' }]);
  });

  it('proposes a carousel for a dump, a Reel for a calendar', () => {
    expect(defaultKind({ template: 'dump' }, 6)).toBe('carousel');
    expect(defaultKind({ template: 'month' }, 4)).toBe('reel');
    expect(defaultKind({ template: 'dump' }, 1)).toBe('reel');
  });
});
