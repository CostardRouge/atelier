import { describe, expect, it } from 'vitest';
import { resolveElementStyle, themeFromPreset } from '../../overlay/title-styles';
import { lookElement } from './look-text';

const GOLD = themeFromPreset('or-cine');

describe('a string in the look', () => {
  it('takes the theme’s face, colour and glow where it carries no ink of its own', () => {
    const el = lookElement({ id: 'card:title', text: 'Australia', px: 54, x: 540, y: 960 }, 1080, 1920);
    expect(el.sizeFrac).toBeCloseTo(54 / 1080, 9);
    expect(el.x).toBeCloseTo(0.5, 9);
    expect(el.y).toBeCloseTo(0.5, 9);
    const st = resolveElementStyle(el, GOLD);
    expect(st.fontFamily).toBe('Instrument Serif');
    expect(st.color).toBe('#f2c230');
    expect(st.glow).not.toBeNull();
  });

  it('on the map’s paper keeps the face and the case, and takes the map’s ink with no glow', () => {
    const el = lookElement({ id: 'card:n', text: '41', px: 40, x: 0, y: 0, ink: '#3a332a' }, 1080, 1920);
    const st = resolveElementStyle(el, GOLD);
    expect(st.fontFamily).toBe('Instrument Serif');
    expect(st.color).toBe('#3a332a');
    expect(st.glow).toBeNull();
    expect(st.legibility.mode).toBe('none');
  });

  it('fades through the engine’s own entrance, so the engine’s alpha is the string’s', () => {
    expect(lookElement({ id: 'a', text: 'x', px: 10, x: 0, y: 0 }, 100, 100).animation).toBeUndefined();
    const half = lookElement({ id: 'a', text: 'x', px: 10, x: 0, y: 0, alpha: 0.5 }, 100, 100);
    expect(half.animation?.in).toMatchObject({ preset: 'fade', duration: 1, easing: 'linear' });
    expect(half.window).toEqual({ start: 0, end: null });
  });
});
