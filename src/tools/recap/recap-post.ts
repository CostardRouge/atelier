/**
 * Sending a recap to the person's Postiz — the one routine behind Export ›
 * *Publish* and `recap.schedule` (lab 12; several networks since lab 18): the
 * recap rendered ONCE, what each network takes of it decided (`networkPlan`),
 * the files checked before a byte leaves and each uploaded once, then ONE post
 * per network — each made, and failing, alone — and the publications the
 * recap keeps, one send being one group.
 */

import type { Publication, PublishKind } from '../../shared/recap/recap-publish';
import { failureHint, postProblem, uploadProblem, type PostizChannel, type PostizClient, type PostizMedia } from '../../shared/sources/postiz/client';
import { mediaTypeOf, networkOf, networkPlan, type PostMusic } from '../../shared/sources/postiz/networks';
import { putPostThumb } from './recap-store';

/** About 240 px wide: what the gallery's week strip shows of a post. */
const THUMB_W = 240;

/** A frame of `file` scaled to the vignette: the picture itself, or a video's frame at one second. */
async function vignetteOf(file: File): Promise<Blob | null> {
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  let release = () => {};
  if (file.type.startsWith('image/')) {
    const bmp = await createImageBitmap(file);
    source = bmp;
    w = bmp.width;
    h = bmp.height;
    release = () => bmp.close();
  } else if (file.type.startsWith('video/')) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = url;
    release = () => URL.revokeObjectURL(url);
    await new Promise<void>((done, fail) => {
      video.onloadeddata = () => done();
      video.onerror = () => fail(new Error('no frame'));
    });
    await new Promise<void>((done) => {
      video.onseeked = () => done();
      video.currentTime = Math.min(1, (video.duration || 2) / 2);
    });
    source = video;
    w = video.videoWidth;
    h = video.videoHeight;
  } else return null;
  try {
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = Math.round((h / w) * THUMB_W);
    canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.82));
  } finally {
    release();
  }
}

/** One network a recap goes out on, with what is its own there. */
export interface Destination {
  channel: PostizChannel;
  /** The words as that network gets them, already fitted. */
  caption: string;
  title?: string | null;
  at: Date | 'now' | 'draft';
  music?: PostMusic | null;
}

export interface SendPosts {
  client: PostizClient;
  kind: PublishKind;
  files: readonly File[];
  /** The film's length, for the networks that cap it. */
  seconds: number | null;
  destinations: readonly Destination[];
  trial: boolean;
  graduate: 'auto' | 'manual';
  collaborators: readonly string[];
  signal: AbortSignal;
  /** Before each file leaves: its place, of how many. */
  onFile?: (n: number, of: number) => void;
  /** Before each post is made: its place, of how many, and where. */
  onPost?: (n: number, of: number, channel: string) => void;
}

export interface SendResult {
  sent: Publication[];
  /** The networks nothing was scheduled on, each with its reason. */
  failed: { channel: string; why: string }[];
  /** What a network was sent less of (a carousel cut to its count). */
  notes: string[];
}

const said = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function sendPosts(s: SendPosts): Promise<SendResult> {
  const problem = postProblem(s.kind, s.files);
  if (problem) throw new Error(problem);
  if (!s.destinations.length) throw new Error('Choose where it goes: no network is ticked.');
  const media = s.files.map((f) => mediaTypeOf(f.type));
  const failed: SendResult['failed'] = [];
  const notes: string[] = [];
  const going: { d: Destination; take: number[] }[] = [];
  for (const d of s.destinations) {
    const net = networkOf(d.channel.identifier);
    const plan = net ? networkPlan(net, s.kind, media, s.seconds) : ({ ok: false, why: `Recap does not post to ${d.channel.identifier} yet.`, short: 'not yet' } as const);
    if (!plan.ok) {
      failed.push({ channel: d.channel.name, why: plan.why });
      continue;
    }
    const heavy = plan.take.map((i) => uploadProblem(s.files[i])).find(Boolean);
    if (heavy) {
      failed.push({ channel: d.channel.name, why: heavy });
      continue;
    }
    if (plan.note) notes.push(plan.note);
    going.push({ d, take: plan.take });
  }
  if (!going.length) throw new Error(failed.map((f) => `${f.channel}: ${f.why}`).join(' '));

  // Each file leaves once, whatever the number of networks that take it.
  const needed = [...new Set(going.flatMap((g) => g.take))].sort((a, b) => a - b);
  const held = new Map<number, PostizMedia>();
  for (const [n, i] of needed.entries()) {
    s.onFile?.(n + 1, needed.length);
    held.set(i, await s.client.upload(s.files[i], s.signal));
  }

  const group = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const sent: Publication[] = [];
  for (const [n, { d, take }] of going.entries()) {
    if (s.signal.aborted) {
      failed.push({ channel: d.channel.name, why: 'Cancelled before it was sent.' });
      continue;
    }
    s.onPost?.(n + 1, going.length, d.channel.name);
    const instagram = networkOf(d.channel.identifier)?.id === 'instagram';
    const trial = instagram && s.kind === 'reel' && s.trial;
    try {
      const ids = await s.client.createPost(
        { channel: d.channel, kind: s.kind, caption: d.caption, media: take.map((i) => held.get(i)!), at: d.at, trial, graduate: s.graduate, collaborators: instagram ? s.collaborators : [], title: d.title, music: d.music },
        s.signal,
      );
      if (!ids.length) throw new Error('Postiz took the post but gave no id back — look in Postiz before sending it again.');
      // The strip's vignette of what went: best effort, never in the way of the post.
      void vignetteOf(s.files[take[0]])
        .then((blob) => blob && putPostThumb(ids[0], blob))
        .catch(() => undefined);
      sent.push({
        postId: ids[0],
        channelId: d.channel.id,
        channel: d.channel.name,
        network: d.channel.identifier,
        group,
        kind: s.kind,
        trial,
        at: d.at instanceof Date ? d.at.toISOString() : d.at === 'now' ? new Date().toISOString() : null,
        sentAt: Date.now(),
        caption: d.caption,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') failed.push({ channel: d.channel.name, why: 'Cancelled before it was sent.' });
      else failed.push({ channel: d.channel.name, why: said(err) });
    }
  }
  return { sent, failed, notes };
}

const stop = (t: string) => (/[.!?…]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

/** What a send did, in sentences a person reads: where it went, then each network that did not get it, why, and what to do. */
export function sendSummary(r: SendResult, where: string): string {
  const names = r.sent.map((p) => p.channel);
  const on = names.length === 1 ? names[0] : `${names.length} accounts`;
  const head = r.sent.length ? `${where} on ${on}.` : 'Nothing was sent.';
  const failed = r.failed.map((f) => {
    const hint = failureHint(f.why);
    return `Not on ${f.channel}: ${stop(f.why)}${hint ? ` ${hint}` : ''}`;
  });
  return [head, ...r.notes, ...failed].join(' ');
}
