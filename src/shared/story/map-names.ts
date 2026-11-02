/**
 * What a point of a Storytelling map SAYS (his ask, 2026-11-01, lab
 * https://claude.ai/artifact/SSPdrdACHyV98vNUtECsQ4, « tout me va »): two
 * lines, each one field of what the trip knows of the point — the place, the
 * town it is in or near, the state (whole or its code), the country, the
 * stage (the name of his share folder), the day of the trip, the date, the
 * kilometres so far — with a place WRITTEN as Trips writes it (`place-style.ts`:
 * « Perth, WA », « Perth, Western Australia », « Perth (WA) », « Perth »), and
 * which points carry their name (the Itinerary's five: all, those passed, the
 * current one, the first and last, none). A name typed by hand for one of the
 * series' own stops wins over every field. (pure)
 */
import { stateCodeFor, writePlace } from '../roadtrip/place-style';
import type { PlaceStyle, TripDoc, TripPlace } from '../roadtrip/trip-types';
import { biggestTownWithin, type NamedTown } from '../roadtrip/hooks/stop-clusters';
import { dayText, type Lang } from './locale';

export type NameField = 'place' | 'town' | 'state' | 'code' | 'country' | 'stage' | 'day' | 'date' | 'km' | 'none';
export const NAME_FIELDS: readonly NameField[] = ['place', 'town', 'state', 'code', 'country', 'stage', 'day', 'date', 'km', 'none'];
export const NAME_FIELD_LABEL: Record<NameField, string> = {
  place: 'Place',
  town: 'Town',
  state: 'State',
  code: 'State code',
  country: 'Country',
  stage: 'Stage',
  day: 'Day of the trip',
  date: 'Date',
  km: 'Km so far',
  none: 'Nothing',
};

/** Which points carry their name — the Itinerary's five (`map-plan.ts`, `MapLabels`). */
export type NamedWhich = 'all' | 'passed' | 'current' | 'ends' | 'none';
export const NAMED_WHICH: readonly NamedWhich[] = ['all', 'passed', 'current', 'ends', 'none'];
export const NAMED_WHICH_LABEL: Record<NamedWhich, string> = {
  all: 'All',
  passed: 'Those passed',
  current: 'The current one',
  ends: 'First and last',
  none: 'None',
};

const WRITINGS: readonly PlaceStyle[] = ['code', 'full', 'paren', 'name'];

/** What the series' map says (`ScriptSources.map.names`), each field over its default. */
export interface MapNames {
  line1?: NameField;
  line2?: NameField;
  /** How a place or a town is written (Trips' four). */
  writing?: PlaceStyle;
  which?: NamedWhich;
  /** A line the previous point already said is left out — a state written once, where it is entered. */
  once?: boolean;
}

/** The default of a series that chose nothing: the town and its state's code, on every point (his pick). */
export const MAP_NAMES_DEFAULT: Required<MapNames> = { line1: 'town', line2: 'none', writing: 'code', which: 'all', once: false };

/** The ready-made settings — the four of before 2026-11-01 among them, so a script that chose one draws as it did. */
export const NAME_PRESETS: readonly { id: string; label: string; names: Required<MapNames> }[] = [
  { id: 'town-state', label: 'Town, state', names: MAP_NAMES_DEFAULT },
  { id: 'state', label: 'State, once', names: { line1: 'state', line2: 'none', writing: 'name', which: 'all', once: true } },
  { id: 'stage', label: 'Stage', names: { line1: 'stage', line2: 'none', writing: 'name', which: 'all', once: false } },
  { id: 'day-town', label: 'Day + town', names: { line1: 'town', line2: 'day', writing: 'name', which: 'passed', once: false } },
  { id: 'place-date', label: 'Place + date', names: { line1: 'place', line2: 'date', writing: 'name', which: 'all', once: false } },
  { id: 'place', label: 'Place', names: { line1: 'place', line2: 'none', writing: 'name', which: 'all', once: false } },
  { id: 'none', label: 'No names', names: { line1: 'none', line2: 'none', writing: 'name', which: 'none', once: false } },
];

/** The setting a script written before the two lines meant by its one `label`. (pure) */
export function namesFromLabel(label: 'place' | 'stage' | 'place-date' | 'none'): Required<MapNames> {
  const id = label === 'place-date' ? 'place-date' : label === 'none' ? 'none' : label;
  return NAME_PRESETS.find((p) => p.id === id)!.names;
}

/** What the map says, settled: its own names, else its old `label`, else the default. (pure) */
export function mapNamesOf(map: { names?: MapNames; label?: 'place' | 'stage' | 'place-date' | 'none' } | undefined): Required<MapNames> {
  if (map?.names) return { ...MAP_NAMES_DEFAULT, ...map.names };
  if (map?.label) return namesFromLabel(map.label);
  return MAP_NAMES_DEFAULT;
}

/** The preset these names are exactly, if any. (pure) */
export function namePresetOf(names: Required<MapNames>): string | null {
  const same = (a: Required<MapNames>) => (Object.keys(a) as (keyof MapNames)[]).every((k) => a[k] === names[k]);
  return NAME_PRESETS.find((p) => same(p.names))?.id ?? null;
}

/** A series' names, kept field by field when well formed. (pure) */
export function readMapNames(raw: unknown): MapNames | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const field = (v: unknown) => (typeof v === 'string' && (NAME_FIELDS as readonly string[]).includes(v) ? (v as NameField) : undefined);
  const out: MapNames = {};
  const l1 = field(r.line1);
  const l2 = field(r.line2);
  if (l1) out.line1 = l1;
  if (l2) out.line2 = l2;
  if (typeof r.writing === 'string' && (WRITINGS as readonly string[]).includes(r.writing)) out.writing = r.writing as PlaceStyle;
  if (typeof r.which === 'string' && (NAMED_WHICH as readonly string[]).includes(r.which)) out.which = r.which as NamedWhich;
  if (typeof r.once === 'boolean') out.once = r.once;
  return Object.keys(out).length ? out : undefined;
}

/** One point of the map as its names are read from: where it is, its day, and what the trip knows of it. */
export interface NamedPoint {
  name: string;
  lat: number;
  lon: number;
  /** ISO day. */
  date?: string;
  /** The trip's place it is (or stands for), when known: its state, codes, country. */
  place?: Pick<TripPlace, 'name' | 'state' | 'stateCode' | 'searchCode' | 'codeFrom' | 'countryCode' | 'country'> | null;
  /** The stage it belongs to, as said out loud. */
  stage?: string;
  /** Kilometres of road driven to reach it. */
  km?: number;
  /** A name the author typed for it: it wins over every field. */
  own?: string;
}

export interface NamingContext {
  /** The trip's codes table (`TripDoc.stateCodes`) and first day. */
  trip?: Pick<TripDoc, 'stateCodes' | 'startDate'> | null;
  towns?: readonly NamedTown[] | null;
  lang?: Lang;
}

/** How far a point looks for the town it is in or near, km — Cape Le Grand finds Esperance, the Daintree Mossman. */
export const TOWN_REACH_KM = 60;
/** Within this of a town, a point is IN it. */
const IN_TOWN_KM = 8;

const thousands = (n: number, lang: Lang) => Math.round(n).toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR').replace(/[\u202f\u00a0,]/g, '\u202f');

/** One field of one point, or '' when the trip does not know it. (pure) */
export function fieldOf(f: NameField, p: NamedPoint, names: Required<MapNames>, ctx: NamingContext): string {
  const trip = { stateCodes: ctx.trip?.stateCodes ?? {} };
  const lang = ctx.lang ?? 'fr';
  const asPlace = (name: string) => (p.place ? writePlace({ ...p.place, name }, names.writing, trip) : name);
  switch (f) {
    case 'place':
      return asPlace(p.name);
    case 'town': {
      // A point in a town is that town (Fremantle stays Fremantle); one outside any finds the biggest near it.
      const at = { lat: p.lat, lon: p.lon };
      const town = ctx.towns ? (biggestTownWithin(ctx.towns, at, IN_TOWN_KM) ?? biggestTownWithin(ctx.towns, at, TOWN_REACH_KM)) : null;
      return asPlace(town?.name ?? p.name);
    }
    case 'state':
      return p.place?.state.trim() ?? '';
    case 'code':
      return p.place ? stateCodeFor(p.place, trip).code : '';
    case 'country':
      return p.place?.country?.trim() ?? '';
    case 'stage':
      return p.stage ?? '';
    case 'day': {
      if (!p.date || !ctx.trip?.startDate) return '';
      const n = Math.round((Date.parse(`${p.date}T00:00:00Z`) - Date.parse(`${ctx.trip.startDate}T00:00:00Z`)) / 86_400_000) + 1;
      return n >= 1 ? `${lang === 'en' ? 'Day' : 'Jour'} ${n}` : '';
    }
    case 'date':
      return p.date ? dayText(p.date, lang) : '';
    case 'km':
      return p.km !== undefined && p.km >= 0 ? `${thousands(p.km, lang)} km` : '';
    default:
      return '';
  }
}

/**
 * The two lines each point says, in order. A first line the trip does not
 * know lets the second take its place; with `once`, a line the previous point
 * said is left out. A name typed by hand is the first line, whatever is set.
 * (pure)
 */
export function nameLines(points: readonly NamedPoint[], names: Required<MapNames>, ctx: NamingContext = {}): [string, string][] {
  const out: [string, string][] = [];
  let prev: [string, string] = ['', ''];
  for (const p of points) {
    let a = p.own?.trim() || fieldOf(names.line1, p, names, ctx);
    let b = fieldOf(names.line2, p, names, ctx);
    const said: [string, string] = [a, b];
    if (names.once) {
      if (!p.own && a === prev[0]) a = '';
      if (b === prev[1]) b = '';
    }
    prev = said;
    out.push(a ? [a, b] : [b, '']);
  }
  return out;
}

/** Whether point `i` of `count` carries its name, the route having reached point `at`. (pure) */
export function namedAt(which: NamedWhich, i: number, count: number, at: number): boolean {
  if (which === 'none') return false;
  if (which === 'all') return true;
  if (which === 'ends') return i === 0 || i === count - 1;
  if (which === 'current') return i === at;
  return i <= at;
}
