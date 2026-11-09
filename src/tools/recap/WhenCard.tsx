import { useState } from 'react';
import { rhythmGrid, slotHead, slotLabel, type Rhythm } from '../../shared/sources/postiz/rhythm';
import Button from '../../shared/ui/Button';

/** When a post goes out: a slot of the rhythm, a time of his, now, or a draft left in Postiz. */
export type When = { kind: 'slot'; at: Date } | { kind: 'other'; at: Date | null } | { kind: 'now' } | { kind: 'draft' };

/** `2026-11-17T09:00` for a datetime-local input, in this browser's own zone. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const cell =
  'min-h-8 pointer-coarse:min-h-11 rounded-[8px] border font-sans text-xs tabular-nums transition-colors duration-150 ease-paper focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';
const free = 'border-line bg-surface text-ink-soft hover:border-accent hover:text-ink cursor-pointer';
const on = 'border-accent bg-accent-wash text-ink font-semibold shadow-[inset_0_0_0_1px_var(--color-accent)] cursor-pointer';

/**
 * *When · your rhythm* (lab 13, his yes): the ANSWER first — the slot it goes
 * out in, in big type, the next free one until he picks another — and the
 * choice folded under *Change*: the rhythm's slots as columns, this week and
 * the next two as rows; a taken slot hatched, a gone one dashed, the chosen
 * one red; *Another time…*, *Now* and *Draft* on one row under it. A broken
 * rhythm is a line inside the card, never a refusal.
 */
export default function WhenCard({
  rhythm,
  taken,
  chosen,
  free: nextFree,
  warnings,
  onChoose,
}: {
  rhythm: Rhythm;
  /** The planned posts' instants (Postiz's queue). */
  taken: readonly Date[];
  chosen: When;
  /** The next free slot, null when none in sight. */
  free: Date | null;
  warnings: readonly string[];
  onChoose: (w: When) => void;
}) {
  const [open, setOpen] = useState(false);
  const tz = rhythm.timeZone;
  const at = chosen.kind === 'slot' || chosen.kind === 'other' ? chosen.at : null;
  const big = chosen.kind === 'now' ? 'Now' : chosen.kind === 'draft' ? 'A draft in Postiz' : at ? slotLabel(at, tz) : 'Choose a time';
  const sub =
    chosen.kind === 'now'
      ? 'Instagram publishes it as soon as it is sent'
      : chosen.kind === 'draft'
        ? 'Nothing is scheduled: you finish it in Postiz'
        : chosen.kind === 'other'
          ? 'A time of yours, on this device’s clock'
          : nextFree && at && at.getTime() === nextFree.getTime()
            ? 'The next free slot of your rhythm'
            : 'A slot of your rhythm';
  const grid = open ? rhythmGrid(rhythm, taken, new Date()) : null;
  const cols = { gridTemplateColumns: `4.75rem repeat(${grid?.slots.length ?? 1}, minmax(0, 1fr))` };

  return (
    <div className="rounded-control border border-line-strong bg-paper overflow-hidden">
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <span aria-hidden="true" className={`flex-none w-2.5 h-2.5 rounded-full ${chosen.kind === 'draft' ? 'bg-line-strong' : 'bg-accent'}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink tabular-nums truncate">{big}</div>
          <div className="text-2xs text-muted truncate">{sub}</div>
        </div>
        <Button size="sm" variant={open ? 'primary' : 'default'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Done' : 'Change'}
        </Button>
      </div>
      {warnings.length > 0 && (
        <div className="flex flex-col gap-0.5 px-2.5 py-1.5 border-t border-warn-line bg-warn-wash text-2xs text-warn" role="status">
          {warnings.map((w) => (
            <span key={w}>⚠ {w} Still yours to send.</span>
          ))}
        </div>
      )}
      {grid && (
        <div className="flex flex-col gap-1.5 px-2.5 pt-2 pb-2.5 border-t border-line">
          <div className="grid gap-1 items-end" style={cols} aria-hidden="true">
            <span />
            {grid.slots.map((s) => (
              <span key={`${s.day}-${s.time}`} className="text-center font-mono text-3xs text-muted">
                {slotHead(s)}
              </span>
            ))}
          </div>
          {grid.weeks.map((w) => (
            <div key={w.monday} className="grid gap-1 items-center" style={cols} role="group" aria-label={`Week of ${w.label}`}>
              <span className="font-mono text-3xs text-muted whitespace-nowrap">{w.label}</span>
              {w.cells.map((c) => {
                const day = slotLabel(c.at, tz);
                const pressed = chosen.kind === 'slot' && chosen.at.getTime() === c.at.getTime();
                return c.state === 'free' ? (
                  <button key={c.at.toISOString()} type="button" aria-pressed={pressed} aria-label={day} title={day} onClick={() => onChoose({ kind: 'slot', at: c.at })} className={`${cell} ${pressed ? on : free}`}>
                    {day.split(' ')[1]}
                  </button>
                ) : (
                  <span
                    key={c.at.toISOString()}
                    title={c.state === 'taken' ? `${day} — a post already goes out then` : `${day} — gone`}
                    className={`${cell} grid place-items-center ${
                      c.state === 'taken' ? 'border-line text-faint line-through bg-[repeating-linear-gradient(135deg,transparent_0_5px,var(--color-line)_5px_6px)]' : 'border-dashed border-line text-faint'
                    }`}
                  >
                    {day.split(' ')[1]}
                  </span>
                );
              })}
            </div>
          ))}
          <div className="grid grid-cols-3 gap-1 pt-0.5" role="group" aria-label="Or">
            {(
              [
                ['other', 'Another time…'],
                ['now', 'Now'],
                ['draft', 'Draft'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={chosen.kind === k}
                onClick={() => onChoose(k === 'other' ? { kind: 'other', at: at ?? new Date(Date.now() + 3600000) } : { kind: k })}
                className={`${cell} ${chosen.kind === k ? on : free}`}
              >
                {label}
              </button>
            ))}
          </div>
          {chosen.kind === 'other' && (
            <input
              type="datetime-local"
              aria-label="When it goes out, on this device's clock"
              className="font-mono text-sm px-3 py-1.5 border border-line-strong rounded-paper bg-surface text-ink"
              value={chosen.at ? localInput(chosen.at) : ''}
              onChange={(e) => onChoose({ kind: 'other', at: e.target.value ? new Date(e.target.value) : null })}
            />
          )}
          <span className="font-mono text-3xs text-muted">{tz.replace(/_/g, ' ')} time · hatched: a post already goes out</span>
        </div>
      )}
    </div>
  );
}
