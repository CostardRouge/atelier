/**
 * Which pictures of a roll CHANGED since they were last delivered (E4 of
 * `docs/lightroom-gaps.md` §9–§10): a mark per picture, written when its file
 * lands, holding a FINGERPRINT of everything that decides that file. A picture
 * whose fingerprint no longer matches its mark is *changed*; one with no mark
 * is *new*; the rest are *current*.
 *
 * **What the fingerprint covers is the picture's own**: its develop, its look,
 * its crop and border, the file it is developed from, its geometry, detail,
 * repair and layers, and its title and caption. NOT the roll's export settings
 * (a new size or quality is the author's knowing choice for a whole run, and
 * would otherwise mark every picture changed at once), not the delivery state
 * and not the identity — a new copyright line is a re-export the author asks
 * for, not a change to find.
 *
 * **Kept beside the roll, never ON it** (`roll-store.ts`, store `exports`),
 * for two reasons. A mark on the document is a write the undo stack would
 * record — every export an undo step, and an undo that un-marks what WAS
 * delivered. And a mark says "the file is in a folder of THIS machine", which
 * is this device's fact, like a folder handle: another device never delivered
 * it.
 *
 * Pure and DOM-free.
 */

import type { RollPicture } from './roll-types';

/** When a picture last left, and as what. */
export interface ExportMark {
  at: number;
  /** `exportKey` of the picture as it was rendered. */
  key: string;
}

/** A roll's marks, by picture id. */
export type ExportMarks = Readonly<Record<string, ExportMark>>;

export type ExportState = 'new' | 'current' | 'changed';

/** The fields of a picture that decide its delivered file. */
const KEYED = [
  'develop',
  'grade',
  'framing',
  'aspect',
  'border',
  'rendition',
  'keystone',
  'lens',
  'detail',
  'repair',
  'layers',
  'title',
  'caption',
] as const satisfies readonly (keyof RollPicture)[];

/**
 * JSON with its keys sorted, so two records that say the same thing print the
 * same way whatever order they were built in. An absent value, `null` and an
 * empty list are one spelling: the roll reads them as the same thing.
 */
function stable(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return value.length === 0 ? 'null' : `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object') {
    // A key whose value says nothing is left out, so absent, `null` and `[]`
    // spell the same record at every depth.
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, stable(v)] as const)
      .filter(([, v]) => v !== 'null')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
  return JSON.stringify(value);
}

/** FNV-1a, twice with two offsets, as 16 hex digits — a fingerprint, not a secret. */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193 + 2);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** The fingerprint of what a picture's delivered file is made of. */
export function exportKey(picture: RollPicture): string {
  const record: Record<string, unknown> = {};
  for (const field of KEYED) record[field] = picture[field];
  // An original aspect with no crop is the same file as no aspect at all.
  if (record.aspect === 'original') record.aspect = null;
  return hash(stable(record));
}

export function exportState(picture: RollPicture, marks: ExportMarks): ExportState {
  const mark = marks[picture.id];
  if (!mark) return 'new';
  return mark.key === exportKey(picture) ? 'current' : 'changed';
}

/** Whether a picture needs delivering again: never delivered, or changed since. */
export function needsExport(picture: RollPicture, marks: ExportMarks): boolean {
  return exportState(picture, marks) !== 'current';
}

/**
 * The marks after `pictures` landed at `at` — each keyed on the picture AS IT
 * WAS RENDERED, so an edit made while the run was going is still a change.
 */
export function withExported(marks: ExportMarks, pictures: readonly RollPicture[], at: number): ExportMarks {
  if (pictures.length === 0) return marks;
  const next: Record<string, ExportMark> = { ...marks };
  for (const p of pictures) next[p.id] = { at, key: exportKey(p) };
  return next;
}

/** Marks as stored, reading nothing it does not recognise. */
export function readExportMarks(raw: unknown): ExportMarks {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, ExportMark> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) continue;
    const { at, key } = v as Record<string, unknown>;
    if (typeof at === 'number' && Number.isFinite(at) && typeof key === 'string' && key) out[id] = { at, key };
  }
  return out;
}

/** Only the marks of pictures still on the roll — a removed picture's mark is dropped. */
export function pruneMarks(marks: ExportMarks, pictureIds: readonly string[]): ExportMarks {
  const keep = new Set(pictureIds);
  const ids = Object.keys(marks);
  if (ids.every((id) => keep.has(id))) return marks;
  return Object.fromEntries(ids.filter((id) => keep.has(id)).map((id) => [id, marks[id]]));
}
