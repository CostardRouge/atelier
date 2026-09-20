import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CubeLut } from '../../shared/lib/cube-parser';
import { gradeKey } from '../../shared/lut/saved-grade';
import { useGradeCubes } from '../../shared/lut/use-grade-cubes';
import { useLutStack, type LutStack } from '../../shared/lut/use-lut-stack';
import {
  gradeScopeOf,
  gradeShownBy,
  pictureKeyOf,
  sameGradeRung,
  unboundGrades,
  writeGrade,
  moveGradeScope,
  HOOK_PICTURE,
  type GradeScope,
  type GradedPicture,
  type PictureKey,
} from '../../shared/roadtrip/post-grade';
import type { TripDoc, TripGrade, TripPost } from '../../shared/roadtrip/trip-types';

export type { GradeScope } from '../../shared/roadtrip/post-grade';

export interface TripGradeBinding {
  /** The Studio's own stack, restored from whichever grade the open picture follows. */
  stack: LutStack;
  /** Whose grade the stack is editing right now. */
  scope: GradeScope;
  /** Move the look onto another rung — the trip, this piece, or this picture. */
  setScope: (scope: GradeScope) => void;
  /** Whether the open picture CAN have a grade of its own (the closing card cannot). */
  canDepart: boolean;
  /** The stored shape of what the stack currently holds. */
  saved: TripGrade;
  /**
   * The cube one picture of the deck is rendered through: the grade it wears,
   * baked with its own develop. The open picture — and every picture that
   * follows the same rung — reads the LIVE stack, so the strength slider keeps
   * its deferred bake; a picture that departed reads its own stored grade.
   */
  lutFor: (picture: GradedPicture) => CubeLut | null;
  /** The grade the HOOK wears, and its rung — what the Studio bridge sends over. */
  hookGrade: TripGrade;
  hookScope: GradeScope;
}

/** The stored shape, in one field order, so two equal grades stringify equal. */
function savedOf(stack: LutStack): TripGrade {
  return { layers: stack.toSaved(), output: stack.output, film: stack.film };
}

/**
 * Bind the Studio's LUT stack to a trip, a piece and the picture in hand. Road
 * Trip has no grade engine of its own: the stack, its bake and its shader are
 * the Studio's, and this hook only decides which document the stack reads from
 * and writes to — the open picture's own grade when it has one, the piece's
 * otherwise, the trip's when neither departed (`post-grade.ts`).
 *
 * Restoring is asynchronous (built-ins are fetched), so the write-back is
 * keyed on what was last restored or written: while the stack is busy, or
 * still equal to that, nothing is written — otherwise the empty stack of a
 * restore in flight would wipe the stored grade.
 *
 * The OTHER grades a deck wears are resolved and baked beside it, read-only
 * (`useGradeCubes`). One stack could never hold them: it is one set of parsed
 * layers with one deferred bake, and that deferral is what keeps the strength
 * slider usable.
 */
export function useTripGrade(
  trip: TripDoc,
  post: TripPost,
  picture: PictureKey,
  onChangeTrip: (trip: TripDoc) => void,
  onChangePost: (post: TripPost) => void,
): TripGradeBinding {
  const stack = useLutStack();
  const scope = gradeScopeOf(post, picture);
  const source = gradeShownBy(trip, post, picture);
  const sourceKey = JSON.stringify(source);

  // What the stack last agreed with, as stored text.
  const agreed = useRef<string | null>(null);
  /**
   * How many restores are in flight. `stack.busy` cannot answer this on the
   * commit that STARTS one: on mount both effects run together and the
   * write-back reads the render's `busy`, still `false`, so an EMPTY stack was
   * written over the stored grade before the restore landed. Measured in a
   * browser — one reload in two wiped the trip's whole grade, and it never
   * came back. A count raised synchronously is the one thing a render cannot
   * be behind.
   */
  const restoring = useRef(0);

  // The bound document changed from outside (a piece or a slide opened, the
  // scope switched, a file imported): rebuild the stack from it.
  useEffect(() => {
    if (agreed.current === sourceKey) return;
    agreed.current = sourceKey;
    restoring.current += 1;
    void stack.restore(source.layers, source.output, source.film).finally(() => {
      restoring.current -= 1;
    });
    // `source` is what `sourceKey` stringifies; `stack.restore` is stable.
  }, [sourceKey]);

  // The stack changed under the author's hand: write it to the bound document.
  const latest = useRef({ trip, post, picture, scope, onChangeTrip, onChangePost });
  latest.current = { trip, post, picture, scope, onChangeTrip, onChangePost };
  useEffect(() => {
    if (stack.busy || restoring.current > 0) return;
    const saved = savedOf(stack);
    const key = JSON.stringify(saved);
    if (key === agreed.current) return;
    agreed.current = key;
    const cur = latest.current;
    const next = writeGrade(cur.trip, cur.post, cur.picture, cur.scope, saved);
    if (next.post) cur.onChangePost(next.post);
    else if (next.trip) cur.onChangeTrip(next.trip);
  }, [stack.layers, stack.output, stack.film, stack.busy]);

  const setScope = (next: GradeScope) => {
    if (next === scope) return;
    onChangePost(moveGradeScope(trip, post, picture, next));
  };

  // The looks the deck wears that this stack is NOT editing. Deduplicated, so
  // five pictures converting from D-Log cost one resolve and one bake.
  const others = useMemo(
    () => unboundGrades(trip, post, picture, gradeKey),
    [trip, post, picture],
  );
  const cubeFor = useGradeCubes(others);

  const lutFor = useCallback(
    (target: GradedPicture): CubeLut | null => {
      // The closing card is drawn, not photographed: there is no source to
      // grade, so a cube for it would only be a cube nobody looks through.
      if (target.kind === 'cta') return null;
      const key = pictureKeyOf(target);
      if (sameGradeRung(post, key, picture)) return stack.composeWith(target.develop);
      return cubeFor(gradeShownBy(trip, post, key), target.develop);
    },
    [trip, post, picture, stack.composeWith, cubeFor],
  );

  return {
    stack,
    scope,
    setScope,
    canDepart: picture !== null,
    saved: savedOf(stack),
    lutFor,
    hookGrade: gradeShownBy(trip, post, HOOK_PICTURE),
    hookScope: gradeScopeOf(post, HOOK_PICTURE),
  };
}
