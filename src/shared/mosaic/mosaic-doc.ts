/**
 * A MOSAIC — what the Mosaic instrument keeps (his pick, 2026-10-31:
 * «.mosaic.json»): a title, the ONE Winnow source its pictures come from,
 * the library of pictures by reference (asset id, the row's content hash
 * when it has one, photo or clip) each with its 6 × 6 grid once measured,
 * the picture chosen as the target, and every setting.
 *
 * The grids ARE the measure of record: a mosaic reimported on another device
 * remeasures nothing. A picture's BYTES never travel — the 160 px tile a cell
 * draws is fetched back from the instance and kept on the device
 * (`docs/mosaic.md` §3).
 *
 * Pure and DOM-free; read back through `readMosaicDoc`, so a stored or
 * imported mosaic can never break the screen (`local-first.md`, «A document
 * is UNTRUSTED input»).
 */

import { DEFAULT_ASPECT, isAspect, isWhole, readCrop, type AspectId, type Crop } from './frame';
import { MAX_CELL_PX, MIN_CELL_PX } from './match';
import { decodeGrid, type Level, type Space } from './measure';

export const MOSAIC_DOC_VERSION = 1;

/** How many pictures one mosaic holds — two full picker spans, short of a runaway file. */
export const MAX_MOSAIC_TILES = 40000;
export const MAX_MOSAIC_TITLE = 120;

export type MosaicMode = 'single' | 'dezoom' | 'chain' | 'reveal' | 'drift';
export type ChainDirection = 'in' | 'out' | 'alternate';

export interface MosaicTile {
  /** The Winnow asset id on the mosaic's source. */
  id: number;
  /** The row's content hash when it carries one — finds the same bytes elsewhere. */
  hash?: string;
  kind: 'photo' | 'clip';
  /** The 6 × 6 grid in base64 (`measure.ts`), once measured. */
  grid?: string;
  /** The thumbnail would not fetch or decode; the run skips it until *Measure again*. */
  failed?: boolean;
}

export interface MosaicSettings {
  /** The rebuilt picture's shape — the stage, its cells and every export follow it (`frame.ts`). */
  aspect: AspectId;
  /** A cell's width in stage pixels (D2). */
  cellPx: number;
  level: Level;
  space: Space;
  /** The veil of the cell's colour over its picture, 0..0.7. */
  tint: number;
  distinctNeighbours: boolean;
  mode: MosaicMode;
  direction: ChainDirection;
  /** ×0.4..2.5 over the base lengths. */
  speed: number;
  /** The chain's picks and the reveal's origin — a replay and an export draw the same. */
  seed: number;
}

export interface MosaicDoc {
  id: string;
  version: number;
  title: string;
  /** The ONE source the DOCUMENT is kept in (`sources/source.ts`), like a trip's: this device, or an instance (M8). */
  sourceId: string;
  /**
   * The ONE Winnow its pictures come from — the connection's id (its host),
   * set by the first add and never changed: a tile's id means nothing on
   * another instance. Absent until a picture is added.
   */
  instance?: string;
  /** The days its pictures span, grown with every add — where the picker reopens. */
  span?: { from: string; to: string };
  tiles: MosaicTile[];
  /** The asset id reconstituted in Single and Dézoom; absent until one is chosen. */
  target?: number;
  /**
   * Which part of the target the frame rebuilds (`frame.ts`); absent = the
   * whole frame, centred. Belongs to `target`: a new target drops it.
   */
  crop?: Crop;
  settings: MosaicSettings;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: MosaicSettings = {
  aspect: DEFAULT_ASPECT,
  cellPx: 40,
  level: 2,
  space: 'oklab',
  tint: 0.25,
  distinctNeighbours: true,
  mode: 'single',
  direction: 'in',
  speed: 1,
  seed: 1,
};

const MODES: readonly MosaicMode[] = ['single', 'dezoom', 'chain', 'reveal', 'drift'];
const DIRECTIONS: readonly ChainDirection[] = ['in', 'out', 'alternate'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T =>
  typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : fallback;

/** Every setting bounded, a missing or foreign one at its default. */
export function sanitizeSettings(raw: unknown): MosaicSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const level = Math.round(num(r.level, 1, 3, DEFAULT_SETTINGS.level)) as Level;
  return {
    aspect: isAspect(r.aspect) ? r.aspect : DEFAULT_SETTINGS.aspect,
    cellPx: Math.round(num(r.cellPx, MIN_CELL_PX, MAX_CELL_PX, DEFAULT_SETTINGS.cellPx)),
    level,
    space: oneOf<Space>(r.space, ['oklab', 'rgb'], DEFAULT_SETTINGS.space),
    tint: num(r.tint, 0, 0.7, DEFAULT_SETTINGS.tint),
    distinctNeighbours: typeof r.distinctNeighbours === 'boolean' ? r.distinctNeighbours : DEFAULT_SETTINGS.distinctNeighbours,
    mode: oneOf(r.mode, MODES, DEFAULT_SETTINGS.mode),
    direction: oneOf(r.direction, DIRECTIONS, DEFAULT_SETTINGS.direction),
    speed: num(r.speed, 0.4, 2.5, DEFAULT_SETTINGS.speed),
    seed: Math.round(num(r.seed, 1, 2147483647, DEFAULT_SETTINGS.seed)),
  };
}

/** A title as it is kept: one space between words, trimmed, bounded. */
export function cleanMosaicTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, MAX_MOSAIC_TITLE);
}

export function newMosaicId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `mosaic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createMosaicDoc(title: string, sourceId: string, now: number = Date.now()): MosaicDoc {
  return {
    id: newMosaicId(),
    version: MOSAIC_DOC_VERSION,
    title: cleanMosaicTitle(title) || 'Mosaic',
    sourceId,
    tiles: [],
    settings: { ...DEFAULT_SETTINGS, seed: (now % 2147483646) + 1 },
    createdAt: now,
    updatedAt: now,
  };
}

function readTile(raw: unknown): MosaicTile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'number' || !Number.isInteger(r.id) || r.id < 0) return null;
  const hash = str(r.hash)?.slice(0, 128);
  const grid = decodeGrid(r.grid) ? (r.grid as string) : undefined;
  return {
    id: r.id,
    ...(hash ? { hash } : {}),
    kind: r.kind === 'clip' ? 'clip' : 'photo',
    ...(grid ? { grid } : {}),
    ...(r.failed === true && !grid ? { failed: true } : {}),
  };
}

/** Tiles as a mosaic keeps them: malformed ones dropped, one per asset (the first wins), bounded. */
export function readTiles(raw: unknown): MosaicTile[] {
  if (!Array.isArray(raw)) return [];
  const out: MosaicTile[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    const tile = readTile(item);
    if (!tile || seen.has(tile.id)) continue;
    seen.add(tile.id);
    out.push(tile);
    if (out.length >= MAX_MOSAIC_TILES) break;
  }
  return out;
}

const time = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);

/**
 * A stored or imported body into a mosaic, or null when it is not one. The
 * settings are bounded, the target kept only where the library holds it, a
 * newer version refused rather than half-read.
 */
export function readMosaicDoc(raw: unknown, sourceIdFallback: string, now: number = Date.now()): MosaicDoc | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  const version = typeof r.version === 'number' ? r.version : MOSAIC_DOC_VERSION;
  if (version > MOSAIC_DOC_VERSION) return null;
  const tiles = readTiles(r.tiles);
  const target = typeof r.target === 'number' && tiles.some((t) => t.id === r.target) ? r.target : undefined;
  const crop = target !== undefined ? readCrop(r.crop) : undefined;
  const span = readSpan(r.span);
  const instance = str(r.instance)?.trim().slice(0, 300);
  const createdAt = time(r.createdAt, now);
  return {
    id,
    version: MOSAIC_DOC_VERSION,
    title: cleanMosaicTitle(str(r.title) ?? '') || 'Mosaic',
    sourceId: str(r.sourceId) || sourceIdFallback,
    ...(instance ? { instance } : {}),
    ...(span ? { span } : {}),
    tiles,
    ...(target !== undefined ? { target } : {}),
    ...(crop && !isWhole(crop) ? { crop } : {}),
    settings: sanitizeSettings(r.settings),
    createdAt,
    updatedAt: time(r.updatedAt, createdAt),
  };
}

/** The two spans' union; one alone when the other is absent. */
export function unionSpan(a: { from: string; to: string } | undefined, b: { from: string; to: string } | undefined): { from: string; to: string } | undefined {
  if (!a) return b;
  if (!b) return a;
  return { from: a.from < b.from ? a.from : b.from, to: a.to > b.to ? a.to : b.to };
}

/**
 * Pictures added from an instance: the tiles appended (`withTiles`), the
 * instance set when the mosaic had none, its span grown by `span`. Refused
 * — the same object back — when the mosaic's pictures come from ANOTHER
 * instance: a tile's id means nothing there.
 */
export function withPictures(
  doc: MosaicDoc,
  added: readonly MosaicTile[],
  instance: string,
  span: { from: string; to: string } | undefined,
  now: number = Date.now(),
): MosaicDoc {
  if (doc.instance && doc.instance !== instance) return doc;
  const next = withTiles(doc, added, now);
  const grown = unionSpan(doc.span, span);
  if (next === doc && doc.instance === instance && grown === doc.span) return doc;
  return { ...next, instance, ...(grown ? { span: grown } : {}), updatedAt: now };
}

function readSpan(raw: unknown): { from: string; to: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const from = str(r.from);
  const to = str(r.to);
  if (!from || !to || !DAY.test(from) || !DAY.test(to) || from > to) return undefined;
  return { from, to };
}

/**
 * The mosaic with `added` tiles after its own — a picture it already holds
 * is skipped, so adding the same span twice changes nothing. The same object
 * back when nothing was new.
 */
export function withTiles(doc: MosaicDoc, added: readonly MosaicTile[], now: number = Date.now()): MosaicDoc {
  const have = new Set(doc.tiles.map((t) => t.id));
  const fresh: MosaicTile[] = [];
  for (const t of added) {
    if (have.has(t.id)) continue;
    have.add(t.id);
    fresh.push(t);
  }
  if (!fresh.length) return doc;
  return { ...doc, tiles: [...doc.tiles, ...fresh].slice(0, MAX_MOSAIC_TILES), updatedAt: now };
}

/** The mosaic without the pictures `ids`; a target among them is dropped. */
export function withoutTiles(doc: MosaicDoc, ids: Iterable<number>, now: number = Date.now()): MosaicDoc {
  const gone = new Set(ids);
  if (!doc.tiles.some((t) => gone.has(t.id))) return doc;
  const out: MosaicDoc = { ...doc, tiles: doc.tiles.filter((t) => !gone.has(t.id)), updatedAt: now };
  if (out.target !== undefined && gone.has(out.target)) {
    delete out.target;
    delete out.crop;
  }
  return out;
}

/** The mosaic aimed at another picture: its crop goes, since a crop belongs to its target. Same object when nothing changes. */
export function withTarget(doc: MosaicDoc, target: number, now: number = Date.now()): MosaicDoc {
  if (doc.target === target) return doc;
  const out: MosaicDoc = { ...doc, target, updatedAt: now };
  delete out.crop;
  return out;
}

/** The part of the target rebuilt; the whole frame is stored as no crop. Same object when nothing changes. */
export function withCrop(doc: MosaicDoc, crop: Crop | undefined, now: number = Date.now()): MosaicDoc {
  const next = crop && !isWhole(crop) ? crop : undefined;
  const cur = doc.crop;
  if (!next && !cur) return doc;
  if (next && cur && next.cx === cur.cx && next.cy === cur.cy && next.scale === cur.scale) return doc;
  const out: MosaicDoc = { ...doc, updatedAt: now };
  if (next) out.crop = next;
  else delete out.crop;
  return out;
}

/**
 * Measurements written onto the tiles: a grid clears a failure, a failure
 * marks a tile that has no grid. The same object back when nothing changed.
 */
export function withMeasures(
  doc: MosaicDoc,
  grids: ReadonlyMap<number, string>,
  failed: Iterable<number> = [],
  now: number = Date.now(),
): MosaicDoc {
  const bad = new Set(failed);
  let changed = false;
  const tiles = doc.tiles.map((t) => {
    const grid = grids.get(t.id);
    if (grid && grid !== t.grid) {
      changed = true;
      const measured: MosaicTile = { ...t, grid };
      delete measured.failed;
      return measured;
    }
    if (!t.grid && bad.has(t.id) && !t.failed) {
      changed = true;
      return { ...t, failed: true };
    }
    return t;
  });
  return changed ? { ...doc, tiles, updatedAt: now } : doc;
}

/** The tiles with a grid, and their grids in one array (`n × 108` bytes) — what a matching reads. */
export function measuredTiles(doc: MosaicDoc): { tiles: MosaicTile[]; grids: Uint8Array } {
  const tiles: MosaicTile[] = [];
  const decoded: Uint8Array[] = [];
  for (const t of doc.tiles) {
    const g = t.grid ? decodeGrid(t.grid) : null;
    if (!g) continue;
    tiles.push(t);
    decoded.push(g);
  }
  const grids = new Uint8Array(decoded.length * 108);
  decoded.forEach((g, i) => grids.set(g, i * 108));
  return { tiles, grids };
}
