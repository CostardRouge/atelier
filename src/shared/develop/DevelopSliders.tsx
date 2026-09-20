import SectionLegend from '../ui/SectionLegend';
import { Icons } from '../ui/icons';
import { DEVELOP_RANGES, signed, type DevelopKey, type DevelopRange, type DevelopSettings } from './develop';

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
const GROUPS: ReadonlyArray<{ legend: string; keys: readonly DevelopKey[]; hint: string }> = [
  {
    legend: 'Light',
    keys: ['exposure', 'brightness', 'contrast'],
    hint: 'Exposure is a gain in stops, in scene light. Brightness lifts the midtones and leaves black and white where they are. Contrast stretches around 18 % grey.',
  },
  {
    legend: 'Tone',
    keys: ['highlights', 'shadows', 'whites', 'blacks'],
    hint: 'Highlights and shadows work the upper and lower halves without reaching the ends; whites and blacks move the ends themselves. On an 8-bit picture nothing above white can come back — only a RAW keeps it.',
  },
  {
    legend: 'Colour',
    keys: ['temperature', 'tint', 'saturation', 'vibrance'],
    hint: 'Temperature and tint are channel gains in linear light. Vibrance is saturation weighted by how pale a colour already is, so a strong colour barely moves — that is what protects skin.',
  },
];

/** Light · Tone · Colour: every slider of a develop, in the order the maths applies them. */
export default function DevelopSliders({
  value,
  onChange,
}: {
  value: DevelopSettings;
  onChange: (key: DevelopKey, v: number) => void;
}) {
  return (
    <>
      {GROUPS.map((group) => (
        <div key={group.legend} className="flex flex-col gap-2">
          <SectionLegend label={group.legend}>
            <p>{group.hint}</p>
          </SectionLegend>
          {group.keys.map((key) => (
            <DevelopSlider key={key} k={key} value={value[key]} onChange={(v) => onChange(key, v)} />
          ))}
        </div>
      ))}
    </>
  );
}

/**
 * ONE slider, for anything with a name, a range and a value it goes back to.
 *
 * Generalised when Levels needed the same row (`DevelopAuto.tsx`): a second
 * copy is how two panels come to disagree about what a slider looks like and
 * which keys it answers. `DevelopSlider` below is this one, keyed on a
 * develop's own field.
 */
export function RangeSlider({
  label,
  value,
  range,
  reset = 0,
  printed,
  onChange,
}: {
  label: string;
  value: number;
  range: DevelopRange;
  /** Where a double-click puts it — 0 for a develop's fields, 1 for a gamma. */
  reset?: number;
  /** The value as words; the signed form when a caller says nothing. */
  printed?: string;
  onChange: (v: number) => void;
}) {
  const changed = value !== reset;
  return (
    <div className="flex flex-col gap-1" onDoubleClick={() => onChange(reset)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="inline-flex items-baseline gap-1.5 min-w-0">
          {/* Ahead of the label rather than on it: it must read in the same
              glance as the row above and below, not only once the eye lands
              here. */}
          <span
            aria-hidden="true"
            className={`inline-block w-1.5 h-1.5 rounded-full bg-accent transition-opacity ${changed ? 'opacity-100' : 'opacity-0'}`}
          />
          <span className={`text-xs truncate ${changed ? 'font-semibold text-ink' : 'text-ink'}`}>{label}</span>
        </span>
        <span className="inline-flex items-baseline gap-1">
          <span className={`font-mono text-2xs tabular-nums ${changed ? 'text-ink-soft' : 'text-faint'}`}>
            {printed ?? signed(value)}
          </span>
          {/* Dimmed rather than hover-revealed, so it still works with a
              finger; the row's own double-click (kept below) is the shortcut
              for anyone who already reaches for it. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(reset);
            }}
            aria-label={`Reset ${label}`}
            title="Reset"
            className={`relative inline-grid place-items-center w-3.5 h-3.5 rounded-[4px] transition-opacity after:absolute after:-inset-2 after:content-[''] [&>svg]:w-3 [&>svg]:h-3 ${
              changed
                ? 'opacity-100 text-accent-ink hover:bg-accent-wash'
                : 'opacity-30 text-ink-soft hover:opacity-60 hover:bg-paper-2'
            }`}
          >
            {Icons.reset}
          </button>
        </span>
      </div>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onKeyDown={(e) => {
          if (!e.shiftKey) return;
          const dir =
            e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
          if (!dir) return;
          e.preventDefault();
          onChange(Math.min(range.max, Math.max(range.min, value + dir * range.step * 10)));
        }}
        className="w-full accent-accent cursor-pointer"
        aria-label={label}
      />
    </div>
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
}: {
  k: DevelopKey;
  value: number;
  onChange: (v: number) => void;
}) {
  const range = DEVELOP_RANGES[k];
  return (
    <RangeSlider
      label={LABELS[k]}
      value={value}
      range={range}
      printed={k === 'exposure' ? `${signed(value, 2)} ${range.unit}` : signed(value)}
      onChange={onChange}
    />
  );
}
