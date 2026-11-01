import { HALF } from '../../shared/history/UndoRedo';
import { Icons } from '../../shared/ui/icons';
import type { TargetSteps } from './use-target-steps';

/**
 * Previous and next target, as one control of two halves — the history
 * pair's look (`UndoRedo`), chevrons where it has arcs, so the two read as
 * siblings that do different things: these walk the PICTURES visited, the
 * other walks every edit. ← and → do the same on the stage while no zoom
 * is kept.
 */
export default function TargetStepsControl({ steps }: { steps: TargetSteps }) {
  const back = steps.canBack ? 'Previous target (←)' : 'No previous target';
  const forward = steps.canForward ? 'Next target (→)' : 'No next target';
  return (
    <span
      role="group"
      aria-label="Targets visited"
      className="inline-flex shrink-0 h-[2.125rem] overflow-hidden rounded-control border border-line-strong bg-surface shadow-[0_1px_1.5px_rgba(27,24,19,0.04)]"
    >
      <button type="button" className={HALF} aria-label={back} title={back} onClick={steps.back} disabled={!steps.canBack}>
        {Icons.back}
      </button>
      <span aria-hidden="true" className="w-px self-stretch bg-line" />
      <button type="button" className={HALF} aria-label={forward} title={forward} onClick={steps.forward} disabled={!steps.canForward}>
        {Icons.forward}
      </button>
    </span>
  );
}
