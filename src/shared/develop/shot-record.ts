/**
 * The picture AS SHOT, kept beside its record — the first half of learning a
 * develop from the maintainer's own rolls (B1 of `docs/auto-develop.md` §6).
 *
 * A develop is a record (`DevelopSettings`, the crop, the layers…), and a
 * model can only learn what the record answers to: the picture BEFORE it. The
 * roll's thumbnail is the picture as DELIVERED (`roll-thumb.ts`), so without
 * this there is no pair. What is kept per picture, in the roll store and never
 * on the document:
 *
 * - a VIGNETTE — a small JPEG of the picture as the browser decodes it, a few
 *   kilobytes (`SHOT_LONG_EDGE`), enough for a network to read the light and
 *   the colour of a scene and nothing a person would print;
 * - its STATS — the very `SourceStats` the Auto verbs read, measured off that
 *   vignette so the two never disagree;
 * - the camera's FACTS — the body, the lens and the exposure, read from the
 *   file's EXIF (`shotExifOf`), because an ISO and a focal length say a lot
 *   about what a hand does next. No GPS, no words: a training file is about
 *   the LIGHT, and a position or a caption is nobody's to learn from.
 *
 * A device choice (`shotsPref`, Develop's settings), kept by default: every
 * day without a pair is dataset lost (§4, decision 2), and turning it off
 * drops what was kept. The dump that writes every pair into one file is
 * `training-dump.ts`. Pure and DOM-free; the bake is `shot-bake.ts`.
 */

import type { ExifData } from '../exif/exif-parser';
import { localPref } from '../ui/local-pref';
import type { SourceStats } from './auto-develop';

/** The vignette's long edge: a scene's light and colour, never its detail. */
export const SHOT_LONG_EDGE = 256;
/** JPEG quality of a vignette — a few kilobytes at this edge. */
export const SHOT_QUALITY = 0.8;
/** What one vignette weighs, roughly, for a sentence said before any is made. */
export const SHOT_ESTIMATE_BYTES = 14_000;

/** The camera's facts a develop answers to — the exposure, never the place. */
export interface ShotExif {
  make?: string;
  model?: string;
  lens?: string;
  iso?: number;
  /** Seconds. */
  exposureTime?: number;
  fNumber?: number;
  /** Millimetres. */
  focalLength?: number;
  /** Millimetres, 35 mm-equivalent. */
  focalLength35?: number;
  /** EV. */
  exposureBias?: number;
  /** EXIF `WhiteBalance`: 0 auto, 1 manual. */
  whiteBalance?: number;
  /** EXIF `DateTimeOriginal`, as written — the hour tells the light. */
  dateTimeOriginal?: string;
}

/** A picture's as-shot pair, as the store keeps it (`roll-store.ts`, `shots`). */
export interface ShotRecord {
  /** The roll picture's id. */
  id: string;
  rollId: string;
  vignette: Blob;
  /** The vignette's width over its height. */
  aspect: number;
  /** The file's own upright size, where the decoder said it; the vignette is smaller. */
  natural: { width: number; height: number } | null;
  stats: SourceStats;
  /** Null when the file said nothing — a re-encode, a working preview. */
  exif: ShotExif | null;
  /** True when the vignette is the camera's render inside a RAW, never its sensor. */
  viaRawPreview: boolean;
  updatedAt: number;
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function text(s: unknown): string | undefined {
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
}

/**
 * The camera's facts out of a file's EXIF — every field optional, absent when
 * the file did not say it, and nothing a position or a person could be read
 * from. Null when nothing at all was said.
 */
export function shotExifOf(exif: ExifData | null | undefined): ShotExif | null {
  if (!exif) return null;
  const out: ShotExif = {};
  const make = text(exif.make);
  const model = text(exif.model);
  if (make) out.make = make;
  if (model) out.model = model;
  const lens = text(exif.lensModel) ?? text(exif.lensMake);
  if (lens) out.lens = lens;
  if (finite(exif.iso) && exif.iso > 0) out.iso = Math.round(exif.iso);
  if (finite(exif.exposureTime) && exif.exposureTime > 0) out.exposureTime = exif.exposureTime;
  if (finite(exif.fNumber) && exif.fNumber > 0) out.fNumber = exif.fNumber;
  if (finite(exif.focalLength) && exif.focalLength > 0) out.focalLength = exif.focalLength;
  if (finite(exif.focalLength35) && exif.focalLength35 > 0) out.focalLength35 = exif.focalLength35;
  if (finite(exif.exposureBias)) out.exposureBias = exif.exposureBias;
  if (finite(exif.whiteBalance)) out.whiteBalance = exif.whiteBalance;
  const when = text(exif.dateTimeOriginal);
  if (when) out.dateTimeOriginal = when;
  return Object.keys(out).length ? out : null;
}

/** A stored record read back safely: junk yields null, a vignette is a Blob or nothing. */
export function readShotRecord(raw: unknown): ShotRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.rollId !== 'string') return null;
  if (typeof Blob === 'undefined' || !(r.vignette instanceof Blob)) return null;
  const stats = r.stats as Partial<SourceStats> | undefined;
  if (!stats || !Array.isArray(stats.bins) || !finite(stats.total) || !Array.isArray(stats.linearMean)) return null;
  const natural = r.natural as { width?: unknown; height?: unknown } | null | undefined;
  return {
    id: r.id,
    rollId: r.rollId,
    vignette: r.vignette,
    aspect: finite(r.aspect) && r.aspect > 0 ? r.aspect : 1,
    natural:
      natural && finite(natural.width) && finite(natural.height) && natural.width > 0 && natural.height > 0
        ? { width: natural.width, height: natural.height }
        : null,
    stats: {
      bins: stats.bins.map((b) => (finite(b) ? b : 0)),
      total: stats.total,
      linearMean: [stats.linearMean[0] ?? 0, stats.linearMean[1] ?? 0, stats.linearMean[2] ?? 0],
      counted: finite(stats.counted) ? stats.counted : 0,
    },
    exif: r.exif && typeof r.exif === 'object' ? (r.exif as ShotExif) : null,
    viaRawPreview: r.viaRawPreview === true,
    updatedAt: finite(r.updatedAt) ? r.updatedAt : 0,
  };
}

/**
 * Whether this device keeps the pairs. Kept by DEFAULT — absent means on —
 * because the dataset is the one thing a later model cannot make up; `0`
 * when the author turned it off, which also drops what was kept.
 */
export const shotsPref = localPref<boolean>(
  'atelier.develop.shots',
  (raw) => raw !== '0',
  (on) => (on ? null : '0'),
);
