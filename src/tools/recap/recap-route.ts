/**
 * Where you are in the Recap instrument, as a route — the mosaic's rule:
 * `/recap/home` is the gallery, `/recap/<recap>` one recap in the editor, where
 * `<recap>` is the trips' readable reference (`<slug>-<first 8 of the id>`), so
 * renaming a recap never breaks a link. A bare `/recap` lands on the gallery.
 *
 * Pure and DOM-free.
 */

import { tripFromRef, tripRef } from '../../shared/roadtrip/trip-route';

export const RECAP_BASE = '/recap';
export const RECAP_HOME = '/recap/home';

export function recapRef(recap: { id: string; title: string }): string {
  return tripRef({ id: recap.id, name: recap.title });
}

export function recapFromRef<T extends { id: string }>(ref: string, recaps: readonly T[]): T | null {
  return tripFromRef(ref, recaps);
}

export function recapPath(ref: string | null): string {
  return ref ? `${RECAP_BASE}/${encodeURIComponent(ref)}` : RECAP_HOME;
}

/** The recap reference `/recap/<ref>` names, or null for the gallery; a query is ignored. */
export function parseRecapPath(path: string): string | null {
  const q = path.indexOf('?');
  const bare = q >= 0 ? path.slice(0, q) : path;
  if (bare !== RECAP_BASE && !bare.startsWith(`${RECAP_BASE}/`)) return null;
  const rest = bare.slice(RECAP_BASE.length).replace(/^\//, '').split('/')[0];
  if (!rest || rest === 'home') return null;
  return decodeURIComponent(rest);
}
