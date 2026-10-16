/**
 * The GEAR STICKER — what the atlas writes for the drone that flew, in the
 * manner of a maker's own «shot on» card, pure: «**DJI MINI 5** PRO», the
 * maker and the model's body in a heavy weight and the trailing qualifier in
 * a light one; or the maker's LOGO followed by the whole model in light
 * («[logo] OSMO POCKET 3»). The words come from the aircraft's display name
 * (the clip's metadata, renamed or not in the Flights tab); which words are
 * light is a rule — the qualifiers at the end — that the author can move
 * name by name.
 */

/** «DJI MINI 5 PRO» in two weights, or the maker's logo then the model in light. */
export type StickerStyle = 'type' | 'logo';
/** `auto` reads the ground under the overlay: light on a dark map, dark on a light one. */
export type StickerInk = 'auto' | 'text' | 'accent' | 'white' | 'black';
export type StickerBacking = 'none' | 'shadow' | 'plate';

export interface StickerSettings {
  style: StickerStyle;
  /** Written first when a drone's name does not start with a known maker. */
  maker: string;
  ink: StickerInk;
  backing: StickerBacking;
  /** Cap size, px on a 1080 short side. */
  size: number;
  /** The logo drawn in the ink (its shape kept, its colours dropped), or as the file is. */
  logoTint: boolean;
}

export const STICKER_DEFAULTS: StickerSettings = {
  style: 'type',
  maker: 'DJI',
  ink: 'auto',
  backing: 'none',
  size: 30,
  logoTint: true,
};

/** The trailing words a maker sets in its light weight. */
export const QUALIFIERS: readonly string[] = ['PRO', 'PLUS', 'CLASSIC', 'CINE', 'SE', 'MAX', 'ULTRA'];

/** Names that, written first, are the maker rather than the model. */
export const KNOWN_MAKERS: readonly string[] = ['DJI', 'SONY', 'APPLE', 'GOPRO', 'AUTEL', 'INSTA360', 'PARROT', 'SKYDIO', 'HOVERAIR', 'POTENSIC'];

/**
 * A word as a sticker writes it: in capitals, except where its own case is
 * its name — an inner capital after a small letter («iPhone») or a letter
 * outside ASCII («α7C», whose α would become a Latin-looking Α).
 */
export function stickerCase(word: string): string {
  if (/[a-z][A-Z]/.test(word) || /[^\x20-\x7e]/.test(word)) return word;
  return word.toUpperCase();
}

/** Where the light words start when nobody chose: before the trailing qualifiers. */
export function autoLightFrom(words: readonly string[]): number {
  let k = words.length;
  while (k > 0 && QUALIFIERS.includes(words[k - 1].toUpperCase())) k--;
  return k;
}

export interface StickerParts {
  /** The maker, as written («DJI»). */
  maker: string;
  /** The model's words, as written («MINI», «5», «PRO»). */
  words: string[];
  /** The first light word (`words.length`: none). */
  lightFrom: number;
}

/**
 * Split a display name into the sticker's parts. A name opening on a known
 * maker keeps it; any other gets `fallbackMaker` in front («Mini 4 Pro» →
 * DJI · MINI 4 PRO). `lightFrom` is the author's choice for this name, when
 * there is one; it is clamped to the words there are.
 */
export function stickerParts(name: string, fallbackMaker: string, lightFrom?: number): StickerParts {
  const all = name.trim().split(/\s+/).filter(Boolean).map(stickerCase);
  let maker = stickerCase(fallbackMaker.trim());
  let words = all;
  if (all.length && KNOWN_MAKERS.includes(all[0].toUpperCase())) {
    maker = all[0];
    words = all.slice(1);
  } else if (maker && all.length && all[0].toUpperCase() === maker.toUpperCase()) {
    words = all.slice(1);
  }
  const k = lightFrom === undefined ? autoLightFrom(words) : Math.max(0, Math.min(words.length, Math.round(lightFrom)));
  return { maker, words, lightFrom: k };
}

/** The sticker's two runs of text: heavy, then light. The logo style has no heavy run — the logo stands for the maker. */
export function stickerText(parts: StickerParts, style: StickerStyle, hasLogo: boolean): { bold: string; light: string; logo: boolean } {
  if (style === 'logo' && hasLogo) return { bold: '', light: parts.words.join(' '), logo: true };
  if (style === 'logo') {
    // No logo kept for this maker: its name in the heavy weight, then the model in light.
    return { bold: parts.maker, light: parts.words.join(' '), logo: false };
  }
  return {
    bold: [parts.maker, ...parts.words.slice(0, parts.lightFrom)].filter(Boolean).join(' '),
    light: parts.words.slice(parts.lightFrom).join(' '),
    logo: false,
  };
}

/** A maker's key in the logo vault: one logo per maker, whatever its case. */
export function makerKey(maker: string): string {
  return maker.trim().toUpperCase();
}

/** Relative luminance of a `#rrggbb`, 0..1 (sRGB, WCAG). */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

export const STICKER_LIGHT = '#ffffff';
export const STICKER_DARK = '#16181c';

/**
 * The ink for a ground of this luminance: the one of white and near-black
 * with the better contrast against it (WCAG), so a mid-grey ground still gets
 * the more legible of the two.
 */
export function inkForGround(groundLuminance: number): string {
  const vsWhite = 1.05 / (groundLuminance + 0.05);
  const vsDark = (groundLuminance + 0.05) / (luminance(STICKER_DARK) + 0.05);
  return vsWhite >= vsDark ? STICKER_LIGHT : STICKER_DARK;
}

/**
 * A logo's SVG made drawable at any size: a canvas draws an SVG through its
 * intrinsic size, and a file that only states a `viewBox` has none (Chrome
 * falls back to 300 × 150 and letterboxes the drawing). Width and height are
 * written from the viewBox when missing. Returns the text and its aspect
 * (width / height), or null when the file is not an SVG with a size.
 */
/**
 * The SVG with the namespaces a browser needs to draw it as a picture: an
 * `<img>` refuses an `<svg>` without `xmlns` (one copied out of a web page
 * often has none), and an `xlink:href` without its own declaration.
 */
export function withSvgNamespace(text: string): string {
  const open = /<svg\b[^>]*>/i.exec(text);
  if (!open) return text;
  let tag = open[0];
  if (!/\sxmlns\s*=/i.test(tag)) tag = tag.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (/xlink:/i.test(text) && !/\sxmlns:xlink\s*=/i.test(tag)) tag = tag.replace(/^<svg\b/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  return text.replace(open[0], tag);
}

/** The SVG given a viewBox measured on the page (`box`, user units), when its file states no size at all. */
export function svgWithViewBox(text: string, box: { x: number; y: number; width: number; height: number }): string {
  const open = /<svg\b[^>]*>/i.exec(text);
  if (!open || box.width <= 0 || box.height <= 0) return text;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const tag = open[0].replace(/\sviewBox\s*=\s*["'][^"']*["']/i, '').replace(/^<svg\b/i, `<svg viewBox="${round(box.x)} ${round(box.y)} ${round(box.width)} ${round(box.height)}"`);
  return text.replace(open[0], tag);
}

export function drawableSvg(text: string): { text: string; ratio: number } | null {
  text = withSvgNamespace(text);
  const open = /<svg\b[^>]*>/i.exec(text);
  if (!open) return null;
  const tag = open[0];
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  const len = (v: string | undefined) => {
    if (!v || /%$/.test(v.trim())) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const vbW = vb && vb.length === 4 && vb[2] > 0 ? vb[2] : null;
  const vbH = vb && vb.length === 4 && vb[3] > 0 ? vb[3] : null;
  const w = len(attr('width'));
  const h = len(attr('height'));
  if (w && h) return { text, ratio: w / h };
  if (!vbW || !vbH) return null;
  const ratio = vbW / vbH;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const width = round(w ?? (h ? h * ratio : vbW));
  const height = round(h ?? width / ratio);
  const bare = tag.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '');
  const sized = bare.replace(/^<svg\b/i, `<svg width="${width}" height="${height}"`);
  return { text: text.replace(tag, sized), ratio };
}
