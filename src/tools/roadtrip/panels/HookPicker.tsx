/**
 * Choosing the piece's OPENER — which hook variant draws its first slide.
 *
 * Tiles, never a dropdown: the rule the title styles already settled is that a
 * look you cannot see before adopting is a look you adopt by trial. Six tiles on
 * two rows of three (2026-10-12, as the summary card's faces and looks), each
 * the variant's own sketch of what it DOES under its name; the chosen one's
 * line is said once under the grid, and the variant's own options mount
 * underneath, so the panel below the picker always belongs to the tile above.
 *
 * A variant a piece cannot feed is greyed **with its reason one touch away**
 * (`aria-disabled`, the reason said under the grid), not hidden — the counter
 * modes' rule: say what it would draw, or say why it cannot. A variant you
 * cannot find is a feature that does not exist.
 *
 * The picker is also the variant panel's HOST: a panel may not open the
 * Library or ask an instance itself (`hook-variant.ts`), so the things it may
 * ask for — the picture chooser, how its pictures are loading, the big
 * picking map — are handed down from here, and the sheets are drawn here.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { PRESS_LOOK } from '../../../shared/ui/press';
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
   * Opens the trip's garage — the vehicle every Virée drives. Absent where the
   * picker has no trip to write to, and the variant's panel says so instead.
   */
  onConfigureVehicle?: () => void;
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
  onConfigureVehicle,
  slideOpener = false,
}: HookPickerProps) {
  // A slide with no opener is showing the NONE card, the badge variant's.
  const currentId = layers[0]?.id ?? (slideOpener ? DEFAULT_HOOK_ID : '');
  const current: HookVariant | undefined = HOOK_VARIANTS.find((v) => v.id === currentId);
  const Panel = current?.Panel;

  // A refused tile the author touched: its reason is shown, nothing is picked.
  const [said, setSaid] = useState<string | null>(null);
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
  // The editor re-renders on every frame of the transport's clock, and its
  // callbacks are new each time. A variant's panel computes the whole road
  // (Virée: the route, the plan, the vehicles, the coast) when it renders, so
  // it must render when what it SHOWS changes and never per frame — the
  // Look tab crawled while the piece played (his report, 2026-10-09). The
  // callbacks are read through a ref, and the panel's element is memoised on
  // its options, its context and its host.
  const latest = useRef({ layers, onChange, onConfigureVehicle });
  latest.current = { layers, onChange, onConfigureVehicle };
  const hasGarage = !!onConfigureVehicle;
  const configureVehicle = useCallback(() => latest.current.onConfigureVehicle?.(), []);
  const host = useMemo<HookPanelHost>(
    () => ({
      choosePictures,
      pictureStatus,
      configureVehicle: hasGarage ? configureVehicle : undefined,
      editStopsOnMap,
    }),
    [choosePictures, pictureStatus, hasGarage, configureVehicle, editStopsOnMap],
  );
  const onPanelChange = useCallback(
    (options: HookLayer['options']) =>
      latest.current.onChange(setHookOptions(latest.current.layers, options)),
    [],
  );
  const options = layers[0]?.options;
  const panel = useMemo(
    () =>
      Panel ? <Panel options={options ?? {}} ctx={ctx} host={host} onChange={onPanelChange} /> : null,
    [Panel, options, ctx, host, onPanelChange],
  );
  const settle = (picked: HookPickedPicture[] | null) => {
    choosing?.resolve(picked);
    setChoosing(null);
  };
  const settleStops = (stops: MapStop[] | null) => {
    placing?.resolve(stops);
    setPlacing(null);
  };

  // The touched tile's reason, only while it still holds (the context moves).
  const saidVariant = said ? HOOK_VARIANTS.find((v) => v.id === said) : undefined;
  const shownUnmet = saidVariant ? hookUnmet(saidVariant, ctx) : null;
  const shown = shownUnmet ? saidVariant : current;
  const noneHere = (variant: HookVariant) => slideOpener && variant.id === DEFAULT_HOOK_ID;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Opener">
        {HOOK_VARIANTS.map((variant) => {
          const active = variant.id === currentId;
          const unmet = hookUnmet(variant, ctx);
          const Sketch = variant.Sketch;
          const none = noneHere(variant);
          return (
            <button
              key={variant.id}
              type="button"
              // A grey tile stays reachable and gives its reason (`aria-disabled`,
              // never `disabled`): a refused opener must say why, not vanish.
              aria-disabled={unmet ? true : undefined}
              aria-pressed={active}
              title={unmet ?? undefined}
              onClick={() => {
                if (unmet) {
                  setSaid(variant.id);
                  return;
                }
                setSaid(null);
                const next = switchHookVariant(layers, shelf, variant, current);
                // On a slide's own opener the badge card is NONE: the slide
                // keeps no opener, and what it drew is shelved all the same,
                // so coming back to it finds its stops.
                onChange(none ? [] : next.hook, next.shelf);
              }}
              className={`flex flex-col items-stretch gap-1 p-1 pb-1.5 rounded-[10px] border text-center font-sans cursor-pointer select-none transition-[background-color,color,box-shadow,border-color,translate] duration-150 ease-paper ${PRESS_LOOK} focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                unmet
                  ? 'border-line bg-paper-2 text-ink-soft opacity-50 cursor-default'
                  : active
                    ? 'border-accent bg-surface text-ink shadow-[0_0_0_1px_var(--color-accent)]'
                    : 'border-line bg-paper-2 text-ink-soft hover:border-line-strong'
              }`}
            >
              <span className="grid place-items-center w-full aspect-[46/24] rounded-[4px] bg-frame overflow-hidden">
                {Sketch && !none ? <Sketch /> : null}
              </span>
              <span className="text-xs font-semibold leading-tight">{none ? 'None' : variant.name}</span>
            </button>
          );
        })}
      </div>
      {shown && (
        // The chosen opener's line is said ONCE, under the grid; touching a
        // refused tile puts its reason here instead, and picks nothing.
        <p
          role="status"
          className={`m-0 min-h-[1.4em] text-2xs leading-snug ${shownUnmet ? 'text-accent-ink' : 'text-muted'}`}
        >
          <b className={`font-semibold ${shownUnmet ? '' : 'text-ink'}`}>
            {noneHere(shown) ? 'None' : shown.name}
          </b>
          {' · '}
          {shownUnmet ?? (noneHere(shown) ? 'The picture, and whatever this slide says over it' : shown.tagline)}
        </p>
      )}

      {panel}

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
          grouping={placing.choice.grouping}
          onCancel={() => settleStops(null)}
          onDone={(stops) => settleStops(stops)}
        />
      )}
    </div>
  );
}
