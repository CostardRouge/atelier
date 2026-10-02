/**
 * Looking a place up by name, against OpenStreetMap's Nominatim.
 *
 * It lives in `shared/map/` beside `track-map.ts` on purpose: that file already
 * holds the OSM tile URL, so this folder is where anyone auditing "what does
 * this app actually fetch" will look. Scattering a second third-party URL
 * elsewhere is how a local-first promise stops being checkable.
 *
 * THE RULES THIS MODULE EXISTS TO ENFORCE, because it is the suite's second
 * network exception and the first one that sends *text the user typed*:
 *
 * - It is opt-in and off by default (`use-place-search-pref.ts`). Nothing here
 *   runs at boot, and nothing runs because a component mounted.
 * - There is NO search-as-you-type. Nominatim's usage policy caps callers at
 *   one request a second and asks for an identifying User-Agent, which a
 *   browser cannot set. One deliberate keystroke — Enter, or a click — is one
 *   request, which respects the cap and keeps what leaves the machine to what
 *   the author chose to send.
 * - Only the query string ever leaves. No photograph, no coordinate we already
 *   hold, no trip.
 * - Everything it offers is optional: a place typed by hand, with no
 *   coordinates, is a complete place.
 *
 * The fetch is one thin function; the URL building and the response parsing are
 * pure and tested, which is the split the rest of the repo uses.
 */

/**
 * One candidate a search came back with. Since 2026-10-02 it KEEPS what the
 * structured address says, field by field, instead of folding the two
 * outermost levels into one string: a place that is picked may then remember
 * its county, its state and that state's code, and its country
 * (`TripPlace`). Every field is `''` where the answer had none.
 */
export interface PlaceResult {
  /** The place said out loud — "Kalbarri". */
  name: string;
  /** Where it sits, in one line — "Western Australia, Australia". */
  region: string;
  lat: number;
  lon: number;
  /** The county, shire, district or municipality — "Shire of Northampton". */
  area: string;
  /** The state, province or region — "Western Australia". */
  state: string;
  /** The state's code, the second half of its ISO 3166-2 — "AU-WA" → "WA". */
  stateCode: string;
  /** The country said out loud — "Australia". */
  country: string;
  /** ISO 3166-1 alpha-2, upper case — "AU". */
  countryCode: string;
}

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';

/** What a person is told when the service cannot be reached at all. */
export const OFFLINE_MESSAGE =
  'Could not reach the place search — you may be offline. Type the place by hand instead.';

/** How many candidates one search asks for. Enough to choose, few enough to read. */
export const PLACE_RESULT_LIMIT = 5;

/**
 * The one URL this module can build, so a test can assert exactly what would
 * leave the machine. `format=jsonv2` is the documented stable projection;
 * `addressdetails=1` asks for the structured address — the state, its ISO
 * code, the county, the country — which is the SAME request (nothing more of
 * ours leaves) answered in more fields, so a picked place can keep them.
 */
export function nominatimUrl(query: string, limit = PLACE_RESULT_LIMIT): string {
  const params = new URLSearchParams({
    q: query.trim(),
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(Math.max(1, Math.trunc(limit))),
  });
  return `${NOMINATIM_SEARCH}?${params.toString()}`;
}

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * "Kalbarri, Shire of Northampton, Western Australia, 6536, Australia" →
 * "Western Australia, Australia". The head is the place itself, postcodes are
 * noise on a badge, and the two outermost administrative levels are what a
 * reader actually wants under a place name.
 */
export function regionFromDisplayName(displayName: string): string {
  const parts = displayName
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^\d[\d\s-]*$/.test(part));
  return parts.slice(1).slice(-2).join(', ');
}

/** The first of these keys the address carries, trimmed, or ''. */
function firstOf(address: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = address[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * Nominatim's `address` object → the fields a place keeps. The state's code
 * is the `ISO3166-2-lvl4` entry ("AU-WA"), whose second half is what a
 * reader calls the state; a code with no dash is not one and is dropped.
 * Everything is optional on the wire and `''` here when absent.
 */
export function placeDetails(address: unknown): Pick<PlaceResult, 'area' | 'state' | 'stateCode' | 'country' | 'countryCode'> {
  const a = address && typeof address === 'object' ? (address as Record<string, unknown>) : {};
  const iso = firstOf(a, ['ISO3166-2-lvl4', 'ISO3166-2-lvl3', 'ISO3166-2-lvl5']);
  const dash = iso.indexOf('-');
  return {
    area: firstOf(a, ['county', 'state_district', 'municipality', 'city_district', 'district']),
    state: firstOf(a, ['state', 'province', 'region', 'territory']),
    stateCode: dash > 0 ? iso.slice(dash + 1).toUpperCase() : '',
    country: firstOf(a, ['country']),
    countryCode: firstOf(a, ['country_code']).toUpperCase(),
  };
}

/**
 * Nominatim's answer → the candidates we can use. It never throws and it drops
 * any row it cannot fully trust, the same discipline `parseTripFile` follows:
 * a malformed response should cost you a result, never the panel you are in.
 */
export function parsePlaceResults(json: unknown): PlaceResult[] {
  if (!Array.isArray(json)) return [];
  const out: PlaceResult[] = [];
  for (const row of json) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const lat = finite(r.lat);
    const lon = finite(r.lon);
    // Bounds only. Unlike the DJI track (`flight-path.ts`), 0,0 is NOT rejected
    // here: there it means the aircraft has not got a fix yet, here it is a
    // genuine answer about a genuine point in the Gulf of Guinea.
    if (lat === null || lon === null) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const display = typeof r.display_name === 'string' ? r.display_name : '';
    const head = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : '';
    const name = head || display.split(',')[0]?.trim() || '';
    if (!name) continue;
    const details = placeDetails(r.address);
    // The one-line region prefers the structured answer, and falls back to the
    // display name's two outermost levels where the address said nothing.
    const structured = [details.state, details.country].filter(Boolean).join(', ');
    out.push({ name, region: structured || regionFromDisplayName(display), lat, lon, ...details });
  }
  return out;
}

/**
 * Ask Nominatim. The caller passes an `AbortSignal` so a second search cancels
 * the first — one search in flight at a time is both the polite reading of the
 * usage policy and the only way the results list cannot arrive out of order.
 *
 * An empty query never reaches the network.
 */
export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<PlaceResult[]> {
  if (!query.trim()) return [];
  let response: Response;
  try {
    response = await fetch(nominatimUrl(query), {
      signal,
      headers: { Accept: 'application/json' },
      // Nothing of ours belongs in a third-party request.
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
    });
  } catch (err) {
    // An aborted search is the caller replacing it, not a failure to report.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Everything else arrives as the browser's bare "Failed to fetch", which
    // tells a person nothing they can act on. Say what it means and what still
    // works — the same contract `parseTripFile` holds itself to.
    throw new Error(OFFLINE_MESSAGE);
  }
  if (!response.ok) {
    // 429 is the one a polite caller still meets: the service is shared.
    throw new Error(
      response.status === 429
        ? 'The place search is rate-limited right now — wait a moment, or type the place by hand.'
        : `The place search answered ${response.status}. You can type the place by hand instead.`,
    );
  }
  return parsePlaceResults(await response.json());
}
