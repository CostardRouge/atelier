import { useEffect, useRef } from 'react';
import { useLutStack, type LutStack } from '../../shared/lut/use-lut-stack';
import { emptyGrade, type TripDoc, type TripGrade, type TripPost } from '../../shared/roadtrip/trip-types';

export type GradeScope = 'trip' | 'post';

export interface TripGradeBinding {
  /** The Studio's own stack, restored from whichever grade the piece follows. */
  stack: LutStack;
  /** Whose grade the stack is editing right now. */
  scope: GradeScope;
  /** Give the piece a grade of its own (starting from the trip's), or send it back to the trip's. */
  setScope: (scope: GradeScope) => void;
  /** The stored shape of what the stack currently holds. */
  saved: TripGrade;
}

/** The stored shape, in one field order, so two equal grades stringify equal. */
function savedOf(stack: LutStack): TripGrade {
  return { layers: stack.toSaved(), output: stack.output };
}

/**
 * Bind the Studio's LUT stack to a trip and a piece. Road Trip has no grade
 * engine of its own: the stack, its bake and its shader are the Studio's, and
 * this hook only decides which document the stack reads from and writes to —
 * the post's own grade when it has one, the trip's otherwise.
 *
 * Restoring is asynchronous (built-ins are fetched), so the write-back is
 * keyed on what was last restored or written: while the stack is busy, or
 * still equal to that, nothing is written — otherwise the empty stack of a
 * restore in flight would wipe the stored grade.
 */
export function useTripGrade(
  trip: TripDoc,
  post: TripPost,
  onChangeTrip: (trip: TripDoc) => void,
  onChangePost: (post: TripPost) => void,
): TripGradeBinding {
  const stack = useLutStack();
  const scope: GradeScope = post.grade ? 'post' : 'trip';
  const source = post.grade ?? trip.grade ?? emptyGrade();
  const sourceKey = JSON.stringify(source);

  // What the stack last agreed with, as stored text.
  const agreed = useRef<string | null>(null);

  // The bound document changed from outside (a piece opened, the scope
  // switched, a file imported): rebuild the stack from it.
  useEffect(() => {
    if (agreed.current === sourceKey) return;
    agreed.current = sourceKey;
    void stack.restore(source.layers, source.output);
    // `source` is what `sourceKey` stringifies; `stack.restore` is stable.
  }, [sourceKey]);

  // The stack changed under the author's hand: write it to the bound document.
  const latest = useRef({ trip, post, onChangeTrip, onChangePost });
  latest.current = { trip, post, onChangeTrip, onChangePost };
  useEffect(() => {
    if (stack.busy) return;
    const saved = savedOf(stack);
    const key = JSON.stringify(saved);
    if (key === agreed.current) return;
    agreed.current = key;
    const cur = latest.current;
    if (cur.post.grade) cur.onChangePost({ ...cur.post, grade: saved });
    else cur.onChangeTrip({ ...cur.trip, grade: saved });
  }, [stack.layers, stack.output, stack.busy]);

  const setScope = (next: GradeScope) => {
    if (next === scope) return;
    if (next === 'post') {
      // Start the piece's own grade from what it showed a moment ago, so
      // departing from the trip changes nothing until the author does.
      onChangePost({ ...post, grade: structuredClone(source) });
    } else {
      onChangePost({ ...post, grade: null });
    }
  };

  return { stack, scope, setScope, saved: savedOf(stack) };
}
