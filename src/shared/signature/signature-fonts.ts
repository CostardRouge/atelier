import { SIGNATURE_FONTS } from './signature-paint';

let ready: Promise<unknown> | null = null;

/**
 * The signature's faces, loaded once for the page: a canvas draws text in
 * whatever is loaded at that instant, so an export awaits this before its
 * first signed frame and a stage repaints when it resolves.
 */
export function signatureFonts(): Promise<unknown> {
  if (!ready) ready = typeof document === 'undefined' || !document.fonts ? Promise.resolve() : Promise.all(SIGNATURE_FONTS.map((f) => document.fonts.load(f).catch(() => undefined)));
  return ready;
}
