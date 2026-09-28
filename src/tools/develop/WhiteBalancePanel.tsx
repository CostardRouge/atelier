import { useMemo } from 'react';
import DevelopFold from '../../shared/develop/DevelopFold';
import { RangeSlider } from '../../shared/develop/DevelopSliders';
import { developLinkClass } from '../../shared/develop/develop-classes';
import {
  KELVIN_RANGE,
  TINT_RANGE,
  WB_PRESETS,
  asShotTempTint,
  describeWhiteBalance,
  wbMatrix,
  type RawWhite,
  type RawWhiteBalance,
} from '../../shared/raw/white-balance';

const HINT =
  'On a RAW, white balance is a temperature in kelvin and a tint, as in Lightroom — the light the picture was lit by. Lower is bluer, higher warmer; tint above zero adds magenta, below adds green. The camera’s own reading is As shot, and every value is turned into the multipliers the camera would have used under that light, through its own matrix. The Temperature and Tint sliders further down still work on top, as a relative nudge.';

/** The slider walks the range on a LOG scale, as Lightroom's does: 2000 → 50000 K over 1000 steps. */
const STEPS = 1000;
const LOG_SPAN = Math.log(KELVIN_RANGE.max / KELVIN_RANGE.min);
const toStep = (k: number) => Math.round((Math.log(k / KELVIN_RANGE.min) / LOG_SPAN) * STEPS);
const toKelvin = (step: number) => Math.round(KELVIN_RANGE.min * Math.exp((step / STEPS) * LOG_SPAN));

/**
 * White balance in kelvin (`shared/raw/white-balance.ts`) — drawn only on a
 * RAW base whose decode gave the camera's white. Lightroom's presets, a
 * temperature and a tint; As shot is `null`.
 */
export default function WhiteBalancePanel({
  white,
  value,
  onChange,
}: {
  white: RawWhite;
  value: RawWhiteBalance | null;
  onChange: (next: RawWhiteBalance | null) => void;
}) {
  const shot = useMemo(() => asShotTempTint(white), [white]);
  if (!shot) return null;
  const kelvin = value?.kelvin ?? shot.kelvin;
  const tint = value?.tint ?? shot.tint;
  const set = (k: number, t: number) => {
    const matrix = wbMatrix(white, k, t);
    if (matrix) onChange({ kelvin: k, tint: t, matrix });
  };
  const preset = value
    ? (WB_PRESETS.find((p) => p.kelvin === Math.round(value.kelvin) && p.tint === Math.round(value.tint))?.id ?? 'custom')
    : 'shot';
  return (
    <DevelopFold id="white-balance" title="White balance" info={<p>{HINT}</p>} marked={Boolean(value)}>
      <label className="flex items-center justify-between gap-2 text-xs text-ink">
        <span>Preset</span>
        <select
          className="flex-1 min-w-0 max-w-[12rem] rounded-control border border-line bg-paper px-2 py-1 text-xs text-ink"
          value={preset}
          onChange={(e) => {
            const id = e.target.value;
            if (id === 'shot') onChange(null);
            const p = WB_PRESETS.find((x) => x.id === id);
            if (p) set(p.kelvin, p.tint);
          }}
        >
          <option value="shot">As shot</option>
          {WB_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.kelvin} K
            </option>
          ))}
          {preset === 'custom' && <option value="custom">Custom</option>}
        </select>
      </label>
      <RangeSlider
        label="Temperature"
        value={toStep(kelvin)}
        reset={toStep(shot.kelvin)}
        range={{ min: 0, max: STEPS, step: 1, unit: '' }}
        printed={`${Math.round(kelvin)} K`}
        onChange={(step) => (step === toStep(shot.kelvin) && !value?.tint ? onChange(null) : set(toKelvin(step), tint))}
      />
      <RangeSlider
        label="Tint"
        value={Math.round(tint)}
        reset={Math.round(shot.tint)}
        range={{ min: TINT_RANGE.min, max: TINT_RANGE.max, step: 1, unit: '' }}
        onChange={(t) => set(kelvin, t)}
      />
      <span className="flex items-center gap-2 font-mono text-3xs text-faint">
        <span className="truncate">as shot {describeWhiteBalance({ ...shot, matrix: [] })}</span>
        <span className="flex-1" />
        {value && (
          <button type="button" className={developLinkClass} onClick={() => onChange(null)}>
            As shot
          </button>
        )}
      </span>
    </DevelopFold>
  );
}
