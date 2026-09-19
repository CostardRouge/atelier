/**
 * A ROLL — the Develop tool's document (`docs/develop-tool.md` §3): a named set
 * of pictures, each with its own develop and crop, plus the roll's look and how
 * it exports. What a developer keeps, not what an editor composes: no deck, no
 * badge, no timeline.
 *
 * A picture is a REF (`SavedMediaRef`, hash-carrying), never bytes: the file is
 * found the way every tool finds one — the Library by name or hash, else the
 * instance it came from. A roll lives on ONE source (`sourceId`), like a trip
 * and a project, and is kept there by the shared sync machine.
 *
 * Every read goes through `readRollDoc` / `migrateRollDoc`: a stored roll, a
 * pulled one and a file all land on the current shape, and a field a newer
 * build wrote is left behind rather than trusted. Pure and DOM-free.
 */

import { developOrNull, type DevelopSettings } from './develop';
import { isDefaultFraming, normaliseFraming, type Framing } from '../media/framing';
import { type SavedMediaRef } from '../projects/project-types';
import { isStoredAspect } from './crop-aspect';
import type { SavedLutLayer } from '../lut/use-lut-stack';
import { MAX_LAYER_INTENSITY } from '../lut/lut-stack';
import type { OutputTransform } from '../lut/transfer';
import { DEFAULT_SOURCE_ID } from '../sources/source';

/** Bumped with a migration block in `migrateRollDoc`, never without. */
export const ROLL_DOC_VERSION = 1;

/** The roll's look, after every picture's develop — Trips' `TripGrade` shape. */
export interface RollGrade {
  layers: SavedLutLayer[];
  output: OutputTransform;
}

/** Where the export takes its pixels (`docs/develop-originals.md` §7, Auto by default). */
export type RollOriginals = 'auto' | 'proxies' | 'originals';

export interface RollExport {
  /** The delivered long edge in pixels, or null for the source's own size. */
  longEdge: number | null;
  /** JPEG quality, 0.5..1. */
  quality: number;
  originals: RollOriginals;
}

export const DEFAULT_ROLL_EXPORT: Readonly<RollExport> = Object.freeze({
  longEdge: null,
  quality: 0.92,
  originals: 'auto',
});

export const ROLL_EXPORT_LIMITS = {
  longEdge: { min: 256, max: 16384 },
  quality: { min: 0.5, max: 1 },
} as const;

/** A picture's crop shape: its own, or one of the suite's aspect presets. */
export type RollAspect = 'original' | string;

export interface RollPicture {
  /** The roll's own id for this entry — the filmstrip's key, the route's tail. */
  id: string;
  ref: SavedMediaRef;
  /** Null is as shot. Never inherited by the next picture. */
  develop: DevelopSettings | null;
  /** Null is uncropped. Crop · straighten · flip (`shared/media/framing.ts`). */
  framing: Framing | null;
  aspect: RollAspect;
}

export interface RollDoc {
  id: string;
  version: number;
  name: string;
  /** The ONE source this roll is kept on. Never in the roll file, never on the wire. */
  sourceId: string;
  createdAt: number;
  updatedAt: number;
  /** The filmstrip's order. */
  pictures: RollPicture[];
  grade: RollGrade | null;
  export: RollExport;
}

export function newRollId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id_${Math.random().toString(36).slice(2)}`;
}

export function createRollDoc(
  name: string,
  sourceId: string = DEFAULT_SOURCE_ID,
  now: number = Date.now(),
  id: string = newRollId(),
): RollDoc {
  return {
    id,
    version: ROLL_DOC_VERSION,
    name: name.trim(),
    sourceId,
    createdAt: now,
    updatedAt: now,
    pictures: [],
    grade: null,
    export: { ...DEFAULT_ROLL_EXPORT },
  };
}

export function createRollPicture(ref: SavedMediaRef, id: string = newRollId()): RollPicture {
  return { id, ref: { ...ref }, develop: null, framing: null, aspect: 'original' };
}

// --- reading what was stored ------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** A stored media ref, or null when it names nothing. Unknown keys are left behind. */
export function readMediaRef(raw: unknown): SavedMediaRef | null {
  if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name) return null;
  return {
    name: raw.name,
    size: Math.max(0, finite(raw.size, 0)),
    lastModified: finite(raw.lastModified, 0),
    ...(typeof raw.assetId === 'string' && raw.assetId ? { assetId: raw.assetId } : {}),
    ...(typeof raw.hash === 'string' && raw.hash ? { hash: raw.hash } : {}),
  };
}

const OUTPUTS: ReadonlySet<string> = new Set(['none', 'rec709-to-srgb', 'rec709-24-to-22', 'srgb-to-rec709']);

function readLayer(raw: unknown): SavedLutLayer | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.source !== 'string') return null;
  return {
    id: raw.id,
    source: raw.source,
    name: typeof raw.name === 'string' ? raw.name : raw.id,
    customText: typeof raw.customText === 'string' ? raw.customText : null,
    // The same 0..3 every other reader allows: capping at 1 silently dimmed
    // an over-applied look the trip and the project kept.
    intensity: Math.min(MAX_LAYER_INTENSITY, Math.max(0, finite(raw.intensity, 1))),
    enabled: raw.enabled !== false,
  };
}

export function readRollGrade(raw: unknown): RollGrade | null {
  if (!isRecord(raw)) return null;
  const layers = Array.isArray(raw.layers) ? raw.layers.flatMap((l) => readLayer(l) ?? []) : [];
  const output = typeof raw.output === 'string' && OUTPUTS.has(raw.output) ? (raw.output as OutputTransform) : 'none';
  // A look with nothing in it is no look: stored as null, so "follows none" has one spelling.
  return layers.length === 0 && output === 'none' ? null : { layers, output };
}

export function readRollExport(raw: unknown): RollExport {
  if (!isRecord(raw)) return { ...DEFAULT_ROLL_EXPORT };
  const { longEdge, quality } = ROLL_EXPORT_LIMITS;
  const edge = typeof raw.longEdge === 'number' && Number.isFinite(raw.longEdge)
    ? Math.round(Math.min(longEdge.max, Math.max(longEdge.min, raw.longEdge)))
    : null;
  return {
    longEdge: edge,
    quality: Math.min(quality.max, Math.max(quality.min, finite(raw.quality, DEFAULT_ROLL_EXPORT.quality))),
    originals: raw.originals === 'proxies' || raw.originals === 'originals' ? raw.originals : 'auto',
  };
}

/** A stored crop, or null when there is none — an untouched framing is no crop, one spelling. */
function readFraming(raw: unknown): Framing | null {
  if (raw == null) return null;
  const f = normaliseFraming(raw);
  return isDefaultFraming(f) ? null : f;
}

function readPicture(raw: unknown): RollPicture | null {
  if (!isRecord(raw)) return null;
  const ref = readMediaRef(raw.ref);
  if (!ref) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newRollId(),
    ref,
    develop: developOrNull(raw.develop),
    framing: readFraming(raw.framing),
    aspect: typeof raw.aspect === 'string' && isStoredAspect(raw.aspect) ? raw.aspect : 'original',
  };
}

/**
 * A stored or received roll read onto the current shape — or null when what
 * arrived is not a roll at all (no id, no picture list). The same reading for
 * the store, the instance and the file, so a roll cannot mean one thing in one
 * place and another in the next. A picture whose ref names nothing is dropped;
 * a second entry for the same picture id keeps the first.
 */
export function readRollDoc(raw: unknown, fallbackSourceId: string = DEFAULT_SOURCE_ID): RollDoc | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || !Array.isArray(raw.pictures)) return null;
  const seen = new Set<string>();
  const pictures: RollPicture[] = [];
  for (const item of raw.pictures) {
    const picture = readPicture(item);
    if (!picture || seen.has(picture.id)) continue;
    seen.add(picture.id);
    pictures.push(picture);
  }
  const now = Date.now();
  return {
    id: raw.id,
    version: ROLL_DOC_VERSION,
    name: typeof raw.name === 'string' ? raw.name : '',
    sourceId: typeof raw.sourceId === 'string' && raw.sourceId ? raw.sourceId : fallbackSourceId,
    createdAt: finite(raw.createdAt, now),
    updatedAt: finite(raw.updatedAt, now),
    pictures,
    grade: readRollGrade(raw.grade),
    export: readRollExport(raw.export),
  };
}

/** A roll as the store hands it back, on the current shape. Version 1 has no older shape to lift. */
export function migrateRollDoc(doc: RollDoc): RollDoc {
  return readRollDoc(doc, doc.sourceId) ?? createRollDoc(doc.name ?? '', doc.sourceId, Date.now(), doc.id);
}

// --- editing ----------------------------------------------------------------

/** Two refs to one picture: the same source id, the same content, or the same name and size. */
export function sameMediaRef(a: SavedMediaRef, b: SavedMediaRef): boolean {
  if (a.assetId && b.assetId) return a.assetId === b.assetId;
  if (a.hash && b.hash) return a.hash === b.hash;
  return a.name.toLowerCase() === b.name.toLowerCase() && a.size === b.size;
}

/**
 * The roll with `refs` appended, in order, each once: a picture already on the
 * roll (by id, hash, or name and size) is not added twice — adding a day's
 * pictures again must not duplicate the ones already developed.
 */
export function addPictures(
  roll: RollDoc,
  refs: readonly SavedMediaRef[],
  now: number = Date.now(),
  makeId: () => string = newRollId,
): RollDoc {
  const pictures = [...roll.pictures];
  for (const ref of refs) {
    if (pictures.some((p) => sameMediaRef(p.ref, ref))) continue;
    pictures.push(createRollPicture(ref, makeId()));
  }
  return pictures.length === roll.pictures.length ? roll : { ...roll, pictures, updatedAt: now };
}

export function removePictures(roll: RollDoc, ids: readonly string[], now: number = Date.now()): RollDoc {
  const drop = new Set(ids);
  const pictures = roll.pictures.filter((p) => !drop.has(p.id));
  return pictures.length === roll.pictures.length ? roll : { ...roll, pictures, updatedAt: now };
}

/** Move one picture to `to` in the strip; out-of-range indices are clamped. */
export function movePicture(roll: RollDoc, from: number, to: number, now: number = Date.now()): RollDoc {
  const n = roll.pictures.length;
  if (from < 0 || from >= n) return roll;
  const target = Math.max(0, Math.min(n - 1, to));
  if (target === from) return roll;
  const pictures = [...roll.pictures];
  const [moved] = pictures.splice(from, 1);
  pictures.splice(target, 0, moved);
  return { ...roll, pictures, updatedAt: now };
}

/** One picture's own fields changed; its id and ref never move. */
export function patchPicture(
  roll: RollDoc,
  id: string,
  patch: Partial<Pick<RollPicture, 'develop' | 'framing' | 'aspect'>>,
  now: number = Date.now(),
): RollDoc {
  let found = false;
  const pictures = roll.pictures.map((p) => {
    if (p.id !== id) return p;
    found = true;
    return { ...p, ...patch };
  });
  return found ? { ...roll, pictures, updatedAt: now } : roll;
}

/**
 * One picture's crop — aspect and framing — written onto others, each as its
 * own copy. An untouched framing is stored as `null`, the reader's spelling;
 * a pan is copied as is, since the draw clamps it to each picture's slack.
 */
export function copyCropTo(
  roll: RollDoc,
  ids: readonly string[],
  crop: { aspect: string; framing: Framing | null },
  now: number = Date.now(),
): RollDoc {
  const framing = crop.framing && !isDefaultFraming(crop.framing) ? crop.framing : null;
  let found = false;
  const pictures = roll.pictures.map((p) => {
    if (!ids.includes(p.id)) return p;
    found = true;
    return { ...p, aspect: crop.aspect, framing: framing ? { ...framing } : null };
  });
  return found ? { ...roll, pictures, updatedAt: now } : roll;
}

/**
 * What the gallery card says: "18 of 42 developed" — a develop or a crop
 * counts, and an ASPECT other than the picture's own is a crop on its own:
 * drawing a free zone with the frame's corners leaves the framing untouched
 * (nothing was panned or zoomed), and a picture that was plainly cropped must
 * not read as one nobody has looked at.
 */
export function rollProgress(roll: RollDoc): { total: number; developed: number } {
  return {
    total: roll.pictures.length,
    developed: roll.pictures.filter((p) => p.develop !== null || p.framing !== null || p.aspect !== 'original')
      .length,
  };
}
