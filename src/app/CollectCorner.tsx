import { Icons } from '../shared/ui/icons';
import { PRESS_LOOK } from '../shared/ui/press';

/**
 * What a picture's tile says about the work the active tool TAKES pictures
 * into (`MediaIntake`): where it already sits, or a ＋ that adds it there.
 */
export interface CollectMark {
  /** The picture's name, for what the corner says to a screen reader. */
  name: string;
  /** Its number in the work — "slide 3" — or null when it is not there. */
  place: number | null;
  /** Added through here this session: the number is a switch that takes it back. */
  removable: boolean;
  /** What one picture becomes — "slide". */
  noun: string;
  /** Why nothing can be added now, or null. */
  locked: string | null;
  /** A fetch for this picture is in flight. */
  busy: boolean;
  onAdd: () => void;
  onRemove: () => void;
}

/**
 * The corner of a Library tile that adds the picture as a NEW item of the
 * tool's work (Trips: a new slide) — the tile's big target still does what it
 * did (put the picture on what is open). Three faces: a ＋; once added
 * through here, the accent number, which takes it back on a second press
 * (a switch, like the Auto verbs); a picture already in the work otherwise,
 * its number in ink, which is a fact and not a target.
 *
 * Drawn 26 px, grabbed on 44 under a finger (`.touch-halo`).
 */
export default function CollectCorner({ mark, className = '' }: { mark: CollectMark; className?: string }) {
  const { name, place, removable, noun, locked, busy } = mark;
  if (place !== null && removable) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          mark.onRemove();
        }}
        aria-label={`Remove ${noun} ${place} (${name}), added just now`}
        title={`${capital(noun)} ${place} — press again to take it back`}
        className={`touch-halo absolute min-w-[26px] h-[26px] px-1.5 inline-flex items-center justify-center gap-0.5 rounded-full border-0 bg-accent text-paper font-mono text-2xs cursor-pointer shadow-paper [&>svg]:w-3 [&>svg]:h-3 ${PRESS_LOOK} ${className}`}
      >
        {Icons.check}
        {place}
      </button>
    );
  }
  if (place !== null) {
    return (
      <span
        className={`absolute min-w-[22px] h-[22px] px-1.5 inline-flex items-center justify-center rounded-full bg-ink text-paper font-mono text-3xs pointer-events-none ${className}`}
        title={`Already ${noun} ${place}`}
        aria-label={`${name}: already ${noun} ${place}`}
      >
        {place}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!locked && !busy) mark.onAdd();
      }}
      aria-disabled={locked !== null || busy}
      aria-label={`Add ${name} as a new ${noun}`}
      title={locked ?? (busy ? 'Fetching…' : `Add as a new ${noun}`)}
      className={`touch-halo absolute w-[26px] h-[26px] inline-flex items-center justify-center rounded-full border border-line-strong bg-surface/90 text-ink cursor-pointer shadow-paper hover:bg-surface hover:text-accent-ink aria-disabled:opacity-50 aria-disabled:cursor-not-allowed [&>svg]:w-3.5 [&>svg]:h-3.5 ${
        busy ? 'animate-pulse motion-reduce:animate-none' : ''
      } ${PRESS_LOOK} ${className}`}
    >
      {Icons.plus}
    </button>
  );
}

function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
