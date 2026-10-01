import { useEffect, useState, type ReactNode } from 'react';
import Button from './Button';
import OverflowMenu from './OverflowMenu';
import { Icons } from './icons';
import {
  describeTimeLeft,
  phaseIndex,
  runCounts,
  timeLeft,
  type RunUnitState,
  type RunProgress,
} from '../tasks/run-progress';

export type DeliverPlacement = 'panel' | 'sheet' | 'drawer';

/** Each placement's bleed: the bar reaches the host's edges and sits on its bottom. */
const PLACEMENT: Record<DeliverPlacement, string> = {
  panel: '-mx-3 -mb-3 px-3 pt-2.5 pb-3 rounded-b-paper',
  sheet: 'sticky bottom-0 z-10 -mx-3 -mb-3 px-3 pt-2 pb-3',
  drawer: 'sticky bottom-0 z-10 -mx-4 px-4 pt-2 pb-2',
};

/** One export verb: what it renders, and how many. */
export interface ExportVerb {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * An editor's export verbs, PINNED at the bottom of its inspector the way the
 * tab strip is pinned at its top (2026-09-28, his pick "bouton + menu" in
 * Develop; Trips and the Studio took the same bar on 2026-09-29): the verbs
 * at the end of a long Export tab were out of sight nearly all the time.
 *
 * ONE primary verb and the others behind a menu beside it, so the bar keeps
 * one height whatever the document offers. What is SET stays in the tab's
 * sections, which scroll; only what is TRIGGERED is pinned, with the run's
 * own sentence above it and the run's outcome under it.
 *
 * While a run goes on the bar BECOMES the run (his pick V1): a segment per
 * unit — a picture, a slide, a variant —, the one in hand named with its own
 * stages and its step in words, a measured fill where the step knows how far
 * it is (an encode) and a sweep where it does not, the time left once one
 * unit has measured it, and a Cancel. The host draws it on every tab while a
 * run goes on, so the document can be worked on while it leaves.
 */
export default function DeliverBar({
  verbs,
  primary: primaryId,
  summary,
  exporting,
  progress,
  onCancel,
  note,
  placement,
  unitWord,
  settingsLine,
  empty = 'Nothing to export yet.',
}: {
  verbs: readonly ExportVerb[];
  /** Which verb is the button; the first when unnamed or absent. */
  primary?: string;
  /** What the primary verb will deliver, in one line. */
  summary: string;
  exporting: string | null;
  /** Where a running export stands (`run-progress.ts`); null when idle. */
  progress: RunProgress | null;
  onCancel: () => void;
  note: ReactNode;
  /**
   * Where the host draws it: under a docked inspector's scroll (`panel`, the
   * inspector padded `p-3`), or stuck to the bottom of a phone's scrolling
   * `sheet` (padded `px-3 pb-3`) or `drawer` (padded `px-4`).
   */
  placement: DeliverPlacement;
  /** What one unit of this tool's run is called — `picture`, `slide`, `variant`. */
  unitWord: string;
  /** Said under a running bar: whose settings the run uses. */
  settingsLine?: string | null;
  /** Said where no verb is offered. */
  empty?: string;
}) {
  const primary = verbs.find((v) => v.id === primaryId) ?? verbs[0] ?? null;
  const others = verbs.filter((v) => v !== primary);
  const busy = exporting !== null || progress !== null;
  return (
    <div
      className={`flex-none flex flex-col gap-1.5 border-t border-line-strong bg-surface ${PLACEMENT[placement]} shadow-[0_-10px_18px_-16px_rgba(43,33,18,0.45)]`}
    >
      {progress ? (
        <RunBar progress={progress} exporting={exporting} onCancel={onCancel} unitWord={unitWord} settingsLine={settingsLine ?? null} />
      ) : (
        <>
          {summary && (
            <span className="font-mono text-3xs text-ink-soft tabular-nums leading-snug line-clamp-2" title={summary}>
              {summary}
            </span>
          )}
          {primary ? (
            <div className="flex items-stretch gap-1 min-w-0">
              <Button
                variant="primary"
                icon={Icons.export}
                onClick={primary.run}
                disabled={busy}
                title={primary.hint}
                className="flex-1 min-w-0 justify-center"
              >
                <span className="truncate">{primary.label}</span>
              </Button>
              {others.length > 0 && (
                <OverflowMenu
                  label="Other exports"
                  icon={Icons.down}
                  variant="primary"
                  size="md"
                  side="above"
                  disabled={busy}
                  items={others.map((v) => ({
                    id: v.id,
                    title: v.hint,
                    onSelect: v.run,
                    label: (
                      <span className="flex flex-col gap-0.5">
                        <span>{v.label}</span>
                        {v.hint && <span className="font-mono text-3xs text-faint whitespace-normal max-w-64">{v.hint}</span>}
                      </span>
                    ),
                  }))}
                />
              )}
            </div>
          ) : (
            <span className="font-mono text-3xs text-faint">{empty}</span>
          )}
          {exporting && (
            <p className="m-0 font-mono text-2xs text-ink-soft" role="status" aria-live="polite">
              {exporting}
            </p>
          )}
          {note && !exporting && (
            <div className="m-0 text-xs text-ink-soft leading-snug" role="status">
              {note}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Past this many units a segment each would be thinner than a hairline: one bar instead. */
const MAX_SEGMENTS = 48;

const SEGMENT: Record<RunUnitState, string> = {
  queued: 'bg-line',
  active: 'bg-line-strong',
  done: 'bg-ok',
  failed: 'bg-danger',
};

/** The run as it goes: counts, a segment per unit, the one in hand, its stage, a Cancel. */
function RunBar({
  progress,
  exporting,
  onCancel,
  unitWord,
  settingsLine,
}: {
  progress: RunProgress;
  exporting: string | null;
  onCancel: () => void;
  unitWord: string;
  settingsLine: string | null;
}) {
  // The time left is re-read every second; nothing else in the bar needs a clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const { total, done, failed, finished } = runCounts(progress);
  const inHand = progress.index >= 0 && progress.index < total && progress.states[progress.index] === 'active';
  const left = describeTimeLeft(timeLeft(progress, now));
  const headline = progress.cancelling
    ? `Cancelling after this ${unitWord}…`
    : inHand
      ? `Exporting ${progress.index + 1} of ${total}`
      : `Preparing ${total} ${unitWord}${total === 1 ? '' : 's'}…`;
  const phases = inHand ? (progress.phases[progress.index] ?? []) : [];
  const phaseAt = phaseIndex(progress);
  return (
    <div className="flex flex-col gap-1.5 min-w-0" role="status" aria-live="polite" aria-label={headline}>
      {/* Every line of the running bar keeps ONE height and the controls one place
          while its words change many times a second (his report on the making-of):
          the headline truncates, the time left has a slot of its own that is always
          drawn, the stages never wrap and the step is one truncated line. */}
      <div className="flex items-baseline justify-between gap-2 font-mono text-2xs tabular-nums whitespace-nowrap min-w-0">
        <span className="text-ink min-w-0 truncate">{headline}</span>
        <span className="flex-none min-w-[15ch] text-right text-muted" aria-hidden={!left || progress.cancelling}>
          {left && !progress.cancelling ? left : '\u00a0'}
        </span>
      </div>
      {total <= MAX_SEGMENTS ? (
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }} aria-hidden="true">
          {progress.states.map((s, i) => (
            <span key={progress.ids[i]} className={`relative h-1.5 rounded-[2px] overflow-hidden ${SEGMENT[s]}`}>
              {s === 'active' &&
                (progress.ratio !== null ? (
                  // A step that knows how far it is FILLS; one that does not sweeps.
                  <span className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-200" style={{ width: `${progress.ratio * 100}%` }} />
                ) : (
                  <span className="absolute inset-y-0 left-0 w-1/2 bg-accent animate-deck-load motion-reduce:animate-none" />
                ))}
            </span>
          ))}
        </div>
      ) : (
        <div className="relative h-1.5 rounded-[2px] bg-line overflow-hidden" aria-hidden="true">
          <span className="absolute inset-y-0 left-0 bg-ok transition-[width] duration-200" style={{ width: `${(finished / total) * 100}%` }} />
        </div>
      )}
      {inHand && (
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-mono text-2xs text-ink truncate min-w-0">{progress.names[progress.index]}</span>
          <span className="flex flex-nowrap gap-1 min-w-0 overflow-hidden" aria-label="Stage">
            {phases.map((p, k) => (
              <span
                key={p.id}
                aria-current={k === phaseAt ? 'step' : undefined}
                className={`flex-none whitespace-nowrap px-1.5 rounded-full border font-mono text-3xs leading-4 ${
                  k === phaseAt
                    ? 'border-accent bg-accent-wash text-accent-ink'
                    : k < phaseAt
                      ? 'border-transparent text-ok'
                      : 'border-line text-faint'
                }`}
              >
                {k < phaseAt ? '✓ ' : ''}
                {p.label}
              </span>
            ))}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 min-w-0">
        <span className="flex-1 min-w-0 font-mono text-3xs text-ink-soft truncate" title={progress.step ?? exporting ?? undefined}>
          {progress.step ?? exporting ?? ''}
        </span>
        {(done > 0 || failed > 0) && (
          <span className="flex-none whitespace-nowrap font-mono text-3xs text-muted tabular-nums">
            {done} done{failed > 0 ? ` · ${failed} not` : ''}
          </span>
        )}
        <Button size="sm" onClick={onCancel} disabled={progress.cancelling} className="flex-none min-w-[11ch] justify-center">
          {progress.cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
      </div>
      {settingsLine && <span className="font-mono text-3xs text-faint leading-snug">{settingsLine}</span>}
    </div>
  );
}
