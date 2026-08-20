/**
 * Font loading for the overlay renderer.
 *
 * Canvas `fillText`/`measureText` only render and measure correctly with fonts
 * the document has actually loaded. The brand fonts (Space Grotesk, JetBrains
 * Mono, Instrument Serif) come from the CSS `@import`, but we can't assume that
 * finished — so we explicitly `document.fonts.load(...)` each used face and
 * await `document.fonts.ready` before the first measured draw and before export.
 * System fonts (Arial/Georgia/Courier) need no loading.
 */

import { BRAND_FONTS, type OverlayElement } from './overlay-types';

/** Load every brand-font face used by `elements`, then await readiness. */
export async function ensureOverlayFonts(elements: OverlayElement[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;

  const faces = new Set<string>();
  for (const el of elements) {
    if (!el.visible || !BRAND_FONTS.has(el.fontFamily)) continue;
    const style = el.italic ? 'italic ' : '';
    // A representative size — metrics scale, only the face needs to be present.
    faces.add(`${style}${el.weight} 32px '${el.fontFamily}'`);
  }

  await Promise.all(
    [...faces].map((face) => document.fonts.load(face).catch(() => undefined)),
  );
  await document.fonts.ready;
}
