/**
 * One photograph's EXIF, from wherever it can be had.
 *
 * Two accounts exist and both are worth reading: the bytes in hand, and what
 * the source that handed the file over parsed at ingest (`MediaOrigin.exif`).
 * A source's editing rendition is a re-encode, and a re-encode drops the
 * metadata — Winnow's photo proxy is a WebP with none at all — so a picture
 * read from its own bytes alone answers `—` on every field while the camera's
 * own record sits one property away.
 *
 * This is the ONE place that combination is made: read the head of the file,
 * then merge the source's account UNDER it (`merge-exif.ts` — the file always
 * wins, field by field). Every consumer that shows or draws a still's EXIF
 * goes through here, so the Studio and the EXIF viewer never drift apart on
 * what a picture is known to say.
 *
 * Reading never throws: a slice that cannot be read (a revoked permission, a
 * file that vanished) leaves the source's account standing on its own, which
 * is the honest answer rather than an error.
 */

import { EXIF_SLICE_BYTES, isEmptyExif, parseExif, type ExifData } from './exif-parser';
import { mergeExif } from './merge-exif';
import { mediaOrigin } from '../projects/media-identity';

export interface EffectiveExif {
  /** File over source, field by field. Empty when neither said anything. */
  exif: ExifData;
  /** What the bytes in hand said on their own — empty for a re-encode. */
  file: ExifData;
  /**
   * The instance that vouched for the rest, when one did — so a panel can say
   * "read from winnow.steeve.website" instead of presenting a column as if it
   * had come out of the file.
   */
  via: string | null;
}

/** What a source knows about `file`'s capture, or null. */
export function vouchedExif(file: File): { exif: ExifData; via: string } | null {
  const origin = mediaOrigin(file);
  const exif = origin?.exif;
  if (!exif || isEmptyExif(exif)) return null;
  return { exif, via: origin.sourceId };
}

/**
 * Only the head of the file is read — EXIF sits at the front of a JPEG and of
 * a TIFF-based RAW — and the picture itself is never decoded here.
 */
export async function readEffectiveExif(file: File): Promise<EffectiveExif> {
  let fileExif: ExifData | null = null;
  try {
    fileExif = parseExif(await file.slice(0, EXIF_SLICE_BYTES).arrayBuffer());
  } catch {
    fileExif = null;
  }
  const vouched = vouchedExif(file);
  return {
    exif: mergeExif(fileExif, vouched?.exif) ?? {},
    file: fileExif ?? {},
    via: vouched?.via ?? null,
  };
}
