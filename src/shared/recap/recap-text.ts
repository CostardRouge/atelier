/**
 * Each TEXT of a recap has its own style (his review, 2026-11-05): the
 * heading, the subheading, the call to action, the weekdays, the days'
 * numbers, the cells' words (camera line, device, caption) and the side
 * labels (on this day's steps, a week's day names) — its face, size, weight,
 * colour, case and spacing, an OUTLINE, a SHADOW under the letters and a GLOW.
 *
 * A style preset dresses one text or all of them at once — the suite's title
 * styles (`overlay/title-styles.ts`: Neutral, Or ciné, Pixel CRT, Rouge plein
 * cadre) and two of Recap's own (Outline, Soft shadow). The faces are
 * Storytelling's (`story/fonts.ts`), shipped from our own origin; `auto`
 * keeps the face each place draws by default.
 *
 * Pure and DOM-free.
 */

import { STORY_FONTS, isStoryFont, type StoryFontId } from '../story/fonts';
import { TITLE_STYLE_PRESETS } from '../overlay/title-styles';

export type TextRole = 'heading' | 'subheading' | 'cta' | 'weekdays' | 'dayNumber' | 'flowDate' | 'cellWords' | 'labels';
export const TEXT_ROLES: readonly TextRole[] = ['heading', 'subheading', 'cta', 'weekdays', 'dayNumber', 'flowDate', 'cellWords', 'labels'];
export const TEXT_ROLE_LABEL: Record<TextRole, string> = {
  heading: 'Heading',
  subheading: 'Subheading',
  cta: 'Call to action',
  weekdays: 'Weekdays',
  dayNumber: 'Day numbers',
  flowDate: 'Highlight dates',
  cellWords: 'Cell words',
  labels: 'Labels',
};

export interface TextStyle {
  /** A face of `STORY_FONTS`, or `auto`: the face this place draws by default. */
  font: StoryFontId | 'auto';
  /** A multiplier over the place's own size. */
  size: number;
  weight: number;
  /** `#rrggbb`, or null: ink on a light ground, paper on a dark one. */
  colour: string | null;
  /** Capitals: forced on or off, or null for the place's own. */
  upper: boolean | null;
  /** Letter spacing in em, or null for the place's own. */
  tracking: number | null;
  /** The letters' outline, a fraction of the size (0 = none), and its colour. */
  outline: number;
  outlineColour: string;
  /** The shadow under the letters: darkness (0 = none), softness and drop, fractions of the size. */
  shadow: number;
  shadowBlur: number;
  shadowY: number;
  /** A glow around the letters, 0 … 1, and how warm it drifts. */
  glow: number;
  glowWarmth: number;
  /** The preset it was last dressed with — the inspector's lit tile; an edit after keeps it named. */
  preset: string | null;
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: 'auto',
  size: 1,
  weight: 400,
  colour: null,
  upper: null,
  tracking: null,
  outline: 0,
  outlineColour: '#000000',
  shadow: 0,
  shadowBlur: 0.35,
  shadowY: 0.06,
  glow: 0,
  glowWarmth: 0.5,
  preset: null,
};

/** The suite's faces as `STORY_FONTS` names them. */
const FAMILY_TO_FONT: Record<string, StoryFontId> = {
  'Instrument Serif': 'instrument',
  VT323: 'vt323',
  'Space Grotesk': 'space',
  Geist: 'geist',
  'JetBrains Mono': 'mono',
  Montserrat: 'montserrat',
};

export interface TextPreset {
  id: string;
  name: string;
  tagline: string;
  style: Omit<TextStyle, 'preset'>;
}

/** The suite's title styles, read as a recap's text styles; then Recap's own. */
export const TEXT_PRESETS: readonly TextPreset[] = [
  ...TITLE_STYLE_PRESETS.map((p): TextPreset => {
    const st = p.style;
    const font = FAMILY_TO_FONT[st.fontFamily] ?? 'auto';
    return {
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      style: {
        ...DEFAULT_TEXT_STYLE,
        font: p.id === 'neutral' ? 'auto' : font,
        size: st.sizeScale,
        weight: st.weight,
        colour: p.id === 'neutral' ? null : st.color.toLowerCase(),
        upper: st.uppercase,
        tracking: st.letterSpacingEm,
        // Neutral's legibility is a drop shadow; the others glow instead.
        shadow: p.id === 'neutral' ? 0.55 : 0,
        glow: st.glowAmount,
        glowWarmth: st.glowWarmth,
      },
    };
  }),
  {
    id: 'outline',
    name: 'Outline',
    tagline: 'White letters, a black outline — reads on any picture',
    style: { ...DEFAULT_TEXT_STYLE, font: 'archivo', weight: 400, colour: '#ffffff', upper: true, tracking: 0.02, outline: 0.08, outlineColour: '#000000' },
  },
  {
    id: 'soft-shadow',
    name: 'Soft shadow',
    tagline: 'Paper white, a deep soft shadow under it',
    style: { ...DEFAULT_TEXT_STYLE, colour: '#f4f0e7', shadow: 0.75, shadowBlur: 0.6, shadowY: 0.1 },
  },
];

export function textPresetById(id: string): TextPreset | undefined {
  return TEXT_PRESETS.find((p) => p.id === id);
}

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export function readTextStyle(raw: unknown): TextStyle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_TEXT_STYLE;
  return {
    font: r.font === 'auto' || !isStoryFont(r.font) ? 'auto' : r.font,
    size: num(r.size, 0.4, 3, d.size),
    weight: Math.round(num(r.weight, 100, 900, d.weight) / 100) * 100,
    colour: typeof r.colour === 'string' && HEX.test(r.colour) ? r.colour.toLowerCase() : null,
    upper: typeof r.upper === 'boolean' ? r.upper : null,
    tracking: typeof r.tracking === 'number' && Number.isFinite(r.tracking) ? Math.min(0.5, Math.max(-0.1, r.tracking)) : null,
    outline: num(r.outline, 0, 0.25, d.outline),
    outlineColour: typeof r.outlineColour === 'string' && HEX.test(r.outlineColour) ? r.outlineColour.toLowerCase() : d.outlineColour,
    shadow: num(r.shadow, 0, 1, d.shadow),
    shadowBlur: num(r.shadowBlur, 0, 1.5, d.shadowBlur),
    shadowY: num(r.shadowY, -0.5, 0.5, d.shadowY),
    glow: num(r.glow, 0, 1, d.glow),
    glowWarmth: num(r.glowWarmth, 0, 1, d.glowWarmth),
    preset: typeof r.preset === 'string' && textPresetById(r.preset) ? r.preset : null,
  };
}

/** Every role's style, read back; a role absent keeps no entry (it draws with the defaults). */
export function readTextStyles(raw: unknown): Partial<Record<TextRole, TextStyle>> {
  const out: Partial<Record<TextRole, TextStyle>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const role of TEXT_ROLES) {
    const v = (raw as Record<string, unknown>)[role];
    if (v && typeof v === 'object') out[role] = readTextStyle(v);
  }
  return out;
}

/** A role's style, its defaults filled in. */
export function textStyleOf(styles: Partial<Record<TextRole, TextStyle>> | undefined, role: TextRole): TextStyle {
  // The highlights' dates borrow the day numbers' style until they have their own (lab 17: nothing moves until he sets one).
  return styles?.[role] ?? (role === 'flowDate' ? styles?.dayNumber : undefined) ?? DEFAULT_TEXT_STYLE;
}

/** A preset's style, ready to keep on a role. */
export function presetStyle(id: string): TextStyle | null {
  const p = textPresetById(id);
  return p ? { ...p.style, preset: p.id } : null;
}

/** The CSS family a role draws in: its own face, else the place's `fallback`. */
export function familyOf(style: TextStyle, fallback: string): string {
  return style.font === 'auto' ? fallback : STORY_FONTS[style.font].family;
}

/** The weight a face really ships nearest to the one asked — what the canvas can draw. */
export function shippedWeight(style: TextStyle): number {
  if (style.font === 'auto') return style.weight;
  const ws = STORY_FONTS[style.font].weights;
  return ws.reduce((best, w) => (Math.abs(w - style.weight) < Math.abs(best - style.weight) ? w : best), ws[0]);
}

/** Whether a face is italic by itself (`instrumentItalic`). */
export function italicOf(style: TextStyle): boolean {
  return style.font !== 'auto' && Boolean((STORY_FONTS[style.font] as { italic?: boolean }).italic);
}

/** Which roles a template draws — what the Text tab lists. */
export function rolesOf(template: string, highlights = false): TextRole[] {
  const base: TextRole[] = ['heading', 'subheading', 'cta'];
  // The slides after the first have their dates' own style (lab 17) — listed only where there are such slides.
  const flow: TextRole[] = highlights ? ['flowDate'] : [];
  if (template === 'month') return [...base, 'weekdays', 'dayNumber', ...flow, 'cellWords'];
  if (template === 'week') return [...base, 'dayNumber', ...flow, 'labels', 'cellWords'];
  if (template === 'onThisDay') return [...base, 'labels', ...flow, 'cellWords'];
  if (template === 'single') return [...base, ...flow, 'cellWords'];
  return [...base, 'dayNumber', ...flow, 'cellWords'];
}
