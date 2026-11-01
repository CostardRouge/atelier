/**
 * A badge's LOOK as a file of its own (hook lab B4, his « exportable et
 * réutilisable »): the title style (`StyleTheme`: face, weight, case, ink,
 * legibility, glow) and, when the surface has them, the badge's per-piece
 * styles — written by Trips, the Studio or Storytelling, read by any of them.
 * Nothing of a trip or a post rides in it: no words, no picture, no place.
 * (pure)
 */
import type { BadgePieceStyles } from '../roadtrip/badge-layout';
import { BRAND_FONTS, type OverlayFontFamily } from './overlay-types';
import { themeFromPreset, type StyleTheme, type TitleStyle } from './title-styles';

export const STYLE_FILE_KIND = 'atelier.badge-style';
export const STYLE_FILE_VERSION = 1;
export const STYLE_FILE_EXT = '.badge.json';

export interface StyleFile {
  theme: StyleTheme;
  pieceStyles?: BadgePieceStyles;
}

/** The file's text for a look. */
export function styleFileText(file: StyleFile): string {
  return JSON.stringify({ kind: STYLE_FILE_KIND, version: STYLE_FILE_VERSION, ...file }, null, 2);
}

/** A file's name from its look: its preset, else « badge ». */
export const styleFileName = (theme: StyleTheme): string => `${(theme.presetId || 'badge').replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}${STYLE_FILE_EXT}`;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const FAMILIES: readonly OverlayFontFamily[] = [...BRAND_FONTS, 'Arial', 'Georgia'] as OverlayFontFamily[];

/** A theme read field by field over its preset's (or Neutral's): a field of the wrong kind keeps the preset's. */
export function readStyleTheme(raw: unknown): StyleTheme | null {
  if (!isObject(raw) || !isObject(raw.style)) return null;
  const presetId = typeof raw.presetId === 'string' ? raw.presetId : 'neutral';
  const base = (themeFromPreset(presetId) ?? themeFromPreset('neutral'))!.style;
  const s = raw.style;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const color = (v: unknown, d: string) => (typeof v === 'string' && v.length < 64 ? v : d);
  const style: TitleStyle = {
    fontFamily: typeof s.fontFamily === 'string' && (FAMILIES as readonly string[]).includes(s.fontFamily) ? (s.fontFamily as OverlayFontFamily) : base.fontFamily,
    weight: [400, 500, 600, 700].includes(s.weight as number) ? (s.weight as TitleStyle['weight']) : base.weight,
    italic: bool(s.italic, base.italic),
    uppercase: bool(s.uppercase, base.uppercase),
    letterSpacingEm: num(s.letterSpacingEm, -0.2, 1, base.letterSpacingEm),
    color: color(s.color, base.color),
    sizeScale: num(s.sizeScale, 0.3, 3, base.sizeScale),
    legibility: isObject(s.legibility) && typeof s.legibility.mode === 'string' ? (s.legibility as unknown as TitleStyle['legibility']) : base.legibility,
    glowAmount: num(s.glowAmount, 0, 1, base.glowAmount),
    glowWarmth: num(s.glowWarmth, 0, 1, base.glowWarmth),
  };
  return { presetId, style };
}

/** A look's file read back, or null with nothing usable in it. */
export function readStyleFile(text: string): StyleFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.kind !== STYLE_FILE_KIND) return null;
  const theme = readStyleTheme(raw.theme);
  if (!theme) return null;
  const pieceStyles = isObject(raw.pieceStyles) ? readPieceStyles(raw.pieceStyles) : undefined;
  return { theme, ...(pieceStyles ? { pieceStyles } : {}) };
}

const PIECES = ['kicker', 'label', 'headline', 'counter', 'caption', 'timing', 'exif'] as const;
/** Per-piece styles kept field by field: a case, colours, a box's numbers — nothing else rides along. */
function readPieceStyles(raw: Record<string, unknown>): BadgePieceStyles | undefined {
  const out: BadgePieceStyles = {};
  for (const k of PIECES) {
    const v = raw[k];
    if (!isObject(v)) continue;
    const str = (x: unknown) => (typeof x === 'string' && x.length < 64 ? x : undefined);
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(5, Math.max(0, x)) : undefined);
    const style = {
      ...(v.textCase === 'upper' || v.textCase === 'lower' || v.textCase === 'as-is' ? { textCase: v.textCase } : {}),
      ...(str(v.color) ? { color: str(v.color) } : {}),
      ...(str(v.boxColor) ? { boxColor: str(v.boxColor) } : {}),
      ...(n(v.boxPadFrac) !== undefined ? { boxPadFrac: n(v.boxPadFrac) } : {}),
      ...(n(v.boxRadiusFrac) !== undefined ? { boxRadiusFrac: n(v.boxRadiusFrac) } : {}),
      ...(str(v.borderColor) ? { borderColor: str(v.borderColor) } : {}),
      ...(n(v.borderWidthFrac) !== undefined ? { borderWidthFrac: n(v.borderWidthFrac) } : {}),
    };
    if (Object.keys(style).length) out[k] = style as BadgePieceStyles[typeof k];
  }
  return Object.keys(out).length ? out : undefined;
}
