/**
 * Font loading for the overlay renderer.
 *
 * Canvas `fillText`/`measureText` only render and measure correctly with fonts
 * the document has actually loaded. The brand fonts (Space Grotesk, JetBrains
 * Mono, Instrument Serif, VT323) come from the document's font links, but we
 * can't assume that finished — so we explicitly `document.fonts.load(...)`
 * each face the deck resolves to (theme included) and await
 * `document.fonts.ready` before the first measured draw and before export.
 * System fonts (Arial/Georgia/Courier) need no loading.
 */

import { BRAND_FONTS, type OverlayElement } from './overlay-types';
import { resolveElementStyle, type StyleTheme } from './title-styles';

/** Load every brand-font face the deck resolves to, then await readiness. */
export async function ensureOverlayFonts(
  elements: OverlayElement[],
  theme?: StyleTheme | null,
): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;

  const faces = new Set<string>();
  for (const el of elements) {
    if (!el.visible) continue;
    const st = resolveElementStyle(el, theme ?? null);
    if (!BRAND_FONTS.has(st.fontFamily)) continue;
    const style = st.italic ? 'italic ' : '';
    // A representative size — metrics scale, only the face needs to be present.
    faces.add(`${style}${st.weight} 32px '${st.fontFamily}'`);
  }

  await Promise.all(
    [...faces].map((face) => document.fonts.load(face).catch(() => undefined)),
  );
  await document.fonts.ready;
}
