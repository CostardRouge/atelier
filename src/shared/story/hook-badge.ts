/**
 * The hook drawn as Trips' BADGE (hook lab https://claude.ai/artifact/KLVzFMpNfq1pPhvn3GukKw,
 * his « je valide avec toutes ses recommandations »): not a second system —
 * the very pieces of a Trips badge (`badge-layout.ts`, `badgeElements`), drawn
 * by the overlay engine (`drawOverlays`) in its title styles (Or ciné, Pixel
 * CRT, Rouge plein cadre, Neutral) or the series' charte. A post's hook keeps
 * its words (its first line the BIG TEXT, its second the SECOND LINE, whose
 * sticker is a box of that piece); the series adds a HEADER (its name and the
 * post's number), the PLACE (the map's first and last stop), WHY NOW (« il y a
 * un an », Trips' time-ago line) and, when the script names it, the CAMERA.
 * The pieces arrive on the hook's own timeline (`hookTimeline`), so its key
 * clicks and its impact still land on their letters. (pure apart from the
 * canvas calls)
 */
import { badgeBlockExtent, badgeElements, type BadgeLayout, type BadgePieceStyles } from '../roadtrip/badge-layout';
import type { BadgeContent, BadgePiece } from '../roadtrip/day-badge';
import { DEFAULT_TIME_AGO_WORDS, FRENCH_TIME_AGO_WORDS, timeAgoLine } from '../roadtrip/time-ago';
import type { AnimStep, ElementAnimation } from '../overlay/animation';
import type { OverlayElement } from '../overlay/overlay-types';
import { themeFromPreset, type StyleTheme } from '../overlay/title-styles';
import { readStyleTheme } from '../overlay/style-file';
import { PAL } from './charte';
import type { Hook, HookTimeline } from './hook';

export type HookLook = 'or-cine' | 'pixel-crt' | 'plein-cadre' | 'neutral' | 'charte';
export const HOOK_LOOKS: readonly { id: HookLook; label: string }[] = [
  { id: 'or-cine', label: 'Or ciné' },
  { id: 'pixel-crt', label: 'Pixel CRT' },
  { id: 'plein-cadre', label: 'Rouge plein cadre' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'charte', label: 'The charte' },
];

/** Where the badge sits: the stack bottom-left (Trips'), the statement in the middle, title up and card down, or a band. */
export type HookComposition = 'stack' | 'centre' | 'split' | 'band';
export const HOOK_COMPOSITIONS: readonly { id: HookComposition; label: string }[] = [
  { id: 'stack', label: 'Stack' },
  { id: 'centre', label: 'Centre' },
  { id: 'split', label: 'Top and bottom' },
  { id: 'band', label: 'Band' },
];

export type HookPieceKey = 'header' | 'second' | 'place' | 'camera' | 'why';
export const HOOK_PIECES: readonly { id: HookPieceKey; label: string }[] = [
  { id: 'header', label: 'Header' },
  { id: 'second', label: 'Second line' },
  { id: 'place', label: 'Place' },
  { id: 'camera', label: 'Camera' },
  { id: 'why', label: 'Why now' },
];

/** A hook piece as Trips' badge names it. */
const PIECE_OF: Record<HookPieceKey | 'big', BadgePiece> = {
  header: 'kicker',
  big: 'headline',
  second: 'counter',
  place: 'caption',
  why: 'timing',
  camera: 'exif',
};

/** The series' hook look (`StoryLook.hook`), each field over its default. */
export interface HookBadge {
  /** `classic`: the typed lines and the sticker of before. */
  mode?: 'badge' | 'classic';
  look?: HookLook;
  composition?: HookComposition;
  /** The big text's size, a share of the frame's width. */
  size?: number;
  pieces?: Partial<Record<HookPieceKey, boolean>>;
  /** Per piece: case, ink, box — Trips' piece styles, by Trips' piece names. */
  styles?: BadgePieceStyles;
  /** The title style as tuned, imported from a `.badge.json` or taken from a trip: wins over `look`'s preset. */
  theme?: StyleTheme;
}

/** His picks: Or ciné, the stack, every piece but the camera (which only the script can name). */
export const HOOK_BADGE_DEFAULTS = {
  mode: 'badge' as const,
  look: 'or-cine' as HookLook,
  composition: 'stack' as HookComposition,
  size: 0.1,
  pieces: { header: true, second: true, place: true, camera: true, why: true } as Record<HookPieceKey, boolean>,
};

export function hookBadgeOf(raw: HookBadge | null | undefined) {
  return {
    mode: raw?.mode ?? HOOK_BADGE_DEFAULTS.mode,
    look: raw?.look ?? HOOK_BADGE_DEFAULTS.look,
    composition: raw?.composition ?? HOOK_BADGE_DEFAULTS.composition,
    size: raw?.size ?? HOOK_BADGE_DEFAULTS.size,
    pieces: { ...HOOK_BADGE_DEFAULTS.pieces, ...(raw?.pieces ?? {}) },
    styles: raw?.styles ?? {},
    theme: raw?.theme ?? null,
  };
}

/** The series' hook look, kept field by field when well formed. (pure) */
export function readHookBadge(raw: unknown): HookBadge | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: HookBadge = {};
  if (r.mode === 'badge' || r.mode === 'classic') out.mode = r.mode;
  if (typeof r.look === 'string' && HOOK_LOOKS.some((l) => l.id === r.look)) out.look = r.look as HookLook;
  if (typeof r.composition === 'string' && HOOK_COMPOSITIONS.some((c) => c.id === r.composition)) out.composition = r.composition as HookComposition;
  if (typeof r.size === 'number' && Number.isFinite(r.size)) out.size = Math.min(0.2, Math.max(0.04, r.size));
  if (typeof r.pieces === 'object' && r.pieces && !Array.isArray(r.pieces)) {
    const pieces: Partial<Record<HookPieceKey, boolean>> = {};
    for (const { id } of HOOK_PIECES) if (typeof (r.pieces as Record<string, unknown>)[id] === 'boolean') pieces[id] = (r.pieces as Record<string, boolean>)[id];
    if (Object.keys(pieces).length) out.pieces = pieces;
  }
  if (typeof r.styles === 'object' && r.styles && !Array.isArray(r.styles)) {
    const styles: BadgePieceStyles = {};
    for (const [k, v] of Object.entries(r.styles as Record<string, unknown>)) {
      if (!Object.values(PIECE_OF).includes(k as BadgePiece) || typeof v !== 'object' || !v) continue;
      const s = v as Record<string, unknown>;
      const color = (x: unknown) => (typeof x === 'string' && /^#[0-9a-f]{3,8}$/i.test(x) ? x : undefined);
      const style = {
        ...(s.textCase === 'upper' || s.textCase === 'lower' || s.textCase === 'as-is' ? { textCase: s.textCase } : {}),
        ...(color(s.color) ? { color: color(s.color) } : {}),
        ...(color(s.boxColor) ? { boxColor: color(s.boxColor) } : {}),
      };
      if (Object.keys(style).length) styles[k as BadgePiece] = style as BadgePieceStyles[BadgePiece];
    }
    if (Object.keys(styles).length) out.styles = styles;
  }
  const theme = readStyleTheme(r.theme);
  if (theme) out.theme = theme;
  return Object.keys(out).length ? out : undefined;
}

/** What the series knows for the pieces it fills itself. */
export interface HookSeries {
  /** The series' name and the post's number, for the header. */
  series: string;
  number: string;
  /** The first and last places the map names. */
  from?: string;
  to?: string;
  /** The trip's first day (ISO), for why now; and today. */
  since?: string;
  today?: string;
  lang?: 'fr' | 'en';
}

/** The hook's pieces as Trips' badge content: the post's words, its own piece texts, else the series'. (pure) */
export function hookBadgeContent(hook: Hook, look: ReturnType<typeof hookBadgeOf>, series: HookSeries): BadgeContent {
  const on = look.pieces;
  const own = hook.pieces ?? {};
  const words = series.lang === 'en' ? DEFAULT_TIME_AGO_WORDS : FRENCH_TIME_AGO_WORDS;
  const why = series.since && series.today ? timeAgoLine(series.since, series.today, 'auto', words) : null;
  const header = [series.series, series.number].filter(Boolean).join(' · ');
  const place = series.from && series.to && series.from !== series.to ? `◆ ${series.from} → ${series.to}` : series.from ? `◆ ${series.from}` : '';
  const pick = (k: HookPieceKey, fallback: string | null | undefined) => (on[k] ? (own[k as keyof typeof own]?.trim() || fallback || null) : null);
  return {
    kicker: pick('header', header),
    label: null,
    headline: hook.lines[0] ?? '',
    counter: on.second ? (hook.lines[1] ?? null) : null,
    caption: pick('place', place),
    timing: pick('why', why),
    exif: pick('camera', null),
  };
}

/** The theme the badge paints in: its own tuned one, else its look's. (pure) */
export function hookThemeOf(raw: HookBadge | null | undefined): StyleTheme {
  const b = hookBadgeOf(raw);
  return b.theme ?? hookTheme(b.look);
}

/** The theme a look paints in: Trips' title style, or the charte's colours on Space Grotesk. (pure) */
export function hookTheme(look: HookLook): StyleTheme {
  if (look !== 'charte') return themeFromPreset(look) ?? themeFromPreset('neutral')!;
  const neutral = themeFromPreset('neutral')!;
  return { presetId: 'charte', style: { ...neutral.style, weight: 600, color: PAL.bg, legibility: { mode: 'none', color: 'rgba(0,0,0,0.65)', padFrac: 0.3 } } };
}

/** The default look of each piece in a look: the second line's box (the old sticker) in the charte, say. */
function lookStyles(look: HookLook): BadgePieceStyles {
  if (look === 'charte') return { counter: { boxColor: PAL.acc, boxPadFrac: 0.28, boxRadiusFrac: 0.35 } };
  if (look === 'pixel-crt') return { counter: { boxColor: '#ff3020', color: '#120806', textCase: 'upper' } };
  if (look === 'plein-cadre') return { counter: { color: '#1a0503' } };
  return {};
}

const LAYOUTS: Record<Exclude<HookComposition, 'split'>, BadgeLayout> = {
  stack: { anchor: 'bottom-left', x: 0.07, y: 0.8, sizeFrac: 0.1 },
  centre: { anchor: 'center', x: 0.5, y: 0.46, sizeFrac: 0.1 },
  band: { anchor: 'bottom-left', x: 0.07, y: 0.8, sizeFrac: 0.1 },
};

/** How the big text arrives, for the hook's entry. */
function entryStep(entry: Hook['entry'], seconds: number): AnimStep {
  switch (entry) {
    case 'rise':
      return { preset: 'slide', duration: seconds, easing: 'out-cubic', direction: 'up', distanceFrac: 0.05 };
    case 'fade':
      return { preset: 'fade', duration: seconds, easing: 'out' };
    case 'wipe':
      return { preset: 'wipe', duration: seconds, easing: 'out-cubic' };
    case 'slam':
      return { preset: 'scale', duration: Math.min(seconds, 0.45), easing: 'back', scaleFrom: 1.3 };
    default:
      return { preset: 'typewriter', duration: seconds, easing: 'linear' };
  }
}

function exitStep(exit: Hook['exit'], seconds: number): AnimStep | null {
  if (exit === 'cut') return null;
  if (exit === 'erase') return { preset: 'wipe', duration: seconds, easing: 'in' };
  if (exit === 'fly') return { preset: 'slide', duration: seconds, easing: 'in-cubic', direction: 'up', distanceFrac: 0.06 };
  return { preset: 'fade', duration: seconds, easing: 'in' };
}

/** One piece of the badge as drawn: its overlay element and which piece of the hook it is. */
export interface HookBadgeElement {
  piece: HookPieceKey | 'big';
  el: OverlayElement;
}

/**
 * The badge's elements for the frame at 1080 × 1920, each with its life set
 * on the hook's timeline: the header ahead of the big text, the big text as
 * the first line arrives (typed, wiped, risen, slammed), the second line on
 * its sticker's beat, the place, why and camera one after the other, all
 * leaving together. (pure)
 */
export function hookBadgeElements(hook: Hook, tl: HookTimeline, raw: HookBadge | null | undefined, series: HookSeries): HookBadgeElement[] {
  const look = hookBadgeOf(raw);
  const content = hookBadgeContent(hook, look, series);
  if (!content.headline || !tl.lines.length) return [];
  const aspect = 1080 / 1920;
  const styles: BadgePieceStyles = { ...lookStyles(look.look) };
  for (const [k, v] of Object.entries(look.styles)) styles[k as BadgePiece] = { ...(styles[k as BadgePiece] ?? {}), ...v };
  const out = exitStep(hook.exit, Math.max(0.05, tl.end - tl.leave));
  const first = tl.lines[0];
  const second = tl.lines[1];
  const settle = (second ?? first).done;
  // Each piece's entrance and its moment, on the hook's own clock.
  const life: Record<BadgePiece, { at: number; step: AnimStep }> = {
    kicker: { at: Math.max(0, first.start - 0.25), step: { preset: 'fade', duration: 0.5, easing: 'out' } },
    label: { at: first.start, step: { preset: 'fade', duration: 0.4, easing: 'out' } },
    headline: { at: first.start, step: entryStep(hook.entry, Math.max(0.2, first.done - first.start)) },
    counter: second
      ? { at: second.start, step: second.sticker ? { preset: 'scale', duration: 0.45, easing: 'back', scaleFrom: 0.6 } : entryStep(hook.entry, Math.max(0.2, second.done - second.start)) }
      : { at: settle, step: { preset: 'fade', duration: 0.4, easing: 'out' } },
    caption: { at: settle + 0.1, step: { preset: 'slide', duration: 0.45, easing: 'out-cubic', direction: 'up', distanceFrac: 0.02 } },
    timing: { at: settle + 0.25, step: { preset: 'slide', duration: 0.45, easing: 'out-cubic', direction: 'up', distanceFrac: 0.02 } },
    exif: { at: settle + 0.4, step: { preset: 'slide', duration: 0.45, easing: 'out-cubic', direction: 'up', distanceFrac: 0.02 } },
  };
  const timed = (els: OverlayElement[]): OverlayElement[] =>
    els.map((el) => {
      const key = (el.id ?? '').replace(/^piece:/, '') as BadgePiece;
      const l = life[key] ?? life.caption;
      const animation: ElementAnimation = { in: l.step, out };
      return { ...el, animation, window: { start: l.at, end: tl.end } };
    });
  const pieceOf = (el: OverlayElement): HookPieceKey | 'big' => {
    const key = (el.id ?? '').replace(/^piece:/, '');
    return (Object.entries(PIECE_OF).find(([, v]) => v === key)?.[0] ?? 'big') as HookPieceKey | 'big';
  };
  // The size is a share of the frame's width — its shorter side, which is what a badge's sizes are of.
  const sized = (l: BadgeLayout): BadgeLayout => ({ ...l, sizeFrac: look.size });
  let els: OverlayElement[];
  if (look.composition === 'split') {
    // The title up, the card down: the same pieces in two blocks, the card's under an empty big text.
    const top: BadgeContent = { ...content, caption: null, timing: null, exif: null };
    const card: BadgeContent = { kicker: null, label: null, headline: '', counter: null, caption: content.caption, timing: content.timing, exif: content.exif };
    els = [
      ...badgeElements(top, sized({ anchor: 'top-left', x: 0.07, y: 0.1, sizeFrac: 0 }), aspect, styles, null),
      ...(card.caption || card.timing || card.exif ? badgeElements(card, sized({ anchor: 'bottom-left', x: 0.07, y: 0.86, sizeFrac: 0 }), aspect, styles, null) : []).filter((el) => el.id !== 'piece:headline'),
    ];
  } else {
    els = badgeElements(content, sized(LAYOUTS[look.composition]), aspect, styles, null);
  }
  return timed(els).map((el) => ({ piece: pieceOf(el), el }));
}

/** The band behind a `band` composition: its top and bottom as shares of the height, and its fill. (pure) */
export function hookBand(hook: Hook, raw: HookBadge | null | undefined, series: HookSeries): { top: number; bottom: number; fill: string } | null {
  const look = hookBadgeOf(raw);
  if (look.composition !== 'band') return null;
  const content = hookBadgeContent(hook, look, series);
  const e = badgeBlockExtent({ ...content, caption: null, timing: null, exif: null }, { ...LAYOUTS.band, sizeFrac: look.size }, 1080 / 1920);
  if (!e) return null;
  const pad = look.size * (1080 / 1920) * 0.35;
  return { top: e.top - pad, bottom: e.bottom + pad, fill: look.look === 'plein-cadre' ? '#f01d0e' : look.look === 'charte' ? PAL.acc : 'rgba(14,12,10,0.82)' };
}
