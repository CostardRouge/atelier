import { useEffect, useMemo, useRef, useState } from 'react';
import { weekStartOf } from '../../shared/recap/recap-days';
import type { RecapTemplate } from '../../shared/recap/recap-doc';
import { addDays, formatIsoDate, todayIso } from '../../shared/roadtrip/trip-days';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { monthSpan } from '../../shared/sources/winnow/month';
import { CalendarGrid, MonthHeader } from '../../shared/ui/MonthCalendar';

/** What a recap is about, as the calendar edits it. */
export interface When {
  anchor: string;
  range: { from: string; to: string } | null;
}

interface Answer {
  counts: Map<string, number>;
  bounds: { from: string; to: string } | null;
}

/**
 * A Winnow's files per day for one month, asked once per month while the
 * calendar lives (the Library's rule): null while asking, or with no Winnow.
 */
function useMonthCounts(client: WinnowClient | null, month: string): { answer: Answer | null; busy: boolean } {
  const cache = useRef(new Map<string, Answer>());
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!client) {
      setAnswer(null);
      setBusy(false);
      return;
    }
    const hit = cache.current.get(month);
    if (hit) {
      setAnswer(hit);
      setBusy(false);
      return;
    }
    const span = monthSpan(month);
    const controller = new AbortController();
    setBusy(true);
    client
      .calendar(span.from, span.to, {}, controller.signal)
      .then((cal) => {
        const got = { counts: new Map(cal.days.map((d) => [d.date, d.count])), bounds: cal.bounds ? { from: cal.bounds.min, to: cal.bounds.max } : null };
        cache.current.set(month, got);
        setAnswer(got);
        setBusy(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAnswer(null);
          setBusy(false);
        }
      });
    return () => controller.abort();
  }, [client, month]);
  return { answer, busy };
}

/** The days a template's value covers, as the calendar draws them picked. */
function pickedOf(template: RecapTemplate, when: When): { from: string; to: string } {
  if (template === 'month') return { from: `${when.anchor.slice(0, 7)}-01`, to: monthSpan(when.anchor.slice(0, 7)).to };
  if (template === 'week') return { from: when.anchor, to: addDays(when.anchor, 6) ?? when.anchor };
  if (template === 'onThisDay') return { from: when.anchor, to: when.anchor };
  return when.range ?? { from: when.anchor, to: when.anchor };
}

/**
 * The recap's WHEN, picked on the suite's one month calendar
 * (`shared/ui/MonthCalendar.tsx`) at its roomy size: the month lists jump to
 * any month of any year, each day says how many files the connected Winnow
 * holds. What a click means is the template's: a month takes the day's month
 * (and the header's month IS the value), a week the day's week, on this day
 * the day, a period two clicks (its first day, then its last).
 */
export default function WhenCalendar({
  template,
  when,
  onChange,
  client,
  weekStart = 1,
}: {
  template: RecapTemplate;
  when: When;
  /** `done`: the pick is complete (a popover closes). */
  onChange: (when: When, done: boolean) => void;
  client: WinnowClient | null;
  weekStart?: 0 | 1;
}) {
  const today = todayIso();
  const [month, setMonth] = useState(() => (when.range?.from ?? when.anchor).slice(0, 7));
  const [first, setFirst] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const { answer, busy } = useMonthCounts(client, month);
  const picked = useMemo(() => {
    if (first) {
      if (!hovered) return { from: first, to: first };
      return first <= hovered ? { from: first, to: hovered } : { from: hovered, to: first };
    }
    return pickedOf(template, when);
  }, [template, when, first, hovered]);

  const goMonth = (key: string) => {
    setMonth(key);
    // A month recap IS its month: the header's teleport changes it at once.
    if (template === 'month') onChange({ anchor: `${key}-01`, range: null }, false);
  };
  const pick = (iso: string) => {
    if (template === 'month') onChange({ anchor: `${iso.slice(0, 7)}-01`, range: null }, true);
    else if (template === 'week') onChange({ anchor: weekStartOf(iso, weekStart) ?? iso, range: null }, true);
    else if (template === 'onThisDay') onChange({ anchor: iso, range: null }, true);
    else if (!first) setFirst(iso);
    else {
      const [from, to] = first <= iso ? [first, iso] : [iso, first];
      setFirst(null);
      onChange({ anchor: from, range: { from, to } }, true);
    }
  };

  const total = answer ? [...answer.counts.values()].reduce((a, b) => a + b, 0) : 0;
  const line = (() => {
    if (first) return `from ${formatIsoDate(first)} — now its last day`;
    if (busy) return 'asking the Winnow…';
    if (hovered && answer) {
      const n = answer.counts.get(hovered) ?? 0;
      return `${formatIsoDate(hovered)} · ${n ? `${n} file${n === 1 ? '' : 's'}` : 'nothing'}`;
    }
    if (answer) return total ? `${total.toLocaleString()} file${total === 1 ? '' : 's'} this month` : 'nothing this month';
    if (template === 'grid' || template === 'single' || template === 'dump' || template === 'sheets') return 'two clicks: its first day, then its last';
    return '';
  })();

  return (
    <div className="flex flex-col gap-2">
      <MonthHeader month={month} onMonth={goMonth} today={today} bounds={answer?.bounds ?? null} size="roomy" />
      <CalendarGrid month={month} counts={answer?.counts ?? null} busy={busy} picked={picked} today={today} onPick={pick} onHover={setHovered} size="roomy" />
      {line && <p className="m-0 text-center font-mono text-2xs text-muted truncate">{line}</p>}
    </div>
  );
}
