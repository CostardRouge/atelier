/**
 * Which look a picture of a piece actually wears — the chain, and the moves
 * between its rungs.
 *
 * A trip has ONE grade so the feed reads as one journey. A piece may depart
 * from it. And since a deck mixes cameras — a D-Log drone clip beside a phone
 * photograph, which cannot share a conversion LUT — ONE PICTURE may depart
 * from the piece. Three rungs, resolved on every read, the same rule the tool
 * binds everywhere else: **empty means computed, never blank**. Nothing
 * dangles, nothing needs repairing when a piece is re-cut, and a picture that
 * never departed is a `null`, not a copy of the trip's grade.
 *
 * A picture is named by its KEY, the convention `develop-apply.ts` already
 * uses: `'hook'` for the piece's opener, a slide id for a content picture,
 * `null` for the closing card (which has no picture and can never depart).
 *
 * Pure and DOM-free.
 */

import type { DevelopSettings } from '../develop/develop';
import type { DeckSlideKind } from './deck';
import { emptyGrade, type TripDoc, type TripGrade, type TripPost } from './trip-types';

/** Which picture of a piece a grade is read for. `null` is the closing card. */
export type PictureKey = string | null;

/** The key that names a piece's opener. */
export const HOOK_PICTURE: PictureKey = 'hook';

/** Where a look is written: the trip, one piece, or one picture of it. */
export type GradeScope = 'trip' | 'post' | 'slide';

/** What grading one picture of a deck needs to know about it. */
export interface GradedPicture {
  kind: DeckSlideKind;
  slideId: string | null;
  grade: TripGrade | null;
  develop: DevelopSettings | null;
}

/** The key of the picture a deck slide draws. */
export function pictureKeyOf(picture: Pick<GradedPicture, 'kind' | 'slideId'>): PictureKey {
  return picture.kind === 'hook' ? HOOK_PICTURE : picture.slideId;
}

/** The grade this one picture carries of its own, or null when it follows. */
export function ownGrade(post: TripPost, picture: PictureKey): TripGrade | null {
  if (picture === null) return null;
  if (picture === HOOK_PICTURE) return post.badge.grade ?? null;
  return post.slides.find((s) => s.id === picture)?.grade ?? null;
}

/** Which rung the look shown on a picture is written on. */
export function gradeScopeOf(post: TripPost, picture: PictureKey): GradeScope {
  if (ownGrade(post, picture)) return 'slide';
  return post.grade ? 'post' : 'trip';
}

/** The grade a picture actually wears: its own, else the piece's, else the trip's. */
export function gradeShownBy(trip: TripDoc, post: TripPost, picture: PictureKey): TripGrade {
  return ownGrade(post, picture) ?? post.grade ?? trip.grade ?? emptyGrade();
}

/**
 * Whether two pictures of a piece read their look from the SAME rung — so a
 * stack bound to one of them is the live answer for the other too.
 *
 * This is what lets the editor keep its deferred bake: the picture being
 * edited, and every picture that follows the same rung, render through the
 * live stack, while a picture that departed renders through its own stored
 * grade (`use-grade-cubes.ts`). Comparing the two grades by VALUE instead
 * would be wrong for exactly one beat — a picture that has just departed
 * holds a byte-identical copy, and would follow the next slider step it
 * should be deaf to.
 */
export function sameGradeRung(post: TripPost, a: PictureKey, b: PictureKey): boolean {
  if (a === b) return true;
  return ownGrade(post, a) === null && ownGrade(post, b) === null;
}

/**
 * How many pictures of a piece carry a look of their own — what lets a panel
 * say "every picture goes through the trip's grade" only when that is true.
 */
export function countOwnGrades(post: TripPost): number {
  let n = post.badge.grade ? 1 : 0;
  for (const slide of post.slides) if (slide.grade) n += 1;
  return n;
}

/** The post with one picture's own grade set or cleared. */
function setOwnGrade(post: TripPost, picture: PictureKey, grade: TripGrade | null): TripPost {
  if (picture === null) return post;
  if (picture === HOOK_PICTURE) return { ...post, badge: { ...post.badge, grade } };
  return {
    ...post,
    slides: post.slides.map((s) => (s.id === picture ? { ...s, grade } : s)),
  };
}

/**
 * Move a picture's look onto another rung, and say what the piece becomes.
 *
 * The rule is the one the two-rung version already followed: going DOWN a
 * rung (more specific) seeds the new one from what the picture shows right
 * now, so departing changes nothing until the author changes something; going
 * UP drops what was below it, which is a real change of look and is stated in
 * the panel.
 *
 * Picking "this piece's" therefore also gives the PIECE a grade when it had
 * none — the rung the author pointed at is where the look now lives, and
 * landing back on the trip's would make the control do nothing.
 */
export function moveGradeScope(
  trip: TripDoc,
  post: TripPost,
  picture: PictureKey,
  scope: GradeScope,
): TripPost {
  const shown = gradeShownBy(trip, post, picture);
  if (scope === 'slide') return setOwnGrade(post, picture, structuredClone(shown));
  const dropped = setOwnGrade(post, picture, null);
  if (scope === 'post') return { ...dropped, grade: dropped.grade ?? structuredClone(shown) };
  return { ...dropped, grade: null };
}

/**
 * The documents to write when the bound stack has changed under the author's
 * hand. Exactly one of the two is non-null: a grade lives on one rung, and
 * writing both in one tick is how two edits clobber each other (the rule
 * `develop-apply.ts` records for the day batch).
 */
export function writeGrade(
  trip: TripDoc,
  post: TripPost,
  picture: PictureKey,
  scope: GradeScope,
  grade: TripGrade,
): { trip: TripDoc | null; post: TripPost | null } {
  if (scope === 'slide') return { trip: null, post: setOwnGrade(post, picture, grade) };
  if (scope === 'post') return { trip: null, post: { ...post, grade } };
  return { trip: { ...trip, grade }, post: null };
}

/**
 * Every grade a piece's pictures wear that the bound stack is NOT editing —
 * what `useGradeCubes` has to resolve and bake so a picture that departed is
 * drawn through its own look. Deduplicated by the grade's own key, so five
 * pictures converting from D-Log cost one bake.
 */
export function unboundGrades(
  trip: TripDoc,
  post: TripPost,
  bound: PictureKey,
  keyOf: (grade: TripGrade) => string,
): TripGrade[] {
  const seen = new Map<string, TripGrade>();
  const add = (picture: PictureKey) => {
    if (sameGradeRung(post, picture, bound)) return;
    const grade = gradeShownBy(trip, post, picture);
    const key = keyOf(grade);
    if (!seen.has(key)) seen.set(key, grade);
  };
  add(HOOK_PICTURE);
  for (const slide of post.slides) add(slide.id);
  return [...seen.values()];
}
