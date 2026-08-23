import {
  CURATED_FONTS,
  type FontWeight,
  type OverlayFontFamily,
} from './overlay-types';
import {
  glowLayersFor,
  themeFromPreset,
  TITLE_STYLE_PRESETS,
  type GlowLayers,
  type StyleTheme,
  type TitleStyle,
} from './title-styles';
import { previewTextStyle } from './style-preview';
import { useState } from 'react';

/**
 * The title-style picker: preset cards, then the theme's own knobs (font,
 * weight, case, colour, letter-spacing, legibility, the one glow slider and
 * its advanced per-layer disclosure).
 *
 * It lives in the shared engine rather than in the studio because more than
 * one tool adopts a theme now — Road Trip's day badge wears one too, and
 * `shared/` never imports `tools/`, so a second consumer meant moving the
 * generic half out rather than reaching across tools. Same move the element
 * list and the guides control already made.
 */
interface StylePanelProps {
  theme: StyleTheme | null;
  onChange: (theme: StyleTheme | null) => void;
}

const labelClass =
  'font-mono text-[0.62rem] tracking-[0.12em] uppercase text-muted';
const inputClass =
  'font-sans text-[0.82rem] text-ink bg-surface border border-line-strong rounded-paper px-[0.6rem] py-[0.4rem] w-full';

const WEIGHTS: { value: FontWeight; label: string }[] = [
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semibold' },
  { value: 700, label: 'Bold' },
];

/** A preset card's inline style — the same DOM approximation the palette uses. */
function cardStyle(style: TitleStyle) {
  return previewTextStyle(
    { ...style, glow: style.glowAmount > 0 ? glowLayersFor(style) : null },
    '0.95rem',
  );
}

const ADVANCED_FIELDS: Array<{
  key: keyof GlowLayers;
  label: string;
  max: number;
  step: number;
}> = [
  { key: 'coreBlurFrac', label: 'Core softness', max: 0.1, step: 0.005 },
  { key: 'haloRadiusFrac', label: 'Halo radius', max: 0.4, step: 0.01 },
  { key: 'haloAlpha', label: 'Halo strength', max: 1, step: 0.05 },
  { key: 'bleedRadiusFrac', label: 'Bleed radius', max: 1.5, step: 0.05 },
  { key: 'bleedAlpha', label: 'Bleed strength', max: 1, step: 0.05 },
  { key: 'grainAlpha', label: 'Grain', max: 0.3, step: 0.01 },
];

/**
 * The project's title style: adopt a preset as the theme, then tweak it — the
 * one "bave" slider drives the four glow layers proportionally, with a
 * per-layer advanced disclosure for the fine hand. Elements follow the theme
 * unless they override a property (see ElementPanel).
 */
export default function StylePanel({ theme, onChange }: StylePanelProps) {
  const [advanced, setAdvanced] = useState(false);

  function patchStyle(patch: Partial<StyleTheme['style']>) {
    if (!theme) return;
    onChange({ ...theme, style: { ...theme.style, ...patch } });
  }

  const derived = theme ? glowLayersFor({ ...theme.style, glowLayers: undefined }) : null;
  const layers = theme ? glowLayersFor(theme.style) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Preset cards */}
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Style</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`px-3 py-2 rounded-paper border text-left cursor-pointer text-[0.8rem] transition-colors ${
            theme === null
              ? 'border-accent bg-accent-wash'
              : 'border-line bg-paper hover:border-line-strong'
          }`}
          aria-pressed={theme === null}
        >
          Off — each element keeps its own style
        </button>
        {TITLE_STYLE_PRESETS.map((p) => {
          const active = theme?.presetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(themeFromPreset(p.id))}
              className={`flex items-center gap-3 px-3 py-2 rounded-paper border text-left cursor-pointer transition-colors ${
                active
                  ? 'border-accent bg-accent-wash'
                  : 'border-line bg-paper hover:border-line-strong'
              }`}
              aria-pressed={active}
            >
              <span
                className="flex-none w-[4.6rem] h-[2.2rem] grid place-items-center rounded-[4px] bg-[#141210] overflow-hidden"
                aria-hidden="true"
              >
                <span style={cardStyle(p.style)}>Alt 87m</span>
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-[0.82rem]">{p.name}</span>
                <span className="block text-[0.68rem] text-muted truncate">
                  {p.tagline}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {theme && (
        <>
          {/* The bave slider */}
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              Glow · {Math.round(theme.style.glowAmount * 100)}
              <span className="normal-case tracking-normal">
                {' '}
                — matte → fluo
              </span>
            </span>
            <input
              type="range"
              className="w-full accent-accent cursor-pointer"
              min={0}
              max={1}
              step={0.01}
              value={theme.style.glowAmount}
              onChange={(e) => patchStyle({ glowAmount: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              Warmth · {Math.round(theme.style.glowWarmth * 100)}% — halation drift
            </span>
            <input
              type="range"
              className="w-full accent-accent cursor-pointer"
              min={0}
              max={1}
              step={0.05}
              value={theme.style.glowWarmth}
              onChange={(e) => patchStyle({ glowWarmth: Number(e.target.value) })}
            />
          </label>

          {/* Theme ink */}
          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Ink</span>
              <input
                type="color"
                className="w-12 h-9 p-0 border border-line-strong rounded-paper bg-surface cursor-pointer"
                value={theme.style.color}
                onChange={(e) => patchStyle({ color: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 flex-1">
              <span className={labelClass}>Font</span>
              <select
                className={`${inputClass} cursor-pointer`}
                value={theme.style.fontFamily}
                onChange={(e) =>
                  patchStyle({ fontFamily: e.target.value as OverlayFontFamily })
                }
              >
                {CURATED_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1 flex-1">
              <span className={labelClass}>Weight</span>
              <select
                className={`${inputClass} cursor-pointer`}
                value={theme.style.weight}
                onChange={(e) =>
                  patchStyle({ weight: Number(e.target.value) as FontWeight })
                }
              >
                {WEIGHTS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="flex-none h-9 px-3 border border-line-strong rounded-paper bg-paper text-ink-soft cursor-pointer italic font-serif text-[0.95rem] aria-pressed:border-accent aria-pressed:text-accent-ink"
              aria-pressed={theme.style.italic}
              onClick={() => patchStyle({ italic: !theme.style.italic })}
              title="Italic"
            >
              I
            </button>
            <button
              type="button"
              className="flex-none h-9 px-3 border border-line-strong rounded-paper bg-paper text-ink-soft cursor-pointer font-semibold text-[0.8rem] aria-pressed:border-accent aria-pressed:text-accent-ink"
              aria-pressed={theme.style.uppercase}
              onClick={() => patchStyle({ uppercase: !theme.style.uppercase })}
              title="Uppercase"
            >
              AA
            </button>
          </div>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              Letter spacing · {(theme.style.letterSpacingEm * 100).toFixed(0)}
            </span>
            <input
              type="range"
              className="w-full accent-accent cursor-pointer"
              min={-0.05}
              max={0.2}
              step={0.005}
              value={theme.style.letterSpacingEm}
              onChange={(e) =>
                patchStyle({ letterSpacingEm: Number(e.target.value) })
              }
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              Size scale · {Math.round(theme.style.sizeScale * 100)}%
            </span>
            <input
              type="range"
              className="w-full accent-accent cursor-pointer"
              min={0.5}
              max={2}
              step={0.05}
              value={theme.style.sizeScale}
              onChange={(e) => patchStyle({ sizeScale: Number(e.target.value) })}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Legibility</span>
            <select
              className={`${inputClass} cursor-pointer`}
              value={theme.style.legibility.mode}
              onChange={(e) =>
                patchStyle({
                  legibility: {
                    ...theme.style.legibility,
                    mode: e.target.value as StyleTheme['style']['legibility']['mode'],
                  },
                })
              }
            >
              <option value="none">None</option>
              <option value="shadow">Drop shadow</option>
              <option value="box">Background box</option>
            </select>
          </label>

          {/* Advanced: the four layers, hand-tuned */}
          <div className="flex flex-col gap-2 pt-2 border-t border-line">
            <button
              type="button"
              className="self-start p-0 border-0 bg-transparent text-[0.72rem] text-muted cursor-pointer underline underline-offset-[2px] hover:text-accent-ink"
              onClick={() => setAdvanced((a) => !a)}
              aria-expanded={advanced}
            >
              {advanced ? 'Hide' : 'Show'} the four glow layers
            </button>
            {advanced && layers && derived && (
              <div className="flex flex-col gap-2">
                {ADVANCED_FIELDS.map((f) => (
                  <label key={f.key} className="flex flex-col gap-1">
                    <span className={labelClass}>
                      {f.label} · {layers[f.key].toFixed(3)}
                      {theme.style.glowLayers?.[f.key] != null && (
                        <button
                          type="button"
                          className="ml-1.5 p-0 border-0 bg-transparent text-accent cursor-pointer text-[0.72rem]"
                          title="Back to the slider-derived value"
                          onClick={() => {
                            const rest = { ...theme.style.glowLayers };
                            delete rest[f.key];
                            patchStyle({
                              glowLayers: Object.keys(rest).length ? rest : undefined,
                            });
                          }}
                        >
                          ↺
                        </button>
                      )}
                    </span>
                    <input
                      type="range"
                      className="w-full accent-accent cursor-pointer"
                      min={0}
                      max={f.max}
                      step={f.step}
                      value={layers[f.key]}
                      onChange={(e) =>
                        patchStyle({
                          glowLayers: {
                            ...theme.style.glowLayers,
                            [f.key]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
                <p className="m-0 text-[0.68rem] text-faint leading-relaxed">
                  Layers follow the glow slider until you touch one; ↺ hands a
                  layer back to the slider.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
