import { describe, expect, it } from 'vitest';
import { createTextElement } from './overlay-types';
import { resolveElementStyle, themeFromPreset, TITLE_STYLE_PRESETS } from './title-styles';
import { canMask, defaultKnockout, glyphsOf, readKnockout, switchKnockout, washFill } from './knockout';

describe('readKnockout', () => {
  it('is none for junk and for a mode this build does not know', () => {
    expect(readKnockout(undefined)).toBeNull();
    expect(readKnockout('wash')).toBeNull();
    expect(readKnockout({ mode: 'stencil', color: '#000000', alpha: 1 })).toBeNull();
  });

  it('keeps a sound knockout exactly', () => {
    const k = { mode: 'wash', color: '#1a2b3c', alpha: 0.5 } as const;
    expect(readKnockout(k)).toEqual(k);
  });

  it('lands a bad colour or strength on the default, and clamps the strength', () => {
    expect(readKnockout({ mode: 'punch', color: 'red', alpha: 'lots' })).toEqual({
      mode: 'punch',
      color: '#100f0d',
      alpha: 0.86,
    });
    expect(readKnockout({ mode: 'wash', color: '#ffffff', alpha: 4 })?.alpha).toBe(1);
    expect(readKnockout({ mode: 'wash', color: '#ffffff', alpha: -1 })?.alpha).toBe(0);
  });

  it('survives what it makes', () => {
    for (const mode of ['wash', 'punch'] as const) {
      expect(readKnockout(defaultKnockout(mode))).toEqual(defaultKnockout(mode));
    }
  });
});

describe('washFill', () => {
  it('is the colour at the wash’s strength', () => {
    expect(washFill({ mode: 'wash', color: '#ff8000', alpha: 0.25 })).toBe('rgba(255,128,0,0.25)');
  });
});

describe('glyphsOf', () => {
  const el = {
    ...createTextElement('Shark Bay'),
    blend: 'multiply' as const,
    knockout: defaultKnockout('wash'),
  };

  it('is the bare letters in one colour, whatever the theme says', () => {
    for (const preset of TITLE_STYLE_PRESETS) {
      const theme = themeFromPreset(preset.id);
      const st = resolveElementStyle(glyphsOf(el, '#123456'), theme);
      expect(st.color).toBe('#123456');
      expect(st.legibility.mode).toBe('none');
      expect(st.glow).toBeNull();
    }
  });

  it('keeps the shape the theme gives the letters, so the hole matches them', () => {
    const preset = TITLE_STYLE_PRESETS.find((p) => p.style.uppercase) ?? TITLE_STYLE_PRESETS[0];
    const theme = themeFromPreset(preset.id);
    const plain = resolveElementStyle(el, theme);
    const glyphs = resolveElementStyle(glyphsOf(el, '#000000'), theme);
    expect([glyphs.fontFamily, glyphs.weight, glyphs.uppercase, glyphs.letterSpacingEm, glyphs.sizeFrac]).toEqual([
      plain.fontFamily,
      plain.weight,
      plain.uppercase,
      plain.letterSpacingEm,
      plain.sizeFrac,
    ]);
  });

  it('is never itself blended or masked', () => {
    const glyphs = glyphsOf(el, '#000000');
    expect(glyphs.blend).toBeUndefined();
    expect(glyphs.knockout).toBeUndefined();
    expect(el.knockout).toEqual(defaultKnockout('wash'));
  });
});

describe('switchKnockout', () => {
  it('is none for off, and the mode’s defaults from nothing', () => {
    expect(switchKnockout(defaultKnockout('wash'), 'off')).toBeUndefined();
    expect(switchKnockout(undefined, 'punch')).toEqual(defaultKnockout('punch'));
  });

  it('keeps the author’s colour across modes, and everything when the mode stays', () => {
    const wash = { mode: 'wash', color: '#224466', alpha: 0.4 } as const;
    expect(switchKnockout(wash, 'wash')).toBe(wash);
    expect(switchKnockout(wash, 'punch')).toEqual({ ...defaultKnockout('punch'), color: '#224466' });
  });
});

describe('canMask', () => {
  it('is words only', () => {
    expect(canMask({ kind: 'text' })).toBe(true);
    expect(canMask({ kind: 'telemetry-field' })).toBe(true);
    expect(canMask({ kind: 'frame-corners' })).toBe(false);
    expect(canMask({ kind: 'battery' })).toBe(false);
  });
});
