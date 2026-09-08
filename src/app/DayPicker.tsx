import { useEffect, useMemo, useRef, useState } from 'react';
import type { WinnowClient } from '../shared/sources/winnow/client';
import { densityStrip } from '../shared/sources/winnow/day-density';
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
 * The strip replaces the invisible `<input type="date">` that used to lend the
 * OS picker: a native calendar cannot show counts, and the counts are the
 * point. Which means this owns the popover contract in exchange — Escape and a
 * click outside close it, focus returns to the value, and the arrow keys walk
 * the month (`tabIndex` roves, so Tab does not visit thirty-one bars).
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
        <MonthStrip
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
          className={`w-1.5 h-1.5 shrink-0 rounded-full ${count ? 'bg-accent' : 'bg-faint'}`}
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

interface MonthStripProps {
  day: string;
  today: string;
  client: WinnowClient | null;
  connectionId: string;
  onPick: (iso: string) => void;
}

/**
 * One month of the instance, as bars.
 *
 * A month is one `calendar()` request, kept for as long as the popover lives
 * (a month walked back to is not asked for twice) and thrown away with it —
 * counts move as the instance ingests, and a picker is open for seconds.
 * Nothing is asked while it is closed, the same rule the tab itself follows.
 */
function MonthStrip({ day, today, client, connectionId, onPick }: MonthStripProps) {
  const [month, setMonth] = useState(() => monthKeyOf(day));
  const [answer, setAnswer] = useState<{
    counts: Map<string, number>;
    bounds: { min: string; max: string } | null;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const cache = useRef(
    new Map<string, { counts: Map<string, number>; bounds: { min: string; max: string } | null }>(),
  );

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

  const strip = densityStrip(span.days, answer?.counts ?? new Map());
  const bounds = answer?.bounds ?? null;
  // Only what the instance itself says it holds bounds the walk; with no
  // answer yet, both arrows stay live rather than pretending to know.
  const canPrev = !bounds || month > monthKeyOf(bounds.min);
  const canNext = !bounds || month < monthKeyOf(bounds.max);
  /** The one bar Tab reaches: the picked day, else the month's first. */
  const roving = strip.bars.some((b) => b.date === day) ? day : span.from;

  function walk(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const bars = [
      ...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
    ];
    const at = bars.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to =
      e.key === 'ArrowLeft'
        ? at - 1
        : e.key === 'ArrowRight'
          ? at + 1
          : e.key === 'Home'
            ? 0
            : bars.length - 1;
    const next = bars[Math.min(Math.max(to, 0), bars.length - 1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
  }

  const read = ((): string => {
    if (hovered) {
      const n = strip.bars.find((b) => b.date === hovered)?.count ?? 0;
      return `${formatIsoDate(hovered)} · ${n ? `${n} file${n === 1 ? '' : 's'}` : 'nothing'}`;
    }
    if (failed) return `could not ask ${connectionId}`;
    if (!answer) return `asking ${connectionId}…`;
    if (!strip.total) return `nothing in ${monthLabel(month)}`;
    return `${strip.total} file${strip.total === 1 ? '' : 's'} · busiest day ${strip.peak}`;
  })();

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
          className="w-6 h-6 shrink-0 rounded-lg border border-line bg-paper text-ink-soft cursor-pointer hover:border-line-strong disabled:opacity-30 disabled:cursor-default"
        >
          ‹
        </button>
        <span
          className="flex-1 min-w-0 truncate text-center font-mono text-[0.68rem] text-ink"
          title={bounds ? `${connectionId} holds media from ${bounds.min} to ${bounds.max}` : undefined}
        >
          {monthLabel(month)}
        </span>
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, 1))}
          disabled={!canNext}
          aria-label="The month after"
          className="w-6 h-6 shrink-0 rounded-lg border border-line bg-paper text-ink-soft cursor-pointer hover:border-line-strong disabled:opacity-30 disabled:cursor-default"
        >
          ›
        </button>
      </div>

      {/* One bar per day. The button is the full height of the strip, so a
          six-pixel-wide day is still a comfortable target vertically; the
          arrows remain the fine adjustment. */}
      <div
        role="group"
        aria-label={`Days of ${monthLabel(month)}`}
        onKeyDown={walk}
        onPointerLeave={() => setHovered(null)}
        className="flex items-end gap-[2px]"
        style={{ height: `${STRIP_HEIGHT}px` }}
      >
        {strip.bars.map((bar) => {
          const future = bar.date > today;
          const picked = bar.date === day;
          return (
            <button
              key={bar.date}
              type="button"
              disabled={future}
              tabIndex={bar.date === roving ? 0 : -1}
              onClick={() => onPick(bar.date)}
              onPointerEnter={() => setHovered(bar.date)}
              onFocus={() => setHovered(bar.date)}
              onBlur={() => setHovered(null)}
              aria-pressed={picked}
              aria-label={`${WEEKDAYS[weekdayIndex(bar.date) ?? 0]} ${formatIsoDate(bar.date)}, ${
                bar.count ? `${bar.count} files` : 'nothing'
              }`}
              title={`${bar.date}${bar.count ? ` · ${bar.count} files` : ''}`}
              // The picked day carries a full-height wash as well as its bar:
              // on a day the instance holds nothing, the bar is a 3px stub and
              // "you are here" would otherwise be invisible.
              className={`flex-1 min-w-0 h-full flex flex-col justify-end border-0 p-0 cursor-pointer disabled:cursor-default disabled:opacity-40 group rounded-t-[3px] ${
                picked ? 'bg-[rgba(27,24,19,0.08)]' : 'bg-transparent'
              }`}
            >
              <span
                className={`w-full rounded-t-[2px] border border-b-0 transition-colors ${
                  picked
                    ? 'bg-ink border-ink'
                    : bar.count
                      ? 'bg-accent-wash border-[#eccabf] group-hover:border-accent'
                      : 'bg-paper-2 border-line group-hover:border-line-strong'
                }`}
                style={{
                  height: `${bar.count ? Math.round(bar.fill * STRIP_HEIGHT) : EMPTY_HEIGHT}px`,
                }}
              />
            </button>
          );
        })}
      </div>

      <p className="m-0 truncate text-center font-mono text-[0.58rem] text-muted">{read}</p>
    </div>
  );
}
