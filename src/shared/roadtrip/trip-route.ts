/**
 * Where you are in Road Trip, expressed as a route.
 *
 * It used to be component state, which cost the obvious thing: coming back
 * from a piece dropped you on the trip's FIRST day rather than the day you
 * were working on. A trip is 300 days long; that is a real loss every time.
 * Putting the trip, the day and the piece in the hash fixes the back button,
 * survives a reload, and makes a day linkable.
 *
 * The trip's part is `<slug>-<first 8 of its id>` — `australia-3b525ba1`. The
 * slug is there to be read and is otherwise ignored; the id fragment is what
 * resolves, so renaming a trip cannot break a link and two trips called
 * "Australia" stay distinguishable. The day is a plain `YYYY-MM-DD`, which is
 * the one part anyone actually reads.
 *
 * Pure and DOM-free.
 */

import { isIsoDate, type IsoDate } from './trip-days';

/** How many characters of the id go in a reference. */
const ID_CHARS = 8;

export const ROADTRIP_BASE = '/roadtrip';
export const ROADTRIP_HOME = '/roadtrip/home';

/** `Australie / Ouest` → `australie-ouest`. Empty for a nameless trip. */
export function tripSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** The readable-but-resolvable reference for a trip. */
export function tripRef(trip: { id: string; name: string }): string {
  const slug = tripSlug(trip.name);
  const tail = trip.id.replace(/-/g, '').slice(0, ID_CHARS);
  return slug ? `${slug}-${tail}` : tail;
}

/**
 * The trip a reference points at, or null. Matched on the id fragment alone,
 * so a renamed trip keeps every link that was ever made to it.
 */
export function tripFromRef<T extends { id: string }>(
  ref: string,
  trips: readonly T[],
): T | null {
  if (!ref) return null;
  const tail = ref.slice(-ID_CHARS).toLowerCase();
  const flat = (id: string) => id.replace(/-/g, '').toLowerCase();
  return (
    trips.find((t) => flat(t.id).startsWith(tail)) ??
    // A full id in the path (an older link, or one typed by hand) still works.
    trips.find((t) => t.id.toLowerCase() === ref.toLowerCase()) ??
    null
  );
}

export interface RoadtripRoute {
  /** The gallery, when nothing else is addressed. */
  ref: string | null;
  date: IsoDate | null;
  postId: string | null;
}

const NOWHERE: RoadtripRoute = { ref: null, date: null, postId: null };

/**
 * Read `/roadtrip/<ref>/<date>/<postId>`, any tail of which may be absent.
 * `/roadtrip` and `/roadtrip/home` both mean the gallery; a date that is not
 * a real calendar day is dropped rather than carried, along with anything
 * that followed it — half a route is worse than none.
 */
export function parseRoadtripPath(path: string): RoadtripRoute {
  if (!path.startsWith(ROADTRIP_BASE)) return NOWHERE;
  const rest = path.slice(ROADTRIP_BASE.length).replace(/^\//, '');
  if (!rest || rest === 'home') return NOWHERE;
  const [ref, date, postId] = rest.split('/').map((p) => decodeURIComponent(p));
  if (!date) return { ref, date: null, postId: null };
  if (!isIsoDate(date)) return { ref, date: null, postId: null };
  return { ref, date, postId: postId || null };
}

/** The path for a place in the tool. Omit what you are not addressing. */
export function roadtripPath(
  ref: string,
  date?: IsoDate | null,
  postId?: string | null,
): string {
  const parts = [ROADTRIP_BASE, encodeURIComponent(ref)];
  if (date) {
    parts.push(date);
    if (postId) parts.push(encodeURIComponent(postId));
  }
  return parts.join('/');
}
