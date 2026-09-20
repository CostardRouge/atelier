/**
 * Giving a delivered JPEG the metadata of the picture it came from.
 *
 * The rule the maintainer set (2026-09-20): **an export carries the
 * ORIGINAL's EXIF, whatever its pixels were taken from.** He develops on a
 * proxy for the speed of it — a WebP rendition with no metadata at all — and
 * the file he keeps has to read like the capture: its position, its body, its
 * lens, the hour it was taken. Where the pixels came from and where the
 * metadata came from are two questions, and only the first is a trade-off.
 *
 * Three accounts, in this order:
 *
 * 1. The original's own EXIF **block**, copied whole (`exif-block.ts`). It is
 *    preferred whenever the original's head bytes can be had, because it
 *    keeps what no struct models — the maker notes above all.
 * 2. Its **fields**, parsed and rebuilt (`exif-build.ts`), for an original
 *    whose block cannot be moved: a DNG or an ARW, whose TIFF stream is the
 *    whole file. What the source vouched for fills the gaps, never the other
 *    way round — the file wins, as everywhere else (`merge-exif.ts`).
 * 3. What the source vouched for alone, when the original is out of reach.
 *    That is Winnow's row: exposure, position, altitude, the capture time —
 *    no make, no model, no lens, so it is the poorest of the three and is
 *    named as such wherever a panel says where the metadata came from.
 *
 * Only `stampExif` touches a `Blob`; the choice itself is pure.
 */

import { buildExifBlock } from './exif-build';
import { readExifBlock, retagExifBlock, withExifBlock } from './exif-block';
import { isEmptyExif, parseExif, type ExifData } from './exif-parser';
import { mergeExif } from './merge-exif';

/** Which of the three accounts a block was made from. */
export type ExifAccount = 'block' | 'fields' | 'vouched' | 'none';

export interface ExportExif {
  /** What to write, or null when nothing is known about the picture. */
  block: Uint8Array<ArrayBuffer> | null;
  account: ExifAccount;
}

export interface DeliveredSize {
  width: number;
  height: number;
}

/**
 * The EXIF block a delivered picture should carry.
 *
 * `head` is the first bytes of the ORIGINAL — enough to hold its EXIF, which
 * sits at the front of a JPEG and of a TIFF-based RAW alike — or null when it
 * could not be had. `vouched` is what the source said about the capture.
 */
export function exportExifBlock(
  head: Uint8Array | null,
  vouched: ExifData | null,
  delivered: DeliveredSize,
): ExportExif {
  const retag = { pixelWidth: delivered.width, pixelHeight: delivered.height };
  if (head && head.length > 0) {
    const copied = readExifBlock(head);
    if (copied) return { block: retagExifBlock(copied, retag), account: 'block' };
    const fields = parseExif(head.buffer.slice(head.byteOffset, head.byteOffset + head.byteLength));
    const merged = mergeExif(isEmptyExif(fields) ? null : fields, vouched);
    if (merged && !isEmptyExif(merged)) {
      return { block: build(merged, delivered), account: 'fields' };
    }
  }
  if (vouched && !isEmptyExif(vouched)) {
    return { block: build(vouched, delivered), account: 'vouched' };
  }
  return { block: null, account: 'none' };
}

function build(exif: ExifData, delivered: DeliveredSize): Uint8Array<ArrayBuffer> {
  return buildExifBlock(exif, {
    software: 'Atelier',
    pixelWidth: delivered.width,
    pixelHeight: delivered.height,
  });
}

/**
 * The same JPEG carrying `block`. A block the format cannot hold — a copied
 * one can be larger than a segment — is REBUILT from what can be read of it
 * rather than dropped, so the position and the body still travel; a picture
 * that has nothing to say comes back untouched.
 */
export async function stampExif(jpeg: Blob, exif: ExportExif, delivered: DeliveredSize): Promise<Blob> {
  if (!exif.block) return jpeg;
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  try {
    return new Blob([withExifBlock(bytes, exif.block)], { type: 'image/jpeg' });
  } catch {
    const fields = parseExif(exif.block.buffer.slice(exif.block.byteOffset));
    if (isEmptyExif(fields)) return jpeg;
    return new Blob([withExifBlock(bytes, build(fields, delivered))], { type: 'image/jpeg' });
  }
}

/** Where a picture's metadata came from, for the sentence a panel says. */
export function exifAccountText(account: ExifAccount): string {
  switch (account) {
    case 'block':
      return 'the original’s own EXIF, copied whole';
    case 'fields':
      return 'the original’s EXIF, rebuilt';
    case 'vouched':
      return 'what the source knows of the capture';
    default:
      return 'no EXIF — nothing is known about this picture';
  }
}
