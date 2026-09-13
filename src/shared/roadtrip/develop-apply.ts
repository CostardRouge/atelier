/**
 * Applying one develop to MANY pictures of a trip, and the trip's presets —
 * the time-savers of `docs/photo-develop.md` §8.
 *
 * Every write is a COPY into each target's own field, never a reference: a
 * correction is about a picture and is never inherited (the framing rule), so
 * a preset edited later changes no piece, and a slide corrected by "apply to"
 * carries its numbers exactly as if they had been set on it.
 *
 * Pure and DOM-free.
 */

import { isDefaultDevelop, type DevelopPreset, type DevelopSettings } from '../develop/develop';
import type { TripDoc, TripPost } from './trip-types';

/** A develop as stored: a copy, or null for as shot. */
function stored(settings: DevelopSettings | null): DevelopSettings | null {
  return settings && !isDefaultDevelop(settings) ? { ...settings } : null;
}

/**
 * The post with `settings` written onto every picture it holds — the hook
 * and each content slide that names a picture — except the slide `except`
 * (a slide id, or `'hook'`), which is the one the sheet writes itself on
 * Done. A slide with no picture is left alone: there is nothing to correct.
 */
export function applyDevelopToPost(
  post: TripPost,
  settings: DevelopSettings | null,
  except: string | null = null,
): TripPost {
  const value = stored(settings);
  return {
    ...post,
    badge:
      except === 'hook' || !post.media ? post.badge : { ...post.badge, develop: value },
    slides: post.slides.map((s) =>
      s.id === except || !s.media ? s : { ...s, develop: value },
    ),
  };
}

/** How many pictures `applyDevelopToPost` would write, with the same `except`. */
export function countPostPictures(post: TripPost, except: string | null = null): number {
  let n = except !== 'hook' && post.media ? 1 : 0;
  for (const s of post.slides) if (s.id !== except && s.media) n += 1;
  return n;
}

/** The other pieces telling the same day as `post` — the day's set. */
export function otherPostsOfDay(trip: TripDoc, post: TripPost): TripPost[] {
  return trip.posts.filter((p) => p.id !== post.id && p.date === post.date);
}

/**
 * The trip with `settings` written onto every picture of the OTHER pieces of
 * `post`'s day. The post itself is left alone — its own pictures are the
 * sheet's business, and a day is the largest set one light is likely to hold,
 * which is why a whole-trip apply is not offered.
 */
export function applyDevelopToDay(
  trip: TripDoc,
  post: TripPost,
  settings: DevelopSettings | null,
): TripDoc {
  const others = new Set(otherPostsOfDay(trip, post).map((p) => p.id));
  if (!others.size) return trip;
  return {
    ...trip,
    posts: trip.posts.map((p) => (others.has(p.id) ? applyDevelopToPost(p, settings) : p)),
  };
}

/** How many pictures `applyDevelopToDay` would write. */
export function countDayPictures(trip: TripDoc, post: TripPost): number {
  return otherPostsOfDay(trip, post).reduce((n, p) => n + countPostPictures(p), 0);
}

// --- presets ---------------------------------------------------------------

/**
 * The trip with a new preset holding a COPY of `settings` under `name`; a
 * name already taken is replaced in place, so "Save current as… Desert noon"
 * twice is one preset with the newer numbers. An as-shot develop saves
 * nothing — a preset of zeros is a button that does nothing.
 */
export function savePreset(
  trip: TripDoc,
  name: string,
  settings: DevelopSettings | null,
  id: string,
): TripDoc {
  const value = stored(settings);
  const label = name.trim();
  if (!value || !label) return trip;
  const existing = trip.developPresets.findIndex((p) => p.name === label);
  const preset: DevelopPreset = {
    id: existing >= 0 ? trip.developPresets[existing].id : id,
    name: label,
    settings: value,
  };
  const developPresets =
    existing >= 0
      ? trip.developPresets.map((p, i) => (i === existing ? preset : p))
      : [...trip.developPresets, preset];
  return { ...trip, developPresets };
}

export function removePreset(trip: TripDoc, id: string): TripDoc {
  if (!trip.developPresets.some((p) => p.id === id)) return trip;
  return { ...trip, developPresets: trip.developPresets.filter((p) => p.id !== id) };
}
