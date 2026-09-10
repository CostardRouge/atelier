/**
 * The band every tool screen opens on: the way back, the screen's own pills,
 * and its status, on ONE line of pills at the very top of the content.
 *
 * It exists because the three screens that have a way back — the trip
 * overview, the piece editor, the Studio editor — each composed that row by
 * hand, and the row drifted: two `barPill` constants (`1.9rem` and `1.95rem`),
 * two arrows (`←` and `‹`), and three different vertical offsets, because a
 * row that centres its items puts the pill wherever the tallest thing beside
 * it decides. Measured from the top of the shell's `main`: 0/1px in the two
 * editors and 12px (20px on a phone) on the overview, which is exactly the
 * drift the maintainer reported — "the back button at the same position
 * across the pages".
 *
 * The rule the component encodes, and the reason a title is not a prop:
 *
 * - **The back pill is the first cell, and the bar is one pill high.** Nothing
 *   in it may be taller, so the pill's own top IS the content's top on every
 *   screen and at every width. A screen whose title does not fit that line
 *   draws it BELOW the bar (the trip overview), where it also gets the full
 *   width — beside the pill on a 390px screen its dates were being clipped.
 *   One that does fit puts it in `children` (the Studio's name field).
 * - **It wraps, and the trailing group is pinned with `ml-auto`.** Both are
 *   the rules `frontend.md` already carries for a row mixing fixed-height
 *   pills with something elastic: an item drops to its own line rather than
 *   the text inside one, and a growing spacer would claim a whole line of its
 *   own the moment the row breaks.
 */

import type { ReactNode } from 'react';

/**
 * One pill of the bar. Exported because a screen's own controls have to match
 * the back pill's height exactly — that is what makes the row read as a band
 * rather than a drift of chips.
 */
export const barPill =
  'inline-flex items-center shrink-0 whitespace-nowrap h-[1.9rem] px-3 rounded-full border transition-colors';

/** The back pill's own skin, on top of `barPill`. */
const backSkin =
  'border-line-strong bg-paper text-[0.78rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink';

interface PageBarProps {
  /** The way back. Omitted on a screen that is already the way back. */
  back?: {
    /** Where it goes, as a place: "Trips", "Overview", "Projects". */
    label: string;
    onClick: () => void;
    title?: string;
  };
  /** The screen's own pills, after the back one. */
  children?: ReactNode;
  /** Pinned right: status, and the screen's one primary action. */
  trailing?: ReactNode;
}

export default function PageBar({ back, children, trailing }: PageBarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap min-w-0">
      {back && (
        <button
          type="button"
          onClick={back.onClick}
          title={back.title}
          className={`${barPill} ${backSkin}`}
        >
          ← {back.label}
        </button>
      )}
      {children}
      {trailing && (
        <span className="flex items-center gap-2 ml-auto min-w-0">{trailing}</span>
      )}
    </div>
  );
}
