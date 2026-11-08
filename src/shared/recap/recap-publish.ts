/**
 * A recap's POST (lab 12, his yes of 2026-11-08): the caption it goes out
 * with, whether the person approved it, and the publications it made through
 * his Postiz.
 *
 * - The caption is a TEMPLATE with Recap's words (`{heading}`, `{place}`,
 *   `{places}`, `{month}`… and `{tags}`, hashtags drawn from the places),
 *   filled when it is sent — so a recap re-dressed or refilled keeps a true
 *   caption. Null = the recap's own default (`DEFAULT_CAPTION`).
 * - `approved`: an agent may WRITE a caption, only the person approves it —
 *   his flow «générer les textes, les valider, les publier». Any change to the
 *   words takes the approval back. Scheduling from the editor approves (the
 *   person pressed the button on what they read); an agent's schedule asks
 *   for an approved caption.
 * - `publications`: what was sent, its Postiz post, when it goes out and as
 *   what — what the gallery's *Planned* reads beside Postiz's own state.
 *
 * Pure and DOM-free.
 */

import { PIN } from './recap-places';
import type { ResolvedRecap } from './recap-slots';
import type { RecapDoc, RecapPicture } from './recap-doc';

/** `{word}` replaced by its value; an unknown word left as typed (`recap-slots.ts`'s `fillText`, here without importing it: `recap-doc.ts` reads this module). */
const fillText = (text: string, vars: Readonly<Record<string, string>>) => text.replace(/\{(\w+)\}/g, (all, name: string) => vars[name] ?? all);

export type PublishKind = 'reel' | 'carousel' | 'story';
export const PUBLISH_KINDS: readonly PublishKind[] = ['reel', 'carousel', 'story'];

export interface Publication {
  /** Postiz's post id. */
  postId: string;
  channelId: string;
  /** The channel's name when it was sent, for a gallery that cannot ask. */
  channel: string;
  kind: PublishKind;
  trial: boolean;
  /** ISO: when it goes out (or went out); null for a draft left in Postiz. */
  at: string | null;
  /** When Recap sent it. */
  sentAt: number;
  /** The caption as it went, filled. */
  caption: string;
}

export interface RecapPublish {
  /** The caption's template; null = `DEFAULT_CAPTION`. */
  caption: string | null;
  approved: boolean;
  publications: Publication[];
}

export const DEFAULT_PUBLISH: RecapPublish = { caption: null, approved: false, publications: [] };

/** What a recap says when nobody wrote its caption: its title, where, the route, its tags. */
export const DEFAULT_CAPTION = '{heading}{at}\n{route}\n\n{tags}';

export const CAPTION_MAX = 2200;
const MAX_TAGS = 5;

const KINDS = new Set<string>(PUBLISH_KINDS);

function readPublication(raw: unknown): Publication | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.postId !== 'string' || !r.postId || typeof r.channelId !== 'string') return null;
  return {
    postId: r.postId.slice(0, 120),
    channelId: r.channelId.slice(0, 120),
    channel: typeof r.channel === 'string' ? r.channel.slice(0, 120) : '',
    kind: KINDS.has(r.kind as string) ? (r.kind as PublishKind) : 'reel',
    trial: r.trial === true,
    at: typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at)) ? r.at : null,
    sentAt: typeof r.sentAt === 'number' && Number.isFinite(r.sentAt) ? r.sentAt : 0,
    caption: typeof r.caption === 'string' ? r.caption.slice(0, CAPTION_MAX) : '',
  };
}

export function readPublish(raw: unknown): RecapPublish {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const caption = typeof r.caption === 'string' ? r.caption.slice(0, CAPTION_MAX * 2) : null;
  return {
    caption,
    approved: r.approved === true,
    publications: Array.isArray(r.publications) ? r.publications.flatMap((p) => readPublication(p) ?? []).slice(-40) : [],
  };
}

/** `#margaretriver` — a place as a hashtag: its letters and digits, accents dropped. */
export function hashtagOf(name: string): string | null {
  const tag = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  return tag.length >= 3 && !/^\d+$/.test(tag) ? `#${tag}` : null;
}

/**
 * The hashtags the places give: the towns most pictured first, then the
 * regions, then the country — five at most, never twice the same.
 */
export function placeTags(pictures: readonly Pick<RecapPicture, 'place' | 'region' | 'country'>[], max = MAX_TAGS): string[] {
  const rank = (key: 'place' | 'region' | 'country') => {
    const n = new Map<string, number>();
    for (const p of pictures) {
      const v = p[key]?.trim();
      if (v) n.set(v, (n.get(v) ?? 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
  };
  const out: string[] = [];
  for (const name of [...rank('place').slice(0, 3), ...rank('region').slice(0, 2), ...rank('country').slice(0, 1)]) {
    const tag = hashtagOf(name);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/** The words a caption can hold, filled for this recap: the texts' own, plus its heading, place, route and tags. */
export function captionWords(doc: RecapDoc, resolved: ResolvedRecap): Record<string, string> {
  const pin = (s: string) => s.split(PIN).join('📍 ');
  const vars = Object.fromEntries(Object.entries(resolved.vars).map(([k, v]) => [k, pin(v)]));
  const heading = doc.heading.show ? pin(fillText(doc.heading.text, resolved.vars)).trim() : doc.title;
  const shown = resolved.slots.flatMap((s) => (s.picture ? [s.picture] : []));
  const place = resolved.vars.place ? pin(resolved.vars.place).replace(/^📍 /, '') : '';
  return {
    ...vars,
    heading: heading || doc.title,
    title: doc.title,
    // ` — Albany`, unless the heading already names it.
    at: place && !heading.includes(place) ? ` — ${place}` : '',
    route: resolved.vars.places && resolved.vars.places.includes('→') ? resolved.vars.places : '',
    tags: placeTags(shown.length ? shown : resolved.inScope).join(' '),
  };
}

/** The caption as it goes out: the template filled, blank lines folded, cut to Instagram's 2 200. */
export function captionText(doc: RecapDoc, resolved: ResolvedRecap): string {
  const text = fillText(doc.publish.caption ?? DEFAULT_CAPTION, captionWords(doc, resolved))
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > CAPTION_MAX ? `${text.slice(0, CAPTION_MAX - 1)}…` : text;
}

/** The caption changed: its approval goes with it, unless the words are the same. */
export function withCaption(publish: RecapPublish, caption: string | null): RecapPublish {
  const next = caption === null || caption === DEFAULT_CAPTION ? null : caption.slice(0, CAPTION_MAX * 2);
  return next === publish.caption ? publish : { ...publish, caption: next, approved: false };
}

/** The new publication kept, most recent last. */
export function withPublication(publish: RecapPublish, p: Publication): RecapPublish {
  return { ...publish, approved: true, publications: [...publish.publications.filter((x) => x.postId !== p.postId), p].slice(-40) };
}

/** What Recap sends as a recap's default kind: a carousel when it has several slides and no motion of its own to show, else its Reel. */
export function defaultKind(doc: Pick<RecapDoc, 'template'>, slides: number): PublishKind {
  if (slides > 1 && (doc.template === 'dump' || doc.template === 'sheets' || doc.template === 'wrapped')) return 'carousel';
  return 'reel';
}
