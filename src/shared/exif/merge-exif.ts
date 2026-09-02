/**
 * Two accounts of one photograph's EXIF, reconciled.
 *
 * A picture can arrive with its metadata stripped — a source's editing
 * rendition is a re-encode, and a re-encode drops EXIF — while the source that
 * handed it over parsed the original at ingest and knows all of it. Both are
 * worth having, and they are not equal: **the file wins**. What is in the
 * bytes is the truth about the file on the stage; the source's account is the
 * truth about the capture it was made from, which is the right answer only
 * where the file is silent.
 *
 * Merged field by field rather than object by object, because a stripped file
 * is rarely empty — a WebP still declares its pixel size — and taking either
 * whole would throw away half the answer.
 *
 * Pure and DOM-free.
 */

import type { ExifData } from './exif-parser';

/**
 * `file` where it has a value, `source` where it does not. Null only when
 * neither says anything at all.
 */
export function mergeExif(
  file: ExifData | null | undefined,
  source: ExifData | null | undefined,
): ExifData | null {
  if (!file) return source ?? null;
  if (!source) return file;
  const merged: ExifData = { ...source };
  for (const [key, value] of Object.entries(file)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}
