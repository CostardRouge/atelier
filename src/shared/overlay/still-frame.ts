/**
 * A still has no clock.
 *
 * Windows, animations and scenes all answer the question "when?", and a
 * photograph is a single instant: there is no first exported frame to count
 * from, no entrance to play, no intro to hold the HUD back for. Drawn naively
 * at t = 0, an element with an entrance would render at the *start* of its
 * slide — off frame, or transparent — and one whose window opens later would
 * not render at all. Both read as a broken composition rather than as a
 * feature that does not apply.
 *
 * So a still is composed from the deck in its **settled** state: the timing is
 * stripped before it reaches the renderer, and every visible element draws
 * where and how it finally comes to rest. Preview, frame grab and export all
 * go through here, so what the stage shows is what burns in.
 *
 * Pure and DOM-free.
 */

import type { OverlayElement } from './overlay-types';

/** True when this element's appearance depends on a clock. */
function isTimed(el: OverlayElement): boolean {
  return el.window !== undefined || el.animation !== undefined || el.sceneId !== undefined;
}

/**
 * The deck as a still shows it: the same elements, with `window`, `animation`
 * and `sceneId` dropped. Returns the input untouched when nothing is timed —
 * the ordinary case, and one no caller should pay a copy for.
 */
export function settleForStill(
  elements: readonly OverlayElement[],
): OverlayElement[] {
  if (!elements.some(isTimed)) return elements as OverlayElement[];
  return elements.map((el) => {
    if (!isTimed(el)) return el;
    const settled = { ...el };
    delete settled.window;
    delete settled.animation;
    delete settled.sceneId;
    return settled;
  });
}
