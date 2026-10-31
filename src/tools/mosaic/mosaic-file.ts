/**
 * The mosaic FILE — `.mosaic.json`: one mosaic, or every mosaic this device
 * keeps, on disk (his pick, 2026-10-31). A BACKUP and a transfer, the roll
 * and atlas files' rule: an import makes NEW mosaics, never an overwrite, and
 * belongs to the source that imports it.
 *
 * It carries the library by reference (asset ids on the mosaic's instance,
 * the rows' hashes) WITH each picture's measured grid — so a mosaic opened
 * on another device remeasures nothing — the target and every setting. The
 * tiles a cell draws (`atelier-mosaic`'s `tiles`) do not travel: they are
 * fetched back from the instance and kept there too. Bounded everywhere: the
 * input is whatever was on the disk. Pure and DOM-free.
 */

import {
  MOSAIC_DOC_VERSION,
  cleanMosaicTitle,
  newMosaicId,
  readMosaicDoc,
  type MosaicDoc,
} from '../../shared/mosaic/mosaic-doc';

export const MOSAIC_FILE_KIND = 'atelier/mosaic';
export const MOSAIC_FILE_EXTENSION = '.mosaic.json';
export const MOSAIC_FILE_ACCEPT = '.json,application/json';

/** A file's largest reasonable size: 40 000 tiles are a few megabytes. */
export const MAX_MOSAIC_FILE_BYTES = 64 * 1024 * 1024;
/** How many mosaics one file may bring. */
const MAX_FILE_MOSAICS = 500;

/** What a mosaic file carries of each mosaic — the document minus what is machine-bound. */
export type MosaicPortable = Omit<MosaicDoc, 'sourceId'>;

export interface MosaicFile {
  kind: typeof MOSAIC_FILE_KIND;
  version: number;
  /** ISO timestamp, for the human reading the file. */
  exportedAt: string;
  mosaics: MosaicPortable[];
}

export type MosaicParseResult = { ok: true; mosaics: MosaicDoc[] } | { ok: false; error: string };

export function toMosaicFile(mosaics: readonly MosaicDoc[], exportedAt: number = Date.now()): MosaicFile {
  return {
    kind: MOSAIC_FILE_KIND,
    version: MOSAIC_DOC_VERSION,
    exportedAt: new Date(exportedAt).toISOString(),
    mosaics: mosaics.map((m) => {
      const { sourceId: _dropped, ...rest } = structuredClone(m);
      void _dropped;
      return rest;
    }),
  };
}

/** Compact: the grids are most of it, and indenting them doubles nothing useful. */
export function serializeMosaicFile(file: MosaicFile): string {
  return JSON.stringify(file);
}

function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** `Sydney 2025` → `sydney-2025.mosaic.json`. */
export function mosaicFileName(title: string): string {
  return `${slug(title) || 'mosaic'}${MOSAIC_FILE_EXTENSION}`;
}

/** `atelier-mosaic-2026-10-31.mosaic.json` — every mosaic this device keeps. */
export function backupFileName(now: number = Date.now()): string {
  return `atelier-mosaic-${new Date(now).toISOString().slice(0, 10)}${MOSAIC_FILE_EXTENSION}`;
}

/**
 * A file's text into mosaics ready to keep, or the reason it is not one.
 * Never throws. Each mosaic gets a NEW id (the same file read twice is two
 * mosaics), the importing source, and today's dates.
 */
export function parseMosaicFile(text: string, sourceId: string, now: number = Date.now()): MosaicParseResult {
  if (text.length > MAX_MOSAIC_FILE_BYTES) return { ok: false, error: 'This file is too large to be a mosaic file.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: `This file is not JSON — a mosaic file ends in ${MOSAIC_FILE_EXTENSION}.` };
  }
  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).kind !== MOSAIC_FILE_KIND) {
    return { ok: false, error: 'This is not a Mosaic file.' };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.version === 'number' && r.version > MOSAIC_DOC_VERSION) {
    return { ok: false, error: 'This mosaic file was written by a newer Atelier — update this page and try again.' };
  }
  const mosaics: MosaicDoc[] = [];
  for (const item of Array.isArray(r.mosaics) ? r.mosaics.slice(0, MAX_FILE_MOSAICS) : []) {
    const body = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    const doc = body ? readMosaicDoc({ ...body, id: newMosaicId(), sourceId, createdAt: now, updatedAt: now }, sourceId, now) : null;
    if (doc) mosaics.push({ ...doc, title: cleanMosaicTitle(doc.title) });
  }
  if (!mosaics.length) return { ok: false, error: 'This mosaic file holds nothing to import.' };
  return { ok: true, mosaics };
}
