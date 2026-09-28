/**
 * The roll file: a whole roll on disk, as JSON — `.roll.json`.
 *
 * A BACKUP and a transfer, the trip file's rule (`roadtrip/trip-file.ts`), not
 * the Studio's template: a roll's pictures, their develops, looks and crops,
 * and its export ARE the roll. It carries everything except what only means
 * something in the browser that wrote it:
 *
 * - `id` — a fresh one on import, so the same file read twice is two rolls and
 *   never an overwrite; and each PICTURE's id with it, since the thumbnails and
 *   working previews are keyed by picture id alone;
 * - `sourceId` — an imported roll belongs to the source that imports it;
 * - the timestamps, and the thumbnails (their own store, re-baked).
 *
 * The media REFS travel, hash and source id included: they are what finds the
 * pictures again in a renamed folder or on the same instance from another
 * machine. A custom `.cube` rides as text inside its layer, so the look opens
 * the same elsewhere. A file from a NEWER version is refused rather than
 * half-read. Pure and DOM-free.
 */

import { ROLL_DOC_VERSION, createRollDoc, newRollId, readRollDoc, type RollDoc } from './roll-types';

/** Marks the file as ours; a stray `.json` is rejected on it. */
export const ROLL_FILE_KIND = 'atelier/develop-roll';
export const ROLL_FILE_EXTENSION = '.roll.json';
export const ROLL_FILE_ACCEPT = '.json,application/json';

/** What a roll file carries — the document minus what is machine-bound. */
export type RollPortable = Omit<RollDoc, 'version' | 'id' | 'sourceId' | 'createdAt' | 'updatedAt'>;

export interface RollFile extends RollPortable {
  kind: typeof ROLL_FILE_KIND;
  version: number;
  /** ISO timestamp, for the human reading the file. */
  exportedAt: string;
}

export type RollParseResult = { ok: true; file: RollFile } | { ok: false; error: string };

export function toRollFile(roll: RollDoc, exportedAt: number = Date.now()): RollFile {
  return {
    kind: ROLL_FILE_KIND,
    version: ROLL_DOC_VERSION,
    exportedAt: new Date(exportedAt).toISOString(),
    name: roll.name,
    pictures: structuredClone(roll.pictures),
    export: structuredClone(roll.export),
  };
}

/** Indented on purpose: the file is meant to be readable and diffable. */
export function serializeRollFile(file: RollFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** `Islande — jour 3` → `islande-jour-3.roll.json`. */
export function rollFileName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'roll'}${ROLL_FILE_EXTENSION}`;
}

/**
 * A file's text into a roll file, or the reason it is not one. The input comes
 * from the user's disk and may be anything: this never throws, and every
 * refusal says something a person can act on. The body is read through the
 * same `readRollDoc` a stored roll is, so a file cannot mean something a store
 * would not.
 */
export function parseRollFile(text: string): RollParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'That file is not an Atelier roll.' };
  }
  const body = raw as Record<string, unknown>;
  if (body.kind !== ROLL_FILE_KIND) {
    return { ok: false, error: 'That file is not an Atelier roll (wrong or missing kind).' };
  }
  const version = typeof body.version === 'number' ? body.version : 0;
  if (version > ROLL_DOC_VERSION) {
    return {
      ok: false,
      error:
        `This file was written by a newer version of Atelier (format ${version}, ` +
        `this one reads up to ${ROLL_DOC_VERSION}). Update the app first.`,
    };
  }
  if (!Array.isArray(body.pictures)) {
    return { ok: false, error: 'The file has no pictures list.' };
  }
  const read = readRollDoc({ ...body, id: 'file' });
  if (!read) return { ok: false, error: 'That file is not an Atelier roll.' };
  return {
    ok: true,
    file: {
      kind: ROLL_FILE_KIND,
      version: ROLL_DOC_VERSION,
      exportedAt: typeof body.exportedAt === 'string' ? body.exportedAt : '',
      name: read.name,
      pictures: read.pictures,
      export: read.export,
    },
  };
}

/**
 * A brand-new roll from a file — the import path: a fresh id, fresh
 * timestamps, the importing source. Every portable field is spelled out, so a
 * field forgotten here fails a test rather than silently dropping what the file
 * carried (the fault `applyProjectFile` once had on intros).
 */
export function rollDocFromFile(
  file: RollFile,
  now: number = Date.now(),
  sourceId?: string,
  makeId: () => string = newRollId,
): RollDoc {
  const doc = createRollDoc(file.name, sourceId, now);
  return {
    ...doc,
    // Fresh PICTURE ids too, not only the roll's: thumbnails and working
    // previews are keyed by picture id alone, so the same file imported twice
    // made two rolls overwrite each other's cells — and deleting one deleted
    // the other's.
    pictures: structuredClone(file.pictures).map((p) => ({ ...p, id: makeId() })),
    export: structuredClone(file.export),
  };
}
