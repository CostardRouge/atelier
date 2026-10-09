/**
 * The TRAINING FILE — every pair this device keeps, in one JSON file a trainer
 * outside the browser can read (B2 of `docs/auto-develop.md` §6).
 *
 * A pair is a picture AS SHOT (`shot-record.ts`: the vignette, its stats, the
 * camera's facts) and the RECORD the author wrote over it — the develop, the
 * crop, the warps, detail, the layers, the repair, the look. One line of
 * truth per picture, the records NORMALISED (every default filled, every
 * stored value read through the same readers a roll is), so a script never
 * guesses what an absent field means. An unedited picture is a pair too: "do
 * nothing here" is an answer a model must learn as much as any other.
 *
 * What is left out, on purpose: a look's inlined `.cube` text (a legacy
 * document's whole lattice — the file says its size and keeps the name), the
 * media's source and asset ids, the journal, the words, the delivery. Nothing
 * here leaves by itself: the file is written on the author's click and goes
 * where a download goes. Pure and DOM-free; the vignette's encoding is
 * injected, since a Blob reads differently in a browser and in node.
 */

import { normaliseFraming, type Framing } from '../media/framing';
import { detailOrNull, type DetailSettings } from '../render/detail';
import { keystoneOrNull, type Keystone } from '../render/geometry';
import { lensOrNull, type LensCorrection } from '../render/lens';
import { postVignetteOrNull, type PostCropVignette } from '../render/post-vignette';
import { readPatches, type Patch } from '../render/repair';
import type { OutputTransform } from '../lut/transfer';
import type { FilmTexture } from '../film/film-texture';
import { normaliseDevelop, type DevelopSettings } from './develop';
import { readLayers, type AdjustLayer } from './layer';
import type { RollBorder } from './border-layout';
import { pictureEdits, readRollGrade, type PictureEdit, type RollDoc, type RollPicture } from './roll-types';
import type { ShotExif, ShotRecord } from './shot-record';
import type { SourceStats } from './auto-develop';

export const TRAINING_FILE_KIND = 'atelier/training-pairs';
export const TRAINING_FILE_VERSION = 1;

/** A look's layer as the file carries it: its identity and strength, never a lattice. */
export interface TrainingLookLayer {
  source: string;
  name: string;
  intensity: number;
  enabled: boolean;
  /** A film stock's or a pack reference's JSON; a legacy inlined `.cube` is replaced by its size. */
  settings: string | null;
  inlinedCubeBytes?: number;
}

export interface TrainingRecord {
  develop: DevelopSettings;
  crop: { aspect: string; framing: Framing };
  keystone: Keystone | null;
  lens: LensCorrection | null;
  detail: DetailSettings | null;
  vignette: PostCropVignette | null;
  border: RollBorder | null;
  repair: Patch[];
  layers: AdjustLayer[];
  look: { layers: TrainingLookLayer[]; output: OutputTransform; film: FilmTexture | null } | null;
}

export interface TrainingShot {
  /** `data:image/jpeg;base64,…`, or null when the vignette could not be read. */
  vignette: string | null;
  aspect: number;
  natural: { width: number; height: number } | null;
  stats: SourceStats;
  exif: ShotExif | null;
  viaRawPreview: boolean;
}

export interface TrainingPair {
  roll: { id: string; name: string };
  picture: { id: string; name: string; size: number; hash: string | null; variant: number | null };
  /** The sections the author touched; empty is an untouched picture. */
  edits: PictureEdit[];
  /**
   * An AGENT wrote at least one step of this record through a command
   * (journal `via: 'agent'`): a model learning the author's own taste leaves
   * these out. Unknown — false — for a picture edited before the journal.
   */
  agent: boolean;
  shot: TrainingShot;
  record: TrainingRecord;
}

export interface TrainingFile {
  kind: typeof TRAINING_FILE_KIND;
  version: typeof TRAINING_FILE_VERSION;
  /** ISO timestamp, for the person reading the file. */
  exportedAt: string;
  pairs: TrainingPair[];
}

/** What a dump found: the pairs, and how many pictures had no pair yet. */
export interface TrainingDump {
  file: TrainingFile;
  /** Pictures across every roll whose pair is not kept (a clip, a file never in hand, the switch off). */
  unpaired: number;
}

/** A JSON text that may be a whole `.cube` lattice: long and shaped like one. */
function isInlinedCube(text: string): boolean {
  return text.length > 4096 && /LUT_3D_SIZE|LUT_1D_SIZE/.test(text.slice(0, 2048));
}

function lookOf(p: RollPicture): TrainingRecord['look'] {
  const grade = readRollGrade(p.grade);
  if (!grade) return null;
  return {
    layers: grade.layers.map((l) => {
      const text = l.customText;
      if (text && isInlinedCube(text)) {
        return { source: l.source, name: l.name, intensity: l.intensity, enabled: l.enabled, settings: null, inlinedCubeBytes: text.length };
      }
      return { source: l.source, name: l.name, intensity: l.intensity, enabled: l.enabled, settings: text ?? null };
    }),
    output: grade.output,
    film: grade.film ?? null,
  };
}

/** A picture's record, every default filled, every value read as a roll reads it. */
export function trainingRecord(p: RollPicture): TrainingRecord {
  return {
    develop: normaliseDevelop(p.develop ?? {}),
    crop: { aspect: p.aspect, framing: normaliseFraming(p.framing ?? {}) },
    keystone: keystoneOrNull(p.keystone),
    lens: lensOrNull(p.lens),
    detail: detailOrNull(p.detail),
    vignette: postVignetteOrNull(p.vignette),
    border: p.border ?? null,
    repair: readPatches(p.repair),
    layers: readLayers(p.layers),
    look: lookOf(p),
  };
}

/** One pair: the picture as shot, the record over it. */
export function trainingPair(roll: RollDoc, p: RollPicture, shot: ShotRecord, vignette: string | null): TrainingPair {
  return {
    roll: { id: roll.id, name: roll.name },
    picture: { id: p.id, name: p.ref.name, size: p.ref.size, hash: p.ref.hash ?? null, variant: p.variant ?? null },
    edits: pictureEdits(p),
    agent: (p.journal ?? []).some((step) => step.via === 'agent'),
    shot: {
      vignette,
      aspect: shot.aspect,
      natural: shot.natural,
      stats: shot.stats,
      exif: shot.exif,
      viaRawPreview: shot.viaRawPreview,
    },
    record: trainingRecord(p),
  };
}

/**
 * The whole file: every picture of every roll that has its pair, in roll
 * order. `encode` turns a vignette into its data URL (a browser's
 * `FileReader`, a test's stub); a vignette that cannot be read keeps its pair
 * with `vignette: null`, since the stats and the record are still a pair.
 */
export async function buildTrainingDump(
  rolls: readonly RollDoc[],
  shots: ReadonlyMap<string, ShotRecord>,
  encode: (vignette: Blob) => Promise<string | null>,
  exportedAt: number = Date.now(),
): Promise<TrainingDump> {
  const pairs: TrainingPair[] = [];
  let unpaired = 0;
  for (const roll of rolls) {
    for (const p of roll.pictures) {
      const shot = shots.get(p.id);
      if (!shot) {
        unpaired += 1;
        continue;
      }
      let vignette: string | null = null;
      try {
        vignette = await encode(shot.vignette);
      } catch {
        vignette = null;
      }
      pairs.push(trainingPair(roll, p, shot, vignette));
    }
  }
  return {
    file: { kind: TRAINING_FILE_KIND, version: TRAINING_FILE_VERSION, exportedAt: new Date(exportedAt).toISOString(), pairs },
    unpaired,
  };
}

/** Indented: meant to be read by a person before it is read by a script. */
export function serializeTrainingFile(file: TrainingFile): string {
  return `${JSON.stringify(file, null, 1)}\n`;
}

/** `atelier-training-2026-10-07.json`. */
export function trainingFileName(exportedAt: number = Date.now()): string {
  return `atelier-training-${new Date(exportedAt).toISOString().slice(0, 10)}.json`;
}
