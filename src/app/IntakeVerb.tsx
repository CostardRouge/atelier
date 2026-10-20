import type { CollectMark } from './CollectCorner';
import { Icons } from '../shared/ui/icons';
import { PRESS_LOOK } from '../shared/ui/press';

const PRIMARY = `inline-flex items-center gap-1.5 font-mono text-2xs tracking-[0.1em] uppercase px-3 py-1.5 rounded-full border-0 bg-accent text-paper cursor-pointer transition-colors hover:bg-accent-ink aria-disabled:opacity-50 aria-disabled:cursor-not-allowed [&>svg]:w-3.5 [&>svg]:h-3.5 ${PRESS_LOOK}`;
const SECONDARY = `inline-flex items-center gap-1.5 font-mono text-2xs tracking-[0.1em] uppercase px-3 py-1.5 rounded-full border border-line-strong bg-paper text-ink cursor-pointer transition-colors hover:border-accent hover:text-accent-ink aria-disabled:opacity-50 aria-disabled:cursor-not-allowed [&>svg]:w-3.5 [&>svg]:h-3.5 ${PRESS_LOOK}`;

/**
 * The sheet that shows a picture large, as the way through a day: «Add as
 * slide 5» (or `A`) takes the picture into the active tool's work, «Add and
 * next» does so and pages on — one gesture per picture kept. Once added the
 * verb becomes the slide's number, a switch that takes it back, like the ＋
 * on the tile the picture came from (`CollectCorner`, the same mark).
 */
export default function IntakeVerb({
  mark,
  next,
  onNext,
}: {
  mark: CollectMark;
  /** The number the next picture added gets. */
  next: number;
  /** Page to the next picture, when there is one. */
  onNext: (() => void) | null;
}) {
  const { place, removable, noun, locked, busy } = mark;
  const blocked = locked !== null || busy;
  const why = locked ?? (busy ? 'Fetching…' : undefined);
  if (place !== null) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {removable ? (
          <button
            type="button"
            onClick={mark.onRemove}
            className={SECONDARY}
            title={`Take ${noun} ${place} back`}
          >
            {Icons.check}
            {noun} {place} · take back
          </button>
        ) : (
          <span className="font-mono text-2xs tracking-[0.08em] uppercase text-muted">
            already {noun} {place}
          </span>
        )}
        {onNext && (
          <button type="button" onClick={onNext} className={SECONDARY}>
            Next
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={() => !blocked && mark.onAdd()}
        aria-disabled={blocked}
        title={why ?? `Add ${mark.name} as a new ${noun} (A)`}
        className={PRIMARY}
      >
        {Icons.plus}
        {busy ? 'Fetching…' : `Add as ${noun} ${next}`}
      </button>
      {onNext && (
        <button
          type="button"
          onClick={() => {
            if (blocked) return;
            mark.onAdd();
            onNext();
          }}
          aria-disabled={blocked}
          title={why ?? 'Add it, then show the next picture'}
          className={SECONDARY}
        >
          Add and next
        </button>
      )}
    </div>
  );
}
