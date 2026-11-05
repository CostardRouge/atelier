import type { KeyboardEvent, ReactNode, SelectHTMLAttributes } from 'react';
import { WEEKDAYS, formatIsoDate, weekdayIndex } from '../roadtrip/trip-days';
import { monthSpan, shiftMonth } from '../sources/winnow/month';
import { Icons } from './icons';

/**
 * ONE month calendar for the suite (his ask, 2026-11-05: «un composant
 * commun … plus grand dans l'inspecteur de Recap»): the Library's day picker
 * (`sources/winnow/DayPicker.tsx`) and Recap's month, day and period fields
 * draw the same header and the same grid, at two sizes.
 *
 * The header is ‹ [month ▾] [year ▾] › — the arrows step, the two lists
 * TELEPORT to any month of any year. The grid writes each day's count (a
 * source's files on that day) under its number when a count is known, and
 * never reads an unanswered month as an empty one (`busy`).
 *
 * The calendar owns no request and no value: the caller says which month is
 * shown, which days are picked and what a click does.
 */

export interface DaySpanLike {
  from: string;
  to: string;
}

export type CalendarSize = 'compact' | 'roomy';

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2000, i, 1)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }));

/** The busy dress: dimmed, pulsing, and nothing to click. */
export const busyClass = 'opacity-50 animate-pulse motion-reduce:animate-none pointer-events-none';

/**
 * Arrow-key walking over a body's day buttons: `columns` is 1 for a single
 * row and 7 for a calendar, where up and down step a week. Counted over EVERY
 * day, disabled ones included, so the geometry holds; landing on a disabled
 * one is refused — Home and End search inward for a day the walk may have.
 */
export function walkDays(e: KeyboardEvent<HTMLDivElement>, columns: number) {
  const steps: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ...(columns > 1 ? { ArrowUp: -columns, ArrowDown: columns } : {}),
  };
  const jump = steps[e.key];
  const ends = e.key === 'Home' || e.key === 'End';
  if (jump === undefined && !ends) return;
  const days = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
  const at = days.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  if (ends) {
    const inward = e.key === 'Home' ? 1 : -1;
    let to = e.key === 'Home' ? 0 : days.length - 1;
    while (to >= 0 && to < days.length && days[to].disabled) to += inward;
    days[to]?.focus({ preventScroll: true });
    return;
  }
  const to = at + jump;
  if (to < 0 || to >= days.length || days[to].disabled) return;
  days[to].focus({ preventScroll: true });
}

/** The years a header offers: what the source holds, and at least the last fifteen and today's. */
export function yearsOffered(month: string, today: string, bounds: DaySpanLike | null): number[] {
  const now = Number(today.slice(0, 4));
  let min = Math.min(now - 15, Number(month.slice(0, 4)));
  let max = Math.max(now, Number(month.slice(0, 4)));
  if (bounds) {
    min = Math.min(min, Number(bounds.from.slice(0, 4)));
    max = Math.max(max, Number(bounds.to.slice(0, 4)));
  }
  const out: number[] = [];
  for (let y = max; y >= min; y--) out.push(y);
  return out;
}

// The browser's own arrow sat against the right edge: drawn here instead, as far in from the right as the text is from the left.
const selectClass = {
  compact: 'h-6 pl-1.5 pr-5 text-2xs',
  roomy: 'h-9 pointer-coarse:h-11 pl-2.5 pr-8 text-sm max-[820px]:text-base',
};
const chevronClass = {
  compact: 'right-1.5 [&>svg]:w-2.5 [&>svg]:h-2.5',
  roomy: 'right-2.5 [&>svg]:w-3.5 [&>svg]:h-3.5',
};

/** A native list, its arrow drawn by us with the same margin on both sides. */
function Picker({ scale, className, children, ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { scale: CalendarSize }) {
  return (
    <span className={`relative inline-flex min-w-0 ${className ?? ''}`}>
      <select {...rest} className={`${selectClass[scale]} w-full appearance-none min-w-0 rounded-md border border-line bg-paper text-ink font-mono cursor-pointer focus:outline-none focus:border-accent`}>
        {children}
      </select>
      <span aria-hidden="true" className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted ${chevronClass[scale]}`}>
        {Icons.down}
      </span>
    </span>
  );
}
const arrowClass = {
  compact: 'w-6 h-6',
  roomy: 'w-9 h-9 pointer-coarse:w-11 pointer-coarse:h-11',
};

/**
 * ‹ [month ▾] [year ▾] › — `trailing` after (the Library's strip toggle).
 * `bounds` (the oldest and newest day a source holds) stops the arrows at
 * the edge of what exists and greys the months outside it; with no bounds,
 * every month is reachable.
 */
export function MonthHeader({
  month,
  onMonth,
  today,
  bounds = null,
  size = 'compact',
  trailing,
  title,
}: {
  month: string;
  onMonth: (key: string) => void;
  today: string;
  bounds?: DaySpanLike | null;
  size?: CalendarSize;
  trailing?: ReactNode;
  title?: string;
}) {
  const minKey = bounds ? bounds.from.slice(0, 7) : null;
  const maxKey = bounds ? bounds.to.slice(0, 7) : null;
  const canPrev = !minKey || month > minKey;
  const canNext = !maxKey || month < maxKey;
  const [y, m] = month.split('-');
  const years = yearsOffered(month, today, bounds);
  const go = (key: string) => {
    // A year teleport lands inside what exists: the same month, else the nearest edge.
    let k = key;
    if (minKey && k < minKey) k = minKey;
    if (maxKey && k > maxKey) k = maxKey;
    onMonth(k);
  };
  const arrow = `${arrowClass[size]} shrink-0 grid place-items-center rounded-lg border border-line bg-paper text-ink-soft cursor-pointer hover:border-line-strong disabled:opacity-30 disabled:cursor-default`;
  return (
    <div className="flex items-center gap-1" title={title}>
      <button type="button" onClick={() => go(shiftMonth(month, -1))} disabled={!canPrev} aria-label="The month before" className={arrow}>
        <span className={size === 'compact' ? '[&>svg]:w-3 [&>svg]:h-3' : ''}>{Icons.back}</span>
      </button>
      <span className="flex-1 min-w-0 flex items-center justify-center gap-1">
        <Picker scale={size} aria-label="Month" value={m} onChange={(e) => go(`${y}-${e.target.value}`)} className="flex-1 max-w-[9.5rem]">
          {MONTH_NAMES.map((name, i) => {
            const key = `${y}-${String(i + 1).padStart(2, '0')}`;
            const out = Boolean((minKey && key < minKey) || (maxKey && key > maxKey));
            return (
              <option key={name} value={String(i + 1).padStart(2, '0')} disabled={out}>
                {name}
              </option>
            );
          })}
        </Picker>
        <Picker scale={size} aria-label="Year" value={y} onChange={(e) => go(`${e.target.value}-${m}`)}>
          {years.map((yr) => (
            <option key={yr} value={String(yr)}>
              {yr}
            </option>
          ))}
        </Picker>
      </span>
      <button type="button" onClick={() => go(shiftMonth(month, 1))} disabled={!canNext} aria-label="The month after" className={arrow}>
        <span className={size === 'compact' ? '[&>svg]:w-3 [&>svg]:h-3' : ''}>{Icons.forward}</span>
      </button>
      {trailing}
    </div>
  );
}

export interface CalendarGridProps {
  month: string;
  /** Files per day, when a source says; a day it does not name holds nothing. */
  counts?: ReadonlyMap<string, number> | null;
  /** Waiting on the source: drawn, never as an answer. */
  busy?: boolean;
  /** The days picked — one day, a week, a month, a period. */
  picked: DaySpanLike | null;
  today: string;
  onPick: (iso: string) => void;
  onHover?: (iso: string | null) => void;
  /** A foot mark under a day (a tool's span), its class, or ''. */
  markOf?: (iso: string) => string;
  /** Days after today cannot be picked (a recap looks back; the Library has nothing there). */
  futureOff?: boolean;
  size?: CalendarSize;
  /** The one day carrying `tabIndex=0`; the picked one, else the month's first. */
  roving?: string;
}

/**
 * The month as a calendar: weekday letters, then a cell per day — its
 * number, and under it the count a source gave. Fixed-height cells, never
 * `aspect-square` (`frontend.md`). An empty day stays clickable: a picker that
 * refuses what its arrows allow reads as broken.
 */
export function CalendarGrid({ month, counts = null, busy = false, picked, today, onPick, onHover, markOf, futureOff = true, size = 'compact', roving }: CalendarGridProps) {
  const span = monthSpan(month);
  const roomy = size === 'roomy';
  const tab = roving ?? (picked && picked.from >= span.from && picked.from <= span.to ? picked.from : span.from);
  return (
    <div
      role="group"
      aria-label="Days of the month"
      aria-busy={busy}
      onKeyDown={(e) => walkDays(e, 7)}
      onPointerLeave={() => onHover?.(null)}
      className={`grid grid-cols-7 ${roomy ? 'gap-1' : 'gap-[3px]'} ${busy ? busyClass : ''}`}
    >
      {WEEKDAYS.map((name, i) => (
        <span key={i} className={`text-center font-mono text-faint ${roomy ? 'text-2xs pb-0.5' : 'text-3xs'}`}>
          {roomy ? name : name[0]}
        </span>
      ))}
      {Array.from({ length: span.leading }, (_, i) => (
        <span key={`lead-${i}`} />
      ))}
      {span.days.map((date) => {
        const count = counts?.get(date) ?? 0;
        const on = Boolean(picked && date >= picked.from && date <= picked.to);
        // A span (a week, a month, a period) fills its two ends; its inside is ringed, so its counts still read.
        const solid = on && picked !== null && (picked.from === picked.to || date === picked.from || date === picked.to);
        const mark = markOf?.(date) ?? '';
        return (
          <button
            key={date}
            type="button"
            disabled={futureOff && date > today}
            tabIndex={date === tab ? 0 : -1}
            onClick={() => onPick(date)}
            onPointerEnter={() => onHover?.(date)}
            onFocus={() => onHover?.(date)}
            onBlur={() => onHover?.(null)}
            aria-pressed={on}
            aria-label={`${WEEKDAYS[weekdayIndex(date) ?? 0]} ${formatIsoDate(date)}, ${count ? `${count} files` : counts ? 'nothing' : 'no count'}`}
            title={`${date}${count ? ` · ${count} files` : ''}`}
            className={`relative ${roomy ? 'h-11 rounded-lg text-sm' : 'h-[30px] rounded-md text-2xs'} flex flex-col items-center justify-center gap-[1px] border font-mono tabular-nums cursor-pointer transition-colors disabled:cursor-default disabled:opacity-40 ${
              solid
                ? 'bg-ink border-ink text-paper'
                : on
                  ? `${count && !busy ? 'bg-accent-wash' : 'bg-paper'} border-accent text-ink`
                  : count && !busy
                  ? 'bg-accent-wash border-danger-line text-ink hover:border-accent'
                  : 'bg-paper border-line text-faint hover:border-line-strong'
            } ${date === today && !on ? 'shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : ''}`}
          >
            {Number(date.slice(-2))}
            {count > 0 && !busy && <span className={`${roomy ? 'text-3xs' : 'text-3xs'} leading-none opacity-70`}>{count}</span>}
            {mark && <span aria-hidden="true" className={`absolute left-1 right-1 bottom-[2px] h-[2px] rounded-full ${mark}`} />}
          </button>
        );
      })}
    </div>
  );
}
