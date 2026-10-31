/**
 * Where you are in the Mosaic instrument, as a route — the atlas's rule
 * (`atlas/atlas-route.ts`): `/mosaic/home` is the gallery, `/mosaic/<mosaic>`
 * one mosaic in the editor, where `<mosaic>` is the trips' readable reference
 * (`<slug>-<first 8 of the id>`), so renaming a mosaic never breaks a link.
 * A bare `/mosaic` lands on the gallery.
 *
 * Pure and DOM-free.
 */

import { tripFromRef, tripRef } from '../../shared/roadtrip/trip-route';

export const MOSAIC_BASE = '/mosaic';
export const MOSAIC_HOME = '/mosaic/home';

export function mosaicRef(mosaic: { id: string; title: string }): string {
  return tripRef({ id: mosaic.id, name: mosaic.title });
}

export function mosaicFromRef<T extends { id: string }>(ref: string, mosaics: readonly T[]): T | null {
  return tripFromRef(ref, mosaics);
}

export function mosaicPath(ref: string | null): string {
  return ref ? `${MOSAIC_BASE}/${encodeURIComponent(ref)}` : MOSAIC_HOME;
}

/** The mosaic reference `/mosaic/<ref>` names, or null for the gallery; a query is ignored. */
export function parseMosaicPath(path: string): string | null {
  const q = path.indexOf('?');
  const bare = q >= 0 ? path.slice(0, q) : path;
  if (bare !== MOSAIC_BASE && !bare.startsWith(`${MOSAIC_BASE}/`)) return null;
  const rest = bare.slice(MOSAIC_BASE.length).replace(/^\//, '').split('/')[0];
  if (!rest || rest === 'home') return null;
  return decodeURIComponent(rest);
}
