/**
 * The bottom bar: the active tool's sections, where a thumb can reach them.
 *
 * Drawn by the shell from what a tool published (`section-rail.tsx`). It only
 * ever appears on a compact shell — at any wider width the same sections are
 * the inspector's own tab strip, which is where they belong when there is room
 * for a column to hold them.
 *
 * **Whether the library is a cell depends on what the bar MEANS** — see
 * `SectionBarRole`. On an editor's `sections` bar it is not one: a sixth cell
 * puts the Studio's five sections under 60px each, and the library is not a
 * place in the document anyway, so it stays a button in the app bar. On a
 * gallery's `actions` bar it is, because there the cells are starting points
 * and picking media is one of them; the shell then drops the app-bar button so
 * the same thing is not offered twice on one screen.
 */

import type { SectionBar } from './section-rail';

const CELL =
  'flex-1 min-w-0 min-h-[44px] px-1 py-1.5 rounded-paper border-0 cursor-pointer font-mono text-[0.6rem] tracking-[0.08em] uppercase truncate transition-colors duration-200 ease-paper';

export interface SectionRailProps {
  bar: SectionBar;
  /**
   * Opens the shell's library. Passed only for an `actions` bar, where the
   * library is one of the starting points the bar is FOR — see
   * {@link SectionBarRole}. On a `sections` bar it stays in the app bar.
   */
  onLibrary?: () => void;
}

export default function SectionRail({ bar, onLibrary }: SectionRailProps) {
  if (bar.sections.length === 0 && !onLibrary) return null;

  return (
    <nav
      aria-label={bar.label}
      className="flex-none flex items-stretch gap-0.5 px-1.5 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] border-t border-line bg-surface"
    >
      {onLibrary && (
        <button
          type="button"
          onClick={onLibrary}
          className={`${CELL} bg-transparent text-muted hover:text-ink`}
        >
          Library
        </button>
      )}
      {bar.sections.map((s) => {
        // An `actions` bar has no current cell, so nothing is pressed: a mark
        // on a verb would claim a state the screen is not in.
        const on = bar.active !== null && s.id === bar.active;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => bar.onSelect(s.id)}
            aria-pressed={bar.active !== null ? on : undefined}
            // `min-w-0` + `truncate`: five words share a 390px screen, and a
            // cell that grows to fit its label would push the last one off the
            // edge rather than shortening itself.
            className={`${CELL} ${
              on
                ? 'bg-accent-wash text-accent-ink'
                : 'bg-transparent text-muted hover:text-ink'
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
