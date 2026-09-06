import { BADGE_PIECES, type BadgePiece } from '../../../shared/roadtrip/day-badge';

/**
 * The six pieces of the badge as a row of chips. Shared by the Content and
 * Style tabs, which both edit "the piece in hand": a click on the stage picks
 * one too, so the chips are only ever a second way to the same state.
 */
export default function PiecePicker({
  piece,
  onPiece,
}: {
  piece: BadgePiece;
  onPiece: (piece: BadgePiece) => void;
}) {
  return (
    <div className="grid grid-cols-6 gap-1" role="group" aria-label="Badge piece">
      {BADGE_PIECES.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPiece(p.id)}
          aria-pressed={piece === p.id}
          title={p.label}
          className={`px-1 py-1.5 rounded-paper border text-[0.66rem] cursor-pointer truncate transition-colors ${
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
