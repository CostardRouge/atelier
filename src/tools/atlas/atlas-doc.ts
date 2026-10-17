/**
 * An ATLAS — what the Flight Atlas keeps since it has a gallery (his ask,
 * 2026-10-17, lab https://claude.ai/artifact/WLcXUFFwTnbDKdetjux9JF): a name,
 * where it is kept, EVERY dial (the title, the place, the zone, the
 * spotlight's picks and the drones' names included — what a preset leaves out
 * is exactly what makes one atlas this atlas), its flights and the ones it
 * hides.
 *
 * A flight is held by REFERENCE: its name and the SHA-256 of its log's text.
 * The text itself lives once on this device, in the atlas store's `logs`
 * (`atlas-store.ts`), shared by every atlas that draws it — which is what lets
 * an atlas reopen from the gallery with no Library and no instance (his
 * amendment: «ceux qui sont dépourvus d'une instance … doivent pouvoir tout
 * avoir et récupérer à partir de la galerie»). A flight's id inside an atlas
 * is derived from that hash, so the same log added twice is one flight.
 *
 * Pure and DOM-free; read back through `readAtlasDoc`, so a stored or imported
 * atlas can never break the screen.
 */

import { sanitizeSettings, type AtlasSettings } from './atlas-settings';

export const ATLAS_DOC_VERSION = 1;

/** How many flights one atlas holds — far past a year of flying, short of a runaway file. */
export const MAX_ATLAS_FLIGHTS = 5000;

/** The longest name kept, for an atlas and for a flight. */
export const MAX_ATLAS_NAME = 120;

/** One flight of an atlas: what finds its log again, and what was learnt when it was added. */
export interface AtlasFlightRef {
  /** Its id in this atlas — `f-` and the head of its log's hash. Hidden flights and spotlight picks name it. */
  id: string;
  /** The log's base name, as the list writes it. */
  name: string;
  /** SHA-256 of the log's text, lowercase hex: the key of the text in the store. */
  log: string;
  /** The text's length in characters, for the storage line. */
  size: number;
  /** The aircraft the clip's own metadata named when the flight was added (a loose log names none). */
  aircraft?: string;
  /** `<host>/<id>` of the clip on the Winnow it came from — what fetches the log back there. */
  winnow?: string;
}

export interface AtlasDoc {
  id: string;
  version: number;
  name: string;
  /** The ONE source it is kept in (`sources/source.ts`), like a trip's. */
  sourceId: string;
  settings: AtlasSettings;
  flights: AtlasFlightRef[];
  /** The flights drawn in the list but not on the map. */
  hidden: string[];
  createdAt: number;
  updatedAt: number;
}

const HASH = /^[0-9a-f]{64}$/;

/** A flight's id in an atlas, from its log's hash. */
export function flightIdOf(hash: string): string {
  return `f-${hash.slice(0, 16)}`;
}

/** A name as it is kept: one space between words, trimmed, bounded. */
export function cleanAtlasName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_ATLAS_NAME);
}

export function newAtlasId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `atlas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createAtlasDoc(
  name: string,
  sourceId: string,
  settings: AtlasSettings = sanitizeSettings({}),
  now: number = Date.now(),
): AtlasDoc {
  return {
    id: newAtlasId(),
    version: ATLAS_DOC_VERSION,
    name: cleanAtlasName(name) || 'Flight Atlas',
    sourceId,
    settings: sanitizeSettings(settings),
    flights: [],
    hidden: [],
    createdAt: now,
    updatedAt: now,
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function readFlightRef(raw: unknown): AtlasFlightRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const log = str(r.log)?.toLowerCase() ?? '';
  if (!HASH.test(log)) return null;
  const name = cleanAtlasName(str(r.name) ?? '') || 'flight';
  const size = typeof r.size === 'number' && Number.isFinite(r.size) && r.size >= 0 ? Math.round(r.size) : 0;
  const aircraft = cleanAtlasName(str(r.aircraft) ?? '').slice(0, 60);
  const winnow = str(r.winnow)?.slice(0, 300) ?? '';
  return {
    id: flightIdOf(log),
    name,
    log,
    size,
    ...(aircraft ? { aircraft } : {}),
    ...(winnow ? { winnow } : {}),
  };
}

/**
 * Flights as an atlas keeps them: malformed ones dropped, one per log (the
 * first wins), bounded.
 */
export function readFlightRefs(raw: unknown): AtlasFlightRef[] {
  if (!Array.isArray(raw)) return [];
  const out: AtlasFlightRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const ref = readFlightRef(item);
    if (!ref || seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push(ref);
    if (out.length >= MAX_ATLAS_FLIGHTS) break;
  }
  return out;
}

const time = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);

/**
 * A stored or imported body into an atlas, or null when it is not one. Every
 * dial goes through `sanitizeSettings`, hidden flights are kept only where the
 * atlas holds them, a newer version is refused rather than half-read.
 */
export function readAtlasDoc(raw: unknown, sourceIdFallback: string, now: number = Date.now()): AtlasDoc | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  const version = typeof r.version === 'number' ? r.version : ATLAS_DOC_VERSION;
  if (version > ATLAS_DOC_VERSION) return null;
  const flights = readFlightRefs(r.flights);
  const ids = new Set(flights.map((f) => f.id));
  const hidden = Array.isArray(r.hidden) ? [...new Set(r.hidden.filter((h): h is string => typeof h === 'string' && ids.has(h)))] : [];
  const createdAt = time(r.createdAt, now);
  return {
    id,
    version: ATLAS_DOC_VERSION,
    name: cleanAtlasName(str(r.name) ?? '') || 'Flight Atlas',
    sourceId: str(r.sourceId) || sourceIdFallback,
    settings: sanitizeSettings(r.settings),
    flights,
    hidden,
    createdAt,
    updatedAt: time(r.updatedAt, createdAt),
  };
}

/**
 * The atlas with `added` flights appended after its own — a log it already
 * draws is skipped, so adding the same folder twice changes nothing. Returns
 * the atlas unchanged (the same object) when nothing was new.
 */
export function withFlights(doc: AtlasDoc, added: readonly AtlasFlightRef[], now: number = Date.now()): AtlasDoc {
  const have = new Set(doc.flights.map((f) => f.id));
  const fresh: AtlasFlightRef[] = [];
  for (const f of added) {
    if (have.has(f.id)) continue;
    have.add(f.id);
    fresh.push(f);
  }
  if (!fresh.length) return doc;
  return { ...doc, flights: [...doc.flights, ...fresh].slice(0, MAX_ATLAS_FLIGHTS), updatedAt: now };
}

/** The atlas without the flights `ids` — out of the list, the hidden set and the spotlight's picks. */
export function withoutFlights(doc: AtlasDoc, ids: Iterable<string>, now: number = Date.now()): AtlasDoc {
  const gone = new Set(ids);
  if (!doc.flights.some((f) => gone.has(f.id))) return doc;
  return {
    ...doc,
    flights: doc.flights.filter((f) => !gone.has(f.id)),
    hidden: doc.hidden.filter((id) => !gone.has(id)),
    settings: { ...doc.settings, camera: { ...doc.settings.camera, picked: doc.settings.camera.picked.filter((id) => !gone.has(id)) } },
    updatedAt: now,
  };
}

/** A copy under a new id, its own name and source: flights, dials and hidden set alike. */
export function cloneAtlas(doc: AtlasDoc, opts: { name: string; sourceId: string }, now: number = Date.now()): AtlasDoc {
  return {
    ...structuredClone(doc),
    id: newAtlasId(),
    name: cleanAtlasName(opts.name) || doc.name,
    sourceId: opts.sourceId,
    createdAt: now,
    updatedAt: now,
  };
}

/** Every log the atlases draw, by hash. */
export function logsOf(docs: readonly AtlasDoc[]): Set<string> {
  const out = new Set<string>();
  for (const d of docs) for (const f of d.flights) out.add(f.log);
  return out;
}

/**
 * The FIRST atlas, made from what the page held before atlases existed: the
 * dials remembered on this browser and the flights the Library had ticked.
 * The spotlight's picks named the Library's asset ids; they are carried over
 * onto the flights' new ids through `idOf`, and dropped where no flight
 * answers.
 */
export function firstAtlas(
  settings: AtlasSettings,
  flights: readonly AtlasFlightRef[],
  idOf: ReadonlyMap<string, string>,
  sourceId: string,
  now: number = Date.now(),
): AtlasDoc {
  const title = settings.hud.title.trim() || settings.intro.title.trim();
  const picked = settings.camera.picked.flatMap((id) => (idOf.has(id) ? [idOf.get(id) as string] : []));
  const doc = createAtlasDoc(title || 'My flights', sourceId, { ...settings, camera: { ...settings.camera, picked } }, now);
  return withFlights(doc, flights, now);
}

/** «37 flights · 9 places» without the places, which need the logs read. */
export function flightCountLine(doc: AtlasDoc): string {
  const n = doc.flights.length;
  return n === 0 ? 'no flights yet' : `${n} flight${n === 1 ? '' : 's'}`;
}
