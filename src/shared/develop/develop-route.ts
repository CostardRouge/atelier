/**
 * Where you are in the Develop tool, expressed as a route — Trips' rule
 * (`roadtrip/trip-route.ts`): the document is in the hash, so Back, a reload
 * and a link all land on the roll you were on.
 *
 * `/develop/home` is the gallery; `/develop/<roll>` a roll, where `<roll>` is
 * the trip's readable-but-resolvable reference (`<slug>-<first 8 of the id>`),
 * so renaming a roll never breaks a link; `/develop/<roll>/<picture>` names a
 * picture on it (read now, drawn by the editor phase).
 *
 * Pure and DOM-free.
 */

import { tripFromRef, tripRef } from '../roadtrip/trip-route';

export const DEVELOP_BASE = '/develop';
export const DEVELOP_HOME = '/develop/home';

export interface DevelopRoute {
  /** Null is the gallery. */
  ref: string | null;
  pictureId: string | null;
}

const NOWHERE: DevelopRoute = { ref: null, pictureId: null };

/** The reference a roll goes by in a route. Generic over `{ id, name }` — the trip's own. */
export function rollRef(roll: { id: string; name: string }): string {
  return tripRef(roll);
}

/** The roll a reference points at, matched on its id fragment alone. */
export function rollFromRef<T extends { id: string }>(ref: string, rolls: readonly T[]): T | null {
  return tripFromRef(ref, rolls);
}

/** The path for a roll (and a picture on it); no roll is the gallery. */
export function developPath(ref: string | null, pictureId: string | null = null): string {
  if (!ref) return DEVELOP_HOME;
  const base = `${DEVELOP_BASE}/${encodeURIComponent(ref)}`;
  return pictureId ? `${base}/${encodeURIComponent(pictureId)}` : base;
}

/** Read `/develop/<ref>/<picture>`, any tail of which may be absent; a query is ignored. */
export function parseDevelopPath(path: string): DevelopRoute {
  const q = path.indexOf('?');
  const bare = q >= 0 ? path.slice(0, q) : path;
  if (bare !== DEVELOP_BASE && !bare.startsWith(`${DEVELOP_BASE}/`)) return NOWHERE;
  const rest = bare.slice(DEVELOP_BASE.length).replace(/^\//, '');
  if (!rest || rest === 'home') return NOWHERE;
  const [ref, pictureId] = rest.split('/').map((p) => decodeURIComponent(p));
  if (!ref) return NOWHERE;
  return { ref, pictureId: pictureId || null };
}
