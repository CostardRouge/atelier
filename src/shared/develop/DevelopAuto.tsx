import SectionLegend from '../ui/SectionLegend';
import { autoColour, autoTone, describeAutoTone, type SourceStats } from './auto-develop';
import { developButtonClass, developLinkClass } from './develop-classes';
import { RangeSlider } from './DevelopSliders';
import {
  MAX_LEVEL_GAMMA,
  MIN_LEVEL_GAMMA,
  NEUTRAL_LEVEL,
  isNeutralLevel,
  type LevelChannel,
  type Levels,
} from './curves';
import type { DevelopSettings } from './develop';

const AUTO_HINT =
  'Tone reads where the picture’s light actually sits and writes a black point, a white point and a midtone gamma into Levels — it touches no colour. Colour neutralises the average cast by white balance, which is the wrong answer on a sunset or a candle-lit room, so it is a second button and never rides along with the first. Both are measured on the picture as shot, so pressing one twice gives the same answer rather than compounding.';

const LEVELS_HINT =
  'Where the range is read FROM: everything at or under black becomes black, everything at or over white becomes white, and gamma bends what is between them. Auto tone writes these three; the curve’s own end points do the same thing by hand.';

/**
 * Auto — two buttons, deliberately not one.
 *
 * Splitting tone from colour is the whole design: a stretch is almost always
 * an improvement, and a white balance is often exactly wrong, so they must not
 * share a click. The maths and the reasons are in `auto-develop.ts`.
 */
export function DevelopAutoSection({
  stats,
  onPatch,
  onTold,
}: {
  stats: SourceStats | null;
  onPatch: (partial: Partial<DevelopSettings>) => void;
  onTold: (message: string) => void;
}) {
  const ready = Boolean(stats && stats.total > 0);
  return (
    <div className="flex flex-col gap-2">
      <SectionLegend label="Auto">
        <p>{AUTO_HINT}</p>
      </SectionLegend>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={developButtonClass}
          disabled={!ready}
          title={ready ? undefined : 'the picture has not been read yet'}
          onClick={() => {
            if (!stats) return;
            const levels = autoTone(stats);
            onPatch({ levels });
            onTold(levels ? `auto tone · ${describeAutoTone(levels)}` : 'nothing to stretch');
          }}
        >
          Auto tone
        </button>
        <button
          type="button"
          className={developButtonClass}
          disabled={!ready}
          title={ready ? undefined : 'the picture has not been read yet'}
          onClick={() => {
            if (!stats) return;
            const { temperature, tint, clamped } = autoColour(stats);
            onPatch({ temperature, tint });
            if (!temperature && !tint) onTold('already neutral');
            else
              onTold(
                `auto colour · temperature ${temperature}, tint ${tint}` +
                  (clamped ? ' · as far as the sliders reach' : ''),
              );
          }}
        >
          Auto colour
        </button>
      </div>
    </div>
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

  return (
    <div className="flex flex-col gap-2">
      <SectionLegend label="Levels">
        <p>{LEVELS_HINT}</p>
      </SectionLegend>
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
    </div>
  );
}
