import { describe, expect, it } from 'vitest';
import { themeFromPreset } from './title-styles';
import { readStyleFile, styleFileName, styleFileText } from './style-file';

describe('a badge style as a file', () => {
  it('writes a look and reads it back, the piece styles with it', () => {
    const theme = themeFromPreset('or-cine')!;
    const text = styleFileText({ theme, pieceStyles: { counter: { boxColor: '#2f4fbf', textCase: 'upper' } } });
    const read = readStyleFile(text)!;
    expect(read.theme).toEqual(theme);
    expect(read.pieceStyles).toEqual({ counter: { boxColor: '#2f4fbf', textCase: 'upper' } });
    expect(styleFileName(theme)).toBe('or-cine.badge.json');
  });

  it('keeps a field of the right kind only, and refuses what is not a badge style', () => {
    const read = readStyleFile(JSON.stringify({ kind: 'atelier.badge-style', version: 1, theme: { presetId: 'pixel-crt', style: { fontFamily: 'Comic Sans', glowAmount: 4, color: '#00ff00' } }, pieceStyles: { headline: { color: 5, evil: 'x' } } }))!;
    expect(read.theme.style.fontFamily).toBe('VT323');
    expect(read.theme.style.glowAmount).toBe(1);
    expect(read.theme.style.color).toBe('#00ff00');
    expect(read.pieceStyles).toBeUndefined();
    expect(readStyleFile('{"kind":"other"}')).toBeNull();
    expect(readStyleFile('not json')).toBeNull();
  });
});
