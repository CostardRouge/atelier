/**
 * Naming a place from its coordinates, offline — the last step of the
 * itinerary deduction, and the one that decides whether its proposals can be
 * read at all. A leg that comes out as "2025-11-02 → 2025-11-05" is a row
 * nobody can accept or refuse; "Kalbarri" is.
 *
 * **It is an index that ships with the app, never a lookup going out.** The
 * suite's only place lookup (`shared/map/geocode.ts`) is an opt-in network
 * exception carrying text the author typed. Reverse-geocoding a deduced leg
 * would send the coordinates of their photographs instead — a larger claim on
 * someone's data, for a name — so the answer comes from our own origin and the
 * README's network callout is unchanged. `scripts/gen-gazetteer.mjs` builds
 * the file; GeoNames is CC BY 4.0 and the attribution rides inside it.
 *
 * **No answer is a real answer.** Past `maxKm` this returns null, and the leg
 * keeps a span and no place — `importTimeline` only keeps a named place, so a
 * leg nobody can name arrives with its dates and nothing else. That is the
 * anti-fabrication line the whole tool holds, met once more: the battery gauge
 * drawing "—", the stage counter falling back rather than inventing a place.
 *
 * This module is PURE and never fetches — `load-gazetteer.ts` is the half that
 * does, split for the reason `saved-grade.ts` and `restore-grade.ts` are:
 * anything reading `import.meta.env` or the network drags a test run into the
 * bundler's world.
 */

import { haversineKm, type GeoPoint } from './hooks/geo';

export interface GazetteerCity {
  /** The place as GeoNames says it out loud ("Kalbarri"). */
  name: string;
  /** ISO 3166-1 alpha-2, to tell two places of one name apart. */
  country: string;
  lat: number;
  lon: number;
  population: number;
  /**
   * A district or suburb (GeoNames `PPLX`) rather than a place in its own
   * right — named only when nothing else is near.
   */
  section: boolean;
}

/**
 * Two cities this close to each other are, for naming purposes, the same
 * answer — so something other than distance has to decide. Without it a leg
 * sitting between a town and its suburb is named after whichever is a
 * kilometre nearer, which is not the name a person would have written.
 *
 * Measured against the real index: at Perth's centre the nearest row is
 * Northbridge, a suburb 0 km away, with Perth itself a few hundred metres
 * further; at Broome the nearest is the town, but GeoNames gives its suburb
 * Cable Beach a LARGER population. So neither distance nor population alone
 * is enough, and the order below is what gets both right.
 */
export const TIE_KM = 5;

/** How far a leg may be from a city and still be called by its name. */
export const DEFAULT_MAX_KM = 90;

/**
 * The committed file, validated. Rows it cannot read are dropped rather than
 * failing the whole index: a gazetteer that refuses to load takes the naming
 * of every leg with it, while a dropped row costs one name.
 */
export function parseGazetteer(raw: unknown): GazetteerCity[] {
  const rows = (raw as { cities?: unknown })?.cities;
  if (!Array.isArray(rows)) return [];

  const cities: GazetteerCity[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const [name, country, lat, lon, population, section] = row as unknown[];
    if (typeof name !== 'string' || !name) continue;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    cities.push({
      name,
      country: typeof country === 'string' ? country : '',
      lat,
      lon,
      population: typeof population === 'number' && population > 0 ? population : 0,
      section: section === 1 || section === true,
    });
  }
  return cities;
}

/** Degrees of longitude between two meridians, the short way round. */
function lonGap(a: number, b: number): number {
  const gap = Math.abs(a - b) % 360;
  return gap > 180 ? 360 - gap : gap;
}

const KM_PER_DEGREE = 111.32;

/**
 * The nearest city to `point`, or null when none is within `maxKm`.
 *
 * A bounding box in degrees rejects almost every row before any trigonometry:
 * the index is 135 000 cities and a trip asks about thirty legs, so a naive
 * pass would be four million great-circle solves for thirty names. The box is
 * deliberately generous — it only has to be a superset, and `haversineKm`
 * settles what is actually inside.
 */
export function nearestCity(
  cities: readonly GazetteerCity[],
  point: GeoPoint,
  maxKm: number = DEFAULT_MAX_KM,
): GazetteerCity | null {
  const latWindow = maxKm / KM_PER_DEGREE;
  // Near a pole, and for a window that spans the globe, the longitude filter
  // stops meaning anything — drop it rather than compute a wrong bound.
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  const lonWindow = cosLat > 0.02 ? maxKm / (KM_PER_DEGREE * cosLat) : 181;

  const near: { city: GazetteerCity; km: number }[] = [];
  let bestKm = Infinity;

  for (const city of cities) {
    if (Math.abs(city.lat - point.lat) > latWindow) continue;
    if (lonWindow <= 180 && lonGap(city.lon, point.lon) > lonWindow) continue;

    const km = haversineKm(point, city);
    if (km > maxKm) continue;
    near.push({ city, km });
    if (km < bestKm) bestKm = km;
  }

  if (!near.length) return null;

  // Two passes, so the answer cannot depend on the order the rows arrived in:
  // the nearest sets the bar, then everything within `TIE_KM` of it competes.
  // A one-pass version reads shorter and quietly gives two different names for
  // two orderings of the same index.
  //
  // The contest, in order: a place beats a SECTION of a place, then the bigger
  // population, then the nearer, then the name — so the last two candidates
  // can never both be "best" and the answer is total.
  const tied = near.filter((c) => c.km <= bestKm + TIE_KM);
  let best = tied[0];
  for (const candidate of tied) {
    if (candidate === best) continue;
    if (candidate.city.section !== best.city.section) {
      if (!candidate.city.section) best = candidate;
    } else if (candidate.city.population !== best.city.population) {
      if (candidate.city.population > best.city.population) best = candidate;
    } else if (candidate.km !== best.km) {
      if (candidate.km < best.km) best = candidate;
    } else if (candidate.city.name < best.city.name) {
      best = candidate;
    }
  }

  return best.city;
}
