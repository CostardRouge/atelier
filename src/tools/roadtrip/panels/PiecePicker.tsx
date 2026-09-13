import { BADGE_PIECES, type BadgePiece } from '../../../shared/roadtrip/day-badge';
import { Icons } from '../../../shared/ui/icons';

/**
 * The piece of the badge in hand, as ONE control: a select in the suite's
 * dress. Rendered once, above the tab body, because the Content and Look
 * tabs both edit "the piece in hand"; a click on the stage picks one too,
 * and that click is the better way — this is the keyboard's and the
 * screen reader's. Six chips in a 22rem column looked like a filter that
 * changed the whole panel, which is exactly what it did and not what a
 * filter looks like.
 */
export default function PiecePicker({
  piece,
  onPiece,
}: {
  piece: BadgePiece;
  onPiece: (piece: BadgePiece) => void;
}) {
  return (
    <span className="relative inline-flex w-full">
      <select
        value={piece}
        onChange={(e) => onPiece(e.target.value as BadgePiece)}
        aria-label="Badge piece"
        className="w-full appearance-none font-sans text-sm font-medium h-[2.125rem] pl-3 pr-9 border border-line-strong rounded-control bg-surface text-ink cursor-pointer focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      >
        {BADGE_PIECES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <span
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex text-muted"
        aria-hidden="true"
      >
        {Icons.down}
      </span>
    </span>
  );
}
