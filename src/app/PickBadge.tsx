/**
 * A tile in the Library's Select mode: what pressing it does, and the number
 * it will be added as.
 */
export interface PickMark {
  /** What it will be added as — "5", or "5·2" for the second picture of a collage — or null when not ticked. */
  order: string | null;
  /** Already in the work: not offered again (its own number says where). */
  held: number | null;
  /** Why this pick was proposed, when Suggest ticked it. */
  reason?: string | null;
  onTick: () => void;
}

/**
 * The tick of a Select-mode tile, top-left: an empty ring, or the number the
 * picture will become — the order the result will read in, seen before it is
 * written. Decoration only: the tile itself is the button.
 */
export default function PickBadge({ mark }: { mark: PickMark }) {
  if (mark.held !== null) {
    return (
      <span
        className="absolute top-[3px] left-[3px] h-[20px] px-1.5 inline-flex items-center rounded-full bg-ink text-paper font-mono text-3xs pointer-events-none"
        aria-hidden="true"
      >
        {mark.held}
      </span>
    );
  }
  return mark.order !== null ? (
    <span
      className="absolute top-[3px] left-[3px] min-w-[22px] h-[22px] px-1 inline-flex items-center justify-center rounded-full bg-accent text-paper font-mono text-2xs pointer-events-none shadow-paper"
      aria-hidden="true"
    >
      {mark.order}
    </span>
  ) : (
    <span
      className="absolute top-[3px] left-[3px] w-[22px] h-[22px] rounded-full border-2 border-white/90 bg-black/25 pointer-events-none"
      aria-hidden="true"
    />
  );
}

/** The ring a ticked tile wears — inside its edge, under the badge. */
export const PICKED_RING = 'shadow-[inset_0_0_0_3px_var(--color-accent)]';
