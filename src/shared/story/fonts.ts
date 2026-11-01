/**
 * The faces a Storytelling post may be set in — each shipped with Atelier
 * from npm (`@fontsource`), served from our own origin like every font of the
 * suite (`local-first.md`): nothing is fetched from a font service. (pure)
 *
 * The charte names four ROLES — the titles, the running text, the numbers
 * and the hand — and an object's font is either a role (`@title`) or a face
 * of this list; the default roles are the charte « geist » of the labs.
 */

export interface StoryFont {
  label: string;
  /** The CSS family list, the face first. */
  family: string;
  /** The weights shipped. */
  weights: readonly number[];
  italic?: boolean;
}

export const STORY_FONTS = {
  geist: { label: 'Geist', family: 'Geist, "Helvetica Neue", Arial, sans-serif', weights: [300, 400, 600] },
  space: { label: 'Space Grotesk', family: '"Space Grotesk", Geist, Arial, sans-serif', weights: [400, 500, 600, 700] },
  montserrat: { label: 'Montserrat', family: 'Montserrat, Geist, Arial, sans-serif', weights: [300, 600] },
  archivo: { label: 'Archivo Black', family: '"Archivo Black", Impact, "Arial Black", sans-serif', weights: [400] },
  fraunces: { label: 'Fraunces', family: 'Fraunces, Georgia, serif', weights: [400, 600, 900] },
  instrument: { label: 'Instrument Serif', family: '"Instrument Serif", Georgia, serif', weights: [400] },
  instrumentItalic: { label: 'Instrument Serif italic', family: '"Instrument Serif", Georgia, serif', weights: [400], italic: true },
  zilla: { label: 'Zilla Slab', family: '"Zilla Slab", Rockwell, Georgia, serif', weights: [600, 700] },
  caveat: { label: 'Caveat (hand)', family: 'Caveat, "Segoe Print", cursive', weights: [600] },
  elite: { label: 'Special Elite (typewriter)', family: '"Special Elite", "Courier New", monospace', weights: [400] },
  mono: { label: 'JetBrains Mono', family: '"JetBrains Mono", ui-monospace, monospace', weights: [400, 500, 600] },
  vt323: { label: 'VT323 (screen)', family: 'VT323, "JetBrains Mono", monospace', weights: [400] },
} as const satisfies Record<string, StoryFont>;

export type StoryFontId = keyof typeof STORY_FONTS;
export const isStoryFont = (id: unknown): id is StoryFontId => typeof id === 'string' && id in STORY_FONTS;

/** The charte's four roles, and what each is set in until the charte says otherwise. */
export type FontRole = 'title' | 'text' | 'num' | 'hand';
export const FONT_ROLES: readonly FontRole[] = ['title', 'text', 'num', 'hand'];
export const ROLE_LABEL: Record<FontRole, string> = { title: 'Titles', text: 'Text', num: 'Numbers', hand: 'Hand' };
export const DEFAULT_ROLES: Record<FontRole, StoryFontId> = { title: 'geist', text: 'geist', num: 'mono', hand: 'caveat' };

/** The weight a face actually ships nearest to the one asked for. */
export function nearestWeight(font: StoryFont, w: number): number {
  return font.weights.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best), font.weights[0]);
}
