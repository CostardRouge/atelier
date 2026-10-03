import DevelopFold from './DevelopFold';
import { autoBands, autoColour, autoTone, describeAutoBands, describeAutoTone, type SourceStats } from './auto-develop';
import { developLinkClass } from './develop-classes';
import { RangeSlider } from './DevelopSliders';
import {
  MAX_LEVEL_GAMMA,
  MIN_LEVEL_GAMMA,
  NEUTRAL_LEVEL,
  isNeutralLevel,
  type LevelChannel,
  type Levels,
} from './curves';
import type { AutoVerb } from './auto-slots';
import AutoSwitch from './AutoSwitch';
import type { AutoMemory } from './use-auto-memory';

const AUTO_HINT =
  'Tone reads where the picture’s light actually sits and writes a black point, a white point and a midtone gamma into Levels — it touches no colour. Colour neutralises the AVERAGE cast, which is the wrong answer on a sunset or a candle-lit room, so it is a second button and never rides along with the first. Pick grey asks you instead: click something in the picture that ought to be neutral and the white balance is solved for that, which beats the average whenever the picture is not an average scene. Bands is the third answer: where a tenth of the picture sits against black it lifts Shadows, where a tenth sits against white it pulls Highlights down — a compression of the ends where Tone is a stretch, so the two stay separate buttons. All of them are measured on the picture as shot, so pressing one twice gives the same answer rather than compounding.';

const SWITCH_HINT =
  'Each one is a switch: a second click puts back what its own sliders held before it, and leaves the others alone. Lit, it still holds its answer; dashed, it found nothing to change; half-lit, you moved its sliders since. Colour and Pick grey share the white balance — the newer replaces the older, and turning it off gives back the balance from before either.';

const LEVELS_HINT =
  'Where the range is read FROM: everything at or under black becomes black, everything at or over white becomes white, and gamma bends what is between them. Auto tone writes these three; the curve’s own end points do the same thing by hand.';

/**
 * Auto — separate buttons, deliberately not one, and each a SWITCH.
 *
 * Splitting tone from colour is the whole design: a stretch is almost always
 * an improvement, and a white balance is often exactly wrong, so they must not
 * share a click. Since 2026-10-02 a second click takes ONE verb back without
 * touching the others (`auto-slots.ts`, `use-auto-memory.ts`). The maths and
 * the reasons are in `auto-develop.ts`.
 */
export function DevelopAutoSection({
  stats,
  auto,
  picking,
  onPicking,
}: {
  stats: SourceStats | null;
  /** The row's memory of its clicks, held by the host per picture (`useAutoMemory`). */
  auto: AutoMemory;
  /** Whether the eyedropper is armed; omitted, no dropper is drawn. */
  picking?: boolean;
  onPicking?: (on: boolean) => void;
}) {
  const ready = Boolean(stats && stats.total > 0);
  const notRead = 'the picture has not been read yet';

  const toggle = (verb: AutoVerb, run: (stats: SourceStats) => void) => {
    if (auto.turnOff(verb) || !stats) return;
    run(stats);
  };

  const verbs: { verb: AutoVerb; label: string; hint?: string; run: (stats: SourceStats) => void }[] = [
    {
      verb: 'tone',
      label: 'Auto tone',
      run: (s) => {
        const levels = autoTone(s);
        auto.apply('tone', { levels }, levels ? `auto tone · ${describeAutoTone(levels)}` : 'nothing to stretch');
      },
    },
    {
      verb: 'colour',
      label: 'Auto colour',
      run: (s) => {
        const { temperature, tint, clamped } = autoColour(s);
        auto.apply(
          'colour',
          { temperature, tint },
          !temperature && !tint
            ? 'already neutral'
            : `auto colour · temperature ${temperature}, tint ${tint}` + (clamped ? ' · as far as the sliders reach' : ''),
        );
      },
    },
    {
      verb: 'bands',
      label: 'Auto bands',
      hint: 'Lift the shadows and pull the highlights down where the picture leans',
      // Nothing to recover still SETS the two bands to zero: a verb that
      // leaves a stale value where it found no reason for one is a nudge.
      run: (s) => {
        const bands = autoBands(s);
        auto.apply(
          'bands',
          { highlights: bands?.highlights ?? 0, shadows: bands?.shadows ?? 0 },
          bands ? `auto bands · ${describeAutoBands(bands)}` : 'nothing to recover',
        );
      },
    },
  ];

  const pickState = auto.state('pick');
  return (
    // One row of verbs: not worth a fold, but drawn with the same header as
    // the foldable sections under it.
    <DevelopFold
      id="auto"
      title="Auto"
      info={
        <>
          <p>{AUTO_HINT}</p>
          <p>{SWITCH_HINT}</p>
        </>
      }
      foldable={false}
    >
      <div className="flex flex-wrap items-center gap-2">
        {verbs.map(({ verb, label, hint, run }) => {
          const state = auto.state(verb);
          return (
            <AutoSwitch
              key={verb}
              state={state}
              disabled={!ready && state === 'off'}
              hint={ready ? hint : notRead}
              onClick={() => toggle(verb, run)}
            >
              {label}
            </AutoSwitch>
          );
        })}
        {onPicking && (
          <AutoSwitch
            state={pickState}
            armed={picking}
            disabled={!ready && pickState === 'off'}
            hint={ready ? 'Click something in the picture that should be grey' : notRead}
            instant
            onClick={() => {
              if (!picking && auto.turnOff('pick')) return;
              onPicking(!picking);
            }}
          >
            {picking ? 'Pick\u2026' : 'Pick grey'}
          </AutoSwitch>
        )}
      </div>
    </DevelopFold>
  );
}

const LEVEL_KEYS = ['inBlack', 'gamma', 'inWhite'] as const;
type LevelKey = (typeof LEVEL_KEYS)[number];

const LEVEL_LABELS: Readonly<Record<LevelKey, string>> = {
  inBlack: 'Black',
  gamma: 'Gamma',
  inWhite: 'White',
};

/**
 * The three numbers Auto tone writes, so they can be seen and moved.
 *
 * The master channel only: per-channel levels exist in the engine but setting
 * them by hand is a white balance done the hard way, and the curve's own R, G
 * and B tabs are the better tool for it.
 */
export function DevelopLevelsSection({
  value,
  onChange,
}: {
  value: Levels | null | undefined;
  onChange: (levels: Levels | null) => void;
}) {
  const level: LevelChannel = value?.rgb ?? { ...NEUTRAL_LEVEL };

  const write = (key: LevelKey, raw: number) => {
    const next: LevelChannel = { ...level, [key]: raw };
    // Black and white may not cross: a range read backwards is a threshold,
    // and `normaliseLevel` would throw the whole channel away.
    if (key === 'inBlack') next.inBlack = Math.min(raw, level.inWhite - 1 / 255);
    if (key === 'inWhite') next.inWhite = Math.max(raw, level.inBlack + 1 / 255);
    const rgb = isNeutralLevel(next) ? null : next;
    const empty = !rgb && !value?.red && !value?.green && !value?.blue;
    onChange(empty ? null : { rgb, red: value?.red ?? null, green: value?.green ?? null, blue: value?.blue ?? null });
  };

  const set = Boolean(value?.rgb || value?.red || value?.green || value?.blue);
  return (
    <DevelopFold id="levels" title="Levels" info={<p>{LEVELS_HINT}</p>} marked={set} defaultOpen={false}>
      {LEVEL_KEYS.map((key) =>
        key === 'gamma' ? (
          <RangeSlider
            key={key}
            label={LEVEL_LABELS[key]}
            value={level.gamma}
            range={{ min: MIN_LEVEL_GAMMA, max: MAX_LEVEL_GAMMA, step: 0.01, unit: '' }}
            reset={1}
            printed={level.gamma.toFixed(2)}
            onChange={(v) => write(key, v)}
          />
        ) : (
          <RangeSlider
            key={key}
            label={LEVEL_LABELS[key]}
            // Shown in the 0..255 codes a photographer reads, stored in [0,1].
            value={Math.round(level[key] * 255)}
            range={{ min: 0, max: 255, step: 1, unit: '' }}
            reset={key === 'inBlack' ? 0 : 255}
            printed={String(Math.round(level[key] * 255))}
            onChange={(v) => write(key, v / 255)}
          />
        ),
      )}
      {!isNeutralLevel(value?.rgb) && (
        <button
          type="button"
          className={`${developLinkClass} self-start`}
          onClick={() =>
            onChange(
              value?.red || value?.green || value?.blue
                ? { rgb: null, red: value.red, green: value.green, blue: value.blue }
                : null,
            )
          }
        >
          Reset levels
        </button>
      )}
    </DevelopFold>
  );
}
