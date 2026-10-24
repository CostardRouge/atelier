import DevelopFold from './DevelopFold';
import SliderBar, { type SliderBarProps } from '../ui/SliderBar';
import { DEVELOP_RANGES, signed, type DevelopKey, type DevelopRange, type DevelopSettings } from './develop';
import { foldSwitch, isParked, isSet, shownOf, toggleKey, type DevelopGroupId } from './parked';

const LABELS: Readonly<Record<DevelopKey, string>> = {
  exposure: 'Exposure',
  brightness: 'Brightness',
  contrast: 'Contrast',
  highlights: 'Highlights',
  shadows: 'Shadows',
  whites: 'Whites',
  blacks: 'Blacks',
  temperature: 'Temperature',
  tint: 'Tint',
  saturation: 'Saturation',
  vibrance: 'Vibrance',
};

/** The column, top to bottom — the pipeline's own order. */
const GROUPS: ReadonlyArray<{ id: DevelopGroupId; legend: string; keys: readonly DevelopKey[]; hint: string }> = [
  {
    id: 'light',
    legend: 'Light',
    keys: ['exposure', 'brightness', 'contrast'],
    hint: 'Exposure is a gain in stops, in scene light. Brightness lifts the midtones and leaves black and white where they are. Contrast stretches around 18 % grey.',
  },
  {
    id: 'tone',
    legend: 'Tone',
    keys: ['highlights', 'shadows', 'whites', 'blacks'],
    hint: 'Highlights and shadows work the upper and lower halves without reaching the ends; whites and blacks move the ends themselves. On an 8-bit picture nothing above white can come back — only a RAW keeps it.',
  },
  {
    id: 'colour',
    legend: 'Colour',
    keys: ['temperature', 'tint', 'saturation', 'vibrance'],
    hint: 'Temperature and tint are channel gains in linear light. Vibrance is saturation weighted by how pale a colour already is, so a strong colour barely moves — that is what protects skin.',
  },
];

/** Light · Tone · Colour: every slider of a develop, in the order the maths applies them. */
export default function DevelopSliders({
  value,
  onChange,
  onSwitch,
  foldPrefix = '',
}: {
  value: DevelopSettings;
  onChange: (key: DevelopKey, v: number) => void;
  /**
   * Where a switch writes the whole develop (`parked.ts`). Given, a set bar's
   * dot and a set fold's eye switch it off and back on; absent, the column
   * draws as before — a layer's, until its sliders take switches too.
   */
  onSwitch?: (next: DevelopSettings) => void;
  /** Keeps a LAYER's folds apart from the picture's (`layer.`). */
  foldPrefix?: string;
}) {
  return (
    <>
      {GROUPS.map((group) => (
        <DevelopFold
          key={group.legend}
          id={`${foldPrefix}${group.legend.toLowerCase()}`}
          title={group.legend}
          info={<p>{group.hint}</p>}
          marked={group.keys.some((key) => isSet(value, key))}
          switched={foldSwitch(value, group.id, onSwitch)}
        >
          {group.keys.map((key) => (
            <DevelopSlider
              key={key}
              k={key}
              value={shownOf(value, key)}
              onChange={(v) => onChange(key, v)}
              toggle={onSwitch ? { off: isParked(value, key), onToggle: () => onSwitch(toggleKey(value, key)) } : undefined}
            />
          ))}
        </DevelopFold>
      ))}
    </>
  );
}

/**
 * ONE slider, for anything with a name, a range and a value it goes back to.
 *
 * Generalised when Levels needed the same row (`DevelopAuto.tsx`): a second
 * copy is how two panels come to disagree about what a slider looks like and
 * which keys it answers. Since 2026-10-13 it IS the suite's `SliderBar` — the
 * bar with its name inside, filled from 0, ↺ and double-click to reset,
 * Shift + arrows for ten steps — so Develop and every inspector read alike.
 * `DevelopSlider` below is this one, keyed on a develop's own field.
 */
export function RangeSlider({
  label,
  value,
  range,
  reset = 0,
  printed,
  swatch,
  onChange,
  toggle,
}: {
  label: string;
  /** A colour the row is ABOUT — a mixer band's hue — drawn as a chip before the name. */
  swatch?: string;
  value: number;
  range: DevelopRange;
  /** Where a double-click puts it — 0 for a develop's fields, 1 for a gamma. */
  reset?: number;
  /** The value as words; the signed form when a caller says nothing. */
  printed?: string;
  onChange: (v: number) => void;
  /** Its on/off switch, where the column can switch settings off (`SliderBar`). */
  toggle?: SliderBarProps['toggle'];
}) {
  return (
    <SliderBar
      label={label}
      lead={
        swatch && (
          // A colour the row is ABOUT, ahead of its name so it reads in the
          // same glance as the rows above and below.
          <span aria-hidden="true" className="flex-none w-2.5 h-2.5 rounded-full border border-line" style={{ background: swatch }} />
        )
      }
      value={value}
      min={range.min}
      max={range.max}
      step={range.step}
      reset={reset}
      printed={printed ?? signed(value)}
      onChange={onChange}
      toggle={toggle}
    />
  );
}

/**
 * One slider of a develop: its name, its value in the mono face, the range.
 * Double-click the row to put it back to 0; Shift with the arrow keys steps
 * ten at a time.
 */
export function DevelopSlider({
  k,
  value,
  onChange,
  toggle,
}: {
  k: DevelopKey;
  value: number;
  onChange: (v: number) => void;
  toggle?: SliderBarProps['toggle'];
}) {
  const range = DEVELOP_RANGES[k];
  return (
    <RangeSlider
      label={LABELS[k]}
      value={value}
      range={range}
      printed={k === 'exposure' ? `${signed(value, 2)} ${range.unit}` : signed(value)}
      onChange={onChange}
      toggle={toggle}
    />
  );
}
