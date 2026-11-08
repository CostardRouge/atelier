/**
 * The gallery's *Planned* (lab 12): what goes out on his Instagram, week by
 * week — read from his Postiz (`GET /posts`), each post tied to the recap
 * that sent it when one did (`RecapDoc.publish.publications`), the others
 * shown by their caption's first line, so the rhythm reads true whatever
 * scheduled them.
 *
 * Pure and DOM-free.
 */

import type { PostizPost, PostState } from '../sources/postiz/client';
import { localDay, weekOf } from '../sources/postiz/rhythm';
import type { RecapDoc } from './recap-doc';
import type { PublishKind } from './recap-publish';

export interface PlannedItem {
  postId: string;
  at: Date;
  state: PostState;
  /** The recap that sent it, when one did. */
  recapId: string | null;
  title: string;
  kind: PublishKind | null;
  trial: boolean;
  error: string | null;
  url: string | null;
}

export interface PlannedWeek {
  /** The Monday that starts it, `YYYY-MM-DD` in the rhythm's zone. */
  monday: string;
  items: PlannedItem[];
}

const firstLine = (s: string) => (s.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 80) || 'A post';

/** The posts, newest week last, each week's in time order; tied to their recaps. */
export function plannedWeeks(posts: readonly PostizPost[], recaps: readonly RecapDoc[], tz: string): PlannedWeek[] {
  const byPost = new Map<string, { doc: RecapDoc; kind: PublishKind; trial: boolean }>();
  for (const doc of recaps) for (const p of doc.publish.publications) byPost.set(p.postId, { doc, kind: p.kind, trial: p.trial });
  const weeks = new Map<string, PlannedItem[]>();
  for (const post of posts) {
    const at = new Date(post.publishDate);
    if (Number.isNaN(at.getTime())) continue;
    const from = byPost.get(post.id);
    const item: PlannedItem = {
      postId: post.id,
      at,
      state: post.state,
      recapId: from?.doc.id ?? null,
      title: from ? from.doc.title : firstLine(post.content),
      kind: from?.kind ?? null,
      trial: from?.trial ?? false,
      error: post.error,
      url: post.releaseURL,
    };
    const key = weekOf(at, tz);
    weeks.set(key, [...(weeks.get(key) ?? []), item]);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monday, items]) => ({ monday, items: items.sort((a, b) => a.at.getTime() - b.at.getTime()) }));
}

/** The closed section's line: `2 this week · next Tue 17 Nov · 9:00`. */
export function plannedPeek(weeks: readonly PlannedWeek[], tz: string, now: Date, label: (d: Date) => string): string {
  const all = weeks.flatMap((w) => w.items);
  const thisWeek = all.filter((i) => weekOf(i.at, tz) === weekOf(now, tz) && i.state !== 'draft').length;
  const next = all.find((i) => i.state === 'queue' && i.at.getTime() > now.getTime());
  const failed = all.filter((i) => i.state === 'error').length;
  return [thisWeek ? `${thisWeek} this week` : null, next ? `next ${label(next.at)}` : null, failed ? `${failed} failed` : null].filter(Boolean).join(' · ') || 'nothing planned';
}

/** Two posts the same local day — what the rhythm never wants, said on the week. */
export function sameDayClash(week: PlannedWeek, tz: string): boolean {
  const days = week.items.filter((i) => i.state !== 'draft' && i.state !== 'error').map((i) => localDay(i.at, tz));
  return new Set(days).size < days.length;
}
