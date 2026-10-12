/**
 * A long panel read as numbered CHAPTERS (2026-10-12, face ★ of
 * `docs/opener-inspector-redesign.md`): an index of one line per chapter —
 * its number, its name, what it is set to, a dot where it departs from the
 * defaults — and, once one is opened, a head to come back by and a foot to
 * step to its neighbours. One chapter is on screen at a time; the number
 * never moves, so «5 · Map» is the same place on every piece.
 *
 * Drawing only: what a row says is computed by the caller (the openers do it
 * in `opener-chapters.ts`, pure).
 */

import type { ReactNode } from 'react';
import { Icons } from './icons';
import { PRESS_LOOK } from './press';

export interface ChapterRow {
  id: string;
  n: number;
  title: string;
  /** What it is set to, in a few words; empty says nothing. */
  summary: string;
  changed: boolean;
  /** Why there is nothing to set here on this piece, or null. */
  unmet: string | null;
  /** Under a search, the row words that matched. */
  matched?: readonly string[];
}

const ROW =
  `w-full grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2.5 px-1 py-2 border-0 border-b border-line bg-transparent text-left font-sans cursor-pointer select-none transition-colors duration-150 ease-paper hover:bg-paper-2 ${PRESS_LOOK} data-pressed:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent`;

/** The chapters, one line each. */
export function ChapterIndex({ rows, onOpen, label }: { rows: readonly ChapterRow[]; onOpen: (id: string) => void; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-col border-t border-line">
      {rows.map((row) => (
        <button key={row.id} type="button" className={ROW} onClick={() => onOpen(row.id)}>
          <span className={`font-serif text-2xl leading-none text-center tabular-nums ${row.unmet ? 'text-muted' : 'text-accent-ink'}`}>
            {row.n}
          </span>
          <span className="min-w-0 flex flex-col">
            <span className={`flex items-center gap-1.5 text-sm font-semibold ${row.unmet ? 'text-muted' : 'text-ink'}`}>
              {row.title}
              {row.changed && <span className="w-1.5 h-1.5 rounded-full bg-accent" title="Changed from the defaults" aria-label="changed" />}
            </span>
            <span className="text-xs text-muted truncate">
              {row.matched?.length ? row.matched.join(' · ') : (row.unmet ?? (row.summary || '—'))}
            </span>
          </span>
          <span className="text-muted [&>svg]:w-4 [&>svg]:h-4" aria-hidden="true">
            {Icons.chevronRight}
          </span>
        </button>
      ))}
    </nav>
  );
}

/** The open chapter's head: the way back to the index, its number and name, a reset when it has one. */
export function ChapterHead({
  row,
  of,
  onBack,
  onReset,
}: {
  row: ChapterRow;
  of: number;
  onBack: () => void;
  onReset?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 pb-2 border-b border-line">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className={`inline-flex items-center gap-0.5 h-7 pl-1 pr-2.5 rounded-full border border-line bg-paper-2 text-xs font-medium text-ink-soft cursor-pointer select-none ${PRESS_LOOK} hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&>svg]:w-3.5 [&>svg]:h-3.5`}
        >
          {Icons.back}
          All
        </button>
        <h3 className="m-0 flex-1 min-w-0 flex items-baseline gap-1.5">
          <span className="font-serif text-2xl leading-none text-accent-ink tabular-nums">{row.n}</span>
          <span className="text-sm font-semibold text-ink truncate">{row.title}</span>
        </h3>
        {row.changed && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink"
          >
            Reset
          </button>
        )}
        <span className="font-mono text-2xs text-faint tabular-nums">
          {row.n}/{of}
        </span>
      </div>
      {row.unmet && <p className="m-0 text-xs text-muted">{row.unmet}</p>}
    </div>
  );
}

/** Step to the chapter before or after the open one. */
export function ChapterFoot({ prev, next, onOpen }: { prev: ChapterRow | null; next: ChapterRow | null; onOpen: (id: string) => void }) {
  const step = (row: ChapterRow | null, side: 'prev' | 'next'): ReactNode =>
    row ? (
      <button
        type="button"
        onClick={() => onOpen(row.id)}
        className={`min-w-0 flex flex-col gap-0.5 px-2.5 py-1.5 rounded-control border border-line bg-paper-2 text-xs text-ink-soft cursor-pointer select-none ${PRESS_LOOK} hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
          side === 'next' ? 'items-end text-right' : 'items-start text-left'
        }`}
      >
        <span className="font-mono text-2xs text-faint">{side === 'prev' ? `‹ ${row.n}` : `${row.n} ›`}</span>
        <span className="truncate max-w-full">{row.title}</span>
      </button>
    ) : (
      <span />
    );
  return (
    <div className="grid grid-cols-2 gap-1.5 pt-1">
      {step(prev, 'prev')}
      {step(next, 'next')}
    </div>
  );
}
