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
import { localDay, slotsWithState, weekOf, wallClock, zonedInstant, type Rhythm } from '../sources/postiz/rhythm';
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

const firstLine = (s: string) => (s.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 80);

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

export interface StripDay {
  /** `YYYY-MM-DD` in the rhythm's zone. */
  day: string;
  /** `Mon 9`. */
  label: string;
  today: boolean;
  past: boolean;
  items: PlannedItem[];
  /** The rhythm's slots of that day still free: in the future, no post near them, no post that day. */
  free: Date[];
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The Monday `offset` weeks from `now`'s week, in the rhythm's zone, `YYYY-MM-DD`. */
export function mondayOf(now: Date, tz: string, offset = 0): string {
  const m = weekOf(now, tz);
  const d = new Date(`${m}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset * 7);
  return d.toISOString().slice(0, 10);
}

/** `9–15 Nov`, `30 Nov – 6 Dec`. */
export function weekLabel(monday: string): string {
  const a = new Date(`${monday}T12:00:00Z`);
  const b = new Date(a.getTime() + 6 * 86400000);
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()} ${MO[b.getUTCMonth()]}` : `${a.getUTCDate()} ${MO[a.getUTCMonth()]} – ${b.getUTCDate()} ${MO[b.getUTCMonth()]}`;
}

/**
 * The WEEK STRIP (lab 14, his pick): the seven days of the week starting
 * `monday`, each with its posts in time order and the rhythm's slots still
 * free — what the gallery's *Planned* draws, a week at a time.
 */
export function weekStrip(posts: readonly PostizPost[], recaps: readonly RecapDoc[], rhythm: Rhythm, monday: string, now: Date): StripDay[] {
  const tz = rhythm.timeZone;
  const items = plannedWeeks(posts, recaps, tz).find((w) => w.monday === monday)?.items ?? [];
  const today = localDay(now, tz);
  const live = posts.filter((p) => p.state !== 'error' && p.state !== 'draft').map((p) => new Date(p.publishDate));
  const start = zonedInstant(Number(monday.slice(0, 4)), Number(monday.slice(5, 7)), Number(monday.slice(8, 10)), 0, 0, tz);
  const slots = slotsWithState(rhythm, live, new Date(Math.max(now.getTime(), start.getTime() - 1)), 30).filter((s) => !s.taken);
  return Array.from({ length: 7 }, (_, k) => {
    const d = new Date(`${monday}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + k);
    const day = d.toISOString().slice(0, 10);
    const its = items.filter((i) => localDay(i.at, tz) === day);
    const busy = its.some((i) => i.state !== 'error' && i.state !== 'draft');
    const w = wallClock(new Date(`${day}T12:00:00Z`), 'UTC');
    return {
      day,
      label: `${WD[d.getUTCDay()]} ${w.d}`,
      today: day === today,
      past: day < today,
      items: its,
      free: busy ? [] : slots.filter((s) => localDay(s.at, tz) === day).map((s) => s.at),
    };
  });
}
