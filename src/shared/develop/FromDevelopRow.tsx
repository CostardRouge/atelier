import type { SavedMediaRef } from '../projects/media-ref';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { FieldRow } from '../ui/Inspector';
import OverflowMenu from '../ui/OverflowMenu';
import { Icons } from '../ui/icons';
import { carriedWords, offerFrom, offerWords, type CarriedEdit, type EditOffer } from './carried-edit';
import { pictureLabel } from './roll-types';
import { useDevelopOffers } from './use-develop-offers';

/**
 * A picture's edit from DEVELOP, one settled row under the host's own
 * correction (item 34 of `docs/lightroom-gaps.md`): the roll that holds this
 * file and the verb that takes its develop, look and passes — or, once taken,
 * where it came from, an update when the picture changed there since, and the
 * way to take the passes off. Nothing is drawn when no roll holds the file.
 *
 * Copied, never linked: `Use` writes the host's own fields, which stay its own
 * to edit (`carried-edit.ts`).
 */
export default function FromDevelopRow({
  media,
  edit,
  onUse,
  onTakeOff,
  carriesLook = true,
  frameWord,
}: {
  /** The file the host shows. */
  media: SavedMediaRef | null;
  /** What the host holds from Develop, if anything. */
  edit: CarriedEdit | null | undefined;
  /** Take this offer — made at the click, so its date is the click's. */
  onUse: (offer: EditOffer) => void;
  /** Take the passes off; the develop and the look stay the host's. */
  onTakeOff: () => void;
  /** False where the host's look is not the picture's own (the Studio's is the clip's). */
  carriesLook?: boolean;
  /** Why the crop stays in Develop, said after it: `the frame is this slide’s own`. */
  frameWord: string;
}) {
  const { offers, held, update, orphan } = useDevelopOffers(media, edit);
  const take = (offer: EditOffer) => onUse(offerFrom(offer.roll, offer.picture));
  const verbTitle = (offer: EditOffer) => {
    const { takes, leaves } = offerWords(offer, carriesLook);
    const stay = leaves.includes(' · ') ? 'stay' : 'stays';
    return `Take ${takes || 'its edit'} from ${pictureLabel(offer.picture)} in ${offer.roll.name}${
      leaves ? ` — its ${leaves} ${stay} in Develop: ${frameWord}` : ''
    }`;
  };

  if (held) {
    const draws = carriedWords(held);
    const from = held.from.rollName || 'a roll';
    return (
      <FieldRow label="From Develop">
        <span
          className="flex-1 min-w-0 truncate font-mono text-xs text-ink-soft"
          title={`${held.from.label} in ${from}, taken ${new Date(held.from.at).toLocaleString()}${
            orphan ? ' — that roll is not in this browser any more' : ''
          }${draws ? `. Drawn here: ${draws}.` : '.'}`}
        >
          {from}
          {draws ? ` · ${draws}` : ''}
        </span>
        {update && (
          <Button size="sm" onClick={() => take(update)} title={`Changed in Develop since it was taken. ${verbTitle(update)}`}>
            Update
          </Button>
        )}
        {draws && (
          <IconButton
            size="sm"
            variant="ghost"
            label={`Take off the ${draws} from Develop — the correction and the look stay, each with its own way back`}
            onClick={onTakeOff}
          >
            {Icons.close}
          </IconButton>
        )}
      </FieldRow>
    );
  }

  const first = offers[0];
  if (!first) return null;
  return (
    <FieldRow label="From Develop">
      <span
        className={`flex-1 min-w-0 truncate font-mono text-xs ${first.refusal ? 'text-muted' : 'text-ink-soft'}`}
        title={first.refusal ? `${pictureLabel(first.picture)} in ${first.roll.name} was ${first.refusal}.` : verbTitle(first)}
      >
        {first.roll.name}
        {first.refusal ? ' · on its sensor' : ''}
      </span>
      {!first.refusal && (
        <Button size="sm" onClick={() => take(first)} title={verbTitle(first)}>
          Use
        </Button>
      )}
      {offers.length > 1 && (
        <OverflowMenu
          label="Other rolls that hold this picture"
          items={offers.slice(1).map((offer) => ({
            id: `${offer.roll.id}/${offer.picture.id}`,
            label: `${offer.roll.name} · ${pictureLabel(offer.picture)}`,
            title: offer.refusal ? `Developed ${offer.refusal}` : verbTitle(offer),
            disabled: Boolean(offer.refusal),
            onSelect: () => take(offer),
          }))}
        />
      )}
    </FieldRow>
  );
}
