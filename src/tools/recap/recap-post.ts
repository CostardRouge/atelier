/**
 * Sending a recap's post to the person's Postiz — the one routine behind
 * Export › *Publish* and `recap.schedule` (lab 12): the files checked before
 * a byte leaves, uploaded one by one, the post made, and the publication the
 * recap keeps.
 */

import type { Publication, PublishKind } from '../../shared/recap/recap-publish';
import { postProblem, uploadProblem, type PostizChannel, type PostizClient } from '../../shared/sources/postiz/client';

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
