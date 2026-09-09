import { useEffect, useMemo, useRef, useState } from 'react';
import type { WinnowClient } from '../shared/sources/winnow/client';
import { densityStrip, type DayBar } from '../shared/sources/winnow/day-density';
import {
  monthKeyOf,
  monthLabel,
  monthSpan,
  shiftMonth,
} from '../shared/sources/winnow/month';
import {
  addDays,
  describeRelativeDay,
  formatIsoDate,
  todayIso,
  WEEKDAYS,
  weekdayIndex,
} from '../shared/roadtrip/trip-days';

interface DayPickerProps {
  /** The day being asked about, `YYYY-MM-DD`. */
  day: string;
  onDay: (iso: string) => void;
  /** Whether the instance's answer for that day is still coming. */
  asking: boolean;
  /** How many files it holds that day; null while asking, or after a failure. */
  count: number | null;
  /** The instance to ask a month's shape of, or null when there is none. */
  client: WinnowClient | null;
  /** Its host, named in the strip's own sentences. */
  connectionId: string;
}

/** How tall the strip draws, in CSS pixels. */
const STRIP_HEIGHT = 44;
/** The stub an empty day keeps, so the month has a baseline to read against. */
const EMPTY_HEIGHT = 3;

/** The month's two readings; which one is up is a preference, not state. */
type MonthView = 'strip' | 'calendar';
const VIEW_KEY = 'atelier.library.month-view';

function readMonthView(): MonthView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'strip';
  } catch {
    return 'strip';
  }
}

function writeMonthView(view: MonthView) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* preference only */
  }
}

/** What the month's answer is, once it comes. */
interface MonthAnswer {
  counts: Map<string, number>;
  bounds: { min: string; max: string } | null;
}

const monthBtn =
  'w-6 h-6 shrink-0 rounded-lg border border-line bg-paper text-ink-soft cursor-pointer hover:border-line-strong disabled:opacity-30 disabled:cursor-default';

/**
 * The day the Winnow tab is asking about, when no tool publishes a span.
 *
 * A **stepper**, not a bare date field: the verb here is *browse the days
 * around a shoot*, so the two arrows are the common move — and the value opens
 * the month as a **density strip**, one bar per day, its height the count the
 * instance holds. That is the question a calendar of empty squares cannot
 * answer at 288px: *which days have footage on them*. `/api/assets/calendar`
 * already returns a count per day for a span plus `bounds`, the oldest and
 * newest dated media in the whole library (independent of the window asked
 * for), which is what stops the month arrows at the edge of what exists.
 *
 * The same month reads **two ways**, one click apart in the popover's header
 * and remembered in `localStorage`: the strip says where the shooting was, the
 * calendar says which weekday it fell on. Neither answers the other's
 * question, so neither replaces the other.
 *
 * The popover replaces the invisible `<input type="date">` that used to lend
 * the OS picker: a native calendar cannot show counts, and the counts are the
 * point. Which means this owns the popover contract in exchange — Escape and a
 * click outside close it, focus returns to the value, and the arrow keys walk
 * the month (`tabIndex` roves, so Tab does not visit thirty-one days).
 *
 * The value is drawn from the ISO string through `trip-days` (UTC, like every
 * date in the suite), never by a field's locale rendering — which is where
 * `08/09/2026`, a date whose day and month swap by machine, came from.
 *
 * Under the control, one line replaces the paragraph the sidebar used to spend
 * on the same fact: a dot for whether the instance holds anything that day, the
 * day in words, then the count. `WinnowScopeGrid` therefore stops announcing it
 * (`announce={false}`); a real problem still comes from there, in red.
 */
export default function DayPicker({
  day,
  onDay,
  asking,
  count,
  client,
  connectionId,
}: DayPickerProps) {
  const today = todayIso();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLButtonElement>(null);

  const step = (days: number) => {
    const next = addDays(day, days);
    if (next) onDay(next);
  };

  // Close on outside click or Escape, and hand focus back — the popover
  // pattern `ToolSwitcher` already sets, no library.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      valueRef.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1">
      <div className="flex h-8 items-stretch overflow-hidden rounded-paper border border-line bg-paper focus-within:border-accent">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="The day before"
          title="The day before"
          className="w-8 shrink-0 border-0 bg-transparent text-muted cursor-pointer hover:bg-paper-2 hover:text-ink"
        >
          ‹
        </button>
        <button
          ref={valueRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={`Pick a day from what ${connectionId} holds`}
          className="flex-1 min-w-0 flex items-center justify-center gap-1 border-0 border-x border-line bg-transparent px-1 font-mono text-[0.78rem] tabular-nums text-ink cursor-pointer whitespace-nowrap hover:bg-paper-2"
        >
          <span className="text-muted">{WEEKDAYS[weekdayIndex(day) ?? 0]}</span>
          <span className="truncate">{formatIsoDate(day)}</span>
          <span className="text-[0.55rem] text-faint" aria-hidden="true">
            ▾
          </span>
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          // Nothing was shot after today; the arrow says so rather than
          // asking the instance about a day it cannot hold anything on.
          disabled={day >= today}
          aria-label="The day after"
          title="The day after"
          className="w-8 shrink-0 border-0 bg-transparent text-muted cursor-pointer hover:bg-paper-2 hover:text-ink disabled:text-faint disabled:cursor-default disabled:hover:bg-transparent"
        >
          ›
        </button>
      </div>

      {open && (
        <MonthPanel
          day={day}
          today={today}
          client={client}
          connectionId={connectionId}
          onPick={(iso) => {
            onDay(iso);
            setOpen(false);
            valueRef.current?.focus();
          }}
        />
      )}

      <p className="m-0 flex items-center gap-1.5 text-[0.7rem] text-muted">
        <span
          aria-hidden="true"
          // The dot pulses while the answer is out: a still grey dot beside
          // "asking…" is the same picture as a day holding nothing.
          className={`w-1.5 h-1.5 shrink-0 rounded-full ${
            asking ? 'bg-faint animate-pulse-dot motion-reduce:animate-none' : count ? 'bg-accent' : 'bg-faint'
          }`}
        />
        <span className="truncate">
          {describeRelativeDay(day, today) ?? day} ·{' '}
          {asking
            ? 'asking…'
            : count === null
              ? 'no answer'
              : count === 0
                ? 'nothing here'
                : `${count} file${count === 1 ? '' : 's'}`}
        </span>
      </p>
    </div>
  );
}

interface MonthPanelProps {
  day: string;
  today: string;
  client: WinnowClient | null;
  connectionId: string;
  onPick: (iso: string) => void;
}

/**
 * One month of the instance, drawn either way.
 *
 * A month is one `calendar()` request, kept for as long as the popover lives
 * (a month walked back to is not asked for twice) and thrown away with it —
 * counts move as the instance ingests, and a picker is open for seconds.
 * Nothing is asked while it is closed, the same rule the tab itself follows.
 *
 * **While a month is in flight the body says so**: the days are drawn at a
 * uniform height, dimmed, pulsing and inert (`aria-busy`). An empty-looking
 * month that is merely unanswered is the one reading this control must never
 * give — the maintainer walked three months believing they held nothing, and
 * the media arrived after he had moved on.
 */
function MonthPanel({ day, today, client, connectionId, onPick }: MonthPanelProps) {
  const [month, setMonth] = useState(() => monthKeyOf(day));
  const [view, setView] = useState<MonthView>(readMonthView);
  const [answer, setAnswer] = useState<MonthAnswer | null>(null);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const cache = useRef(new Map<string, MonthAnswer>());

  const span = useMemo(() => monthSpan(month), [month]);

  useEffect(() => {
    const hit = cache.current.get(month);
    if (hit) {
      setAnswer(hit);
      setFailed(false);
      return;
    }
    setAnswer(null);
    setFailed(false);
    if (!client) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    client
      .calendar(span.from, span.to)
      .then((cal) => {
        if (cancelled) return;
        const got = {
          counts: new Map(cal.days.map((d) => [d.date, d.count])),
          bounds: cal.bounds,
        };
        cache.current.set(month, got);
        setAnswer(got);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client, month, span.from, span.to]);

  /** Waiting on this month — not the same thing as a month holding nothing. */
  const busy = !answer && !failed;
  const strip = densityStrip(span.days, answer?.counts ?? new Map());
  const bounds = answer?.bounds ?? null;
  // Only what the instance itself says it holds bounds the walk; with no
  // answer yet, both arrows stay live rather than pretending to know.
  const canPrev = !bounds || month > monthKeyOf(bounds.min);
  const canNext = !bounds || month < monthKeyOf(bounds.max);
  /** The one day Tab reaches: the picked one, else the month's first. */
  const roving = strip.bars.some((b) => b.date === day) ? day : span.from;

  const read = ((): string => {
    if (busy) return `asking ${connectionId}…`;
    if (hovered) {
      const n = strip.bars.find((b) => b.date === hovered)?.count ?? 0;
      return `${formatIsoDate(hovered)} · ${n ? `${n} file${n === 1 ? '' : 's'}` : 'nothing'}`;
    }
    if (failed) return `could not ask ${connectionId}`;
    if (!strip.total) return `nothing in ${monthLabel(month)}`;
    return `${strip.total} file${strip.total === 1 ? '' : 's'} · busiest day ${strip.peak}`;
  })();

  const bodyProps: MonthBodyProps = {
    bars: strip.bars,
    day,
    today,
    roving,
    busy,
    leading: span.leading,
    onPick,
    onHover: setHovered,
  };

  return (
    <div
      role="dialog"
      aria-label="Pick a day"
      className="absolute left-0 right-0 top-9 z-20 flex flex-col gap-1.5 rounded-paper border border-line-strong bg-surface p-2 shadow-paper"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, -1))}
          disabled={!canPrev}
          aria-label="The month before"
          className={monthBtn}
        >
          ‹
        </button>
        <span
          className="flex-1 min-w-0 truncate text-center font-mono text-[0.68rem] text-ink"
          title={
            bounds ? `${connectionId} holds media from ${bounds.min} to ${bounds.max}` : undefined
          }
        >
          {monthLabel(month)}
        </span>
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, 1))}
          disabled={!canNext}
          aria-label="The month after"
          className={monthBtn}
        >
          ›
        </button>
        {/* The two readings of the same month, one click apart and remembered:
            the strip says where the shooting was, the calendar says which
            weekday it fell on. Neither answers the other's question. */}
        <button
          type="button"
          onClick={() => {
            const next = view === 'strip' ? 'calendar' : 'strip';
            setView(next);
            writeMonthView(next);
          }}
          aria-label={view === 'strip' ? 'Show the month as a calendar' : 'Show the month as a strip'}
          title={view === 'strip' ? 'Show the month as a calendar' : 'Show the month as a strip'}
          className={`${monthBtn} ml-0.5 grid place-items-center`}
        >
          {view === 'strip' ? <CalendarGlyph /> : <StripGlyph />}
        </button>
      </div>

      {view === 'strip' ? <StripBody {...bodyProps} /> : <CalendarBody {...bodyProps} />}

      <p className="m-0 truncate text-center font-mono text-[0.58rem] text-muted">{read}</p>
    </div>
  );
}

interface MonthBodyProps {
  bars: readonly DayBar[];
  day: string;
  today: string;
  /** The one day carrying `tabIndex=0`, so Tab does not visit thirty-one. */
  roving: string;
  /** Waiting on the instance: draw the month, but never as an answer. */
  busy: boolean;
  /** Blank cells before the 1st, so the calendar starts on the right weekday. */
  leading: number;
  onPick: (iso: string) => void;
  onHover: (iso: string | null) => void;
}

/**
 * Arrow-key walking, shared by both bodies: `columns` is 1 for the strip (a
 * single row, so up and down have nothing to say) and 7 for the calendar,
 * where they step a week. Focus moves; Enter and space still do the picking,
 * because these are ordinary buttons.
 *
 * The step is counted over **every** day, disabled ones included, or the
 * geometry lies: with the rest of the month out of reach (the future), a
 * seventh *enabled* button is not the same weekday a week later. Landing on
 * one of those is simply refused — Home and End are the two that search
 * inward for a day the walk may have.
 */
function walkDays(e: React.KeyboardEvent<HTMLDivElement>, columns: number) {
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
    days[to]?.focus();
    return;
  }
  const to = at + jump;
  if (to < 0 || to >= days.length || days[to].disabled) return;
  days[to].focus();
}

/** The busy dress: dimmed, pulsing, and nothing to click. */
const busyClass = 'opacity-50 animate-pulse motion-reduce:animate-none pointer-events-none';

/**
 * The month as bars — one per day, height by count.
 *
 * The button is the full height of the strip, so a six-pixel-wide day is still
 * a comfortable target vertically; the stepper's arrows remain the fine
 * adjustment. A picked day carries a full-height wash as well as its bar: on a
 * day the instance holds nothing the bar is a stub, and "you are here" would
 * otherwise be invisible.
 */
function StripBody({ bars, day, today, roving, busy, onPick, onHover }: MonthBodyProps) {
  return (
    <div
      role="group"
      aria-label="Days of the month"
      aria-busy={busy}
      onKeyDown={(e) => walkDays(e, 1)}
      onPointerLeave={() => onHover(null)}
      className={`flex items-end gap-[2px] ${busy ? busyClass : ''}`}
      style={{ height: `${STRIP_HEIGHT}px` }}
    >
      {bars.map((bar) => {
        const picked = bar.date === day;
        // Waiting: every day the same height, or a month nobody has answered
        // for reads exactly like a month holding nothing.
        const height = busy
          ? Math.round(STRIP_HEIGHT * 0.4)
          : bar.count
            ? Math.round(bar.fill * STRIP_HEIGHT)
            : EMPTY_HEIGHT;
        return (
          <button
            key={bar.date}
            type="button"
            disabled={bar.date > today}
            tabIndex={bar.date === roving ? 0 : -1}
            onClick={() => onPick(bar.date)}
            onPointerEnter={() => onHover(bar.date)}
            onFocus={() => onHover(bar.date)}
            onBlur={() => onHover(null)}
            aria-pressed={picked}
            aria-label={dayLabel(bar)}
            title={`${bar.date}${bar.count ? ` · ${bar.count} files` : ''}`}
            className={`flex-1 min-w-0 h-full flex flex-col justify-end border-0 p-0 cursor-pointer disabled:cursor-default disabled:opacity-40 group rounded-t-[3px] ${
              picked ? 'bg-[rgba(27,24,19,0.08)]' : 'bg-transparent'
            }`}
          >
            <span
              className={`w-full rounded-t-[2px] border border-b-0 transition-colors ${
                picked && !busy
                  ? 'bg-ink border-ink'
                  : bar.count && !busy
                    ? 'bg-accent-wash border-[#eccabf] group-hover:border-accent'
                    : 'bg-paper-2 border-line group-hover:border-line-strong'
              }`}
              style={{ height: `${height}px` }}
            />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The month as a calendar — the same counts, read by weekday.
 *
 * Fixed-height cells, never `aspect-square`: a `1fr` grid track's width is
 * indefinite and the ratio resolves against it however the browser likes
 * (`frontend.md`). An empty day stays clickable here, unlike the browse-all
 * sheet's grid: the stepper's arrows can already step onto one, and a picker
 * refusing what the arrows allow reads as broken.
 */
function CalendarBody({
  bars,
  day,
  today,
  roving,
  busy,
  leading,
  onPick,
  onHover,
}: MonthBodyProps) {
  return (
    <div
      role="group"
      aria-label="Days of the month"
      aria-busy={busy}
      onKeyDown={(e) => walkDays(e, 7)}
      onPointerLeave={() => onHover(null)}
      className={`grid grid-cols-7 gap-[3px] ${busy ? busyClass : ''}`}
    >
      {WEEKDAYS.map((name, i) => (
        <span key={i} className="text-center font-mono text-[0.5rem] text-faint">
          {name[0]}
        </span>
      ))}
      {Array.from({ length: leading }, (_, i) => (
        <span key={`lead-${i}`} />
      ))}
      {bars.map((bar) => {
        const picked = bar.date === day;
        return (
          <button
            key={bar.date}
            type="button"
            disabled={bar.date > today}
            tabIndex={bar.date === roving ? 0 : -1}
            onClick={() => onPick(bar.date)}
            onPointerEnter={() => onHover(bar.date)}
            onFocus={() => onHover(bar.date)}
            onBlur={() => onHover(null)}
            aria-pressed={picked}
            aria-label={dayLabel(bar)}
            title={`${bar.date}${bar.count ? ` · ${bar.count} files` : ''}`}
            className={`h-[30px] flex flex-col items-center justify-center gap-[1px] rounded-md border font-mono text-[0.62rem] tabular-nums cursor-pointer transition-colors disabled:cursor-default disabled:opacity-40 ${
              picked
                ? 'bg-ink border-ink text-paper'
                : bar.count && !busy
                  ? 'bg-accent-wash border-[#eccabf] text-ink hover:border-accent'
                  : 'bg-paper border-line text-faint hover:border-line-strong'
            } ${bar.date === today && !picked ? 'shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : ''}`}
          >
            {Number(bar.date.slice(-2))}
            {bar.count > 0 && !busy && (
              <span className="text-[0.44rem] leading-none opacity-70">{bar.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function dayLabel(bar: DayBar): string {
  return `${WEEKDAYS[weekdayIndex(bar.date) ?? 0]} ${formatIsoDate(bar.date)}, ${
    bar.count ? `${bar.count} files` : 'nothing'
  }`;
}

function CalendarGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="1.8" y="3" width="12.4" height="11" rx="2" />
      <path d="M1.8 6.4h12.4M5.4 1.6v2.6M10.6 1.6v2.6" />
    </svg>
  );
}

function StripGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="1.5" y="9" width="2.4" height="5" rx="0.6" />
      <rect x="5.3" y="4.5" width="2.4" height="9.5" rx="0.6" />
      <rect x="9.1" y="7" width="2.4" height="7" rx="0.6" />
      <rect x="12.9" y="11" width="2.4" height="3" rx="0.6" />
    </svg>
  );
}
