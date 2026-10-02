import { haltKey, haltName, type DeduceDraft, type Proposal } from '../../../shared/roadtrip/deduce-draft';
import { addDays } from '../../../shared/roadtrip/trip-days';
import Button from '../../../shared/ui/Button';
import { dayText, legend, note, spanText } from './pieces';
import type { DeduceActions } from './context';

/**
 * One proposal corrected before it is written: its name, its two dates a
 * day at a time, its halts reordered or left out, and a name for a halt the
 * index could not name. The SAME editor in the three windows, over the same
 * draft — a correction made in the grain is what the paquet then shows.
 */

interface ProposalEditorProps {
  p: Proposal;
  draft: DeduceDraft;
  actions: DeduceActions;
  /** The trip's first and last day: a date never steps outside them. */
  first: string;
  last: string;
}

const field =
  'w-full h-[2.125rem] px-3 rounded-control border border-line-strong bg-surface text-sm max-[820px]:text-base text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';
const op =
  'w-6 h-6 inline-grid place-items-center rounded-md border-0 bg-transparent text-muted cursor-pointer hover:bg-paper-2 hover:text-ink disabled:opacity-30 disabled:cursor-default';

function Stepper({
  label,
  value,
  canLess,
  canMore,
  onStep,
}: {
  label: string;
  value: string;
  canLess: boolean;
  canMore: boolean;
  onStep: (delta: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className={legend}>{label}</span>
      <span className="inline-flex items-center h-7 w-fit rounded-full border border-line-strong bg-surface overflow-hidden">
        <button type="button" className="w-7 h-full border-0 bg-transparent text-ink cursor-pointer disabled:opacity-30 disabled:cursor-default" disabled={!canLess} onClick={() => onStep(-1)} aria-label={`${label}: a day earlier`}>
          −
        </button>
        <span className="min-w-[4.2rem] text-center font-mono text-2xs tabular-nums">{dayText(value)}</span>
        <button type="button" className="w-7 h-full border-0 bg-transparent text-ink cursor-pointer disabled:opacity-30 disabled:cursor-default" disabled={!canMore} onClick={() => onStep(1)} aria-label={`${label}: a day later`}>
          +
        </button>
      </span>
    </div>
  );
}

export default function ProposalEditor({ p, draft, actions, first, last }: ProposalEditorProps) {
  const all = p.chapter.halts;
  const kept = p.halts.map(haltKey);
  const setHalts = (keys: string[]) => actions.edit(p, { halts: keys });

  return (
    <div className="flex flex-col gap-2.5 pt-2.5 border-t border-dashed border-line-strong" data-editor={p.key}>
      <label className="flex flex-col gap-1">
        <span className={legend}>Name</span>
        <input
          type="text"
          className={field}
          value={p.ownName}
          placeholder={p.ownName ? undefined : `${p.label} (derived from its places)`}
          onChange={(e) => actions.edit(p, { name: e.target.value })}
          aria-label="The stage's name; empty derives it from its places"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Stepper
          label="Starts"
          value={p.startDate}
          canLess={p.startDate > first}
          canMore={p.startDate < p.endDate}
          onStep={(d) => {
            const next = addDays(p.startDate, d);
            if (next) actions.edit(p, { startDate: next });
          }}
        />
        <Stepper
          label="Ends"
          value={p.endDate}
          canLess={p.endDate > p.startDate}
          canMore={p.endDate < last}
          onStep={(d) => {
            const next = addDays(p.endDate, d);
            if (next) actions.edit(p, { endDate: next });
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className={legend}>Places, in order</span>
        <ul className="m-0 p-0 list-none flex flex-col gap-1">
          {all.map((h) => {
            const key = haltKey(h);
            const at = kept.indexOf(key);
            const out = at < 0;
            const name = haltName(h, draft);
            return (
              <li
                key={key}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pl-2.5 pr-1 py-1 rounded-lg border bg-surface text-xs ${
                  out ? 'border-dashed border-line opacity-60' : 'border-line'
                }`}
              >
                <span className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className={name ? '' : 'text-warn'}>{name ?? 'Unnamed halt'}</span>
                  <span className="font-mono text-3xs text-muted">{spanText(h.leg.startDate, h.leg.endDate)}</span>
                  {!h.city && (
                    <input
                      type="text"
                      value={draft.renames[key] ?? ''}
                      placeholder="name this halt"
                      onChange={(e) => actions.rename(key, e.target.value)}
                      aria-label="A name for this halt, on the trip only"
                      className="w-32 h-6 px-1.5 rounded-md border border-line-strong bg-surface text-xs max-[820px]:text-base text-ink"
                    />
                  )}
                </span>
                <span className="inline-flex gap-px">
                  {out ? (
                    <button type="button" className={op} title="Put it back" onClick={() => setHalts(all.map(haltKey).filter((k) => kept.includes(k) || k === key))}>
                      ↩
                    </button>
                  ) : (
                    <>
                      <button type="button" className={op} title="Earlier" disabled={at === 0} onClick={() => { const next = [...kept]; [next[at - 1], next[at]] = [next[at], next[at - 1]]; setHalts(next); }}>
                        ↑
                      </button>
                      <button type="button" className={op} title="Later" disabled={at === kept.length - 1} onClick={() => { const next = [...kept]; [next[at + 1], next[at]] = [next[at], next[at + 1]]; setHalts(next); }}>
                        ↓
                      </button>
                      <button type="button" className={op} title="Leave it out" disabled={kept.length <= 1} onClick={() => setHalts(kept.filter((k) => k !== key))}>
                        ×
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`${note} basis-[14rem] grow`}>
          Edits live in the draft every window reads and are written only on Write. A halt named here is named for this trip only.
        </span>
        <span className="flex gap-1.5 ml-auto">
          <Button size="sm" variant="ghost" disabled={!p.edited} onClick={() => actions.resetEdit(p.key)}>
            Reset
          </Button>
          <Button size="sm" variant="primary" onClick={() => actions.setEditing(null)}>
            Done
          </Button>
        </span>
      </div>
    </div>
  );
}
