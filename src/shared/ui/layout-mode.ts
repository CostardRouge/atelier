/**
 * How much room the SHELL has, named once.
 *
 * Below 820px Atelier used to stop being a layout and become a stack: the
 * masthead, then the full-width library card, then the editor, all in one
 * scrolling column. The rule was also spread by hand — dozens of literal
 * `max-[820px]:` utilities across the tools, each re-deciding what "small"
 * meant. This module is the one place that decides, and the shell publishes
 * the answer (`use-layout-mode.tsx`) the way a tool publishes its media scope.
 *
 * Three modes, one new number: `820` keeps exactly the meaning every existing
 * utility already gives it, so adopting this is additive rather than a
 * re-tuning of what is already verified.
 *
 * **This is not the query a tool's own layout splits on.** The Library rail
 * eats 288px that no viewport query can see, so a tool's internal columns stay
 * on `@container` (`studio.md`, `frontend.md`). What a `LayoutMode` answers is
 * a different question — which chrome the shell wears, and therefore whether a
 * tool's sections are drawn as its own tabs or handed to the shell's bar.
 *
 * DOM-free on purpose: the arithmetic is testable in node, and the one
 * `matchMedia` listener lives beside it in the React half.
 */

/**
 * - `compact` — a phone. One surface at a time: the stage owns the screen, the
 *   tool's sections sit in a bottom bar, and the panels are sheets over it.
 * - `medium` — a tablet, or a split-screen laptop. An icon rail, the stage,
 *   and panels that slide over it rather than taking a column of their own.
 * - `expanded` — the desktop layout, docked: library column, stage, inspector.
 */
export type LayoutMode = 'compact' | 'medium' | 'expanded';

/**
 * The two boundaries, in CSS pixels. `COMPACT_MAX` is the suite's existing
 * `820` — changing it would silently re-tune every `max-[820px]:` utility
 * still in the tree, so it is a constant, not a knob.
 */
export const COMPACT_MAX = 820;
export const MEDIUM_MAX = 1180;

/** Every mode, widest last — the order a picker or a test should walk. */
export const LAYOUT_MODES: readonly LayoutMode[] = ['compact', 'medium', 'expanded'];

/**
 * The mode for a viewport width. The boundaries are exclusive at the bottom:
 * `820` itself is already `medium`, matching `max-[820px]:` (which stops
 * applying at 821 — CSS `max-width: 820px` includes 820, so the utility and
 * this function deliberately DISAGREE by one pixel at exactly 820).
 *
 * That single pixel is the price of keeping the number: a layout that changes
 * at 820 and one that changes at 821 are indistinguishable in use, while a
 * different number would mean re-verifying every utility already measured at
 * 390, 744, 834 and 1280.
 */
export function modeForWidth(width: number): LayoutMode {
  if (!Number.isFinite(width) || width < COMPACT_MAX) return 'compact';
  if (width < MEDIUM_MAX) return 'medium';
  return 'expanded';
}

/**
 * True when the mode has at least this much room — `atLeast(mode, 'medium')`
 * is "not a phone". Reads better at a call site than comparing to two names,
 * and keeps the ordering in one place rather than in every consumer.
 */
export function atLeast(mode: LayoutMode, min: LayoutMode): boolean {
  return LAYOUT_MODES.indexOf(mode) >= LAYOUT_MODES.indexOf(min);
}

/**
 * The media queries the shell listens on, narrowest first. Two listeners
 * answer three modes: a width matching neither is `medium`.
 *
 * Written as `max-width` so they mirror the Tailwind utilities they replace.
 */
export const COMPACT_QUERY = `(max-width: ${COMPACT_MAX - 1}px)`;
export const MEDIUM_QUERY = `(max-width: ${MEDIUM_MAX - 1}px)`;

/** The mode two `matchMedia` results name. Pure, so the hook stays trivial. */
export function modeForMatches(compact: boolean, medium: boolean): LayoutMode {
  if (compact) return 'compact';
  return medium ? 'medium' : 'expanded';
}
