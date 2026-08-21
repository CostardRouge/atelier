import { describe, expect, it } from 'vitest';
import {
  PREVIEW_FONT_STACK,
  previewGlowFilter,
  previewTextShadow,
  previewTextStyle,
  type PreviewAppearance,
} from './style-preview';
import { glowLayersFor, TITLE_STYLE_PRESETS } from './title-styles';

function appearance(glowAmount: number): PreviewAppearance {
  const preset = TITLE_STYLE_PRESETS.find((p) => p.id === 'or-cine')!;
  const style = { ...preset.style, glowAmount };
  return {
    ...style,
    glow: glowAmount > 0 ? glowLayersFor(style) : null,
  };
}

describe('previewTextShadow', () => {
  it('paints nothing without glow', () => {
    expect(previewTextShadow(appearance(0))).toBe('none');
  });

  it('paints a bright halo and a warm bleed, in em', () => {
    const shadow = previewTextShadow(appearance(0.5));
    const stops = shadow.split('), ');
    expect(stops).toHaveLength(2);
    expect(shadow).toContain('em rgba(255,255,255,'); // halo keeps to white
    expect(shadow.match(/em/g)).toHaveLength(2); // radii scale with font size
    // The bleed drifts warm: blue collapses against the gold ink.
    const bleed = /rgba\((\d+),(\d+),(\d+),/.exec(stops[1])!;
    expect(Number(bleed[3])).toBeLessThan(Number(bleed[1]));
  });
});

describe('previewGlowFilter', () => {
  it('is undefined without glow, a drop-shadow with it', () => {
    expect(previewGlowFilter(appearance(0))).toBeUndefined();
    expect(previewGlowFilter(appearance(0.5))).toContain('drop-shadow(');
  });
});

describe('previewTextStyle', () => {
  it('maps the canvas family to a CSS stack and carries the size through', () => {
    const style = previewTextStyle(appearance(0), '0.62rem');
    expect(style.fontFamily).toBe(PREVIEW_FONT_STACK['Instrument Serif']);
    expect(style.fontSize).toBe('0.62rem');
    expect(style.textTransform).toBe('none');
  });
});
