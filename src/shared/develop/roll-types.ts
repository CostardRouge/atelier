/**
 * A ROLL — the Develop tool's document (`docs/develop-tool.md` §3): a named set
 * of pictures, each with its own develop, look and crop, plus how the roll
 * exports. What a developer keeps, not what an editor composes: no deck, no
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

import { ALL_META, readMetaChoice, type MetaChoice } from '../exif/meta-groups';
import { isDefaultKeystone, keystoneOrNull, type Keystone } from '../render/geometry';
import { isDefaultLens, lensOrNull, type LensCorrection } from '../render/lens';
import { detailOrNull, isDefaultDetail, type DetailSettings } from '../render/detail';
import { isDefaultPostVignette, postVignetteOrNull, type PostCropVignette } from '../render/post-vignette';
import { readPatches, type Patch } from '../render/repair';
import { readLayers, type AdjustLayer } from './layer';
import { developOrNull, isDefaultDevelop, type DevelopSettings } from './develop';
import { filmTextureOrNull, type FilmTexture } from '../film/film-texture';
import { isDefaultFraming, normaliseFraming, type Framing } from '../media/framing';
import { type SavedMediaRef } from '../projects/project-types';
import { isStoredAspect } from './crop-aspect';
import { legacyWholeBorder, readBorder, sameBorder, type RollBorder } from './border-layout';
import type { SavedLutLayer } from '../lut/use-lut-stack';
import { MAX_LAYER_INTENSITY } from '../lut/lut-stack';
import type { OutputTransform } from '../lut/transfer';
import { DEFAULT_SOURCE_ID } from '../sources/source';

/**
 * Bumped with a migration block in `migrateRollDoc`, never without.
 * v2 (2026-09-19): `RollPicture.border`, and a legacy Whole framing that is
 * exactly a border read as one (`legacyWholeBorder`).
 * v3 (2026-09-20): `RollGrade.film` — grain and halation. No block of its own:
 * `migrateRollDoc` re-READS the whole document, so a roll written before the
 * texture existed lands with `film: null` and one written by a newer build
 * lands clamped, both through `readRollGrade`.
 * `RollPicture.rendition` (2026-09-21) needed no bump: absent reads as null,
 * which means exactly what it means now — the picture opens where it opens.
 * v4 (2026-09-21): `RollExport.originals` is GONE — which pixels a picture
 * leaves from is the picture's own rendition (`docs/capture-renditions.md`
 * §13.2), and "proxies only, this run" is a run-time choice that never
 * touches the document. No block: the reader simply stops reading the key.
 * v5 (2026-09-23): the look is the PICTURE's (`RollPicture.grade`), never the
 * roll's — the maintainer's call: *"c'est le média qui décide"*. A roll written
 * before v5 hands its one look to every picture that has none (`readRollDoc`),
 * so nothing changes on screen; `RollDoc.grade` is gone.
 */
export const ROLL_DOC_VERSION = 5;

/** A picture's look, after its own develop — Trips' `TripGrade` shape. */
export interface RollGrade {
  layers: SavedLutLayer[];
  output: OutputTransform;
  /** Grain and halation, or null for none — `SavedGrade.film`. */
  film?: FilmTexture | null;
}

export interface RollExport {
  /** The delivered long edge in pixels, or null for the source's own size. */
  longEdge: number | null;
  /** JPEG quality, 0.5..1. */
  quality: number;
  /**
   * Replace a file the chosen folder already holds under the export's name,
   * or number the incoming one (`DJI_0101-1.jpg`). OFF by default: an export
   * is named after its picture, so the name it wants is exactly the name a
   * previous run — or, on a case-insensitive volume, the original itself —
   * may already be sitting under.
   */
  replace: boolean;
  /**
   * Deliver an Ultra HDR JPEG (`shared/hdr/`): the SDR picture with a gain
   * map inside it, for a picture developed on its RAW — a render holds
   * nothing above white and leaves as a plain JPEG, said in the run.
   */
  hdr: boolean;
  /** How far above white the map may reach, in stops: the RAW is developed this much darker to find them. */
  hdrStops: number;
  /**
   * Which groups of metadata leave (`exif/meta-groups.ts`, M3): the roll's,
   * because "this set goes online without its position" is said of a
   * delivery. Absent reads as All — the GPS leaves by default, his call.
   */
  metadata: MetaChoice;
}

export const DEFAULT_ROLL_EXPORT: Readonly<RollExport> = Object.freeze({
  longEdge: null,
  quality: 0.92,
  replace: false,
  hdr: false,
  hdrStops: 2,
  metadata: ALL_META,
});

export const ROLL_EXPORT_LIMITS = {
  longEdge: { min: 256, max: 16384 },
  quality: { min: 0.5, max: 1 },
  hdrStops: { min: 1, max: 4 },
} as const;

/** Whether a picture leaves in an export — `RollPicture.deliver`. */
export type DeliverState = 'auto' | 'yes' | 'no' | 'ignore';

const DELIVER_STATES: ReadonlySet<string> = new Set(['auto', 'yes', 'no', 'ignore']);

/** A picture's crop shape: its own, or one of the suite's aspect presets. */
export type RollAspect = 'original' | string;

export interface RollPicture {
  /** The roll's own id for this entry — the filmstrip's key, the route's tail. */
  id: string;
  ref: SavedMediaRef;
  /** Null is as shot. Never inherited by the next picture. */
  develop: DevelopSettings | null;
  /**
   * The look — LUTs, output transform, grain — applied after the develop, or
   * null for none (v5). The picture's own, like its develop: never inherited
   * by the next picture, and written onto others only by an Apply-to verb.
   */
  grade?: RollGrade | null;
  /** Null is uncropped. Crop · straighten · flip (`shared/media/framing.ts`). */
  framing: Framing | null;
  aspect: RollAspect;
  /** Null is no border: the file is exactly the crop (`border-layout.ts`, v2). */
  border: RollBorder | null;
  /**
   * WHICH FILE of the capture this picture is developed from, below the
   * sensor: a rendition id (`media/renditions.ts` — `proxy`, or
   * `delivered:<file name>`), stored so a phone shows the same picture
   * without re-picking (`docs/capture-renditions.md` §12, A3). Null is where
   * the picture OPENS — its proxy where there is one, else the file itself —
   * and an id the capture no longer offers falls back to that. The material
   * rung above it is `develop.base`; a preset, a paste or a batch verb never
   * carries either.
   */
  rendition?: string | null;
  /**
   * Whether the picture LEAVES in an export (2026-09-23, `docs/lightroom-gaps.md`
   * §10): `auto` follows the roll's rule — it leaves when it is edited
   * (`pictureEdits`) —, `yes` and `no` are the author's own call, and `ignore`
   * takes the picture out of the roll's WORK: never exported, skipped by the
   * arrows and by every "apply to the others", left out of the progress count,
   * still opened by a click. ONE field, so no two answers can contradict each
   * other. Absent reads as `auto`, so no roll needs migrating. An output
   * instruction, never a rating: culling stays Winnow's.
   */
  deliver?: DeliverState;
  /**
   * The picture's own WORDS, written into the delivered file (2026-09-23, M2
   * of `docs/lightroom-gaps.md` §9): a title (`dc:title`) and a caption
   * (`dc:description` and EXIF `ImageDescription`). The picture's, never the
   * roll's — two frames of one scene are captioned apart — and carried by no
   * preset, paste or Apply-to. Absent or empty mean none, one spelling.
   */
  title?: string;
  caption?: string;
  /**
   * The perspective correction (`shared/render/geometry.ts`), or null for
   * none. It is applied BEFORE the crop frames the result: a keystone takes
   * the converging verticals out of the picture, and the crop then decides
   * what of it is kept.
   */
  keystone?: Keystone | null;
  /**
   * Distortion, lateral CA and vignetting (`shared/render/lens.ts`), or null.
   * It runs BEFORE the keystone: a lens un-bends the picture, and only then
   * does a perspective correction have straight verticals to work with
   * (`shared/render/picture-geometry.ts` states that order once).
   */
  lens?: LensCorrection | null;
  /**
   * Denoise, defringe and sharpen (`shared/render/detail.ts`), or null for
   * none. The noise passes run FIRST, on the source before the develop; the
   * sharpen LAST, after every warp and layer — `detail.ts` states why.
   */
  detail?: DetailSettings | null;
  /**
   * The post-crop vignette (`shared/render/post-vignette.ts`), or null for
   * none — shaped in the DELIVERED frame, so it follows the crop.
   */
  vignette?: PostCropVignette | null;
  /**
   * Heal and clone patches (`shared/render/repair.ts`), in order, drawn as
   * ONE pass on the source before everything else. Absent and empty mean the
   * same thing.
   */
  repair?: Patch[];
  /**
   * Adjustment layers, BOTTOM to TOP (`shared/develop/layer.ts`). Absent and
   * empty mean the same thing, so nothing is migrated. They apply after the
   * picture's own develop and look, on the picture as it is DISPLAYED — see
   * `render-core.md` for why that order was chosen over the brief's.
   */
  layers?: AdjustLayer[];
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
    export: { ...DEFAULT_ROLL_EXPORT },
  };
}

export function createRollPicture(ref: SavedMediaRef, id: string = newRollId()): RollPicture {
  return {
    id,
    ref: { ...ref },
    develop: null,
    grade: null,
    framing: null,
    aspect: 'original',
    border: null,
    rendition: null,
    deliver: 'auto',
    keystone: null,
    lens: null,
    detail: null,
    vignette: null,
    repair: [],
    layers: [],
  };
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
  const film = filmTextureOrNull(raw.film);
  // A look with nothing in it is no look: stored as null, so "follows none"
  // has one spelling. A TEXTURE alone is a look — grain on an ungraded
  // picture is exactly what a stock's texture half is for.
  return layers.length === 0 && output === 'none' && !film ? null : { layers, output, film };
}

export function readRollExport(raw: unknown): RollExport {
  if (!isRecord(raw)) return { ...DEFAULT_ROLL_EXPORT, metadata: { ...ALL_META } };
  const { longEdge, quality } = ROLL_EXPORT_LIMITS;
  const edge = typeof raw.longEdge === 'number' && Number.isFinite(raw.longEdge)
    ? Math.round(Math.min(longEdge.max, Math.max(longEdge.min, raw.longEdge)))
    : null;
  return {
    longEdge: edge,
    quality: Math.min(quality.max, Math.max(quality.min, finite(raw.quality, DEFAULT_ROLL_EXPORT.quality))),
    // `originals`, written by v1–v3, is left behind on purpose (v4).
    // Anything but a stored `true` reads as off, so a roll written before the
    // choice existed keeps what is in its folder.
    replace: raw.replace === true,
    hdr: raw.hdr === true,
    hdrStops: Math.round(
      Math.min(ROLL_EXPORT_LIMITS.hdrStops.max, Math.max(ROLL_EXPORT_LIMITS.hdrStops.min, finite(raw.hdrStops, DEFAULT_ROLL_EXPORT.hdrStops))),
    ),
    metadata: readMetaChoice(raw.metadata),
  };
}

/**
 * The roll with one picture's words replaced — trimmed, an emptied one taken
 * off the picture rather than stored blank. The same roll back when nothing
 * changed, so a blur that edited nothing is no undo step.
 */
export function setPictureWords(
  roll: RollDoc,
  id: string,
  words: { title?: string; caption?: string },
  now: number = Date.now(),
): RollDoc {
  const picture = roll.pictures.find((p) => p.id === id);
  if (!picture) return roll;
  const next = wordsOf({ title: words.title ?? picture.title, caption: words.caption ?? picture.caption });
  if ((next.title ?? '') === (picture.title ?? '') && (next.caption ?? '') === (picture.caption ?? '')) return roll;
  const pictures = roll.pictures.map((p) => {
    if (p.id !== id) return p;
    const { title: _t, caption: _c, ...rest } = p;
    void _t;
    void _c;
    return { ...rest, ...next };
  });
  return { ...roll, pictures, updatedAt: now };
}

/** A picture's words as stored: a title and a caption, trimmed, an empty one left out. */
export function wordsOf(raw: { title?: unknown; caption?: unknown }): Pick<RollPicture, 'title' | 'caption'> {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const caption = typeof raw.caption === 'string' ? raw.caption.trim() : '';
  return { ...(title ? { title } : {}), ...(caption ? { caption } : {}) };
}

/** A stored crop, or null when there is none — an untouched framing is no crop, one spelling. */
function readFraming(raw: unknown): Framing | null {
  if (raw == null) return null;
  const f = normaliseFraming(raw);
  return isDefaultFraming(f) ? null : f;
}

/**
 * A stored picture. `rollGrade` is the look a roll written before v5 held for
 * every picture: it is handed to a picture that carries no `grade` key of its
 * own, which is every picture of such a roll — so the migration is part of
 * reading, and idempotent.
 */
function readPicture(raw: unknown, rollGrade: RollGrade | null = null): RollPicture | null {
  if (!isRecord(raw)) return null;
  const ref = readMediaRef(raw.ref);
  if (!ref) return null;
  let framing = readFraming(raw.framing);
  let aspect = typeof raw.aspect === 'string' && isStoredAspect(raw.aspect) ? raw.aspect : 'original';
  let border = readBorder(raw.border);
  // v1 → v2: a Whole framing that IS a border becomes one. Idempotent, so it
  // is simply part of reading: v2 never writes `contain`.
  const legacy = framing ? legacyWholeBorder(aspect, framing) : null;
  if (legacy) {
    aspect = legacy.aspect;
    framing = isDefaultFraming(legacy.framing) ? null : legacy.framing;
    border = border ?? legacy.border;
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newRollId(),
    ref,
    develop: developOrNull(raw.develop),
    grade: 'grade' in raw ? readRollGrade(raw.grade) : rollGrade ? structuredClone(rollGrade) : null,
    framing,
    aspect,
    border,
    rendition: typeof raw.rendition === 'string' && raw.rendition ? raw.rendition : null,
    // Absent — every roll written before it existed — and anything unknown read as `auto`.
    deliver: typeof raw.deliver === 'string' && DELIVER_STATES.has(raw.deliver) ? (raw.deliver as DeliverState) : 'auto',
    ...wordsOf(raw),
    // Absent on every roll written before the warp existed, and `null` there
    // means exactly what it means now — so there is no migration to run.
    keystone: keystoneOrNull(raw.keystone),
    lens: lensOrNull(raw.lens),
    detail: detailOrNull(raw.detail),
    vignette: postVignetteOrNull(raw.vignette),
    repair: readPatches(raw.repair),
    layers: readLayers(raw.layers),
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
  // v4 → v5: the roll's one look becomes every picture's own. Only a roll
  // that PREDATES v5 is read for it — a v5 roll never writes the key, and one
  // that somehow carried it must not dress pictures their author left bare.
  const version = finite(raw.version, 1);
  const rollGrade = version < 5 ? readRollGrade(raw.grade) : null;
  const seen = new Set<string>();
  const pictures: RollPicture[] = [];
  for (const item of raw.pictures) {
    const picture = readPicture(item, rollGrade);
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
    export: readRollExport(raw.export),
  };
}

/** A roll as the store hands it back, on the current shape — v1's lift (the border, a legacy Whole) is `readPicture`'s. */
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
  patch: Partial<
    Pick<
      RollPicture,
      | 'develop'
      | 'grade'
      | 'framing'
      | 'aspect'
      | 'border'
      | 'rendition'
      | 'deliver'
      | 'keystone'
      | 'lens'
      | 'detail'
      | 'vignette'
      | 'repair'
      | 'layers'
    >
  >,
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
 * One picture's LOOK written onto others, each as its own copy — never the
 * develop, the crop or anything else: a look is chosen per picture, and this
 * is the one gesture that dresses several with it. `null` takes the look off.
 */
export function copyGradeTo(
  roll: RollDoc,
  ids: readonly string[],
  grade: RollGrade | null,
  now: number = Date.now(),
): RollDoc {
  const key = JSON.stringify(grade ?? null);
  let changed = false;
  const pictures = roll.pictures.map((p) => {
    if (!ids.includes(p.id) || JSON.stringify(p.grade ?? null) === key) return p;
    changed = true;
    return { ...p, grade: grade ? structuredClone(grade) : null };
  });
  return changed ? { ...roll, pictures, updatedAt: now } : roll;
}

/**
 * One picture's BORDER written onto others, each as its own copy — never the
 * crop: the maintainer asked for the two apart (2026-09-19), so a roll can wear
 * one border over crops that each differ. `null` takes the border off.
 */
export function copyBorderTo(
  roll: RollDoc,
  ids: readonly string[],
  border: RollBorder | null,
  now: number = Date.now(),
): RollDoc {
  let changed = false;
  const pictures = roll.pictures.map((p) => {
    if (!ids.includes(p.id) || sameBorder(p.border, border)) return p;
    changed = true;
    return { ...p, border: border ? { ...border, margin: { ...border.margin } } : null };
  });
  return changed ? { ...roll, pictures, updatedAt: now } : roll;
}

/** What was done to a picture, in the inspector's own words — `edited` is this list being non-empty. */
export type PictureEdit =
  | 'develop'
  | 'look'
  | 'crop'
  | 'border'
  | 'perspective'
  | 'lens'
  | 'detail'
  | 'vignette'
  | 'repair'
  | 'layers';

/**
 * Everything the author did to ONE picture — the one answer to "is it edited?"
 * that the filmstrip's dot, the roll's progress and the remove confirmation all
 * read (2026-09-23: three different tests had it three ways, and an hour of
 * heal spots was removed without a word). A value dragged back to its default
 * is no edit; an ASPECT other than the picture's own is a crop on its own —
 * drawing a free zone with the frame's corners pans nothing. WHICH FILE the
 * picture is developed from (`rendition`) is a choice of bytes, not an edit.
 */
export function pictureEdits(p: RollPicture): PictureEdit[] {
  const out: PictureEdit[] = [];
  if (!isDefaultDevelop(p.develop)) out.push('develop');
  if (p.grade) out.push('look');
  if ((p.framing && !isDefaultFraming(p.framing)) || p.aspect !== 'original') out.push('crop');
  if (p.border) out.push('border');
  if (!isDefaultKeystone(p.keystone)) out.push('perspective');
  if (!isDefaultLens(p.lens)) out.push('lens');
  if (!isDefaultDetail(p.detail)) out.push('detail');
  if (!isDefaultPostVignette(p.vignette)) out.push('vignette');
  if ((p.repair ?? []).length > 0) out.push('repair');
  if ((p.layers ?? []).length > 0) out.push('layers');
  return out;
}

export function isEdited(p: RollPicture): boolean {
  return pictureEdits(p).length > 0;
}

/**
 * What the gallery card says: "18 of 42 developed" — `isEdited`, counted over
 * the pictures still in the roll's work: an ignored picture is in neither
 * number, and `ignored` says how many were set aside.
 */
export function rollProgress(roll: RollDoc): { total: number; developed: number; ignored: number } {
  const live = roll.pictures.filter((p) => !isIgnored(p));
  return { total: live.length, developed: live.filter(isEdited).length, ignored: roll.pictures.length - live.length };
}

// --- delivery ---------------------------------------------------------------

export function deliverState(p: Pick<RollPicture, 'deliver'>): DeliverState {
  return p.deliver ?? 'auto';
}

export function isIgnored(p: Pick<RollPicture, 'deliver'>): boolean {
  return deliverState(p) === 'ignore';
}

/** Whether the picture leaves in an export: the author's call, else the roll's rule — edited ones leave. */
export function delivers(p: RollPicture): boolean {
  const state = deliverState(p);
  return state === 'yes' || (state === 'auto' && isEdited(p));
}

/**
 * The state after one "send ↔ hold" gesture (the `P` key, a row, a badge):
 * the OTHER answer, stored as `auto` when that is what the rule already says —
 * so a picture toggled twice is back on the rule, not pinned. An ignored
 * picture comes back into the work on `auto`.
 */
export function toggledDelivery(p: RollPicture): DeliverState {
  if (isIgnored(p)) return 'auto';
  const leaving = !delivers(p);
  return leaving === isEdited(p) ? 'auto' : leaving ? 'yes' : 'no';
}

/** The Export tab's table filters. An ignored picture answers none of them: it has a group of its own. */
export type DeliveryFilter = 'all' | 'edited' | 'leaving' | 'held';

export function matchesDeliveryFilter(p: RollPicture, filter: DeliveryFilter): boolean {
  if (isIgnored(p)) return false;
  switch (filter) {
    case 'all':
      return true;
    case 'edited':
      return isEdited(p);
    case 'leaving':
      return delivers(p);
    case 'held':
      return !delivers(p);
  }
}

/** One delivery state written onto several pictures; the same roll back when nothing changes. */
export function setDelivery(
  roll: RollDoc,
  ids: readonly string[],
  state: DeliverState,
  now: number = Date.now(),
): RollDoc {
  let changed = false;
  const pictures = roll.pictures.map((p) => {
    if (!ids.includes(p.id) || deliverState(p) === state) return p;
    changed = true;
    return { ...p, deliver: state };
  });
  return changed ? { ...roll, pictures, updatedAt: now } : roll;
}
