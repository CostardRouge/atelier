import { CURATED_FONTS, type FontWeight } from './overlay-types';
import {
  glowLayersFor,
  themeFromPreset,
  TITLE_STYLE_PRESETS,
  type GlowLayers,
  type StyleTheme,
  type TitleStyle,
} from './title-styles';
import { previewTextStyle } from './style-preview';
import { useState, type ReactNode } from 'react';
import IconButton from '../ui/IconButton';
import { FieldRow, RangeField, Readout, SelectField, ToggleField } from '../ui/Inspector';
import { Icons } from '../ui/icons';

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
  /**
   * What sits above the preset cards. Omitted, it is the panel's own "Style"
   * legend; a consumer that already titles the section (Road Trip's Look tab
   * says whose style it is) passes its own so the two do not stack.
   */
  heading?: ReactNode;
}

const labelClass =
  'font-mono text-2xs tracking-[0.12em] uppercase text-muted';

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
export default function StylePanel({ theme, onChange, heading }: StylePanelProps) {
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
        {heading ?? <span className={labelClass}>Style</span>}
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`px-3 py-2 rounded-paper border text-left cursor-pointer text-xs transition-colors ${
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
                className="flex-none w-[4.6rem] h-[2.2rem] grid place-items-center rounded-[4px] bg-frame overflow-hidden"
                aria-hidden="true"
              >
                <span style={cardStyle(p.style)}>Alt 87m</span>
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-sm">{p.name}</span>
                <span className="block text-2xs text-muted truncate">
                  {p.tagline}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {theme && (
        <div className="flex flex-col gap-2.5">
          {/* The bave slider: one amount drives the four glow layers. */}
          <FieldRow label="Glow" hint="Matte → fluo.">
            <RangeField
              label="Glow"
              min={0}
              max={1}
              step={0.01}
              value={theme.style.glowAmount}
              onChange={(glowAmount) => patchStyle({ glowAmount })}
              format={(v) => `${Math.round(v * 100)}`}
            />
          </FieldRow>
          <FieldRow label="Warmth" hint="Halation drift.">
            <RangeField
              label="Warmth"
              min={0}
              max={1}
              step={0.05}
              value={theme.style.glowWarmth}
              onChange={(glowWarmth) => patchStyle({ glowWarmth })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
          <FieldRow label="Ink">
            <input
              type="color"
              className="flex-none w-8 h-8 p-0 border border-line-strong rounded-[7px] bg-surface cursor-pointer"
              value={theme.style.color}
              onChange={(e) => patchStyle({ color: e.target.value })}
              aria-label="Ink"
            />
            <Readout muted>{theme.style.color}</Readout>
          </FieldRow>
          <FieldRow label="Font">
            <SelectField
              label="Font"
              value={theme.style.fontFamily}
              onChange={(fontFamily) => patchStyle({ fontFamily })}
              options={CURATED_FONTS.map((f) => ({ id: f, label: f }))}
            />
          </FieldRow>
          <FieldRow label="Weight">
            <SelectField
              label="Weight"
              value={String(theme.style.weight)}
              onChange={(w) => patchStyle({ weight: Number(w) as FontWeight })}
              options={WEIGHTS.map((w) => ({ id: String(w.value), label: w.label }))}
            />
          </FieldRow>
          <FieldRow label="Emphasis">
            <ToggleField
              label="Italic"
              checked={theme.style.italic}
              onChange={(italic) => patchStyle({ italic })}
            >
              <span className="italic font-serif">Italic</span>
            </ToggleField>
            <ToggleField
              label="Uppercase"
              checked={theme.style.uppercase}
              onChange={(uppercase) => patchStyle({ uppercase })}
            >
              AA
            </ToggleField>
          </FieldRow>
          <FieldRow label="Spacing">
            <RangeField
              label="Letter spacing"
              min={-0.05}
              max={0.2}
              step={0.005}
              value={theme.style.letterSpacingEm}
              onChange={(letterSpacingEm) => patchStyle({ letterSpacingEm })}
              format={(v) => (v * 100).toFixed(0)}
            />
          </FieldRow>
          <FieldRow label="Size">
            <RangeField
              label="Size scale"
              min={0.5}
              max={2}
              step={0.05}
              value={theme.style.sizeScale}
              onChange={(sizeScale) => patchStyle({ sizeScale })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
          <FieldRow label="Legibility">
            <SelectField
              label="Legibility"
              value={theme.style.legibility.mode}
              onChange={(mode) =>
                patchStyle({ legibility: { ...theme.style.legibility, mode } })
              }
              options={[
                { id: 'none', label: 'None' },
                { id: 'shadow', label: 'Drop shadow' },
                { id: 'box', label: 'Background box' },
              ]}
            />
          </FieldRow>

          {/* Advanced: the four layers, hand-tuned. */}
          <FieldRow label="Glow layers">
            <ToggleField label="Show the four glow layers" checked={advanced} onChange={setAdvanced}>
              Tune by hand
            </ToggleField>
          </FieldRow>
          {advanced && layers && derived && (
            <>
              {ADVANCED_FIELDS.map((f) => (
                <FieldRow key={f.key} label={f.label}>
                  <RangeField
                    label={f.label}
                    min={0}
                    max={f.max}
                    step={f.step}
                    value={layers[f.key]}
                    onChange={(v) =>
                      patchStyle({ glowLayers: { ...theme.style.glowLayers, [f.key]: v } })
                    }
                    format={(v) => v.toFixed(3)}
                  />
                  {theme.style.glowLayers?.[f.key] != null && (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label="Back to the slider-derived value"
                      onClick={() => {
                        const rest = { ...theme.style.glowLayers };
                        delete rest[f.key];
                        patchStyle({ glowLayers: Object.keys(rest).length ? rest : undefined });
                      }}
                    >
                      {Icons.reset}
                    </IconButton>
                  )}
                </FieldRow>
              ))}
              <p className="m-0 text-xs text-muted leading-relaxed">
                Layers follow the glow slider until you touch one; the reset hands a layer back
                to the slider.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
