import { useEffect, useMemo, useState } from 'react';
import { WinnowClient } from '../../shared/sources/winnow/client';
import type { WinnowConnection } from '../../shared/sources/winnow/store';
import { factText } from '../../shared/story/story-facts';
import Button from '../../shared/ui/Button';
import { DateField } from '../../shared/ui/DateField';
import useDialogKeys from '../../shared/ui/use-dialog-keys';

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Every day from `from` to `to`, both included (ISO, UTC). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); Number.isFinite(t) && t <= end && out.length < 1000; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const weekdayOf = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
const monthOf = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

export interface DaysChoice {
  from?: string;
  to?: string;
  skip?: string[];
}

/**
 * Exactly which days a series counts: a first and last day, and days left
 * out one by one — on a calendar of the span, each day with what the Winnow
 * holds for it when one is connected, so a day of screenshots or of someone
 * else's trip is seen before it is left out. Reset returns to the kept
 * stages' days.
 */
export default function DaysModal({
  base,
  current,
  connection,
  onCancel,
  onApply,
}: {
  /** The kept stages' days — what Reset returns to. */
  base: { from: string; to: string };
  current: DaysChoice | undefined;
  connection: WinnowConnection | null;
  onCancel: () => void;
  /** Null = the kept stages' days, nothing left out. */
  onApply: (days: DaysChoice | null) => void;
}) {
  const [from, setFrom] = useState(current?.from ?? base.from);
  const [to, setTo] = useState(current?.to ?? base.to);
  const [skip, setSkip] = useState<Set<string>>(() => new Set(current?.skip ?? []));
  const [perDay, setPerDay] = useState<Map<string, number> | null>(null);
  const valid = !!from && !!to && from <= to;
  const days = useMemo(() => (valid ? daysBetween(from, to) : []), [from, to, valid]);

  useEffect(() => {
    if (!connection || !valid) return;
    let alive = true;
    const client = new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth });
    client
      .calendar(from, to)
      .then((cal) => {
        if (alive) setPerDay(new Map(cal.days.map((d) => [d.date, d.count])));
      })
      .catch(() => {
        if (alive) setPerDay(null);
      });
    return () => {
      alive = false;
    };
  }, [connection, from, to, valid]);

  const kept = days.filter((d) => !skip.has(d));
  const media = perDay ? kept.reduce((n, d) => n + (perDay.get(d) ?? 0), 0) : null;
  const apply = () => {
    const left = [...skip].filter((d) => d >= from && d <= to).sort();
    const same = from === base.from && to === base.to && left.length === 0;
    onApply(
      same
        ? null
        : { ...(from !== base.from ? { from } : {}), ...(to !== base.to ? { to } : {}), ...(left.length ? { skip: left } : {}) },
    );
  };
  useDialogKeys({ onCancel, onConfirm: valid ? apply : null });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center max-[560px]:items-end p-4 max-[560px]:p-0 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="story-days-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[34rem] max-[560px]:max-w-none max-h-[calc(var(--app-h,100%)-2rem)] max-[560px]:max-h-[90%] flex flex-col gap-4 bg-surface border border-line rounded-paper-lg max-[560px]:rounded-b-none shadow-paper p-6 max-[560px]:pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <div>
          <h2 id="story-days-title" className="m-0 font-serif text-2xl">
            Days counted
          </h2>
          <p className="m-0 mt-1 text-sm text-muted">Click a day to leave it out of the counts and the wall.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateField label="First day" value={from} max={to || undefined} onChange={setFrom} />
          <span className="text-muted">→</span>
          <DateField label="Last day" value={to} min={from || undefined} onChange={setTo} />
        </div>
        <div className="min-h-0 overflow-y-auto flex flex-col gap-1">
          <div className="grid grid-cols-7 gap-1">
            {WEEK.map((w) => (
              <span key={w} className={`${legend} text-center`}>
                {w}
              </span>
            ))}
            {days.length ? Array.from({ length: weekdayOf(days[0]) }, (_, i) => <span key={`pad${i}`} />) : null}
            {days.map((d) => {
              const off = skip.has(d);
              const n = perDay?.get(d) ?? 0;
              const first = d.endsWith('-01') || d === days[0];
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={!off}
                  aria-label={`${d}${perDay ? `, ${n} media` : ''}${off ? ', left out' : ''}`}
                  onClick={() =>
                    setSkip((s) => {
                      const next = new Set(s);
                      if (next.has(d)) next.delete(d);
                      else next.add(d);
                      return next;
                    })
                  }
                  className={`flex flex-col items-center justify-center h-11 rounded-[8px] border text-xs tabular-nums cursor-pointer transition-colors ${
                    off
                      ? 'border-line bg-paper text-faint line-through'
                      : n > 0
                        ? 'border-line-strong bg-paper-2 text-ink'
                        : 'border-line bg-surface text-muted'
                  }`}
                >
                  <span className={first ? 'font-semibold' : ''}>{first ? `${Number(d.slice(8))} ${monthOf(d)}` : Number(d.slice(8))}</span>
                  {perDay ? <span className="font-mono text-3xs text-muted">{n > 0 ? factText(n) : '·'}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
        <p className="m-0 text-xs text-muted tabular-nums" role="status">
          {valid
            ? `${kept.length} day${kept.length === 1 ? '' : 's'} counted${skip.size ? ` · ${days.filter((d) => skip.has(d)).length} left out` : ''}${media !== null ? ` · ${factText(media)} media` : connection ? '' : ' · connect the Winnow to see each day’s media'}`
            : 'The first day must come before the last.'}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFrom(base.from);
              setTo(base.to);
              setSkip(new Set());
            }}
          >
            Reset to the stages
          </Button>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={apply} disabled={!valid}>
            Use these days
          </Button>
        </div>
      </div>
    </div>
  );
}
