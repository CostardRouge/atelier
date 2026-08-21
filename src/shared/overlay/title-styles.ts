/**
 * Title styles — the appearance system agreed with the maintainer
 * (docs/memory/studio.md): a named PRESET is adopted as a project THEME
 * (possibly tweaked), and each element may OVERRIDE individual properties.
 *
 * The theme carries appearance only — font, weight, italic, case, colour,
 * letter-spacing, legibility, glow — never geometry (position, anchor, bound
 * field, text). Size is a *multiplier* over the element's own size, so
 * switching themes never explodes a layout.
 *
 * The film glow (the “bave”) is one 0..1 amount driving four layers
 * proportionally — softened core, tight bright halo, wide warm-drifting
 * bleed, animated grain — the digital reconstruction of optical-era halation.
 * An advanced per-layer override rides on top for fine tuning.
 *
 * Pure and DOM-free; the canvas work lives in draw-overlays.ts.
 */

import type {
  FontWeight,
  LegibilityStyle,
  OverlayElement,
  OverlayFontFamily,
} from './overlay-types';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** The four glow layers, as fractions of the font size (alpha 0..1). */
export interface GlowLayers {
  /** Softness of the letter body itself (blur radius / font size). */
  coreBlurFrac: number;
  /** Tight bright halo hugging the strokes. */
  haloRadiusFrac: number;
  haloAlpha: number;
  /** Wide bleed contaminating the image around. */
  bleedRadiusFrac: number;
  bleedAlpha: number;
  /** Animated grain biting the glow region. */
  grainAlpha: number;
}

export interface TitleStyle {
  fontFamily: OverlayFontFamily;
  weight: FontWeight;
  italic: boolean;
  uppercase: boolean;
  /** Extra letter spacing in em (fraction of font size); 0 = font default. */
  letterSpacingEm: number;
  color: string;
  /** Multiplier over each element's own sizeFrac — never an absolute size. */
  sizeScale: number;
  legibility: LegibilityStyle;
  /** The one “bave” slider, 0 (matte) .. 1 (fluo). */
  glowAmount: number;
  /** 0 = halo keeps the ink's hue, 1 = strong warm (orange) drift. */
  glowWarmth: number;
  /** Advanced per-layer tuning; merged over the amount-derived layers. */
  glowLayers?: Partial<GlowLayers>;
}

export interface TitleStylePreset {
  id: string;
  /** Product name, shown as-is ("Or ciné" — the maintainer's branding). */
  name: string;
  /** One-line character description for the picker. */
  tagline: string;
  style: TitleStyle;
}

/** A project's theme: the preset it started from plus the user's tweaks. */
export interface StyleTheme {
  presetId: string;
  style: TitleStyle;
}

/** Appearance keys an element can override individually. */
export type ThemableKey =
  | 'fontFamily'
  | 'weight'
  | 'italic'
  | 'color'
  | 'legibility'
  | 'uppercase'
  | 'letterSpacing'
  | 'glow';

// ---------------------------------------------------------------------------
// Glow maths
// ---------------------------------------------------------------------------

const NO_GLOW: GlowLayers = {
  coreBlurFrac: 0,
  haloRadiusFrac: 0,
  haloAlpha: 0,
  bleedRadiusFrac: 0,
  bleedAlpha: 0,
  grainAlpha: 0,
};

/**
 * Map the single amount to the four layers, proportionally. At 0 everything is
 * off; 0.3 ≈ the muted gold title card; 0.8+ ≈ the fluorescent CRT cards.
 * Advanced overrides are merged last.
 */
export function glowLayersFor(style: TitleStyle): GlowLayers {
  const a = Math.max(0, Math.min(1, style.glowAmount));
  const base: GlowLayers =
    a === 0
      ? { ...NO_GLOW }
      : {
          coreBlurFrac: a * 0.035,
          haloRadiusFrac: a * 0.12,
          haloAlpha: Math.min(1, 0.35 + a * 0.6),
          bleedRadiusFrac: a * 0.6,
          bleedAlpha: 0.08 + a * 0.3,
          grainAlpha: a * 0.12,
        };
  return { ...base, ...style.glowLayers };
}

// ---------------------------------------------------------------------------
// Colour helpers (hex in, css colours out)
// ---------------------------------------------------------------------------

/** `#rgb`/`#rrggbb` → [r,g,b] 0..255; null for anything else. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (m3) {
    return [
      parseInt(m3[1] + m3[1], 16),
      parseInt(m3[2] + m3[2], 16),
      parseInt(m3[3] + m3[3], 16),
    ];
  }
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m6) return null;
  return [parseInt(m6[1], 16), parseInt(m6[2], 16), parseInt(m6[3], 16)];
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * Drift a colour toward warm halation (film print orange) by `warmth` 0..1:
 * red is preserved, green gains a little, blue collapses. On a pure red this
 * yields the rosy-orange rim of the reference cards; on gold, the amber bleed.
 */
export function warmDrift(color: string, warmth: number): [number, number, number] {
  const rgb = hexToRgb(color) ?? [255, 255, 255];
  const w = Math.max(0, Math.min(1, warmth));
  const [r, g, b] = rgb;
  return [
    clamp255(r + (255 - r) * w * 0.25),
    clamp255(g + (Math.max(g, 140) - g) * w * 0.5),
    clamp255(b * (1 - w * 0.75)),
  ];
}

/** `rgba()` string from a hex colour and an alpha. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color) ?? [255, 255, 255];
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

/** Brightened version of the ink for the tight halo (toward white). */
export function halolight(color: string, alpha: number): string {
  const rgb = hexToRgb(color) ?? [255, 255, 255];
  const [r, g, b] = rgb.map((c) => clamp255(c + (255 - c) * 0.55));
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
// Cascade resolution
// ---------------------------------------------------------------------------

/** What the renderer needs, after preset → theme → override resolution. */
export interface ResolvedStyle {
  fontFamily: OverlayFontFamily;
  weight: FontWeight;
  italic: boolean;
  color: string;
  legibility: LegibilityStyle;
  uppercase: boolean;
  letterSpacingEm: number;
  /** Effective size fraction (element size × theme multiplier). */
  sizeFrac: number;
  /** Fully-derived glow layers, or null when there is no glow at all. */
  glow: GlowLayers | null;
  glowWarmth: number;
}

function overridden(el: OverlayElement, key: ThemableKey): boolean {
  return el.styleOverrides?.includes(key) ?? false;
}

/**
 * Resolve an element's appearance under a theme.
 *
 * - No theme (legacy pages, themeless projects): the element's own concrete
 *   values, exactly as before themes existed.
 * - Theme active: the theme's values, except for keys the element overrides.
 *   Elements saved before themes existed carry no `styleOverrides`, which
 *   reads as "fully themed" — adopting a theme restyles the whole deck, the
 *   agreed behaviour.
 */
export function resolveElementStyle(
  el: OverlayElement,
  theme: StyleTheme | null | undefined,
): ResolvedStyle {
  if (!theme) {
    const amount = el.glowAmount ?? 0;
    const style = el.glowWarmth;
    return {
      fontFamily: el.fontFamily,
      weight: el.weight,
      italic: el.italic,
      color: el.color,
      legibility: el.legibility,
      uppercase: el.uppercase ?? false,
      letterSpacingEm: el.letterSpacingEm ?? 0,
      sizeFrac: el.sizeFrac,
      glow:
        amount > 0
          ? glowLayersFor({
              ...FALLBACK_STYLE,
              glowAmount: amount,
              glowWarmth: style ?? 0.5,
            })
          : null,
      glowWarmth: style ?? 0.5,
    };
  }

  const t = theme.style;
  const glowAmount = overridden(el, 'glow') ? (el.glowAmount ?? 0) : t.glowAmount;
  const glowWarmth = overridden(el, 'glow')
    ? (el.glowWarmth ?? 0.5)
    : t.glowWarmth;
  const glowStyle: TitleStyle = { ...t, glowAmount, glowWarmth };
  return {
    fontFamily: overridden(el, 'fontFamily') ? el.fontFamily : t.fontFamily,
    weight: overridden(el, 'weight') ? el.weight : t.weight,
    italic: overridden(el, 'italic') ? el.italic : t.italic,
    color: overridden(el, 'color') ? el.color : t.color,
    legibility: overridden(el, 'legibility') ? el.legibility : t.legibility,
    uppercase: overridden(el, 'uppercase') ? (el.uppercase ?? false) : t.uppercase,
    letterSpacingEm: overridden(el, 'letterSpacing')
      ? (el.letterSpacingEm ?? 0)
      : t.letterSpacingEm,
    sizeFrac: el.sizeFrac * t.sizeScale,
    glow: glowAmount > 0 ? glowLayersFor(glowStyle) : null,
    glowWarmth,
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const FALLBACK_STYLE: TitleStyle = {
  fontFamily: 'Space Grotesk',
  weight: 600,
  italic: false,
  uppercase: false,
  letterSpacingEm: 0,
  color: '#ffffff',
  sizeScale: 1,
  legibility: { mode: 'shadow', color: 'rgba(0,0,0,0.65)', padFrac: 0.3 },
  glowAmount: 0,
  glowWarmth: 0.5,
};

/**
 * The built-in looks. "Neutral" is the themeless default made explicit; the
 * three signature presets come straight from the maintainer's reference
 * imagery (gold optical-print credits, CRT phosphor data cards, full-bleed
 * red statements).
 */
export const TITLE_STYLE_PRESETS: readonly TitleStylePreset[] = [
  {
    id: 'neutral',
    name: 'Neutral',
    tagline: 'Clean readouts, drop shadow, no glow',
    style: { ...FALLBACK_STYLE },
  },
  {
    id: 'or-cine',
    name: 'Or ciné',
    tagline: 'Optical-print gold serif, muted halation',
    style: {
      fontFamily: 'Instrument Serif',
      weight: 400,
      italic: false,
      uppercase: false,
      letterSpacingEm: 0.01,
      color: '#f2c230',
      sizeScale: 1,
      legibility: { mode: 'none', color: 'rgba(0,0,0,0.65)', padFrac: 0.3 },
      glowAmount: 0.35,
      glowWarmth: 0.7,
    },
  },
  {
    id: 'pixel-crt',
    name: 'Pixel CRT',
    tagline: 'Terminal red on phosphor, fluo bleed',
    style: {
      fontFamily: 'VT323',
      weight: 400,
      italic: false,
      uppercase: false,
      letterSpacingEm: 0.02,
      color: '#e02015',
      sizeScale: 1.15,
      legibility: { mode: 'none', color: 'rgba(0,0,0,0.65)', padFrac: 0.3 },
      glowAmount: 0.75,
      glowWarmth: 0.35,
    },
  },
  {
    id: 'plein-cadre',
    name: 'Rouge plein cadre',
    tagline: 'Flat saturated caps, no glow, full confidence',
    style: {
      fontFamily: 'Space Grotesk',
      weight: 700,
      italic: false,
      uppercase: true,
      letterSpacingEm: -0.01,
      color: '#f01d0e',
      sizeScale: 1,
      legibility: { mode: 'none', color: 'rgba(0,0,0,0.65)', padFrac: 0.3 },
      glowAmount: 0.08,
      glowWarmth: 0.5,
    },
  },
];

export function presetById(id: string): TitleStylePreset | undefined {
  return TITLE_STYLE_PRESETS.find((p) => p.id === id);
}

/** A fresh theme adopting `presetId` (deep-copied so tweaks never mutate it). */
export function themeFromPreset(presetId: string): StyleTheme | null {
  const preset = presetById(presetId);
  if (!preset) return null;
  return { presetId, style: structuredClone(preset.style) };
}
