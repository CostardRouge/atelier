import { BADGE_PIECES, type BadgePiece } from '../../../shared/roadtrip/day-badge';

/**
 * The six pieces of the badge as a grid of chips. Rendered once, above the
 * tab body, because the Content and Look tabs both edit "the piece in hand":
 * a click on the stage picks one too, so the chips are only ever a second way
 * to the same state.
 *
 * Three columns, not six: at 22rem a six-column row gives each chip ~54px and
 * every label truncated to two words of ellipsis, which is exactly the kind of
 * thing that makes a panel unreadable. One more row is cheaper than six
 * unreadable labels.
 */
export default function PiecePicker({
  piece,
  onPiece,
}: {
  piece: BadgePiece;
  onPiece: (piece: BadgePiece) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Badge piece">
      {BADGE_PIECES.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPiece(p.id)}
          aria-pressed={piece === p.id}
          className={`px-2 py-1.5 rounded-paper border text-[0.74rem] cursor-pointer truncate transition-colors ${
            piece === p.id
              ? 'border-accent bg-accent-wash text-accent-ink font-semibold'
              : 'border-line bg-paper text-ink-soft hover:border-line-strong'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
