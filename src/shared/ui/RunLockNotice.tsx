import type { ReactNode } from 'react';
import { Icons } from './icons';

/** `21:37` — when a run took its settings, as a bar and a notice say it. */
export function runClock(since: number): string {
  return new Date(since).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Why an export tab's sections are dimmed while a run goes on (L2, his pick in
 * Develop, carried to Trips and the Studio on 2026-09-29): the run uses the
 * settings as they were at the click, retouching stays free, and what is
 * edited meanwhile is named when the run ends — `what` says that last part in
 * the tool's own nouns. Stuck to the top of the tab's scroll: the lock must be
 * read where the dimmed control is, and a tab is usually scrolled down.
 */
export default function RunLockNotice({ since, children }: { since: number; children: ReactNode }) {
  return (
    <p
      className="sticky top-0 z-10 m-0 flex items-start gap-2 rounded-control border border-line bg-paper-2 px-2.5 py-2 text-xs leading-snug text-ink-soft shadow-[0_8px_14px_-12px_rgba(43,33,18,0.45)]"
      role="status"
    >
      <span className="flex-none inline-flex pt-px text-muted" aria-hidden="true">
        {Icons.clock}
      </span>
      <span>
        Locked while exporting — this run uses the settings as they were at {runClock(since)}. {children}
      </span>
    </p>
  );
}
