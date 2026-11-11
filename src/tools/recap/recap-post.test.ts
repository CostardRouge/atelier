import { describe, expect, it } from 'vitest';
import type { PostizChannel, PostizClient, PostRequest } from '../../shared/sources/postiz/client';
import { sendPosts, sendSummary } from './recap-post';

const channel = (id: string, identifier: string): PostizChannel => ({ id, name: id, identifier, picture: null, disabled: false });
const file = (name: string, type: string) => new File(['x'], name, { type });

/** A Postiz that takes every upload and every post, but the networks named in `refuse`. */
function fake(refuse: Record<string, string> = {}) {
  const uploads: string[] = [];
  const posts: PostRequest[] = [];
  const client = {
    upload: async (f: File) => {
      uploads.push(f.name);
      return { id: `m-${f.name}`, path: `https://p/uploads/${f.name}` };
    },
    createPost: async (req: PostRequest) => {
      const why = refuse[req.channel.identifier];
      if (why) throw new Error(why);
      posts.push(req);
      return [`post-${req.channel.id}`];
    },
  } as unknown as PostizClient;
  return { client, uploads, posts };
}

const base = { trial: false, graduate: 'auto' as const, collaborators: ['vanessa'], signal: new AbortController().signal };

describe('sending a recap to several networks', () => {
  it('uploads the film once and makes one post per network, in one group', async () => {
    const { client, uploads, posts } = fake();
    const at = new Date('2026-11-13T18:00:00Z');
    const r = await sendPosts({ ...base, client, kind: 'reel', files: [file('week.mp4', 'video/mp4')], seconds: 28, destinations: ['instagram', 'youtube', 'bluesky'].map((n) => ({ channel: channel(n, n), caption: `words for ${n}`, at })) });
    expect(uploads).toEqual(['week.mp4']);
    expect(posts.map((p) => [p.channel.id, p.caption, p.media.length])).toEqual([['instagram', 'words for instagram', 1], ['youtube', 'words for youtube', 1], ['bluesky', 'words for bluesky', 1]]);
    expect(new Set(r.sent.map((p) => p.group)).size).toBe(1);
    expect(r.sent.map((p) => p.network)).toEqual(['instagram', 'youtube', 'bluesky']);
    expect(r.failed).toEqual([]);
  });

  it('invites the collaborator and tries the Reel on Instagram only', async () => {
    const { client, posts } = fake();
    const r = await sendPosts({ ...base, trial: true, client, kind: 'reel', files: [file('week.mp4', 'video/mp4')], seconds: 28, destinations: [{ channel: channel('ig', 'instagram'), caption: 'a', at: 'now' }, { channel: channel('tt', 'tiktok'), caption: 'a', at: 'now' }] });
    expect(posts.map((p) => [p.trial, p.collaborators])).toEqual([[true, ['vanessa']], [false, []]]);
    expect(r.sent.map((p) => p.trial)).toEqual([true, false]);
  });

  it('lets a network fail alone, and says which', async () => {
    const { client } = fake({ tiktok: 'unaudited_client_can_only_post_to_private_accounts' });
    const r = await sendPosts({ ...base, client, kind: 'reel', files: [file('week.mp4', 'video/mp4')], seconds: 28, destinations: [{ channel: channel('ig', 'instagram'), caption: 'a', at: 'draft' }, { channel: channel('tt', 'tiktok'), caption: 'a', at: 'draft' }] });
    expect(r.sent.map((p) => p.channelId)).toEqual(['ig']);
    expect(r.failed).toEqual([{ channel: 'tt', why: 'unaudited_client_can_only_post_to_private_accounts' }]);
    const said = sendSummary(r, 'Sent to Postiz as a draft (Reel)');
    expect(said).toMatch(/^Sent to Postiz as a draft \(Reel\) on ig\. Not on tt: unaudited.*TikTok lets an app/);
  });

  it('cuts a carousel to what each network holds, uploading only what goes somewhere', async () => {
    const { client, uploads, posts } = fake();
    const files = [file('1.jpg', 'image/jpeg'), file('2.mp4', 'video/mp4'), file('3.jpg', 'image/jpeg'), file('4.jpg', 'image/jpeg'), file('5.jpg', 'image/jpeg'), file('6.jpg', 'image/jpeg')];
    const r = await sendPosts({ ...base, client, kind: 'carousel', files, seconds: null, destinations: [{ channel: channel('bs', 'bluesky'), caption: 'a', at: 'now' }, { channel: channel('yt', 'youtube'), caption: 'a', at: 'now' }] });
    expect(uploads).toEqual(['1.jpg', '3.jpg', '4.jpg', '5.jpg']);
    expect(posts[0].media.map((m) => m.id)).toEqual(['m-1.jpg', 'm-3.jpg', 'm-4.jpg', 'm-5.jpg']);
    expect(r.notes[0]).toMatch(/first 4 pictures of 6/);
    expect(r.failed[0]).toMatchObject({ channel: 'yt', why: expect.stringMatching(/video only/) });
  });

  it('refuses before a byte leaves when no network can take it', async () => {
    const { client, uploads } = fake();
    await expect(sendPosts({ ...base, client, kind: 'story', files: [file('s.mp4', 'video/mp4')], seconds: 9, destinations: [{ channel: channel('tt', 'tiktok'), caption: 'a', at: 'now' }] })).rejects.toThrow(/story is Instagram/);
    await expect(sendPosts({ ...base, client, kind: 'reel', files: [file('s.mp4', 'video/mp4')], seconds: 9, destinations: [] })).rejects.toThrow(/no network is ticked/);
    expect(uploads).toEqual([]);
  });
});
