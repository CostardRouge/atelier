import AutoSwitch from '../../shared/develop/AutoSwitch';
import DevelopFold from '../../shared/develop/DevelopFold';
import { RangeSlider } from '../../shared/develop/DevelopSliders';
import type { AutoState } from '../../shared/develop/auto-slots';
import { developLinkClass } from '../../shared/develop/develop-classes';
import { FieldRow } from '../../shared/ui/Inspector';
import {
  DEFAULT_KEYSTONE,
  MAX_KEYSTONE_ROTATION,
  MAX_KEYSTONE_SCALE,
  MIN_KEYSTONE_SCALE,
  isDefaultKeystone,
  type Keystone,
} from '../../shared/render/geometry';

const HINT =
  'Pointing a lens up at a building makes its verticals converge; these take that back out. Vertical is the one you want for a building, horizontal for a wall shot from one side, and the two perspective sliders empty the corners of the frame — Zoom is what hides that, so it usually goes up as they do. Turn levels the horizon in the same pass, so the picture is resampled once rather than twice. The correction happens BEFORE the crop, which then decides what of the result is kept.';

/** Auto upright, held by the workbench (`use-value-switch.ts`): the switch and its click. */
export interface AutoUprightVerb {
  state: AutoState;
  /** Apply, or take back when on. */
  onClick: () => void;
  /** The picture has not been read yet: the switch waits. */
  disabled?: boolean;
}

const UPRIGHT_HINT =
  'Auto upright reads the lines that stand and lie in the picture — a building’s edges, a wall’s courses — and where they converge, writes the Vertical and Horizontal that make them parallel, with the Zoom that hides the corners it empties. Turn and Stretch are left as you set them. Lines that do not agree on one vanishing point are refused rather than guessed at. A switch: a second click puts back what was there.';

const KEYS = [
  { key: 'vertical', label: 'Vertical', min: -100, max: 100, step: 1, reset: 0, digits: 0 },
  { key: 'horizontal', label: 'Horizontal', min: -100, max: 100, step: 1, reset: 0, digits: 0 },
  { key: 'rotation', label: 'Turn', min: -MAX_KEYSTONE_ROTATION, max: MAX_KEYSTONE_ROTATION, step: 0.1, reset: 0, digits: 1 },
  { key: 'aspect', label: 'Stretch', min: -100, max: 100, step: 1, reset: 0, digits: 0 },
  { key: 'scale', label: 'Zoom', min: MIN_KEYSTONE_SCALE, max: MAX_KEYSTONE_SCALE, step: 0.01, reset: 1, digits: 2 },
] as const;

/**
 * The perspective correction — the suite's first control that moves a pixel
 * rather than changing its colour.
 *
 * It sits on the Crop tab because it is the same gesture in a photographer's
 * head ("make the frame right"), and because the order matters and is easier
 * to see when the two are together: the warp happens first, the crop decides
 * what survives it. The maths is `shared/render/geometry.ts`.
 */
export default function KeystonePanel({
  value,
  onChange,
  auto,
}: {
  value: Keystone | null;
  onChange: (keystone: Keystone | null) => void;
  /** Auto upright; omitted, the fold is the sliders alone. */
  auto?: AutoUprightVerb;
}) {
  const keystone: Keystone = value ?? { ...DEFAULT_KEYSTONE };
  const write = (key: keyof Keystone, v: number) => {
    const next: Keystone = { ...keystone, [key]: v };
    // Stored as null the moment it does nothing, the record's rule everywhere
    // here — so a picture nobody corrected carries no correction.
    onChange(isDefaultKeystone(next) ? null : next);
  };

  const touched = !isDefaultKeystone(value);
  return (
    <DevelopFold
      id="perspective"
      title="Perspective"
      marked={touched}
      info={
        <>
          <p>{HINT}</p>
          <p>The corners it empties are left EMPTY, never smeared — zoom to hide them.</p>
          {auto && <p>{UPRIGHT_HINT}</p>}
        </>
      }
      actions={
        touched ? (
          <button type="button" className={developLinkClass} onClick={() => onChange(null)}>
            Reset
          </button>
        ) : undefined
      }
    >
      {auto && (
        <FieldRow label="Upright">
          <AutoSwitch
            shape="control"
            state={auto.state}
            onClick={auto.onClick}
            disabled={auto.disabled && auto.state === 'off'}
            hint="Read the lines that converge and set Vertical, Horizontal and Zoom so they stand parallel"
          >
            Auto upright
          </AutoSwitch>
          <span className="font-mono text-3xs text-faint leading-relaxed">from the picture’s lines</span>
        </FieldRow>
      )}
      {KEYS.map((k) => (
        <RangeSlider
          key={k.key}
          label={k.label}
          value={keystone[k.key]}
          range={{ min: k.min, max: k.max, step: k.step, unit: '' }}
          reset={k.reset}
          printed={
            k.key === 'scale'
              ? `${keystone.scale.toFixed(2)}×`
              : k.key === 'rotation'
                ? `${keystone.rotation > 0 ? '+' : keystone.rotation < 0 ? '−' : ''}${Math.abs(keystone.rotation).toFixed(1)}°`
                : undefined
          }
          onChange={(v) => write(k.key, v)}
        />
      ))}
    </DevelopFold>
  );
}
