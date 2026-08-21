import { describe, expect, it } from 'vitest';
import {
  glowLayersFor,
  hexToRgb,
  presetById,
  resolveElementStyle,
  themeFromPreset,
  TITLE_STYLE_PRESETS,
  warmDrift,
  type TitleStyle,
} from './title-styles';
import { CURATED_FONTS, createTextElement } from './overlay-types';

const baseStyle = (over: Partial<TitleStyle> = {}): TitleStyle => ({
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
  ...over,
});

describe('presets', () => {
  it('have unique ids and only curated fonts', () => {
    const ids = TITLE_STYLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of TITLE_STYLE_PRESETS) {
      expect(CURATED_FONTS).toContain(p.style.fontFamily);
    }
  });

  it('include the three signature looks plus neutral', () => {
    for (const id of ['neutral', 'or-cine', 'pixel-crt', 'plein-cadre']) {
      expect(presetById(id)).toBeDefined();
    }
  });

  it('themeFromPreset deep-copies so tweaks never touch the preset', () => {
    const theme = themeFromPreset('or-cine')!;
    theme.style.color = '#000000';
    expect(presetById('or-cine')!.style.color).not.toBe('#000000');
  });
});

describe('glowLayersFor', () => {
  it('is fully off at amount 0', () => {
    const g = glowLayersFor(baseStyle({ glowAmount: 0 }));
    expect(g.haloAlpha).toBe(0);
    expect(g.bleedRadiusFrac).toBe(0);
    expect(g.grainAlpha).toBe(0);
  });

  it('grows every layer with the amount', () => {
    const low = glowLayersFor(baseStyle({ glowAmount: 0.2 }));
    const high = glowLayersFor(baseStyle({ glowAmount: 0.9 }));
    expect(high.bleedRadiusFrac).toBeGreaterThan(low.bleedRadiusFrac);
    expect(high.haloRadiusFrac).toBeGreaterThan(low.haloRadiusFrac);
    expect(high.grainAlpha).toBeGreaterThan(low.grainAlpha);
  });

  it('lets the advanced per-layer override win', () => {
    const g = glowLayersFor(
      baseStyle({ glowAmount: 0.5, glowLayers: { bleedRadiusFrac: 2 } }),
    );
    expect(g.bleedRadiusFrac).toBe(2);
    expect(g.haloRadiusFrac).toBeGreaterThan(0); // others still derived
  });
});

describe('colour helpers', () => {
  it('parses #rgb and #rrggbb', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('#f01d0e')).toEqual([240, 29, 14]);
    expect(hexToRgb('not-a-colour')).toBeNull();
  });

  it('warm drift collapses blue and never exceeds channel bounds', () => {
    const [r, g, b] = warmDrift('#f01d0e', 1);
    expect(b).toBeLessThan(14);
    expect(r).toBeGreaterThanOrEqual(240);
    expect(g).toBeLessThanOrEqual(255);
    // zero warmth = identity
    expect(warmDrift('#f01d0e', 0)).toEqual([240, 29, 14]);
  });
});

describe('resolveElementStyle', () => {
  it('without a theme, uses the element exactly as before themes existed', () => {
    const el = createTextElement('hello');
    el.color = '#123456';
    const st = resolveElementStyle(el, null);
    expect(st.color).toBe('#123456');
    expect(st.sizeFrac).toBe(el.sizeFrac);
    expect(st.glow).toBeNull();
    expect(st.uppercase).toBe(false);
  });

  it('under a theme, an element with no overrides is fully themed', () => {
    const theme = themeFromPreset('pixel-crt')!;
    const el = createTextElement('hello');
    const st = resolveElementStyle(el, theme);
    expect(st.fontFamily).toBe('VT323');
    expect(st.color).toBe(theme.style.color);
    expect(st.glow).not.toBeNull();
  });

  it('an overridden key keeps the element value; others stay themed', () => {
    const theme = themeFromPreset('pixel-crt')!;
    const el = createTextElement('hello');
    el.color = '#00ff00';
    el.styleOverrides = ['color'];
    const st = resolveElementStyle(el, theme);
    expect(st.color).toBe('#00ff00');
    expect(st.fontFamily).toBe('VT323');
  });

  it('the theme size is a multiplier over the element size, never absolute', () => {
    const theme = themeFromPreset('pixel-crt')!; // sizeScale 1.15
    const el = createTextElement('hello');
    el.sizeFrac = 0.04;
    const st = resolveElementStyle(el, theme);
    expect(st.sizeFrac).toBeCloseTo(0.04 * 1.15, 6);
  });

  it('uppercase and letter spacing resolve from the theme', () => {
    const theme = themeFromPreset('plein-cadre')!;
    const el = createTextElement('hello');
    const st = resolveElementStyle(el, theme);
    expect(st.uppercase).toBe(true);
    expect(st.letterSpacingEm).toBeCloseTo(-0.01, 6);
  });

  it('a glow override at 0 kills the theme glow for that element', () => {
    const theme = themeFromPreset('pixel-crt')!;
    const el = createTextElement('hello');
    el.styleOverrides = ['glow'];
    el.glowAmount = 0;
    const st = resolveElementStyle(el, theme);
    expect(st.glow).toBeNull();
  });
});
