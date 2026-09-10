/**
 * The bottom bar: the active tool's sections, where a thumb can reach them.
 *
 * Drawn by the shell from what a tool published (`section-rail.tsx`). It only
 * ever appears on a compact shell — at any wider width the same sections are
 * the inspector's own tab strip, which is where they belong when there is room
 * for a column to hold them.
 *
 * **The library is deliberately NOT a cell here**, though the sketch this was
 * built from drew it as one. Two reasons, and they agree: the bar is the
 * tool's and the library is the shell's, so mixing them is a category error;
 * and a sixth cell puts the Studio's five sections under 60px each. The
 * frequent target belongs in the thumb zone, the occasional one in the app bar
 * — you open the library to pick a media, then work in the sections all day.
 */

import type { SectionBar } from './section-rail';

export default function SectionRail({ bar }: { bar: SectionBar }) {
  if (bar.sections.length === 0) return null;

  return (
    <nav
      aria-label={bar.label}
      className="flex-none flex items-stretch gap-0.5 px-1.5 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] border-t border-line bg-surface"
    >
      {bar.sections.map((s) => {
        const on = s.id === bar.active;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => bar.onSelect(s.id)}
            aria-pressed={on}
            // `min-w-0` + `truncate`: five words share a 390px screen, and a
            // cell that grows to fit its label would push the last one off the
            // edge rather than shortening itself.
            className={`flex-1 min-w-0 min-h-[44px] px-1 py-1.5 rounded-paper border-0 cursor-pointer font-mono text-[0.6rem] tracking-[0.08em] uppercase truncate transition-colors duration-200 ease-paper ${
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
