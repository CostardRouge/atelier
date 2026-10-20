/**
 * Font loading for the overlay renderer.
 *
 * Canvas `fillText`/`measureText` only render and measure correctly with fonts
 * the document has actually loaded. The brand fonts (Space Grotesk, JetBrains
 * Mono, Instrument Serif, VT323) are bundled @font-face rules (main.tsx), but we
 * can't assume that finished — so we explicitly `document.fonts.load(...)`
 * each face the deck resolves to (theme included) and await
 * `document.fonts.ready` before the first measured draw and before export.
 * System fonts (Arial/Georgia/Courier) need no loading.
 */

import { withDeadline } from '../lib/abortable';
import { BRAND_FONTS, type OverlayElement } from './overlay-types';
import { resolveElementStyle, type StyleTheme } from './title-styles';

/**
 * The brand-font faces the deck resolves to, as `document.fonts.load`
 * strings, sorted — so two decks using the same faces give the same list,
 * and an editor can tell "the fonts in use changed" from "an element moved".
 * Pure: the resolution reads no DOM.
 */
export function overlayFontFaces(elements: OverlayElement[], theme?: StyleTheme | null): string[] {
  const faces = new Set<string>();
  for (const el of elements) {
    if (!el.visible) continue;
    const st = resolveElementStyle(el, theme ?? null);
    if (!BRAND_FONTS.has(st.fontFamily)) continue;
    const style = st.italic ? 'italic ' : '';
    // A representative size — metrics scale, only the face needs to be present.
    faces.add(`${style}${st.weight} 32px '${st.fontFamily}'`);
  }
  return [...faces].sort();
}

/** Load the given faces, then await the document's fonts. */
export async function ensureFontFaces(faces: readonly string[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  // Bounded: a face that never settles (a font the browser is still
  // fetching on a slow phone, a `fonts.ready` that waits on another page's
  // face) would hold every paint behind it; past the deadline the frame is
  // drawn with the faces that are in.
  await withDeadline(
    (async () => {
      await Promise.all(faces.map((face) => document.fonts.load(face).catch(() => undefined)));
      await document.fonts.ready;
    })(),
    FONTS_DEADLINE_MS,
    () => undefined,
  );
}

/** How long a paint waits for its fonts before drawing with what is in. */
export const FONTS_DEADLINE_MS = 8_000;

/** Load every brand-font face the deck resolves to, then await readiness. */
export function ensureOverlayFonts(
  elements: OverlayElement[],
  theme?: StyleTheme | null,
): Promise<void> {
  return ensureFontFaces(overlayFontFaces(elements, theme));
}
