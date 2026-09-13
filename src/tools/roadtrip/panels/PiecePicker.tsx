import { BADGE_PIECES, type BadgePiece } from '../../../shared/roadtrip/day-badge';
import { SelectField } from '../../../shared/ui/Inspector';

/**
 * The piece of the badge in hand, as ONE control: the inspector's select.
 * Rendered once, above the tab body, because the Content and Look tabs both
 * edit "the piece in hand"; a click on the stage picks one too, and that
 * click is the better way — this is the keyboard's and the screen reader's.
 */
export default function PiecePicker({
  piece,
  onPiece,
}: {
  piece: BadgePiece;
  onPiece: (piece: BadgePiece) => void;
}) {
  return (
    <SelectField
      label="Badge piece"
      value={piece}
      onChange={onPiece}
      options={BADGE_PIECES.map((p) => ({ id: p.id, label: p.label }))}
    />
  );
}
