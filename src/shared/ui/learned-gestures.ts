/**
 * Which gestures this browser has already been shown to know.
 *
 * A hint under a drag surface — "drag a leg, or either of its edges, to move
 * its dates" — earns its place exactly once. After that it is a line of prose
 * charging rent on every visit, and the panel it sits in has controls to show
 * instead. So the hint is drawn until the gesture has actually been PERFORMED,
 * and the explanation stays reachable behind the section's ⓘ forever
 * (`InfoDot`): nothing is hidden, only stopped from repeating itself.
 *
 * It lives in `localStorage` for the reason `use-lut-interpolation.ts` gives —
 * this is a property of the machine and the hand using it, never of a document,
 * and it must not travel inside an exported `.roadtrip.json`. Failing to
 * persist is survivable in the safe direction: the hint comes back.
 */

/** The slice of `Storage` this needs — so a test can hand it a fake. */
export type GestureStore = Pick<Storage, 'getItem' | 'setItem'>;

const PREFIX = 'atelier.learned.';

export function hasLearned(store: GestureStore | null, key: string): boolean {
  if (!store) return false;
  try {
    return store.getItem(PREFIX + key) === 'yes';
  } catch {
    // Private mode, disabled storage — the answer stays "no", so the hint is
    // shown. A hint too many beats a gesture nobody finds.
    return false;
  }
}

export function markLearned(store: GestureStore | null, key: string): void {
  if (!store) return;
  try {
    store.setItem(PREFIX + key, 'yes');
  } catch {
    // Not persisting only means the hint returns next session.
  }
}

/** The browser's own storage, or null where there is none to reach. */
export function browserGestureStore(): GestureStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
