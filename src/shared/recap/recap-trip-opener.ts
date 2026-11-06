/**
 * Virée and Itinerary at the head of a recap (lab 7, his yes of 2026-11-06:
 * «offered only when a trip of Trips covers the recap's days»). Trips' own
 * variants run unchanged (`hookVariantById`): the TRIP gives the road, the
 * legs, the vehicle and the way places are written; the RECAP gives the stops
 * — its shown pictures that carry a GPS, in time order — and the stills they
 * show. With fewer than two located pictures the trip's own places over those
 * days are the stops.
 *
 * The context is the one Trips builds (`hookContextFor`) for a piece dated on
 * the recap's last day that no other piece is — so the calendar is the
 * trip's, untouched.
 *
 * Pure but for the variants' own `ready` (fonts, an OSM ground the trip asked).
 */

import { hookContextFor } from '../roadtrip/hooks/hook-context';
import { hookVariantById } from '../roadtrip/hooks/registry';
import { sampleEvenly } from '../roadtrip/hooks/picked';
import type { HookPicture, HookPickedPicture, HookRender } from '../roadtrip/hooks/hook-variant';
import type { TripDoc, TripPost } from '../roadtrip/trip-types';
import type { RecapPicture } from './recap-doc';
import type { Drawable } from './recap-paint';
import type { TripOpenerPlan } from './recap-opener-plan';

const DAY_MS = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** The trip whose days cover the most of `days` (one at least), else null. */
export function tripCovering(trips: readonly TripDoc[], days: readonly string[]): TripDoc | null {
  if (!days.length) return null;
  const sorted = [...days].sort();
  const from = dayMs(sorted[0]);
  const to = dayMs(sorted[sorted.length - 1]);
  let best: TripDoc | null = null;
  let bestDays = 0;
  for (const t of trips) {
    if (!t.startDate || !t.endDate) continue;
    const overlap = Math.floor((Math.min(to, dayMs(t.endDate)) - Math.max(from, dayMs(t.startDate))) / DAY_MS) + 1;
    if (overlap > bestDays) {
      best = t;
      bestDays = overlap;
    }
  }
  return best;
}

/** A recap picture as a picked picture of Trips: found again by its key (`id:<key>`), on its day, at its moment and place. */
export function pickedOf(p: RecapPicture): HookPickedPicture | null {
  if (!p.day) return null;
  return {
    ref: { name: p.name, size: 0, lastModified: 0, assetId: p.key },
    date: p.day,
    takenAt: dayMs(p.day) + (p.second !== undefined ? p.second * 1000 : (p.minute ?? 720) * 60_000),
    ...(p.lat !== undefined && p.lon !== undefined ? { coords: { lat: p.lat, lon: p.lon } } : {}),
  };
}

/** The pictures a variant draws, read from the painter's stills at the moment it paints. */
class StillMap extends Map<string, HookPicture> {
  read: (key: string) => Drawable | null = () => null;
  override get(key: string): HookPicture | undefined {
    if (!key.startsWith('id:')) return undefined;
    const d = this.read(key.slice(3));
    return d ? { image: d.image, width: d.width, height: d.height } : undefined;
  }
  override has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}

/**
 * Virée (`drive`) or Itinerary (`map`) over `trip`, its stops the recap's
 * located `pictures` within the trip, dated on `lastDay`. Null when the
 * variant cannot run (unmet) or plays nothing.
 */
export function planTripOpener(kind: 'drive' | 'map', trip: TripDoc, pictures: readonly RecapPicture[], lastDay: string, aspect: number): TripOpenerPlan | null {
  const variant = hookVariantById(kind);
  if (!variant) return null;
  const inTrip = pictures.filter((p) => p.day && p.day >= trip.startDate && p.day <= trip.endDate);
  const picked = inTrip.flatMap((p) => {
    const k = pickedOf(p);
    return k ? [k] : [];
  });
  // Eight stops at most for a drive, twelve for a map: an opener is the first seconds, not the trip again.
  const located = sampleEvenly(picked.filter((p) => p.coords), kind === 'drive' ? 8 : 12);
  const stills = new StillMap();
  const day = lastDay < trip.startDate ? trip.startDate : lastDay > trip.endDate ? trip.endDate : lastDay;
  // A piece of the trip that is no other: its day the recap's last, its timing the opener's own.
  const post = { id: '__recap__', date: day, badge: { durationSeconds: 4, mode: 'day' } } as unknown as TripPost;
  const ctx = hookContextFor(trip, post, aspect, null, stills, { durationSeconds: 6, screenSeconds: 6 });
  if (variant.unmet?.(ctx)) return null;
  const options = {
    ...variant.defaults,
    ...(located.length >= 2 ? { stopsOn: 'pictures', picked: located } : { stopsOn: 'places', picked }),
    includePieces: false,
    // The recap's cover follows: no summary card of the trip, short halts.
    ...(kind === 'drive' ? { summary: false, secondsPerPicture: 0.45 } : { size: 1.1, plate: true }),
  };
  let render: HookRender;
  try {
    render = variant.prepare(options, ctx);
  } catch {
    return null;
  }
  if (!(render.seconds > 0) || !render.paint) return null;
  const paint = render.paint.bind(render);
  return {
    kind,
    seconds: Math.max(1, render.seconds),
    keys: (located.length >= 2 ? located : picked).map((p) => p.ref.assetId!),
    paint(g, w, h, t, read) {
      stills.read = read ?? (() => null);
      // A frame of ink under it: the variants own the frame but may leave its edges.
      g.fillStyle = '#141210';
      g.fillRect(0, 0, w, h);
      paint(g, Math.min(t, render.seconds), { width: w, height: h });
    },
    ...(render.ready ? { ready: () => render.ready!(0, render.seconds) } : {}),
    tripName: trip.name,
  };
}
