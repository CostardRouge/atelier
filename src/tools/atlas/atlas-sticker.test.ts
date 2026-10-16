import { describe, expect, it } from 'vitest';
import { autoLightFrom, drawableSvg, svgWithViewBox, withSvgNamespace, inkForGround, luminance, makerKey, stickerCase, stickerParts, stickerText, STICKER_DARK, STICKER_LIGHT } from './atlas-sticker';

describe('stickerParts', () => {
  it('keeps a known maker and sets the trailing qualifier light', () => {
    const p = stickerParts('DJI Mini 5 Pro', 'DJI');
    expect(p).toEqual({ maker: 'DJI', words: ['MINI', '5', 'PRO'], lightFrom: 2 });
    expect(stickerText(p, 'type', false)).toEqual({ bold: 'DJI MINI 5', light: 'PRO', logo: false });
  });

  it('writes nothing light when the name ends on no qualifier', () => {
    const p = stickerParts('DJI Air 3S', 'DJI');
    expect(stickerText(p, 'type', false)).toEqual({ bold: 'DJI AIR 3S', light: '', logo: false });
  });

  it('puts the fallback maker in front of a bare model, once', () => {
    expect(stickerParts('Mini 4 Pro', 'DJI').maker).toBe('DJI');
    expect(stickerParts('Mini 4 Pro', 'DJI').words).toEqual(['MINI', '4', 'PRO']);
    // A maker the list does not know, but the author typed as the fallback, is not written twice.
    expect(stickerParts('Holystone HS720', 'Holystone')).toEqual({ maker: 'HOLYSTONE', words: ['HS720'], lightFrom: 1 });
  });

  it('obeys the author, clamped to the words there are', () => {
    expect(stickerParts('DJI Mavic 4 Pro', 'DJI', 1).lightFrom).toBe(1);
    expect(stickerParts('DJI Mavic 4 Pro', 'DJI', 9).lightFrom).toBe(3);
    expect(stickerParts('DJI Mavic 4 Pro', 'DJI', -2).lightFrom).toBe(0);
  });

  it('keeps a name whose case is its name', () => {
    expect(stickerCase('iPhone')).toBe('iPhone');
    expect(stickerCase('α7C')).toBe('α7C');
    expect(stickerCase('Osmo')).toBe('OSMO');
    expect(stickerText(stickerParts('Apple iPhone 16 Pro', 'DJI'), 'type', false)).toEqual({ bold: 'APPLE iPhone 16', light: 'PRO', logo: false });
  });

  it('gives the logo style the whole model in light, or the maker heavy without a logo', () => {
    const p = stickerParts('DJI Osmo Pocket 3', 'DJI');
    expect(stickerText(p, 'logo', true)).toEqual({ bold: '', light: 'OSMO POCKET 3', logo: true });
    expect(stickerText(p, 'logo', false)).toEqual({ bold: 'DJI', light: 'OSMO POCKET 3', logo: false });
  });

  it('finds the qualifiers whatever their case', () => {
    expect(autoLightFrom(['Mini', '3', 'Pro'])).toBe(2);
    expect(autoLightFrom(['Mavic', '3', 'Pro', 'Cine'])).toBe(2);
    expect(autoLightFrom([])).toBe(0);
  });

  it('keys a maker in the vault whatever its case', () => {
    expect(makerKey(' dji ')).toBe('DJI');
  });
});

describe('ink for a ground', () => {
  it('reads light on dark and dark on light', () => {
    expect(inkForGround(luminance('#101318'))).toBe(STICKER_LIGHT);
    expect(inkForGround(luminance('#efe8da'))).toBe(STICKER_DARK);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('nope')).toBe(0);
  });
});

describe('drawableSvg', () => {
  it('writes the size a viewBox implies', () => {
    const out = drawableSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 100"><path d="M0 0h1"/></svg>');
    expect(out?.ratio).toBeCloseTo(2.2, 5);
    expect(out?.text).toContain('width="220" height="100"');
  });

  it('keeps a file that states its size', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 30 10"></svg>';
    expect(drawableSvg(svg)).toEqual({ text: svg, ratio: 3 });
  });

  it('replaces a percentage size with the viewBox', () => {
    const out = drawableSvg('<svg width="100%" viewBox="0 0 50 25"></svg>');
    expect(out?.text).toContain('<svg width="50" height="25"');
    expect(out?.ratio).toBe(2);
  });

  it('gives an SVG copied out of a page the namespaces a picture needs', () => {
    const out = drawableSvg('<svg viewBox="0 0 10 5"><use xlink:href="#a"/></svg>');
    expect(out?.text).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out?.text).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(withSvgNamespace('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  });

  it('sizes an SVG that states nothing from the box measured on the page', () => {
    const measured = svgWithViewBox('<svg xmlns="http://www.w3.org/2000/svg"><rect width="40" height="10"/></svg>', { x: 0, y: 0, width: 40, height: 10 });
    expect(drawableSvg(measured)?.ratio).toBe(4);
  });

  it('refuses what is not a sized SVG', () => {
    expect(drawableSvg('<html></html>')).toBeNull();
    expect(drawableSvg('<svg></svg>')).toBeNull();
  });
});
