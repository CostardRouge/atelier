/**
 * The arithmetic behind Trips' agent COMMANDS (`shared/commands/registry.ts`,
 * registered by `RoadTripTool` for trips and pieces, `PostEditor` for the open
 * piece): what an agent is told of a trip and a piece, and how its asks become
 * the documents the editor writes — a piece's pictures in order, its opener,
 * its badge's words.
 *
 * Every value is checked and REFUSED rather than clamped, like every command:
 * an opener option of the wrong type, a badge piece that does not exist, a
 * shape the suite does not deliver.
 *
 * Pure and DOM-free.
 */

import { CommandError } from '../commands/registry';
import { ASPECT_PRESETS } from '../projects/aspect-presets';
import type { SavedMediaRef } from '../projects/project-types';
import { BADGE_PIECES, COUNTER_MODES, type BadgePiece, type CounterMode } from './day-badge';
import { deckSlides } from './deck';
import { HOOK_VARIANTS, hookVariantById } from './hooks/registry';
import { switchHookVariant, type HookLayer, type HookShelf } from './hooks/hook-variant';
import { createPostSlide, type PostBadge, type TripDoc, type TripPost } from './trip-types';

/** A trip as an agent lists it. */
export function tripSummary(trip: TripDoc) {
  return {
    id: trip.id,
    name: trip.name,
    from: trip.startDate,
    to: trip.endDate,
    stages: trip.stages.length,
    pieces: trip.posts.length,
    updatedAt: new Date(trip.updatedAt).toISOString(),
  };
}

/** A piece as a trip's list shows it. */
export function pieceLine(post: TripPost) {
  return {
    id: post.id,
    kind: post.kind,
    date: post.date,
    ...(post.endDate ? { endDate: post.endDate } : {}),
    title: post.title || null,
    pictures: (post.media ? 1 : 0) + post.slides.filter((s) => s.media).length,
    opener: post.badge.hook[0]?.id ?? null,
    published: post.publishedAt ? new Date(post.publishedAt).toISOString().slice(0, 10) : null,
  };
}

/** The open trip as an agent reads it: its legs with their places, and its pieces. */
export function tripDetail(trip: TripDoc) {
  return {
    ...tripSummary(trip),
    stages: trip.stages.map((s) => ({
      id: s.id,
      name: s.name || null,
      from: s.startDate,
      to: s.endDate,
      places: s.places.map((p) => p.name),
    })),
    pieces: trip.posts.map(pieceLine),
  };
}

/** One piece as an agent reads it: its slides in swipe order, its opener, its badge's words. */
export function pieceDetail(trip: TripDoc, post: TripPost) {
  return {
    ...pieceLine(post),
    aspect: post.badge.aspectId,
    counter: post.badge.mode,
    words: post.badge.textOverrides,
    callToAction: post.includeCta,
    slides: deckSlides(trip, post).map((s) => ({
      position: s.position,
      kind: s.kind,
      picture: s.media?.name ?? null,
      medium: s.medium,
      seconds: Math.round(s.seconds * 100) / 100,
      opener: s.hook?.[0]?.id ?? null,
      ...(s.caption ? { caption: s.caption } : {}),
    })),
  };
}

/**
 * The piece with these pictures, in this order: the first is the HOOK (the
 * piece's own picture, under its badge), the rest its slides. A slide already
 * there keeps everything it carries — its timing, its opener, its words —
 * and only changes picture; a slide past the list is dropped, one beyond the
 * old count is made fresh.
 */
export function withPictures(post: TripPost, refs: readonly SavedMediaRef[]): TripPost {
  if (refs.length === 0) throw new CommandError('invalid', 'give at least one picture — the first is the hook');
  const [hook, ...rest] = refs;
  const slides = rest.map((ref, i) => {
    const kept = post.slides[i];
    return kept ? { ...kept, media: ref } : createPostSlide(ref);
  });
  return { ...post, media: hook, slides };
}

/** The openers an agent may choose from. */
export function openerList() {
  return HOOK_VARIANTS.map((v) => ({ id: v.id, name: v.name, does: v.tagline, options: v.defaults }));
}

/**
 * An opener switched to and its options patched. Switching to another keeps
 * what the first was given, as the picker does (`switchHookVariant`). An
 * option is refused unless the variant has it, and unless the value has the
 * type of its default — the variants read their options without a schema, so
 * the type is the one check that holds for all of them.
 */
export function withOpener(
  layers: readonly HookLayer[] | undefined,
  shelf: HookShelf | undefined,
  id: string,
  patch: Record<string, unknown> | undefined,
): { hook: HookLayer[]; shelf: HookShelf } {
  const variant = hookVariantById(id);
  if (!variant) throw new CommandError('invalid', `no opener "${id}" — the openers are ${HOOK_VARIANTS.map((v) => v.id).join(', ')}`);
  const from = hookVariantById(layers?.[0]?.id ?? '');
  const switched = switchHookVariant(layers, shelf, variant, from);
  if (!patch || Object.keys(patch).length === 0) return switched;
  const defaults = variant.defaults as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in defaults)) {
      throw new CommandError('invalid', `the ${variant.id} opener has no option "${k}" — it has ${Object.keys(defaults).join(', ') || 'none'}`);
    }
    const want = Array.isArray(defaults[k]) ? 'array' : defaults[k] === null ? null : typeof defaults[k];
    const got = Array.isArray(v) ? 'array' : typeof v;
    if (want !== null && want !== got) throw new CommandError('invalid', `option "${k}" is a ${want}, not a ${got}`);
  }
  const [first, ...rest] = switched.hook;
  return { hook: [{ id: first.id, options: { ...first.options, ...patch } }, ...rest], shelf: switched.shelf };
}

/**
 * The badge with these words written over its computed ones. An empty string
 * gives the piece back its computed word — the rule every badge field follows
 * ("emptied returns the computed value, never a blank").
 */
export function withBadgeWords(badge: PostBadge, words: Record<string, unknown>): PostBadge {
  const ids = BADGE_PIECES.map((p) => p.id) as readonly string[];
  const next: Partial<Record<BadgePiece, string>> = { ...badge.textOverrides };
  for (const [k, v] of Object.entries(words)) {
    if (!ids.includes(k)) throw new CommandError('invalid', `no badge piece "${k}" — the pieces are ${ids.join(', ')}`);
    if (typeof v !== 'string') throw new CommandError('invalid', `"${k}" must be a string ("" gives back the computed word)`);
    if (v.trim()) next[k as BadgePiece] = v;
    else delete next[k as BadgePiece];
  }
  return { ...badge, textOverrides: next };
}

/** A counter mode, or refused with the list. */
export function readCounterMode(raw: unknown): CounterMode {
  const ids = COUNTER_MODES.map((m) => m.id) as readonly string[];
  if (typeof raw !== 'string' || !ids.includes(raw)) throw new CommandError('invalid', `the counter modes are ${ids.join(', ')}`);
  return raw as CounterMode;
}

/** A frame shape the suite delivers, or refused with the list. */
export function readAspect(raw: unknown): string {
  const ids = ASPECT_PRESETS.map((a) => a.id);
  if (typeof raw !== 'string' || !ids.includes(raw)) throw new CommandError('invalid', `the shapes are ${ids.join(', ')}`);
  return raw;
}
