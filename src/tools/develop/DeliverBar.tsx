import Button from '../../shared/ui/Button';
import OverflowMenu from '../../shared/ui/OverflowMenu';
import { Icons } from '../../shared/ui/icons';
import type { ExportVerb } from './ExportPanel';

/**
 * The Export tab's verbs, PINNED at the bottom of the inspector the way the
 * tab strip is pinned at its top (2026-09-28, his pick "bouton + menu"): the
 * Pictures table alone is taller than a screen on a real roll, so the verbs at
 * the end of the last section were out of sight nearly all the time.
 *
 * ONE primary verb — what leaves (`roll`), else the picture in hand — and the
 * others behind a menu beside it, so the bar keeps one height whatever the
 * roll offers. What is SET (Replace, the long explanation) stays in the
 * Deliver section, which scrolls; only what is TRIGGERED is pinned, with the
 * run's own sentence above it and the run's progress and outcome under it.
 */
export default function DeliverBar({
  verbs,
  summary,
  exporting,
  note,
  compact,
}: {
  verbs: readonly ExportVerb[];
  /** The run's sentence (`RunPlan.summary`) — what the primary verb will deliver. */
  summary: string;
  exporting: string | null;
  note: string | null;
  /** Inside the phone's drawer, whose body scrolls: stuck to its bottom edge. */
  compact: boolean;
}) {
  const primary = verbs.find((v) => v.id === 'roll') ?? verbs[0] ?? null;
  const others = verbs.filter((v) => v !== primary);
  const busy = exporting !== null;
  return (
    <div
      className={`flex-none flex flex-col gap-1.5 border-t border-line-strong bg-surface ${
        compact ? 'sticky bottom-0 z-10 -mx-4 px-4 pt-2 pb-2' : '-mx-3 -mb-3 px-3 pt-2.5 pb-3 rounded-b-paper'
      } shadow-[0_-10px_18px_-16px_rgba(43,33,18,0.45)]`}
    >
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
        <span className="font-mono text-3xs text-faint">Open a picture to export.</span>
      )}
      {busy && (
        <p className="m-0 font-mono text-2xs text-ink-soft" role="status" aria-live="polite">
          {exporting}
        </p>
      )}
      {note && !busy && (
        <p className="m-0 text-xs text-ink-soft leading-snug" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
