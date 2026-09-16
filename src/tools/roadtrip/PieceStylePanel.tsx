import type { AnimPreset, AnimStep } from '../../shared/overlay/animation';
import { defaultStep } from '../../shared/overlay/animation';
import { CURVES, DEFAULT_STEPS, EASING_IDS, MAX_STEPS, MIN_STEPS } from '../../shared/motion/easing';
import type { BadgePieceStyle } from '../../shared/roadtrip/badge-layout';
import { FieldRow, RangeField, SelectField, ToggleField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';

interface PieceStylePanelProps {
  style: BadgePieceStyle;
  onChange: (style: BadgePieceStyle) => void;
}

const swatch =
  'flex-none w-8 h-8 p-0 border border-line-strong rounded-[7px] bg-paper cursor-pointer disabled:opacity-40 disabled:cursor-default';

const CASES: { id: NonNullable<BadgePieceStyle['textCase']>; label: string }[] = [
  { id: 'as-is', label: 'As-is' },
  { id: 'upper', label: 'UPPER' },
  { id: 'lower', label: 'lower' },
];

const PRESETS: { id: AnimPreset; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'slide', label: 'Slide' },
  { id: 'scale', label: 'Scale' },
  { id: 'typewriter', label: 'Typewriter' },
  { id: 'wipe', label: 'Wipe' },
];

/** Every curve of the shared registry (`shared/motion/easing.ts`), by its own name. */
const EASINGS = EASING_IDS.map((id) => ({
  id,
  label: CURVES[id].overshoots
    ? `${CURVES[id].label} — overshoots`
    : CURVES[id].stepped
      ? `${CURVES[id].label} — in jumps`
      : CURVES[id].label,
}));

/**
 * One optional colour: the switch decides whether the colour exists at all,
 * the swatch owns its value. Absent has to be reachable — "no panel behind
 * the trip's name" is the default look, not an edge case.
 */
function OptionalColor({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  fallback: string;
  onChange: (value: string | null) => void;
}) {
  return (
    <FieldRow label={label}>
      <ToggleField
        label={`Use ${label.toLowerCase()}`}
        checked={Boolean(value)}
        onChange={(on) => onChange(on ? fallback : null)}
      />
      <input
        type="color"
        value={value ?? fallback}
        disabled={!value}
        onChange={(e) => onChange(e.target.value)}
        className={swatch}
        aria-label={label}
      />
    </FieldRow>
  );
}

/**
 * One animation step as inspector rows — the preset, its length, its curve,
 * its direction. Shared with the badge's cascade, which derives every delay
 * and so hides the Delay row.
 */
export function StepRows({
  which,
  step,
  onChange,
  hideDelay = false,
}: {
  which: 'In' | 'Out';
  step: AnimStep | null | undefined;
  onChange: (step: AnimStep | null) => void;
  hideDelay?: boolean;
}) {
  const preset = step?.preset ?? 'none';
  return (
    <>
      <FieldRow label={which === 'In' ? 'Entrance' : 'Exit'}>
        <SelectField
          label={`${which} animation`}
          value={preset}
          onChange={(next) =>
            onChange(next === 'none' ? null : { ...(step ?? defaultStep(next)), preset: next })
          }
          options={PRESETS}
        />
      </FieldRow>
      {step && (
        <>
          <FieldRow label="Duration">
            <RangeField
              label={`${which} duration`}
              min={0}
              max={2}
              step={0.05}
              value={step.duration}
              onChange={(duration) => onChange({ ...step, duration })}
              format={(v) => `${v.toFixed(2)} s`}
            />
          </FieldRow>
          {which === 'In' && !hideDelay && (
            <FieldRow label="Delay">
              <RangeField
                label="In delay"
                min={0}
                max={2}
                step={0.05}
                value={step.delay ?? 0}
                onChange={(delay) => onChange({ ...step, delay })}
                format={(v) => `${v.toFixed(2)} s`}
              />
            </FieldRow>
          )}
          <FieldRow label="Easing">
            <SelectField
              label={`${which} easing`}
              value={step.easing}
              onChange={(easing) => onChange({ ...step, easing })}
              options={EASINGS}
            />
          </FieldRow>
          {step.easing === 'steps' && (
            <FieldRow label="Steps">
              <RangeField
                label={`${which} steps`}
                min={MIN_STEPS}
                max={MAX_STEPS}
                step={1}
                value={step.steps ?? DEFAULT_STEPS}
                onChange={(steps) => onChange({ ...step, steps })}
                format={(v) => `${v}`}
              />
            </FieldRow>
          )}
          {step.preset === 'slide' && (
            <FieldRow label="From">
              <SelectField
                label="Slide direction"
                value={step.direction ?? 'up'}
                onChange={(direction) => onChange({ ...step, direction })}
                options={(['up', 'down', 'left', 'right'] as const).map((d) => ({ id: d, label: d }))}
              />
            </FieldRow>
          )}
        </>
      )}
    </>
  );
}

/**
 * Everything one badge piece may depart from the trip's theme on: its casing,
 * its ink, a panel behind it (fill, corners, outline) and an entrance/exit —
 * as inspector rows, so it reads like every other panel.
 *
 * The animation half is the engine's own model (`shared/overlay/animation.ts`)
 * with no translation layer — the same fade/slide/typewriter the studio's
 * intro titles use, so a look authored here means the same thing there.
 */
export default function PieceStylePanel({ style, onChange }: PieceStylePanelProps) {
  const patch = (p: Partial<BadgePieceStyle>) => onChange({ ...style, ...p });
  const hasPanel = Boolean(style.boxColor || style.borderColor);

  return (
    <>
      <FieldRow label="Case">
        <Segmented
          fill
          size="sm"
          label="Case"
          value={style.textCase ?? 'as-is'}
          onChange={(textCase) => patch({ textCase })}
          options={CASES}
          className="flex-1 min-w-0"
        />
      </FieldRow>

      <OptionalColor label="Ink" value={style.color} fallback="#ffffff" onChange={(color) => patch({ color })} />
      <OptionalColor
        label="Background"
        value={style.boxColor}
        fallback="#d9442a"
        onChange={(boxColor) => patch({ boxColor })}
      />
      <OptionalColor
        label="Border"
        value={style.borderColor}
        fallback="#ffffff"
        onChange={(borderColor) => patch({ borderColor })}
      />

      {hasPanel && (
        <>
          <FieldRow label="Padding">
            <RangeField
              label="Panel padding"
              min={0.05}
              max={1.2}
              step={0.05}
              value={style.boxPadFrac ?? 0.3}
              onChange={(boxPadFrac) => patch({ boxPadFrac })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
          <FieldRow label="Corners">
            <RangeField
              label="Panel corners"
              min={0}
              max={6}
              step={0.1}
              value={style.boxRadiusFrac ?? 0.5}
              onChange={(boxRadiusFrac) => patch({ boxRadiusFrac })}
              format={(v) => v.toFixed(1)}
            />
          </FieldRow>
          {style.borderColor && (
            <FieldRow label="Border width">
              <RangeField
                label="Border width"
                min={0.01}
                max={0.25}
                step={0.005}
                value={style.borderWidthFrac ?? 0.06}
                onChange={(borderWidthFrac) => patch({ borderWidthFrac })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </FieldRow>
          )}
        </>
      )}

      <StepRows
        which="In"
        step={style.animation?.in}
        onChange={(inStep) =>
          patch({
            animation:
              inStep || style.animation?.out ? { in: inStep, out: style.animation?.out ?? null } : null,
          })
        }
      />
      <StepRows
        which="Out"
        step={style.animation?.out}
        onChange={(outStep) =>
          patch({
            animation:
              outStep || style.animation?.in ? { in: style.animation?.in ?? null, out: outStep } : null,
          })
        }
      />
    </>
  );
}
