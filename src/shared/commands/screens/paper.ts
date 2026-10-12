/**
 * The palette and the type every SCREEN an agent receives is drawn in — a
 * contact sheet, the sum-up card — taken from the suite's own tokens
 * («Studio Papier», `src/index.css`) rather than copied by hand into each
 * painter, so the images an agent shares look like the app and change with
 * it. A spec reads `index.css` and fails when the two drift apart.
 *
 * A shared image is a FILE, so it is drawn on paper (`SCREEN_LIGHT`) by
 * default whatever the page's theme; `SCREEN_DARK` exists for the screens'
 * bench, to judge a design at night too.
 *
 * Pure: values only; `screenFonts` is the one DOM call, and it never fails a
 * drawing — a canvas falls back to the monospace the system has.
 */

export interface ScreenPalette {
  /** The ground. */
  paper: string;
  /** Text and bars. */
  ink: string;
  /** Secondary text: captions, counts, axes. */
  muted: string;
  /** Rules and empty boxes. */
  line: string;
  /** The one accent: the busiest bar, a culling mark. */
  accent: string;
}

/** The light theme's tokens (`@theme` in `index.css`). */
export const SCREEN_LIGHT: ScreenPalette = {
  paper: '#f4f0e7',
  ink: '#1b1813',
  muted: '#938b7c',
  line: '#e2dac9',
  accent: '#d9442a',
};

/** The dark theme's tokens (`html[data-theme='dark']` in `index.css`). */
export const SCREEN_DARK: ScreenPalette = {
  paper: '#16130e',
  ink: '#f2ece0',
  muted: '#a49a86',
  line: '#3b3429',
  accent: '#ef5638',
};

/** The suite's numerals face, served from our own origin (`@fontsource/jetbrains-mono`), then the system's. */
export const SCREEN_MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";

/** Wait for the face a screen is drawn in — a canvas draws in whatever is loaded at that instant. */
export async function screenFonts(): Promise<void> {
  try {
    if (typeof document === 'undefined' || !document.fonts) return;
    await Promise.all(['400 16px "JetBrains Mono"', '500 16px "JetBrains Mono"', '600 16px "JetBrains Mono"'].map((f) => document.fonts.load(f)));
  } catch {
    // The system's monospace then: a screen is never refused for its font.
  }
}
