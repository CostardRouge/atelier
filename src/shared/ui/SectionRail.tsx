/**
 * The bottom bar of a compact shell: the library, then the active tool's own
 * cells, where a thumb can reach them.
 *
 * Drawn by the shell from what a tool published (`section-rail.tsx`). It only
 * ever appears on a compact shell — at any wider width the same sections are
 * the inspector's own tab strip, and the library is the docked column, which is
 * where both belong when there is room for a column to hold them.
 *
 * **The library is the first cell on every screen**, whatever the bar means.
 * It used to be a cell only on a gallery's `actions` bar and a burger in the
 * app bar everywhere else, on the argument that the library is not a place in
 * the document; the maintainer's answer is that a phone has ONE bottom menu and
 * the way to the pictures is in it, on the trip overview and inside an editor
 * alike. So the burger is gone and the bar is drawn even for a tool that
 * publishes no sections at all — an empty bar still has the one thing every
 * tool screen needs.
 *
 * Beside a tool's cells it is the only one that does NOT stretch: it is the
 * shell's, sized to its word and set off by a rule, so the tool's cells share
 * the rest evenly. Alone it does stretch — a bar holding one chip in the corner
 * reads as something left over, where a full-width row reads as the menu it is.
 *
 * The padding is as tight as it is because six cells is the worst case and it
 * is a real one: the library plus the Studio's five sections, measured at
 * 360px (the narrowest phone worth drawing for), where the widest label wants
 * ~43px of the ~52px a cell gets. Widening any of it truncates "Overlay".
 */

import type { SectionBar } from './section-rail';

const CELL =
  'min-h-[44px] py-1.5 rounded-paper border-0 cursor-pointer font-mono text-[0.6rem] tracking-[0.08em] uppercase truncate transition-colors duration-200 ease-paper';

export interface SectionRailProps {
  /** The tool's cells, or null for a tool that publishes none. */
  bar: SectionBar | null;
  /** Opens the shell's library. Omitted only if there is no library to open. */
  onLibrary?: () => void;
}

export default function SectionRail({ bar, onLibrary }: SectionRailProps) {
  const sections = bar?.sections ?? [];
  if (sections.length === 0 && !onLibrary) return null;

  return (
    <nav
      aria-label={bar?.label ?? 'Library'}
      className="flex-none flex items-stretch gap-0.5 px-1.5 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] border-t border-line bg-surface"
    >
      {onLibrary && (
        <>
          <button
            type="button"
            onClick={onLibrary}
            className={`${CELL} bg-transparent text-muted hover:text-ink ${
              sections.length > 0 ? 'shrink-0 px-2' : 'flex-1 px-3 text-left'
            }`}
          >
            Library
          </button>
          {sections.length > 0 && (
            <span className="self-center w-px h-5 mx-0.5 bg-line" aria-hidden="true" />
          )}
        </>
      )}
      {sections.map((s) => {
        // An `actions` bar has no current cell, so nothing is pressed: a mark
        // on a verb would claim a state the screen is not in.
        const on = bar!.active !== null && s.id === bar!.active;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => bar!.onSelect(s.id)}
            aria-pressed={bar!.active !== null ? on : undefined}
            // `min-w-0` + `truncate`: five words share a 360px screen, and a
            // cell that grows to fit its label would push the last one off the
            // edge rather than shortening itself.
            className={`${CELL} flex-1 min-w-0 px-0.5 ${
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
