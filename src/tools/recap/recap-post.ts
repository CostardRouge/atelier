/**
 * Sending a recap's post to the person's Postiz — the one routine behind
 * Export › *Publish* and `recap.schedule` (lab 12): the files checked before
 * a byte leaves, uploaded one by one, the post made, and the publication the
 * recap keeps.
 */

import type { Publication, PublishKind } from '../../shared/recap/recap-publish';
import { postProblem, uploadProblem, type PostizChannel, type PostizClient } from '../../shared/sources/postiz/client';
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

export interface SendPost {
  client: PostizClient;
  channel: PostizChannel;
  kind: PublishKind;
  caption: string;
  files: readonly File[];
  at: Date | 'now' | 'draft';
  trial: boolean;
  graduate: 'auto' | 'manual';
  collaborators: readonly string[];
  signal: AbortSignal;
  /** Before each file leaves: its place, of how many. */
  onFile?: (n: number, of: number) => void;
}

export async function sendPost(s: SendPost): Promise<Publication> {
  const problem = postProblem(s.kind, s.files) ?? s.files.map(uploadProblem).find(Boolean) ?? null;
  if (problem) throw new Error(problem);
  const media = [];
  for (const [i, f] of s.files.entries()) {
    s.onFile?.(i + 1, s.files.length);
    media.push(await s.client.upload(f, s.signal));
  }
  const trial = s.kind === 'reel' && s.trial;
  const ids = await s.client.createPost({ channel: s.channel, kind: s.kind, caption: s.caption, media, at: s.at, trial, graduate: s.graduate, collaborators: s.collaborators }, s.signal);
  if (!ids.length) throw new Error('Postiz took the post but gave no id back — look in Postiz before sending it again.');
  // The strip's vignette of what went: best effort, never in the way of the post.
  void vignetteOf(s.files[0])
    .then((blob) => blob && putPostThumb(ids[0], blob))
    .catch(() => undefined);
  return {
    postId: ids[0],
    channelId: s.channel.id,
    channel: s.channel.name,
    kind: s.kind,
    trial,
    at: s.at instanceof Date ? s.at.toISOString() : s.at === 'now' ? new Date().toISOString() : null,
    sentAt: Date.now(),
    caption: s.caption,
  };
}
