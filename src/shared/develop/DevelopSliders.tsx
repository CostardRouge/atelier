import SectionLegend from '../ui/SectionLegend';
import { DEVELOP_RANGES, signed, type DevelopKey, type DevelopSettings } from './develop';

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
 * One slider: its name, its value in the mono face, the range. Double-click
 * the row to put it back to 0; Shift with the arrow keys steps ten at a time.
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
  const printed = k === 'exposure' ? `${signed(value, 2)} ${range.unit}` : signed(value);
  return (
    <div className="flex flex-col gap-1" onDoubleClick={() => onChange(0)}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-ink">{LABELS[k]}</span>
        <span className={`font-mono text-2xs tabular-nums ${value === 0 ? 'text-faint' : 'text-ink-soft'}`}>
          {printed}
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
        aria-label={LABELS[k]}
      />
    </div>
  );
}
