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

/**
 * A link from a Winnow into Road Trip — a PROPOSAL the person confirms on a
 * screen, never an action the URL performs (`docs/winnow-timeline.md` §5.5).
 *
 * `source` is the instance's host, as `sourceIdFor()` mints it. The URL may
 * say what to open, never where to fetch from: the shell resolves the host
 * against the connections this browser already holds and falls through to
 * `#/connect` when it is not one of them. `chapters` narrows a seed to the
 * legs the link named ("Make a Road Trip from this leg"); empty means all.
 */
export interface TimelineLink {
  /** `seed` creates a trip from the timeline; `complete` reconciles into one. */
  kind: 'seed' | 'complete';
  source: string;
  chapters: string[];
}

export interface RoadtripRoute {
  /** The gallery, when nothing else is addressed. */
  ref: string | null;
  date: IsoDate | null;
  postId: string | null;
  /** Set when the route is a timeline link; absent on an ordinary route. */
  link?: TimelineLink;
}

const NOWHERE: RoadtripRoute = { ref: null, date: null, postId: null };

/** A host, and only a host — no scheme, no path, no space. */
const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i;

/** The `?source=…&chapters=…` part of a link, or null when it names no source. */
function parseLinkQuery(query: string): { source: string; chapters: string[] } | null {
  const params = new URLSearchParams(query);
  const source = (params.get('source') ?? '').trim().toLowerCase();
  if (!source || !HOST_RE.test(source)) return null;
  const chapters = params
    .getAll('chapters')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return { source, chapters };
}

/**
 * Read `/roadtrip/<ref>/<date>/<postId>`, any tail of which may be absent.
 * `/roadtrip` and `/roadtrip/home` both mean the gallery; a date that is not
 * a real calendar day is dropped rather than carried, along with anything
 * that followed it — half a route is worse than none.
 *
 * Two more shapes are the timeline links: `/roadtrip/new?source=<host>` seeds
 * a trip, `/roadtrip/<ref>/import?source=<host>` completes one. A link with
 * no usable source is read as the plain route underneath it.
 */
export function parseRoadtripPath(path: string): RoadtripRoute {
  if (!path.startsWith(ROADTRIP_BASE)) return NOWHERE;
  const q = path.indexOf('?');
  const query = q >= 0 ? path.slice(q + 1) : '';
  const bare = q >= 0 ? path.slice(0, q) : path;
  const rest = bare.slice(ROADTRIP_BASE.length).replace(/^\//, '');
  if (!rest || rest === 'home') return NOWHERE;
  const [ref, second, third] = rest.split('/').map((p) => decodeURIComponent(p));
  if (ref === 'new') {
    const link = parseLinkQuery(query);
    return link ? { ...NOWHERE, link: { kind: 'seed', ...link } } : NOWHERE;
  }
  if (second === 'import') {
    const link = parseLinkQuery(query);
    return link
      ? { ref, date: null, postId: null, link: { kind: 'complete', ...link } }
      : { ref, date: null, postId: null };
  }
  const date = second;
  const postId = third;
  if (!date) return { ref, date: null, postId: null };
  if (!isIsoDate(date)) return { ref, date: null, postId: null };
  return { ref, date, postId: postId || null };
}

/**
 * The path a Winnow puts behind "Make a Road Trip from this leg" (`seed`, no
 * ref) or "Complete this trip" (`complete`, with the trip's ref).
 */
export function timelineLinkPath(link: TimelineLink, ref?: string | null): string {
  const params = new URLSearchParams({ source: link.source });
  if (link.chapters.length) params.set('chapters', link.chapters.join(','));
  const head =
    link.kind === 'seed'
      ? `${ROADTRIP_BASE}/new`
      : `${ROADTRIP_BASE}/${encodeURIComponent(ref ?? '')}/import`;
  return `${head}?${params.toString()}`;
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
