/**
 * The badge's elements at a moment, for a hook that rewrites its text.
 *
 * Elements are normally built once per edit and memoised: the badge does not
 * change as the clock runs. A variant that steps the numeral changes that, and
 * the answer is NOT a time dependency in a React memo — which would rebuild
 * every element sixty times a second for every piece, rewriting or not. It is
 * a function of `t` handed to the renderer, built only when some layer
 * actually rewrites (`ResolvedHook.rewrites`), and called at paint time.
 *
 * The ids stay deterministic (`piece:<key>`), so a click on the stage still
 * lands on the numeral while it is counting.
 */

import type { OverlayElement } from '../../overlay/overlay-types';
import {
  badgeElements,
  type BadgeCascade,
  type BadgeLayout,
  type BadgePieceStyles,
} from '../badge-layout';
import type { BadgeContent } from '../day-badge';
import type { ResolvedHook } from './hook-variant';
import type { TimeWindow } from '../../overlay/animation';
import { pieceFromElementId } from '../badge-layout';

/**
 * The badge's pieces inside the window an opener gives them
 * (`ResolvedHook.badgeWindow`): an entrance plays from its start and an exit
 * lands on its end — or, where the window is open, on the piece's own end.
 * Only the BADGE's elements move; the slide's free text keeps its own life.
 * A window that opens and closes at 0 hides the badge (`never`), the ghost
 * still letting the editor pick a piece.
 */
export function windowedBadge(elements: OverlayElement[], win: TimeWindow | null | undefined): OverlayElement[] {
  if (!win) return elements;
  return elements.map((el) =>
    pieceFromElementId(el.id) === null
      ? el
      : { ...el, window: { start: win.start, end: win.end ?? (el.animation?.out ? (el.window?.end ?? null) : null) } },
  );
}

export type ElementsAt = (tSeconds: number) => OverlayElement[];

export function hookElementsAt(
  hook: ResolvedHook | null,
  content: BadgeContent | null,
  layout: BadgeLayout,
  aspect: number,
  styles: BadgePieceStyles,
  durationSeconds: number,
  cascade: BadgeCascade | null = null,
): ElementsAt | null {
  if (!hook?.rewrites || !content) return null;
  return (t) => {
    const at = hook.contentAt(content, t);
    return at ? windowedBadge(badgeElements(at, layout, aspect, styles, durationSeconds, cascade), hook.badgeWindow) : [];
  };
}
