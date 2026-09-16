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
    return at ? badgeElements(at, layout, aspect, styles, durationSeconds, cascade) : [];
  };
}
