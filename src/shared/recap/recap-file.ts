/**
 * The recap FILE — `.recap.json`: one recap, or every recap this device
 * keeps, on disk. A BACKUP and a transfer, the roll's, atlas's and mosaic's
 * rule: an import makes NEW recaps, never an overwrite, and belongs to the
 * source that imports it.
 *
 * It carries every choice — the pool by reference, the picks, the captions,
 * each picture's develop, the look and every setting. The prints a slot
 * draws, a local clip and the sound stay on the device they were added on:
 * another device fetches a Winnow picture again, and asks for a local file or
 * the sound once more. Pure and DOM-free.
 */

import { RECAP_DOC_VERSION, cleanRecapTitle, newRecapId, readRecapDoc, type RecapDoc } from './recap-doc';

export const RECAP_FILE_KIND = 'atelier/recap';
export const RECAP_FILE_EXTENSION = '.recap.json';
export const RECAP_FILE_ACCEPT = '.json,application/json';
export const MAX_RECAP_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FILE_RECAPS = 500;

export type RecapPortable = Omit<RecapDoc, 'sourceId'>;

export interface RecapFile {
  kind: typeof RECAP_FILE_KIND;
  version: number;
  exportedAt: string;
  recaps: RecapPortable[];
}

export type RecapParseResult = { ok: true; recaps: RecapDoc[] } | { ok: false; error: string };

export function toRecapFile(recaps: readonly RecapDoc[], exportedAt: number = Date.now()): RecapFile {
  return {
    kind: RECAP_FILE_KIND,
    version: RECAP_DOC_VERSION,
    exportedAt: new Date(exportedAt).toISOString(),
    recaps: recaps.map((r) => {
      const { sourceId: _dropped, ...rest } = structuredClone(r);
      void _dropped;
      return rest;
    }),
  };
}

export function serializeRecapFile(file: RecapFile): string {
  return JSON.stringify(file);
}

export function slugOf(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** `October 2026` → `october-2026.recap.json`. */
export function recapFileName(title: string): string {
  return `${slugOf(title) || 'recap'}${RECAP_FILE_EXTENSION}`;
}

export function backupFileName(now: number = Date.now()): string {
  return `atelier-recap-${new Date(now).toISOString().slice(0, 10)}${RECAP_FILE_EXTENSION}`;
}

/** A file's text into recaps ready to keep, or the reason it is not one. Never throws; every recap gets a new id. */
export function parseRecapFile(text: string, sourceId: string, now: number = Date.now()): RecapParseResult {
  if (text.length > MAX_RECAP_FILE_BYTES) return { ok: false, error: 'This file is too large to be a recap file.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: `This file is not JSON — a recap file ends in ${RECAP_FILE_EXTENSION}.` };
  }
  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).kind !== RECAP_FILE_KIND) return { ok: false, error: 'This is not a Recap file.' };
  const r = raw as Record<string, unknown>;
  if (typeof r.version === 'number' && r.version > RECAP_DOC_VERSION) {
    return { ok: false, error: 'This recap file was written by a newer Atelier — update this page and try again.' };
  }
  const recaps: RecapDoc[] = [];
  for (const item of Array.isArray(r.recaps) ? r.recaps.slice(0, MAX_FILE_RECAPS) : []) {
    const body = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    const doc = body ? readRecapDoc({ ...body, id: newRecapId(), sourceId, createdAt: now, updatedAt: now }, sourceId, now) : null;
    if (doc) recaps.push({ ...doc, title: cleanRecapTitle(doc.title) });
  }
  if (!recaps.length) return { ok: false, error: 'This recap file holds nothing to import.' };
  return { ok: true, recaps };
}
