/**
 * Choosing the piece's OPENER — which hook variant draws its first slide.
 *
 * Cards, never a dropdown: the rule the title styles already settled is that a
 * look you cannot see before adopting is a look you adopt by trial. Each row
 * carries the variant's own sketch of what it DOES, its name and its line; the
 * variant's own options mount underneath, so the panel below the picker always
 * belongs to the card above it.
 *
 * A variant a piece cannot feed is greyed **with the reason on the card**, not
 * hidden — the counter modes' rule: say what it would draw, or say why it
 * cannot. A variant you cannot find is a feature that does not exist.
 *
 * The picker is also the variant panel's HOST: a panel may not open the
 * Library or ask an instance itself (`hook-variant.ts`), so the things it may
 * ask for — the picture chooser, how its pictures are loading, the big
 * picking map — are handed down from here, and the sheets are drawn here.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_HOOK_ID,
  setHookOptions,
  switchHookVariant,
  type HookContext,
  type HookLayer,
  type HookPanelHost,
  type HookPictureChoice,
  type HookPickedPicture,
  type HookPictureStatus,
  type HookShelf,
  type HookStopsChoice,
  type HookVariant,
} from '../../../shared/roadtrip/hooks/hook-variant';
import { HOOK_VARIANTS, hookUnmet } from '../../../shared/roadtrip/hooks/registry';
import { tripPlaces, type MapStop } from '../../../shared/roadtrip/hooks/stops';
import HookPicturesModal from '../HookPicturesModal';
import StopsMapSheet from '../StopsMapSheet';

interface HookPickerProps {
  /** The piece's stored layers; the picker writes the first and only the first. */
  layers: HookLayer[];
  /**
   * What the openers not on the card were given (`PostBadge.hookShelf`) — a
   * switch sets the current one's aside and takes the chosen one's back.
   */
  shelf?: HookShelf;
  /** What the variants were prepared against — also what an option panel reads. */
  ctx: HookContext;
  /** How the opener's pictures are coming along, for its panel to say. */
  pictureStatus?: HookPictureStatus;
  /** The shelf is passed only when a switch changed it. */
  onChange: (layers: HookLayer[], shelf?: HookShelf) => void;
  /**
   * Opens the trip's garage — the car every Virée drives. Absent where the
   * picker has no trip to write to, and the variant's panel says so instead.
   */
  onConfigureCar?: () => void;
  /**
   * The picker is choosing a slide's OWN opener rather than the piece's. The
   * badge variant draws nothing beyond the badge, and on such a slide the
   * badge is a capacity of its own — so its card reads as what it is there,
   * NONE, and picking it clears the slide's opener instead of writing one.
   */
  slideOpener?: boolean;
}

interface StopsRequest {
  stops: readonly MapStop[];
  choice: HookStopsChoice;
  resolve: (stops: MapStop[] | null) => void;
}

interface ChooseRequest {
  selected: readonly HookPickedPicture[];
  choice: HookPictureChoice;
  resolve: (picked: HookPickedPicture[] | null) => void;
}

export default function HookPicker({
  layers,
  shelf,
  ctx,
  pictureStatus,
  onChange,
  onConfigureCar,
  slideOpener = false,
}: HookPickerProps) {
  // A slide with no opener is showing the NONE card, the badge variant's.
  const currentId = layers[0]?.id ?? (slideOpener ? DEFAULT_HOOK_ID : '');
  const current: HookVariant | undefined = HOOK_VARIANTS.find((v) => v.id === currentId);
  const Panel = current?.Panel;

  const [choosing, setChoosing] = useState<ChooseRequest | null>(null);
  const choosePictures = useCallback(
    (selected: readonly HookPickedPicture[], choice: HookPictureChoice = {}) =>
      new Promise<HookPickedPicture[] | null>((resolve) =>
        setChoosing({ selected, choice, resolve }),
      ),
    [],
  );
  const [placing, setPlacing] = useState<StopsRequest | null>(null);
  const editStopsOnMap = useCallback(
    (stops: readonly MapStop[], choice: HookStopsChoice = {}) =>
      new Promise<MapStop[] | null>((resolve) => setPlacing({ stops, choice, resolve })),
    [],
  );
  const host = useMemo<HookPanelHost>(
    () => ({ choosePictures, pictureStatus, configureCar: onConfigureCar, editStopsOnMap }),
    [choosePictures, pictureStatus, onConfigureCar, editStopsOnMap],
  );
  const settle = (picked: HookPickedPicture[] | null) => {
    choosing?.resolve(picked);
    setChoosing(null);
  };
  const settleStops = (stops: MapStop[] | null) => {
    placing?.resolve(stops);
    setPlacing(null);
  };

  return (
    <div className="flex flex-col gap-2">

      <div className="flex flex-col gap-1.5">
        {HOOK_VARIANTS.map((variant) => {
          const active = variant.id === currentId;
          const unmet = hookUnmet(variant, ctx);
          const Sketch = variant.Sketch;
          const none = slideOpener && variant.id === DEFAULT_HOOK_ID;
          return (
            <button
              key={variant.id}
              type="button"
              disabled={!!unmet}
              onClick={() => {
                const next = switchHookVariant(layers, shelf, variant, current);
                // On a slide's own opener the badge card is NONE: the slide
                // keeps no opener, and what it drew is shelved all the same,
                // so coming back to it finds its stops.
                onChange(none ? [] : next.hook, next.shelf);
              }}
              aria-pressed={active}
              className={`flex items-center gap-3 px-3 py-2 rounded-paper border text-left transition-colors ${
                unmet
                  ? 'border-line bg-paper opacity-55 cursor-default'
                  : active
                    ? 'border-accent bg-accent-wash cursor-pointer'
                    : 'border-line bg-paper hover:border-line-strong cursor-pointer'
              }`}
            >
              <span className="flex-none w-[4.6rem] h-[2.2rem] grid place-items-center rounded-[4px] bg-frame overflow-hidden">
                {Sketch && !none ? <Sketch /> : null}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-sm">{none ? 'None' : variant.name}</span>
                <span
                  className={`block text-2xs truncate ${
                    unmet ? 'text-accent-ink' : 'text-muted'
                  }`}
                >
                  {unmet ?? (none ? 'The picture, and whatever this slide says over it' : variant.tagline)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {Panel && (
        <Panel
          options={layers[0]?.options ?? {}}
          ctx={ctx}
          host={host}
          onChange={(options) => onChange(setHookOptions(layers, options))}
        />
      )}

      {choosing && (
        <HookPicturesModal
          ctx={ctx}
          selected={choosing.selected}
          includeThisDay={choosing.choice.includeThisDay}
          keepsLater={choosing.choice.keepsLater}
          onCancel={() => settle(null)}
          onConfirm={(picked) => settle(picked)}
        />
      )}

      {placing && (
        <StopsMapSheet
          stops={placing.stops}
          places={tripPlaces(ctx.stages)}
          title={placing.choice.title}
          onCancel={() => settleStops(null)}
          onDone={(stops) => settleStops(stops)}
        />
      )}
    </div>
  );
}
