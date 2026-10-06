/**
 * How a place is WRITTEN, and where its short code comes from.
 *
 * A place keeps facts (`TripPlace`: a name, a state, a code or three, a
 * country, two dates). This module turns them into the string a surface
 * shows — «Sydney, NSW» · «Sydney, New South Wales» · «Sydney (NSW)» ·
 * «Sydney» — and settles the one fact that has several candidates, the
 * state's short code.
 *
 * Two rules, both the maintainer's (2026-10-01 / 2026-10-02):
 *
 * - **The writing CASCADES** like the look does — the place's own, else its
 *   stage's, else the trip's for that kind of surface (`badge` has little
 *   room, `lists` has plenty); nearest wins and absent means «like above».
 * - **No table of codes is shipped.** A state's code is the place's OWN when
 *   the author wrote one, else the TRIP's table (filled by the author, one
 *   state at a time, from a place where a code was corrected), else what the
 *   SEARCH gave (the second half of an ISO 3166-2), else DERIVED from the
 *   name — and a place may be pinned to any of the three it has
 *   (`codeFrom`), so the author can always prefer the search's value, the
 *   table's or their own. The derivation is a last resort said out loud: it
 *   is right for «New South Wales» and wrong for «Queensland», which is what
 *   the table is for.
 *
 * Pure and DOM-free.
 */

import { formatDayMonth, isWithin, parseIsoDate, type IsoDate } from './trip-days';
import { PLACE_ARROW, stageEnd, stageStart } from './trip-places';
// Types only: `trip-types.ts` imports THIS module's default, and a value the
// other way round is the cycle that left `day-badge.ts` half-loaded in tests.
import type { PlaceCodeFrom, PlaceStyle, TripDoc, TripPlace, TripPlaceStyle, TripStage } from './trip-types';

export type PlaceSurface = keyof TripPlaceStyle;

/**
 * Today's writing exactly on the badge — the name alone, the region on its
 * own caption line as it always was — and the short code in the lists, so
 * what a place keeps is seen where there is room for it.
 */
export const DEFAULT_PLACE_STYLE: TripPlaceStyle = { badge: 'name', lists: 'code' };

export const PLACE_STYLE_OPTIONS: readonly { id: PlaceStyle; label: string; example: string }[] = [
  { id: 'code', label: 'Name, code', example: 'Sydney, NSW' },
  { id: 'full', label: 'Name, state', example: 'Sydney, New South Wales' },
  { id: 'paren', label: 'Name (code)', example: 'Sydney (NSW)' },
  { id: 'name', label: 'Name only', example: 'Sydney' },
];

/** Where a resolved code came from — the three a place may wear, plus the two fallbacks. */
export type CodeFrom = PlaceCodeFrom | 'derived' | 'none';

export interface StateCode {
  code: string;
  from: CodeFrom;
}

export const CODE_FROM_WORDS: Record<CodeFrom, string> = {
  own: 'this place’s own',
  table: 'the trip’s table',
  search: 'the search',
  derived: 'derived from the name',
  none: 'no state',
};

/** Words an acronym skips: «Australian Capital Territory» → ACT, «Île-de-France» → IDF. */
const SMALL_WORDS = new Set(['of', 'the', 'and', 'de', 'du', 'des', 'la', 'le', 'les', 'et', 'd', 'l', 'y', 'del', 'di', 'da', 'do', 'dos', 'das', 'van', 'von']);

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * A code from a state's name alone: the initials of its words (small words
 * skipped), or the first three letters of a single word. «New South Wales» →
 * NSW, «Western Australia» → WA, «Bretagne» → BRE — and «Queensland» → QUE,
 * which is why this is the LAST rung and never the first.
 */
export function deriveStateCode(state: string): string {
  const words = fold(state)
    .split(/[\s\-'’]+/)
    .filter((word) => word.length > 0 && !SMALL_WORDS.has(word.toLowerCase()));
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map((word) => word[0]).join('').toUpperCase();
}

function sameState(a: string, b: string): boolean {
  return fold(a).trim().toLowerCase() === fold(b).trim().toLowerCase();
}

/** The trip's table, read by the state's name — accents and case forgiven. */
export function tableCode(codes: Record<string, string>, state: string): string {
  if (!state.trim()) return '';
  const exact = codes[state.trim()];
  if (exact) return exact;
  for (const [key, code] of Object.entries(codes)) if (sameState(key, state)) return code;
  return '';
}

/** Every code this place could wear, empty where it has none. */
export function codeCandidates(
  place: Pick<TripPlace, 'state' | 'stateCode' | 'searchCode'>,
  trip: Pick<TripDoc, 'stateCodes'>,
): Record<PlaceCodeFrom | 'derived', string> {
  return {
    own: (place.stateCode ?? '').trim(),
    table: tableCode(trip.stateCodes ?? {}, place.state),
    search: (place.searchCode ?? '').trim(),
    derived: deriveStateCode(place.state),
  };
}

/**
 * The code a place wears: the rung it is pinned to when that rung has a
 * value, else the automatic order own → table → search → derived. A pin on
 * a rung that went empty (the table entry was removed) falls through rather
 * than showing nothing — the pin is a preference, not a fact.
 */
export function stateCodeFor(
  place: Pick<TripPlace, 'state' | 'stateCode' | 'searchCode' | 'codeFrom'>,
  trip: Pick<TripDoc, 'stateCodes'>,
): StateCode {
  if (!place.state.trim()) return { code: '', from: 'none' };
  const c = codeCandidates(place, trip);
  if (place.codeFrom && c[place.codeFrom]) return { code: c[place.codeFrom], from: place.codeFrom };
  for (const from of ['own', 'table', 'search'] as const) if (c[from]) return { code: c[from], from };
  return { code: c.derived, from: c.derived ? 'derived' : 'none' };
}

export interface ResolvedStyle {
  style: PlaceStyle;
  from: 'place' | 'stage' | 'trip';
}

/** The cascade: the place's own, else its stage's, else the trip's for this surface. */
export function placeStyleFor(
  place: Pick<TripPlace, 'style'>,
  stage: Pick<TripStage, 'placeStyle'> | null,
  trip: Pick<TripDoc, 'placeStyle'>,
  surface: PlaceSurface,
): ResolvedStyle {
  if (place.style) return { style: place.style, from: 'place' };
  if (stage?.placeStyle) return { style: stage.placeStyle, from: 'stage' };
  return { style: trip.placeStyle[surface], from: 'trip' };
}

/**
 * The place in one writing. A style that asks for what the place lacks
 * degrades to the next thing it has — «Sydney, NSW» with no code becomes
 * «Sydney, New South Wales», and with no state «Sydney» — never a dangling
 * comma, never an invented code.
 */
export function writePlace(
  place: Pick<TripPlace, 'name' | 'state' | 'stateCode' | 'searchCode' | 'codeFrom'>,
  style: PlaceStyle,
  trip: Pick<TripDoc, 'stateCodes'>,
): string {
  const name = place.name.trim();
  const state = place.state.trim();
  if (!name || !state || style === 'name') return name;
  if (style === 'full') return `${name}, ${state}`;
  const { code } = stateCodeFor(place, trip);
  if (!code) return `${name}, ${state}`;
  return style === 'paren' ? `${name} (${code})` : `${name}, ${code}`;
}

/** A trip as the writing needs it; a caller holding less than a document passes what it has. */
export type PlaceWritingTrip = Partial<Pick<TripDoc, 'placeStyle' | 'stateCodes'>>;

function whole(trip: PlaceWritingTrip): Pick<TripDoc, 'placeStyle' | 'stateCodes'> {
  return { placeStyle: trip.placeStyle ?? DEFAULT_PLACE_STYLE, stateCodes: trip.stateCodes ?? {} };
}

/** `writePlace` through the cascade — what a surface actually shows. */
export function placeText(place: TripPlace, stage: TripStage | null, trip: PlaceWritingTrip, surface: PlaceSurface): string {
  const t = whole(trip);
  return writePlace(place, placeStyleFor(place, stage, t, surface).style, t);
}

/**
 * The stage as a surface names it: the author's own name always wins
 * (`stageLabel`), else its two ends WRITTEN — «Kalbarri, WA → Exmouth, WA»
 * is said once, «Kalbarri → Exmouth, WA», when both ends share the state and
 * neither place departs from the cascade. Empty when the stage names nothing,
 * exactly like `stageLabel`, so every caller's fallback still holds.
 */
export function stageRoute(stage: TripStage, trip: PlaceWritingTrip, surface: PlaceSurface): string {
  const own = stage.name.trim();
  if (own) return own;
  const from = stageStart(stage);
  const to = stageEnd(stage);
  if (!from) return '';
  const t = whole(trip);
  if (!to || to.id === from.id) return placeText(from, stage, t, surface);
  const shared = from.state.trim() && from.state.trim() === to.state.trim() && !from.style && !to.style;
  const head = shared ? from.name.trim() : placeText(from, stage, t, surface);
  return `${head} ${PLACE_ARROW} ${placeText(to, stage, t, surface)}`;
}

/** The states the trip's places name, distinct, in the order they are met — what the table lists. */
export function statesOf(trip: Pick<TripDoc, 'stages'>): string[] {
  const seen: string[] = [];
  for (const stage of trip.stages ?? []) {
    for (const place of stage.places ?? []) {
      const state = place.state.trim();
      if (state && !seen.some((s) => sameState(s, state))) seen.push(state);
    }
  }
  return seen;
}

/** The trip with one more line in its table — or one less, when the code is emptied. */
export function rememberStateCode(trip: TripDoc, state: string, code: string): TripDoc {
  const key = state.trim();
  if (!key) return trip;
  const next = { ...trip.stateCodes };
  for (const existing of Object.keys(next)) if (sameState(existing, key)) delete next[existing];
  if (code.trim()) next[key] = code.trim();
  return { ...trip, stateCodes: next };
}

/**
 * A place's dates as one chip: nothing, «10 Nov», or «7–9 Nov» — the month
 * said once when both days share it. The year is the trip's.
 */
export function placeDates(place: Pick<TripPlace, 'arrived' | 'left'>): string {
  const from = place.arrived && parseIsoDate(place.arrived) !== null ? place.arrived : '';
  const to = place.left && parseIsoDate(place.left) !== null ? place.left : '';
  if (!from) return to ? formatDayMonth(to) : '';
  if (!to || to === from) return formatDayMonth(from);
  const [a, b] = [formatDayMonth(from), formatDayMonth(to)];
  const [ad, am] = a.split(' ');
  const [bd, bm] = b.split(' ');
  return am === bm ? `${ad}–${bd} ${bm}` : `${a}–${b}`;
}

/** A date outside the stage's span — kept and SAID, never corrected. */
export function datesOutsideStage(
  place: Pick<TripPlace, 'arrived' | 'left'>,
  stage: Pick<TripStage, 'startDate' | 'endDate'>,
): boolean {
  const outside = (iso: IsoDate | undefined) =>
    !!iso && parseIsoDate(iso) !== null && !isWithin(stage.startDate, stage.endDate, iso);
  return outside(place.arrived) || outside(place.left);
}

// --- the country, said on every line that writes a place -------------------

let regionNames: Intl.DisplayNames | null | undefined;

/**
 * A country's name from its ISO code — «AU» → «Australia» — by the
 * browser's own table (`Intl.DisplayNames`), so no list of countries ships.
 * The code itself where the engine has no table or does not know it.
 */
export function countryName(code: string | undefined): string {
  const cc = (code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return cc;
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

/** The code most of these places carry — the trip's country; '' when none says one. */
export function majorityCountry(codes: Iterable<string | undefined>): string {
  const count = new Map<string, number>();
  let best = '';
  let most = 0;
  for (const raw of codes) {
    const cc = (raw ?? '').trim().toUpperCase();
    if (!cc) continue;
    const n = (count.get(cc) ?? 0) + 1;
    count.set(cc, n);
    // The first to reach a count keeps it: ties go to the country met first.
    if (n > most) {
      most = n;
      best = cc;
    }
  }
  return best;
}

/** The trip's country: the code most of its places carry. */
export function tripCountry(trip: Pick<TripDoc, 'stages'>): string {
  return majorityCountry((trip.stages ?? []).flatMap((s) => (s.places ?? []).map((p) => p.countryCode)));
}

/** A place as one LINE of a list: its writing, and its country as a code and a name. */
export interface PlaceLine {
  /** `placeText` — «Exmouth, WA». */
  text: string;
  /**
   * The state as a column says it: in full where the writing is «Name,
   * state», else its code («WA»), else the state, else ''.
   */
  stateText: string;
  /** ISO 3166-1, upper case; '' when the place does not say. */
  countryCode: string;
  /** The place's own country name, else the code's, else ''. */
  countryName: string;
}

/** What every surface listing places reads, so the trip's writing is applied everywhere alike. */
export function placeLine(place: TripPlace, stage: TripStage | null, trip: PlaceWritingTrip, surface: PlaceSurface): PlaceLine {
  const code = (place.countryCode ?? '').trim().toUpperCase();
  const t = whole(trip);
  const state = place.state.trim();
  const full = placeStyleFor(place, stage, t, surface).style === 'full';
  return {
    text: placeText(place, stage, trip, surface),
    stateText: full ? state : stateCodeFor(place, t).code || state,
    countryCode: code,
    countryName: (place.country ?? '').trim() || countryName(code),
  };
}
