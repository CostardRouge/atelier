import type { AnimPreset, AnimStep, Easing } from '../../shared/overlay/animation';
import { defaultStep } from '../../shared/overlay/animation';
import type { BadgePieceStyle } from '../../shared/roadtrip/badge-layout';

interface PieceStylePanelProps {
  style: BadgePieceStyle;
  onChange: (style: BadgePieceStyle) => void;
}

const legend = 'font-mono text-[0.6rem] tracking-[0.13em] uppercase text-muted';
const row = 'flex items-center gap-2';
const swatch =
  'w-7 h-7 p-0 border border-line-strong rounded-[5px] bg-paper cursor-pointer';

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

const EASINGS: Easing[] = ['linear', 'in', 'out', 'in-out'];

/**
 * One optional colour: a swatch plus the switch that decides whether the
 * colour exists at all. Absent has to be reachable — "no panel behind the
 * trip's name" is the default look, not an edge case — so the checkbox owns
 * presence and the swatch only owns the value.
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
    <div className={row}>
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked ? fallback : null)}
        className="accent-accent"
        aria-label={`Use ${label}`}
      />
      <span className="flex-1 text-[0.78rem] text-ink-soft">{label}</span>
      <input
        type="color"
        value={value ?? fallback}
        disabled={!value}
        onChange={(e) => onChange(e.target.value)}
        className={`${swatch} disabled:opacity-40`}
        aria-label={label}
      />
    </div>
  );
}

function StepEditor({
  which,
  step,
  onChange,
}: {
  which: 'In' | 'Out';
  step: AnimStep | null | undefined;
  onChange: (step: AnimStep | null) => void;
}) {
  const preset = step?.preset ?? 'none';
  return (
    <div className="flex flex-col gap-1.5">
      <div className={row}>
        <span className="w-8 flex-none font-mono text-[0.66rem] text-muted">
          {which}
        </span>
        <select
          value={preset}
          onChange={(e) => {
            const next = e.target.value as AnimPreset;
            onChange(
              next === 'none'
                ? null
                : { ...(step ?? defaultStep(next)), preset: next },
            );
          }}
          className="flex-1 min-w-0 font-sans text-[0.78rem] px-2 py-1 border border-line-strong rounded-paper bg-paper text-ink cursor-pointer"
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {step && (
        <div className="flex flex-wrap items-center gap-2 pl-8">
          <label className="flex items-center gap-1 text-[0.7rem] text-muted">
            {step.duration.toFixed(2)}s
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={step.duration}
              onChange={(e) => onChange({ ...step, duration: Number(e.target.value) })}
              className="w-20 accent-accent"
              aria-label={`${which} duration`}
            />
          </label>
          <select
            value={step.easing}
            onChange={(e) => onChange({ ...step, easing: e.target.value as Easing })}
            className="font-sans text-[0.72rem] px-1.5 py-0.5 border border-line rounded-paper bg-paper text-ink-soft cursor-pointer"
            aria-label={`${which} easing`}
          >
            {EASINGS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          {step.preset === 'slide' && (
            <select
              value={step.direction ?? 'up'}
              onChange={(e) =>
                onChange({
                  ...step,
                  direction: e.target.value as AnimStep['direction'],
                })
              }
              className="font-sans text-[0.72rem] px-1.5 py-0.5 border border-line rounded-paper bg-paper text-ink-soft cursor-pointer"
              aria-label="Slide direction"
            >
              <option value="up">up</option>
              <option value="down">down</option>
              <option value="left">left</option>
              <option value="right">right</option>
            </select>
          )}
          {which === 'In' && (
            <label className="flex items-center gap-1 text-[0.7rem] text-muted">
              delay {(step.delay ?? 0).toFixed(2)}s
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={step.delay ?? 0}
                onChange={(e) => onChange({ ...step, delay: Number(e.target.value) })}
                className="w-20 accent-accent"
                aria-label="In delay"
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Everything one badge piece may depart from the trip's theme on: its casing,
 * its ink, a panel behind it (fill, corners, outline) and an entrance/exit.
 *
 * The animation half is the engine's own model (`shared/overlay/animation.ts`)
 * with no translation layer — the same fade/slide/typewriter the studio's
 * intro titles use, so a look authored here means the same thing there.
 */
export default function PieceStylePanel({ style, onChange }: PieceStylePanelProps) {
  const patch = (p: Partial<BadgePieceStyle>) => onChange({ ...style, ...p });
  const hasPanel = Boolean(style.boxColor || style.borderColor);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className={legend}>Case</span>
        <div className="flex gap-1.5">
          {CASES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => patch({ textCase: c.id })}
              aria-pressed={(style.textCase ?? 'as-is') === c.id}
              className={`flex-1 px-2 py-1.5 rounded-paper border text-[0.74rem] cursor-pointer transition-colors ${
                (style.textCase ?? 'as-is') === c.id
                  ? 'border-accent bg-accent-wash text-accent-ink font-semibold'
                  : 'border-line bg-paper text-ink-soft hover:border-line-strong'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={legend}>Colours</span>
        <OptionalColor
          label="Ink"
          value={style.color}
          fallback="#ffffff"
          onChange={(color) => patch({ color })}
        />
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
      </div>

      {hasPanel && (
        <div className="flex flex-col gap-1.5">
          <span className={legend}>Panel</span>
          <label className="flex items-center gap-2 text-[0.72rem] text-muted">
            <span className="w-14 flex-none">padding</span>
            <input
              type="range"
              min={0.05}
              max={1.2}
              step={0.05}
              value={style.boxPadFrac ?? 0.3}
              onChange={(e) => patch({ boxPadFrac: Number(e.target.value) })}
              className="flex-1 accent-accent"
            />
          </label>
          <label className="flex items-center gap-2 text-[0.72rem] text-muted">
            <span className="w-14 flex-none">corners</span>
            <input
              type="range"
              min={0}
              max={6}
              step={0.1}
              value={style.boxRadiusFrac ?? 0.5}
              onChange={(e) => patch({ boxRadiusFrac: Number(e.target.value) })}
              className="flex-1 accent-accent"
            />
          </label>
          {style.borderColor && (
            <label className="flex items-center gap-2 text-[0.72rem] text-muted">
              <span className="w-14 flex-none">border</span>
              <input
                type="range"
                min={0.01}
                max={0.25}
                step={0.005}
                value={style.borderWidthFrac ?? 0.06}
                onChange={(e) => patch({ borderWidthFrac: Number(e.target.value) })}
                className="flex-1 accent-accent"
              />
            </label>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className={legend}>Animation</span>
        <StepEditor
          which="In"
          step={style.animation?.in}
          onChange={(inStep) =>
            patch({
              animation:
                inStep || style.animation?.out
                  ? { in: inStep, out: style.animation?.out ?? null }
                  : null,
            })
          }
        />
        <StepEditor
          which="Out"
          step={style.animation?.out}
          onChange={(outStep) =>
            patch({
              animation:
                outStep || style.animation?.in
                  ? { in: style.animation?.in ?? null, out: outStep }
                  : null,
            })
          }
        />
      </div>

      <button
        type="button"
        onClick={() => onChange({})}
        className="self-start p-0 border-0 bg-transparent text-[0.74rem] text-faint cursor-pointer underline underline-offset-[3px] hover:text-accent-ink"
      >
        Back to the trip's style
      </button>
    </div>
  );
}
