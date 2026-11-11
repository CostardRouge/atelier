import { describe, expect, it } from 'vitest';
import { NETWORKS, captionLength, fitCaption, hashtagsIn, musicLibrary, networkOf, networkPlan, postMoments, readTracks, settingsFor, titleFrom } from './networks';

const BASE =
  'A year ago this week — Tasmania, east coast. 📍 Bicheno\nWineglass Bay at sunrise, the Friendly Beaches at noon, then the long drive north to the Bay of Fires. We slept by the sea and woke to wallabies on the sand, and nobody else for miles around the bay.\n#tasmania #wineglassbay #freycinet #bayoffires #roadtrip';

describe('networkOf', () => {
  it('reads a channel’s network from its provider', () => {
    expect(networkOf('instagram-standalone')?.id).toBe('instagram');
    expect(networkOf('tiktok-business')?.id).toBe('tiktok');
    expect(networkOf('X')?.id).toBe('x');
    expect(networkOf('linkedin')).toBeNull();
  });
  it('knows which channels have a music library through Postiz', () => {
    expect(musicLibrary('instagram')).toEqual({ tool: 'audioSearch', key: 'audio' });
    expect(musicLibrary('instagram-standalone')).toBeNull();
    expect(musicLibrary('tiktok-business')).toEqual({ tool: 'musicSearch', key: 'music' });
    expect(musicLibrary('tiktok')).toBeNull();
  });
});

describe('networkPlan', () => {
  it('sends the film everywhere, under each network’s word', () => {
    expect(networkPlan(NETWORKS.instagram, 'reel', ['video'], 28)).toMatchObject({ ok: true, as: 'Reel', take: [0] });
    expect(networkPlan(NETWORKS.youtube, 'reel', ['video'], 28)).toMatchObject({ ok: true, as: 'Short' });
  });
  it('refuses a film longer than a network takes, saying so', () => {
    const r = networkPlan(NETWORKS.x, 'reel', ['video'], 200);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toMatch(/140 s/);
  });
  it('keeps a story for Instagram', () => {
    expect(networkPlan(NETWORKS.instagram, 'story', ['video']).ok).toBe(true);
    expect(networkPlan(NETWORKS.tiktok, 'story', ['video']).ok).toBe(false);
  });
  it('cuts a carousel to the first pictures where clips cannot mix, and says it', () => {
    const media = ['picture', 'video', 'picture', 'picture', 'picture', 'picture'] as const;
    const r = networkPlan(NETWORKS.bluesky, 'carousel', media);
    expect(r).toMatchObject({ ok: true, take: [0, 2, 3, 4], as: '4 pictures' });
    expect(r.ok && r.note).toMatch(/first 4 pictures of 6/);
    expect(networkPlan(NETWORKS.threads, 'carousel', media)).toMatchObject({ ok: true, take: [0, 1, 2, 3, 4, 5], note: null });
  });
  it('gives Instagram ten slides of a longer carousel', () => {
    const r = networkPlan(NETWORKS.instagram, 'carousel', Array.from({ length: 12 }, () => 'picture' as const));
    expect(r.ok && r.take.length).toBe(10);
    expect(r.ok && r.as).toBe('Carousel · 10');
  });
  it('sends no carousel to YouTube', () => {
    expect(networkPlan(NETWORKS.youtube, 'carousel', ['picture', 'picture']).ok).toBe(false);
  });
});

describe('fitCaption', () => {
  it('leaves a text that fits alone', () => {
    expect(fitCaption(BASE, NETWORKS.instagram)).toBe(BASE);
  });
  it('cuts at a sentence and keeps two hashtags', () => {
    for (const id of ['bluesky', 'x'] as const) {
      const out = fitCaption(BASE, NETWORKS[id]);
      expect(captionLength(out, NETWORKS[id])).toBeLessThanOrEqual(NETWORKS[id].captionMax);
      expect(hashtagsIn(out)).toEqual(['#tasmania', '#wineglassbay']);
      expect(out.split('\n\n')[0]).toMatch(/[.!?…]$/);
    }
  });
  it('keeps every hashtag where the text fits', () => {
    expect(fitCaption(BASE, NETWORKS.threads)).toBe(BASE);
  });
  it('counts an emoji twice on X', () => {
    expect(captionLength('📍a', NETWORKS.x)).toBe(3);
    expect(captionLength('📍a', NETWORKS.bluesky)).toBe(2);
  });
  it('cuts a text with no sentence end at a word', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const out = fitCaption(long, NETWORKS.x);
    expect(out.endsWith('…')).toBe(true);
    expect(captionLength(out, NETWORKS.x)).toBeLessThanOrEqual(280);
  });
});

describe('titleFrom', () => {
  it('takes the first line without tags or pin', () => {
    expect(titleFrom('#tag\nA year ago — Tasmania 📍 Bicheno #tasmania\nmore', 100)).toBe('A year ago — Tasmania Bicheno');
  });
  it('cuts at a word', () => {
    const t = titleFrom('A very long title that goes on and on about the east coast of Tasmania and its bays', 40);
    expect([...t].length).toBeLessThanOrEqual(40);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('settingsFor', () => {
  it('writes Instagram’s trial Reel, collaborator and library track', () => {
    const s = settingsFor({ identifier: 'instagram', kind: 'reel', media: ['video'], caption: 'x', trial: true, collaborators: ['@vanessa'], music: { track: { id: '9', title: 'Oceanside', artist: 'Jasmine', image: null }, musicVolume: 80, filmVolume: 0 } });
    expect(s).toEqual({ __type: 'instagram', post_type: 'post', is_trial_reel: true, graduation_strategy: 'SS_PERFORMANCE', collaborators: [{ label: 'vanessa' }], audio: { id: '9', title: 'Oceanside', artist: 'Jasmine', audio_volume: 80, video_volume: 0 } });
  });
  it('never sends a library track on a carousel, nor where the channel has no library', () => {
    const music = { track: { id: '9', title: 't', artist: 'a', image: null }, musicVolume: 50, filmVolume: 50 };
    expect(settingsFor({ identifier: 'instagram', kind: 'carousel', media: ['picture'], caption: 'x', music }).audio).toBeUndefined();
    expect(settingsFor({ identifier: 'instagram-standalone', kind: 'reel', media: ['video'], caption: 'x', music }).audio).toBeUndefined();
  });
  it('gives TikTok every field its schema requires, published directly', () => {
    const s = settingsFor({ identifier: 'tiktok', kind: 'reel', media: ['video'], caption: 'Tasmania, east coast\n#tasmania' });
    expect(s).toMatchObject({ __type: 'tiktok', title: 'Tasmania, east coast', privacy_level: 'PUBLIC_TO_EVERYONE', duet: true, stitch: true, comment: true, autoAddMusic: 'no', brand_content_toggle: false, brand_organic_toggle: false, content_posting_method: 'DIRECT_POST' });
    expect(settingsFor({ identifier: 'tiktok', kind: 'carousel', media: ['picture'], caption: 'x' })).toMatchObject({ duet: false, stitch: false });
  });
  it('gives YouTube a title, a visibility and tags from the hashtags', () => {
    const s = settingsFor({ identifier: 'youtube', kind: 'reel', media: ['video'], caption: 'words\n#tasmania #freycinet', title: 'A year ago: Tasmania' });
    expect(s).toEqual({ __type: 'youtube', title: 'A year ago: Tasmania', type: 'public', selfDeclaredMadeForKids: 'no', tags: [{ value: 'tasmania', label: 'tasmania' }, { value: 'freycinet', label: 'freycinet' }] });
  });
  it('sends Bluesky and Threads their type alone, X who may reply', () => {
    expect(settingsFor({ identifier: 'bluesky', kind: 'reel', media: ['video'], caption: 'x' })).toEqual({ __type: 'bluesky' });
    expect(settingsFor({ identifier: 'threads', kind: 'reel', media: ['video'], caption: 'x' })).toEqual({ __type: 'threads' });
    expect(settingsFor({ identifier: 'x', kind: 'reel', media: ['video'], caption: 'x' })).toEqual({ __type: 'x', who_can_reply_post: 'everyone', community: '' });
  });
});

describe('readTracks', () => {
  it('reads a search’s output, the duration in seconds', () => {
    const t = readTracks({ output: [{ id: '1', title: 'Oceanside', artist: 'Jasmine', image: 'https://x/y.jpg', duration: 232746, previewUrl: 'https://cdn/a.mp4' }, { title: 'no id' }, { id: 2, duration: 15 }] });
    expect(t).toEqual([
      { id: '1', title: 'Oceanside', artist: 'Jasmine', image: 'https://x/y.jpg', seconds: 233, previewUrl: 'https://cdn/a.mp4' },
      { id: '2', title: 'Untitled', artist: '', image: null, seconds: 15, previewUrl: null },
    ]);
  });
  it('never keeps a preview that is not https', () => {
    expect(readTracks([{ id: '1', previewUrl: 'javascript:alert(1)' }])[0].previewUrl).toBeNull();
  });
});

describe('postMoments', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 13, h));
  it('counts one recap on several networks once, even two hours apart', () => {
    expect(postMoments([{ at: at(18), channelId: 'ig' }, { at: at(18), channelId: 'tt' }, { at: at(20), channelId: 'yt' }])).toEqual([at(18)]);
  });
  it('never folds two posts of one channel, nor posts far apart', () => {
    expect(postMoments([{ at: at(8), channelId: 'ig' }, { at: at(9), channelId: 'ig' }, { at: at(18), channelId: 'tt' }])).toEqual([at(8), at(9), at(18)]);
  });
});
