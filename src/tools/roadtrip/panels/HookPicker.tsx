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
 * ask for — the picture chooser, how its pictures are loading — are handed
 * down from here, and the chooser is drawn here.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  setHookOptions,
  setHookVariant,
  type HookContext,
  type HookLayer,
  type HookPanelHost,
  type HookPictureChoice,
  type HookPickedPicture,
  type HookPictureStatus,
  type HookVariant,
} from '../../../shared/roadtrip/hooks/hook-variant';
import { HOOK_VARIANTS, hookUnmet } from '../../../shared/roadtrip/hooks/registry';
import HookPicturesModal from '../HookPicturesModal';

interface HookPickerProps {
  /** The piece's stored layers; the picker writes the first and only the first. */
  layers: HookLayer[];
  /** What the variants were prepared against — also what an option panel reads. */
  ctx: HookContext;
  /** How the opener's pictures are coming along, for its panel to say. */
  pictureStatus?: HookPictureStatus;
  onChange: (layers: HookLayer[]) => void;
  /**
   * Opens the trip's garage — the car every Virée drives. Absent where the
   * picker has no trip to write to, and the variant's panel says so instead.
   */
  onConfigureCar?: () => void;
}

interface ChooseRequest {
  selected: readonly HookPickedPicture[];
  choice: HookPictureChoice;
  resolve: (picked: HookPickedPicture[] | null) => void;
}

export default function HookPicker({
  layers,
  ctx,
  pictureStatus,
  onChange,
  onConfigureCar,
}: HookPickerProps) {
  const currentId = layers[0]?.id ?? '';
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
  const host = useMemo<HookPanelHost>(
    () => ({ choosePictures, pictureStatus, configureCar: onConfigureCar }),
    [choosePictures, pictureStatus, onConfigureCar],
  );
  const settle = (picked: HookPickedPicture[] | null) => {
    choosing?.resolve(picked);
    setChoosing(null);
  };

  return (
    <div className="flex flex-col gap-2">

      <div className="flex flex-col gap-1.5">
        {HOOK_VARIANTS.map((variant) => {
          const active = variant.id === currentId;
          const unmet = hookUnmet(variant, ctx);
          const Sketch = variant.Sketch;
          return (
            <button
              key={variant.id}
              type="button"
              disabled={!!unmet}
              onClick={() => onChange(setHookVariant(layers, variant))}
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
                {Sketch ? <Sketch /> : null}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-sm">{variant.name}</span>
                <span
                  className={`block text-2xs truncate ${
                    unmet ? 'text-accent-ink' : 'text-muted'
                  }`}
                >
                  {unmet ?? variant.tagline}
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
          onCancel={() => settle(null)}
          onConfirm={(picked) => settle(picked)}
        />
      )}
    </div>
  );
}
