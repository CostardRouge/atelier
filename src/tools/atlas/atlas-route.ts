/**
 * Where you are in the Flight Atlas, as a route — the Develop tool's rule
 * (`develop/develop-route.ts`): `/atlas/home` is the gallery, `/atlas/<atlas>`
 * one atlas in the editor, where `<atlas>` is the trips' readable reference
 * (`<slug>-<first 8 of the id>`), so renaming an atlas never breaks a link.
 * A bare `/atlas` lands on the gallery.
 *
 * Pure and DOM-free.
 */

import { tripFromRef, tripRef } from '../../shared/roadtrip/trip-route';

export const ATLAS_BASE = '/atlas';
export const ATLAS_HOME = '/atlas/home';

export function atlasRef(atlas: { id: string; name: string }): string {
  return tripRef(atlas);
}

export function atlasFromRef<T extends { id: string }>(ref: string, atlases: readonly T[]): T | null {
  return tripFromRef(ref, atlases);
}

export function atlasPath(ref: string | null): string {
  return ref ? `${ATLAS_BASE}/${encodeURIComponent(ref)}` : ATLAS_HOME;
}

/** The atlas reference `/atlas/<ref>` names, or null for the gallery; a query is ignored. */
export function parseAtlasPath(path: string): string | null {
  const q = path.indexOf('?');
  const bare = q >= 0 ? path.slice(0, q) : path;
  if (bare !== ATLAS_BASE && !bare.startsWith(`${ATLAS_BASE}/`)) return null;
  const rest = bare.slice(ATLAS_BASE.length).replace(/^\//, '').split('/')[0];
  if (!rest || rest === 'home') return null;
  return decodeURIComponent(rest);
}
