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

import { mulberry32 } from '../lib/prng';
import { DEFAULT_ASPECT, isAspect, isWhole, readCrop, type AspectId, type Crop } from './frame';
import { MAX_CELL_PX, MIN_CELL_PX, pickDive, pickNextTarget } from './match';
import { decodeGrid, type Level, type Space } from './measure';
import { RECIPES, RECIPE_MOTIONS, departAt, motionOf, sanitizeMotion, type Motion, type MotionMode } from './motion';

/**
 * v2 (2026-11-01): the chain's queue (`chain`) joins the document; a v1 body reads with an empty one.
 * v3 (2026-11-01): the animated step as a grammar (`settings.motion`, `motion.ts`); a v2 body's
 * `mode` + `direction` read as the matching recipe.
 */
export const MOSAIC_DOC_VERSION = 3;

/** How many pictures the chain keeps ahead of the one on screen, and under how many it refills itself. */
export const QUEUE_AHEAD = 10;
export const QUEUE_REFILL_AT = 5;
/** The queue's bound on read — a hand-made file cannot make the band endless. */
export const MAX_QUEUE = 200;

/** How many pictures one mosaic holds — two full picker spans, short of a runaway file. */
export const MAX_MOSAIC_TILES = 40000;
export const MAX_MOSAIC_TITLE = 120;

/** The stage's mode: still, or an animated recipe of `motion.ts` (`custom` once a part was set by hand). */
export type MosaicMode = 'single' | MotionMode;

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
  /** The animated step's parts (lab 3); the recipes of the transport are presets of it. */
  motion: Motion;
  /** ×0.4..2.5 over the base lengths. */
  speed: number;
  /** The chain's picks and the reveal's origin — a replay and an export draw the same. */
  seed: number;
}

/** One picture to come in the chain: drawn from the seed, or picked by the person. */
export interface ChainEntry {
  id: number;
  by: 'draw' | 'pick';
}

/**
 * The CHAIN as a queue (lab 2, R6): the pictures after the target, in order,
 * ten ahead and refilled under five; `draw` off, the chain ends at the last
 * picked one. In the document, so a reopened mosaic plays the same chain
 * and an export replays it.
 */
export interface MosaicChain {
  queue: ChainEntry[];
  draw: boolean;
}

export const DEFAULT_CHAIN: MosaicChain = { queue: [], draw: true };

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
  /** The pictures to come after `target` in a chain; absent = none queued, the seed draws them. */
  chain?: MosaicChain;
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
  // A new mosaic plays from mosaic to mosaic (his preference, lab 3): the photo never appears unless a recipe says so.
  motion: RECIPE_MOTIONS.mosaics,
  speed: 1,
  seed: 1,
};

const MODES: readonly MosaicMode[] = ['single', ...RECIPES, 'custom'];
/** A v2 body's chain direction, read into the recipe's departure. */
const LEGACY_DEPART: Record<string, Motion['depart']> = { in: 'dive', out: 'pull', alternate: 'alternate' };
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
  const mode = oneOf(r.mode, MODES, DEFAULT_SETTINGS.mode);
  // The motion stored, bounded; a v2 body (mode and direction, no motion) reads as its recipe.
  const recipe = mode === 'single' || mode === 'custom' ? DEFAULT_SETTINGS.motion : motionOf(mode, DEFAULT_SETTINGS.motion);
  const legacy = typeof r.direction === 'string' && r.direction in LEGACY_DEPART && mode === 'chain' ? { ...recipe, depart: LEGACY_DEPART[r.direction] } : recipe;
  const motion = r.motion && typeof r.motion === 'object' ? sanitizeMotion(r.motion, legacy) : legacy;
  return {
    aspect: isAspect(r.aspect) ? r.aspect : DEFAULT_SETTINGS.aspect,
    cellPx: Math.round(num(r.cellPx, MIN_CELL_PX, MAX_CELL_PX, DEFAULT_SETTINGS.cellPx)),
    level,
    space: oneOf<Space>(r.space, ['oklab', 'rgb'], DEFAULT_SETTINGS.space),
    tint: num(r.tint, 0, 0.7, DEFAULT_SETTINGS.tint),
    distinctNeighbours: typeof r.distinctNeighbours === 'boolean' ? r.distinctNeighbours : DEFAULT_SETTINGS.distinctNeighbours,
    mode,
    motion,
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
  const chain = readChain(r.chain, tiles);
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
    ...(chain ? { chain } : {}),
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

/** The mosaic without the pictures `ids`; a target among them is dropped, and so are the queue's entries. */
export function withoutTiles(doc: MosaicDoc, ids: Iterable<number>, now: number = Date.now()): MosaicDoc {
  const gone = new Set(ids);
  if (!doc.tiles.some((t) => gone.has(t.id))) return doc;
  const out: MosaicDoc = { ...doc, tiles: doc.tiles.filter((t) => !gone.has(t.id)), updatedAt: now };
  if (out.target !== undefined && gone.has(out.target)) {
    delete out.target;
    delete out.crop;
  }
  return setChain(out, { ...chainOf(out), queue: chainOf(out).queue.filter((e) => !gone.has(e.id)) });
}

/**
 * The mosaic aimed at another picture: its crop goes, since a crop belongs
 * to its target, and so do the chain's DRAWN entries — they followed the old
 * one; the person's picks stay. Same object when nothing changes.
 */
export function withTarget(doc: MosaicDoc, target: number, now: number = Date.now()): MosaicDoc {
  if (doc.target === target) return doc;
  const out: MosaicDoc = { ...doc, target, updatedAt: now };
  delete out.crop;
  return setChain(out, { ...chainOf(out), queue: chainOf(out).queue.filter((e) => e.by === 'pick' && e.id !== target) });
}

// --- the chain's queue (lab 2, R6) ---

/** The chain as the document means it: `DEFAULT_CHAIN` when none is stored. */
export function chainOf(doc: MosaicDoc): MosaicChain {
  return doc.chain ?? DEFAULT_CHAIN;
}

/** Two neighbours in the queue are never the same picture; the bound holds. */
function normalizeQueue(queue: readonly ChainEntry[], target: number | undefined): ChainEntry[] {
  const out: ChainEntry[] = [];
  for (const e of queue) {
    const prev = out.length ? out[out.length - 1].id : target;
    if (e.id === prev) continue;
    out.push(e);
    if (out.length >= MAX_QUEUE) break;
  }
  return out;
}

function sameChain(a: MosaicChain, b: MosaicChain): boolean {
  return a.draw === b.draw && a.queue.length === b.queue.length && a.queue.every((e, i) => e.id === b.queue[i].id && e.by === b.queue[i].by);
}

/** `chain` written onto the document — the default stored as none; the same object when equal. No `updatedAt` change (the callers set it). */
function setChain(doc: MosaicDoc, chain: MosaicChain): MosaicDoc {
  const next: MosaicChain = { queue: normalizeQueue(chain.queue, doc.target), draw: chain.draw };
  if (sameChain(next, chainOf(doc))) return doc;
  const out: MosaicDoc = { ...doc };
  if (sameChain(next, DEFAULT_CHAIN)) delete out.chain;
  else out.chain = next;
  return out;
}

/** A stored chain read back: entries the library holds, well-formed, bounded; undefined when it is the default. */
export function readChain(raw: unknown, tiles: readonly MosaicTile[]): MosaicChain | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const have = new Set(tiles.map((t) => t.id));
  const queue: ChainEntry[] = [];
  if (Array.isArray(r.queue)) {
    for (const item of r.queue) {
      if (!item || typeof item !== 'object') continue;
      const e = item as Record<string, unknown>;
      if (typeof e.id !== 'number' || !have.has(e.id)) continue;
      queue.push({ id: e.id, by: e.by === 'pick' ? 'pick' : 'draw' });
      if (queue.length >= MAX_QUEUE) break;
    }
  }
  const chain: MosaicChain = { queue, draw: typeof r.draw === 'boolean' ? r.draw : true };
  return sameChain(chain, DEFAULT_CHAIN) ? undefined : chain;
}

/** The chain with `draw` on or off — off, the chain ends at the last picked picture. */
export function withChainDraw(doc: MosaicDoc, draw: boolean, now: number = Date.now()): MosaicDoc {
  const out = setChain(doc, { ...chainOf(doc), draw });
  return out === doc ? doc : { ...out, updatedAt: now };
}

/** The queue with the person's pick `id` at `at` — in place of the entry there, appended past the end. */
export function queueSet(doc: MosaicDoc, at: number, id: number, by: ChainEntry['by'] = 'pick', now: number = Date.now()): MosaicDoc {
  if (!doc.tiles.some((t) => t.id === id)) return doc;
  const queue = [...chainOf(doc).queue];
  const i = Math.max(0, Math.min(queue.length, Math.floor(at)));
  queue[i] = { id, by };
  const out = setChain(doc, { ...chainOf(doc), queue });
  return out === doc ? doc : { ...out, updatedAt: now };
}

/** The queue with the person's pick `id` inserted before `at` (`queue.length` appends). */
export function queueInsert(doc: MosaicDoc, at: number, id: number, now: number = Date.now()): MosaicDoc {
  if (!doc.tiles.some((t) => t.id === id)) return doc;
  const queue = [...chainOf(doc).queue];
  queue.splice(Math.max(0, Math.min(queue.length, Math.floor(at))), 0, { id, by: 'pick' });
  const out = setChain(doc, { ...chainOf(doc), queue });
  return out === doc ? doc : { ...out, updatedAt: now };
}

/** The queue without its entry at `at`. */
export function queueRemove(doc: MosaicDoc, at: number, now: number = Date.now()): MosaicDoc {
  const queue = chainOf(doc).queue;
  if (at < 0 || at >= queue.length) return doc;
  const out = setChain(doc, { ...chainOf(doc), queue: queue.filter((_, i) => i !== at) });
  return out === doc ? doc : { ...out, updatedAt: now };
}

/** The seed after a shuffle — another draw, still a number the document bounds. */
export function nextSeed(seed: number): number {
  return (Math.floor(seed * 48271 + 12345) % 2147483646) + 1;
}

/** *Shuffle*: every DRAWN entry goes and the seed turns, so the refill draws another chain; the picks stay in order. */
export function queueShuffle(doc: MosaicDoc, now: number = Date.now()): MosaicDoc {
  const chain = chainOf(doc);
  const picks = chain.queue.filter((e) => e.by === 'pick');
  const out = setChain(doc, { ...chain, queue: picks });
  return { ...out, settings: { ...out.settings, seed: nextSeed(out.settings.seed) }, updatedAt: now };
}

/**
 * A run ended after `done` steps on `current`: the picture seen is the target,
 * the steps played leave the queue, the crop (the old target's) goes. The
 * same object when nothing moved.
 */
export function chainAdvanced(doc: MosaicDoc, done: number, current: number, now: number = Date.now()): MosaicDoc {
  const chain = chainOf(doc);
  let queue = chain.queue.slice(Math.max(0, Math.min(chain.queue.length, Math.floor(done))));
  // A pull-back shows its next picture before its step ends: the head already seen goes too.
  if (queue.length && queue[0].id === current) queue = queue.slice(1);
  if (doc.target === current && queue.length === chain.queue.length) return doc;
  const out: MosaicDoc = { ...doc, updatedAt: now };
  if (doc.tiles.some((t) => t.id === current)) {
    out.target = current;
    if (current !== doc.target) delete out.crop;
  }
  return setChain(out, { ...chain, queue });
}

/** The mix of the seed, the picture a draw follows and its place — one generator per draw, the same on every device. */
function drawSeed(seed: number, fromId: number, position: number): number {
  return ((seed ^ ((fromId * 2654435761) >>> 0) ^ ((position + 1) * 40503)) >>> 0) + 1;
}

/**
 * The queue filled from the seed: when fewer than `QUEUE_REFILL_AT` entries
 * lie past the `done` played ones (and `draw` is on), pictures are drawn
 * until `QUEUE_AHEAD` do — by colour, like the player picked them before the
 * queue existed: for a dive (even steps, or `in`) a picture whose mean sits
 * in a cell of the one before it (`pickDive`), for a pull-back one holding a
 * cell near the mean of the one before (`pickNextTarget`). `lab` is every
 * measured picture's grid in OKLab, in `measured`'s order (`oklabOf`).
 * Deterministic: the same document fills the same way everywhere.
 */
export function refillQueue(doc: MosaicDoc, lab: Float32Array, measured: readonly MosaicTile[], done = 0, now: number = Date.now()): MosaicDoc {
  const chain = chainOf(doc);
  if (!chain.draw || doc.target === undefined || measured.length < 2) return doc;
  const ahead = chain.queue.length - Math.max(0, done);
  if (ahead >= QUEUE_REFILL_AT) return doc;
  const indexOf = new Map<number, number>();
  measured.forEach((t, i) => indexOf.set(t.id, i));
  if (!indexOf.has(doc.target)) return doc;
  const queue = [...chain.queue];
  const history = () => [doc.target as number, ...queue.map((e) => e.id)].map((id) => indexOf.get(id)).filter((i): i is number => i !== undefined).slice(-12);
  while (queue.length - done < QUEUE_AHEAD) {
    const position = queue.length;
    const fromId = position ? queue[position - 1].id : doc.target;
    const from = indexOf.get(fromId);
    if (from === undefined) break;
    // A pull-back wants a picture holding the current one's mean; every other departure one whose mean sits in a cell of it.
    const kind = departAt(doc.settings.motion, position);
    const rnd = mulberry32(drawSeed(doc.settings.seed, fromId, position));
    const opts = { history: history(), rnd };
    const next = kind === 'pull' ? pickNextTarget(lab, measured.length, from, opts) : pickDive(lab, measured.length, from, opts);
    if (next < 0 || next === from) break;
    queue.push({ id: measured[next].id, by: 'draw' });
  }
  const out = setChain(doc, { ...chain, queue });
  return out === doc ? doc : { ...out, updatedAt: now };
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
