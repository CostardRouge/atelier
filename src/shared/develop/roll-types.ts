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

import { readLensProfile, type LensProfileApplied } from '../lens/lens-profile';
import { DEFAULT_TARGET, readTargets, type ExportTarget } from './export-targets';
import { DEFAULT_WATERMARK, readWatermark, type Watermark } from './watermark';
import { ALL_META, readMetaChoice, type MetaChoice } from '../exif/meta-groups';
import { isDefaultKeystone, keystoneOrNull, type Keystone } from '../render/geometry';
import { isDefaultLens, lensOrNull, type LensCorrection } from '../render/lens';
import { detailOrNull, isDefaultDetail, type DetailSettings } from '../render/detail';
import { isDefaultPostVignette, postVignetteOrNull, type PostCropVignette } from '../render/post-vignette';
import { readPatches, type Patch } from '../render/repair';
import { readLayers, type AdjustLayer } from './layer';
import { DEFAULT_DEVELOP, developOrNull, isDefaultDevelop, isRawDevelop, type DevelopSettings } from './develop';
import { filmTextureOrNull, type FilmTexture } from '../film/film-texture';
import { isDefaultFraming, normaliseFraming, type Framing } from '../media/framing';
import { isClipName } from '../library/assets';
import { type SavedMediaRef } from '../projects/project-types';
import { isStoredAspect } from './crop-aspect';
import { legacyWholeBorder, readBorder, sameBorder, type RollBorder } from './border-layout';
import { DEFAULT_TIMELAPSE, readMakingOf, readTimelapseOptions, type MakingOf, type TimelapseOptions } from './timelapse-options';
import type { SavedLutLayer } from '../lut/use-lut-stack';
import { MAX_LAYER_INTENSITY } from '../lut/lut-stack';
import type { OutputTransform } from '../lut/transfer';
import { DEFAULT_SOURCE_ID } from '../sources/source';
import { readRollChoice, type RollChoice } from './roll-choice';

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
 * v6 (2026-09-23): the export writes to TARGETS (`export-targets.ts`, audit
 * item 28) — `RollExport.longEdge` and `quality` became the first target's
 * size and quality, read back by `readTargets`, so a roll exports exactly as
 * it did.
 * v7 (2026-09-30): `RollPicture.journal` — the picture's edit STEPS, for the
 * making-of video (`docs/develop-timelapse.md`). Absent reads as no steps,
 * so nothing migrates; a picture edited before v7 has settings and no story,
 * and `journal.ts` reconstructs one in a standard order, said as such.
 * `RollDoc.opensOn` (2026-10-02) needed no bump, like the rendition: absent
 * reads as null, which is what every roll did until then — each picture
 * opens where it opens.
 */
export const ROLL_DOC_VERSION = 7;

/** A picture's look, after its own develop — Trips' `TripGrade` shape. */
export interface RollGrade {
  layers: SavedLutLayer[];
  output: OutputTransform;
  /** Grain and halation, or null for none — `SavedGrade.film`. */
  film?: FilmTexture | null;
}

export interface RollExport {
  /**
   * Where the run writes and at what size (`export-targets.ts`, v6): the
   * first target into the folder chosen at the click, each other one into a
   * sub-folder of it named after the target — the files' own names never
   * change. Never empty.
   */
  targets: ExportTarget[];
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
  /**
   * The watermark's STYLE (`watermark.ts`): one look for the set, drawn only
   * on the targets that ask for it. Absent reads as the default.
   */
  watermark: Watermark;
  /**
   * How a picture's MAKING-OF video is made (`timelapse-options.ts`, v7):
   * one social format, length and grammar for the roll, so a second device
   * draws the same. Absent reads as the defaults.
   */
  timelapse: TimelapseOptions;
}

export const DEFAULT_ROLL_EXPORT: Readonly<RollExport> = Object.freeze({
  targets: [{ ...DEFAULT_TARGET }],
  replace: false,
  hdr: false,
  hdrStops: 2,
  metadata: ALL_META,
  watermark: DEFAULT_WATERMARK,
  timelapse: DEFAULT_TIMELAPSE,
});

export const ROLL_EXPORT_LIMITS = {
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
   * The MEASURED profile of the lens that took it (Lensfun,
   * `shared/lens/lens-profile.ts`), resolved to terms for its focal length and
   * aperture. CALIBRATION, not an edit: never copied to another picture, not
   * cleared by Reset, not what makes a picture "edited". `undefined` is never
   * decided (an automatic lookup may apply one), `null` is taken off by the
   * author (nothing puts it back by itself).
   */
  lensProfile?: LensProfileApplied | null;
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
  /**
   * Which VARIANT of its capture this entry is (2026-09-23, item 30 of
   * `docs/lightroom-gaps.md`, his YES — Capture One's variants, Lightroom's
   * virtual copies): absent for the first, 2, 3… for a copy made from a
   * picture already on the roll (`addVariant`). Every variant is a whole
   * `RollPicture` of its own — its develop, crop, look, words, delivery —
   * sharing only the file. Adding a file the roll holds is still refused
   * (`addPictures`); a variant is MADE, never added. A copy leaves into a
   * sub-folder named after it (`variantFolder`) so the file keeps the
   * capture's exact name, the one Winnow's `reconcile` pairs on.
   */
  variant?: number;
  /**
   * The picture's edit STEPS, oldest first (v7, `journal.ts`): what each
   * write of the one updater changed and the values it left — the record a
   * making-of video replays. Written in the SAME write as the edit, so an
   * undo takes the step with it; coalesced like the undo stack; bounded.
   * Never copied by Apply-to, a paste or a preset (a target's step is its
   * own, `via` said), never an edit (`pictureEdits`), never in an export
   * mark's key. Absent and empty mean the same thing.
   */
  journal?: JournalStep[];
  /**
   * What the author changed about this picture's making-of (v7,
   * `timelapse-options.ts`): chapters folded away, captions rewritten. A
   * document write like any other — one undo step, synced — and never an
   * edit of the picture. Absent and empty mean the same thing.
   */
  makingOf?: MakingOf;
}

/** How a step came to be, when it was not the author's own gesture on this picture. */
export type JournalVia = 'apply' | 'paste' | 'reset' | 'earlier';

/**
 * A step's VALUES: the sections it changed, as they stood after it — the
 * fields `PictureEdit` names, each under its section's own id. The crop is
 * its aspect AND its framing, the one section stored as two fields.
 */
export interface SectionValues {
  develop?: DevelopSettings | null;
  look?: RollGrade | null;
  crop?: { aspect: RollAspect; framing: Framing | null };
  border?: RollBorder | null;
  perspective?: Keystone | null;
  lens?: LensCorrection | null;
  detail?: DetailSettings | null;
  vignette?: PostCropVignette | null;
  repair?: Patch[];
  layers?: AdjustLayer[];
}

/** One write of the updater that changed a picture. */
export interface JournalStep {
  /** When the write landed (ms since the epoch); a coalesced step keeps its LAST write's. */
  at: number;
  /** What the write changed, in the inspector's order. */
  sections: PictureEdit[];
  /** Those sections' values AFTER the write — nothing else. */
  after: SectionValues;
  /** Absent for the author's own gesture on this picture. */
  via?: JournalVia;
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
  /**
   * Which file of its capture a picture with no choice of its own opens on
   * (`roll-choice.ts`, 2026-10-02): the camera's file, its sensor, or —
   * null, absent — where it opens, its proxy. A ROLE, resolved per picture,
   * since a stored rendition names one capture's file and means nothing on
   * another's. A picture's own choice always wins; a clip never follows.
   */
  opensOn?: RollChoice | null;
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
    opensOn: null,
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
  if (!isRecord(raw)) {
    return {
      ...DEFAULT_ROLL_EXPORT,
      targets: [{ ...DEFAULT_TARGET }],
      metadata: { ...ALL_META },
      watermark: { ...DEFAULT_WATERMARK },
      timelapse: readTimelapseOptions(undefined),
    };
  }
  return {
    // v5 and earlier held one long edge and one quality: they become the
    // only target, so an old roll exports exactly as it did.
    targets: readTargets(raw.targets, { longEdge: raw.longEdge, quality: raw.quality }),
    // `originals`, written by v1–v3, is left behind on purpose (v4).
    // Anything but a stored `true` reads as off, so a roll written before the
    // choice existed keeps what is in its folder.
    replace: raw.replace === true,
    hdr: raw.hdr === true,
    hdrStops: Math.round(
      Math.min(ROLL_EXPORT_LIMITS.hdrStops.max, Math.max(ROLL_EXPORT_LIMITS.hdrStops.min, finite(raw.hdrStops, DEFAULT_ROLL_EXPORT.hdrStops))),
    ),
    metadata: readMetaChoice(raw.metadata),
    watermark: readWatermark(raw.watermark),
    timelapse: readTimelapseOptions(raw.timelapse),
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
    // Absent stays absent: "never decided" and "taken off" are two answers.
    ...('lensProfile' in raw ? { lensProfile: readLensProfile(raw.lensProfile) ?? null } : {}),
    detail: detailOrNull(raw.detail),
    vignette: postVignetteOrNull(raw.vignette),
    repair: readPatches(raw.repair),
    layers: readLayers(raw.layers),
    // Absent is the first variant — every roll written before copies existed.
    ...(Number.isInteger(raw.variant) && (raw.variant as number) >= 2 ? { variant: raw.variant as number } : {}),
    // v7: absent on every roll written before the journal existed, and an
    // empty one is left absent so an old roll's record is byte-identical.
    ...(() => {
      const journal = readJournal(raw.journal);
      return journal.length > 0 ? { journal } : {};
    })(),
    ...(() => {
      const makingOf = readMakingOf(raw.makingOf);
      return makingOf ? { makingOf } : {};
    })(),
  };
}

/**
 * The roll with one picture's making-of edits replaced: a chapter hidden or
 * shown, a caption rewritten — an emptied caption taken off, so the computed
 * one returns. The same roll back when nothing changed.
 */
export function setMakingOf(
  roll: RollDoc,
  id: string,
  change: { hidden?: string[]; captions?: Record<string, string> },
  now: number = Date.now(),
): RollDoc {
  const picture = roll.pictures.find((p) => p.id === id);
  if (!picture) return roll;
  const next = readMakingOf({
    hidden: change.hidden ?? picture.makingOf?.hidden ?? [],
    captions: change.captions ?? picture.makingOf?.captions ?? {},
  });
  if (JSON.stringify(next ?? null) === JSON.stringify(picture.makingOf ?? null)) return roll;
  const pictures = roll.pictures.map((p) => {
    if (p.id !== id) return p;
    const { makingOf: _m, ...rest } = p;
    void _m;
    return next ? { ...rest, makingOf: next } : rest;
  });
  return { ...roll, pictures, updatedAt: now };
}

/** The sections a step may name, in the inspector's order. */
export const PICTURE_EDITS: readonly PictureEdit[] = [
  'develop',
  'look',
  'crop',
  'border',
  'perspective',
  'lens',
  'detail',
  'vignette',
  'repair',
  'layers',
];

const EDIT_IDS: ReadonlySet<string> = new Set(PICTURE_EDITS);
const VIAS: ReadonlySet<string> = new Set(['apply', 'paste', 'reset', 'earlier']);

/** A step's stored values read through the same readers a picture's fields are. */
function readSectionValues(raw: unknown, sections: readonly PictureEdit[]): SectionValues {
  const r = isRecord(raw) ? raw : {};
  const out: SectionValues = {};
  for (const s of sections) {
    switch (s) {
      case 'develop':
        out.develop = developOrNull(r.develop);
        break;
      case 'look':
        out.look = readRollGrade(r.look);
        break;
      case 'crop': {
        const crop = isRecord(r.crop) ? r.crop : {};
        out.crop = {
          aspect: typeof crop.aspect === 'string' && isStoredAspect(crop.aspect) ? crop.aspect : 'original',
          framing: readFraming(crop.framing),
        };
        break;
      }
      case 'border':
        out.border = readBorder(r.border);
        break;
      case 'perspective':
        out.perspective = keystoneOrNull(r.perspective);
        break;
      case 'lens':
        out.lens = lensOrNull(r.lens);
        break;
      case 'detail':
        out.detail = detailOrNull(r.detail);
        break;
      case 'vignette':
        out.vignette = postVignetteOrNull(r.vignette);
        break;
      case 'repair':
        out.repair = readPatches(r.repair);
        break;
      case 'layers':
        out.layers = readLayers(r.layers);
        break;
      default:
        // Exhaustive by type: a new `PictureEdit` member fails here at
        // compile time instead of being read as nothing (`journal.ts`).
        unreachedSection(s);
    }
  }
  return out;
}

function unreachedSection(section: never): never {
  throw new Error(`Unknown picture section: ${String(section)}`);
}

/**
 * A stored journal: a step with no time or no known section is dropped, the
 * sections come back in the inspector's order, each value through its own
 * reader, and the steps in time order.
 */
export function readJournal(raw: unknown): JournalStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: JournalStep[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.at !== 'number' || !Number.isFinite(item.at) || !Array.isArray(item.sections)) continue;
    const wanted = new Set(item.sections.filter((x): x is PictureEdit => typeof x === 'string' && EDIT_IDS.has(x)));
    const sections = PICTURE_EDITS.filter((s) => wanted.has(s));
    if (sections.length === 0) continue;
    steps.push({
      at: item.at,
      sections,
      after: readSectionValues(item.after, sections),
      ...(typeof item.via === 'string' && VIAS.has(item.via) ? { via: item.via as JournalVia } : {}),
    });
  }
  return steps.sort((a, b) => a.at - b.at);
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
    opensOn: readRollChoice(raw.opensOn),
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

// --- clips (2026-09-30) ------------------------------------------------------

/**
 * True when the picture is a CLIP — a video on the roll, developed and looked
 * whole and delivered as an MP4. Read from the ref's NAME (a Winnow proxy is
 * `<base>.mp4`, a rush `<base>.MP4`), never from a `File`: the answer must
 * hold before any byte is in hand, on every device.
 *
 * What a clip takes is the GLOBAL develop and the look — the one cube the
 * export grades every frame through, and the film node after it — and, since
 * 2026-10-01, a CROP: one framing (aspect, zoom, pan, straighten, flip) held
 * still over the whole clip, the same arithmetic as a photograph's applied
 * to every frame. A border, the perspective and lens warps, detail, repair
 * and layers stay a photograph's: they are passes over one still frame, and
 * on a clip they would have to follow the picture from frame to frame, which
 * nothing here does (and which Lightroom does not do either). So they are
 * never written onto a clip, by any door — the pure writers below refuse
 * them.
 */
export function isClipPicture(p: Pick<RollPicture, 'ref'>): boolean {
  return isClipName(p.ref.name);
}

// --- variants (item 30) --------------------------------------------------------

/** 1 for the first entry of a capture, 2, 3… for its copies. */
export function variantNumber(p: Pick<RollPicture, 'variant'>): number {
  return p.variant && p.variant >= 2 ? p.variant : 1;
}

/** `DJI_0101.JPG` for the first, `DJI_0101.JPG · 2` for a copy — the name every list shows. */
export function pictureLabel(p: Pick<RollPicture, 'ref' | 'variant'>): string {
  const n = variantNumber(p);
  return n > 1 ? `${p.ref.name} · ${n}` : p.ref.name;
}

/**
 * The sub-folder a copy's file leaves into — `Variant 2` — or '' for the
 * first. A FOLDER and not a suffix: the delivered name stays exactly the
 * capture's (`exportName`), which is what pairs his Gallery with his source
 * folder by eye and what Winnow's `reconcile` matches on (basename + capture
 * time). A `_v2` would have broken both.
 */
export function variantFolder(p: Pick<RollPicture, 'variant'>): string {
  const n = variantNumber(p);
  return n > 1 ? `Variant ${n}` : '';
}

/** How a variant starts: as the source picture stands, or as shot. */
export type VariantStart = 'clone' | 'fresh';

/**
 * A new variant of picture `fromId`, placed right after the last entry of
 * its capture and numbered one past the highest there (a number is never
 * reused while a higher one stands, so `Variant 3` names one picture's files
 * for as long as it exists).
 *
 * - `clone` — Lightroom's virtual copy, Capture One's *Clone Variant*: every
 *   field of the source, its words included (the author edits them apart),
 *   and its delivery back on the roll's rule.
 * - `fresh` — Capture One's *New Variant*: the picture AS SHOT. What is kept
 *   is what belongs to the FILE, never an edit: which rendition it is
 *   developed from, the RAW base with its measured gain (never its white
 *   balance, which is a choice), and the lens's measured profile.
 *
 * Returns the roll unchanged when `fromId` names nothing.
 */
export function addVariant(
  roll: RollDoc,
  fromId: string,
  start: VariantStart,
  newId: string = newRollId(),
  now: number = Date.now(),
): RollDoc {
  const from = roll.pictures.find((p) => p.id === fromId);
  if (!from) return roll;
  const family = roll.pictures.filter((p) => sameMediaRef(p.ref, from.ref));
  const number = Math.max(...family.map(variantNumber)) + 1;
  let made: RollPicture;
  if (start === 'clone') {
    const { deliver: _deliver, variant: _variant, ...rest } = structuredClone(from);
    void _deliver;
    void _variant;
    made = { ...rest, id: newId, deliver: 'auto', variant: number };
  } else {
    const base = from.develop && isRawDevelop(from.develop)
      ? { ...DEFAULT_DEVELOP, base: from.develop.base, rawGain: from.develop.rawGain ?? null }
      : null;
    made = {
      ...createRollPicture(from.ref, newId),
      develop: base,
      rendition: from.rendition ?? null,
      ...(from.lensProfile !== undefined ? { lensProfile: structuredClone(from.lensProfile) } : {}),
      variant: number,
    };
  }
  const last = roll.pictures.reduce((at, p, i) => (sameMediaRef(p.ref, from.ref) ? i : at), -1);
  const pictures = [...roll.pictures];
  pictures.splice(last + 1, 0, made);
  return { ...roll, pictures, updatedAt: now };
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
      | 'lensProfile'
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
    // A clip takes a crop like a photograph (`isClipPicture`): held still over every frame.
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
    // A clip leaves as it was recorded, with no border round it.
    if (!ids.includes(p.id) || isClipPicture(p) || sameBorder(p.border, border)) return p;
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

/**
 * The state that makes a picture leave (or stay), stored as `auto` wherever
 * the rule already says it — the batch twin of `toggledDelivery`, so ticking
 * a whole table pins only the pictures the rule would have answered otherwise.
 */
export function deliveryFor(p: RollPicture, leave: boolean): DeliverState {
  return leave === isEdited(p) ? 'auto' : leave ? 'yes' : 'no';
}

/**
 * "Tick all" / "untick all" over several pictures (the Pictures table's head
 * box): each takes `deliveryFor`, an ignored one is left out of the work and
 * untouched. The same roll back when nothing changes.
 */
export function setLeaving(
  roll: RollDoc,
  ids: readonly string[],
  leave: boolean,
  now: number = Date.now(),
): RollDoc {
  let changed = false;
  const pictures = roll.pictures.map((p) => {
    if (!ids.includes(p.id) || isIgnored(p)) return p;
    const next = deliveryFor(p, leave);
    if (deliverState(p) === next) return p;
    changed = true;
    return { ...p, deliver: next };
  });
  return changed ? { ...roll, pictures, updatedAt: now } : roll;
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
