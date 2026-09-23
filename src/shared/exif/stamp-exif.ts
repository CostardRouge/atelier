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
 * Whichever account, the block says `Software: Atelier` — the mark
 * `software-mark.ts` reads, so a file this suite wrote is never taken for the
 * camera's own rendition of the picture it sits beside. Since M1 (2026-09-23)
 * that holds with NO account too: a picture nobody knows anything about still
 * leaves signed, in a block of its own and in an XMP packet, and the author's
 * rights (`delivery-meta.ts`) are written over whatever the capture said.
 *
 * Only `stampExif` touches a `Blob`; the choice itself is pure.
 */

import { buildExifBlock } from './exif-build';
import { readExifBlock, retagExifBlock, withExifBlock, withXmpPacket } from './exif-block';
import { isEmptyExif, parseExif, type ExifData, type GpsCoord } from './exif-parser';
import { captureYear, deliveryXmp, resolveRights, type DeliveryIdentity, type DeliveryRights } from './delivery-meta';
import { ALL_META, filterExif, keepsWholeBlock, type MetaChoice } from './meta-groups';
import type { DeliveryPlace } from './delivery-place';
import { mergeExif } from './merge-exif';
import { ATELIER_SOFTWARE } from './software-mark';

/** Which of the three accounts a block was made from. */
export type ExifAccount = 'block' | 'fields' | 'vouched' | 'none';

export interface ExportExif {
  /**
   * What to write. Never null since every file is signed: with no account it
   * is a block holding the signature and the rights alone.
   */
  block: Uint8Array<ArrayBuffer> | null;
  /** Where the CAPTURE's metadata came from — `none` still leaves signed. */
  account: ExifAccount;
  /** The rights written, resolved against the capture's year. */
  rights: DeliveryRights;
  /** The author's tags as written over the capture's — what a rebuild must write again. */
  tags: AuthorTags;
  /** What was asked to leave (`meta-groups.ts`). */
  keep: MetaChoice;
  /** The place written, or null. */
  place: DeliveryPlace | null;
  /** Whether the capture had a position a place could have been named from. */
  located: boolean;
  /** The XMP packet the file carries: the signature, and the rights where there are some. */
  xmp: string;
}

/** The author's half of what a delivered picture says (`delivery-meta.ts`). */
export interface AuthorMeta {
  /** Who signs; null or no name writes no rights. */
  identity?: DeliveryIdentity | null;
  /** The year for a picture whose capture time is unknown — the export's own. */
  fallbackYear?: number;
  /** The picture's own title and caption (`RollPicture`), or none. */
  title?: string | null;
  caption?: string | null;
  /** Which groups leave (`meta-groups.ts`); everything when not given. */
  keep?: MetaChoice;
  /**
   * Names a position (`delivery-place.ts` over the loaded index), or absent
   * when the run did not load one. Asked of the capture's OWN position,
   * whether or not that position leaves.
   */
  placeOf?: (gps: GpsCoord) => DeliveryPlace | null;
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
  author: AuthorMeta = {},
): ExportExif {
  const keep = author.keep ?? ALL_META;
  const fallbackYear = author.fallbackYear ?? new Date().getFullYear();
  const caption = keep.words ? author.caption?.trim() || null : null;
  const title = keep.words ? author.title?.trim() || null : null;
  const rightsOf = (exif: ExifData | null): DeliveryRights =>
    keep.rights
      ? resolveRights(author.identity ?? null, captureYear(exif?.dateTimeOriginal, fallbackYear))
      : { creator: null, copyright: null };
  // The place is read from the capture as it WAS — before the choice drops
  // its position — so a town can leave without the coordinates it came from.
  let located = false;
  const placeFrom = (exif: ExifData | null): DeliveryPlace | null => {
    const gps = exif?.gps;
    if (!gps) return null;
    located = true;
    return keep.place && author.placeOf ? author.placeOf(gps) : null;
  };
  const signed = (block: Uint8Array<ArrayBuffer>, account: ExifAccount, rights: DeliveryRights, capture: ExifData | null): ExportExif => {
    const tags = authorTags(keep, rights, caption);
    const place = placeFrom(capture);
    return { block, account, rights, tags, keep, place, located, xmp: deliveryXmp({ ...rights, title, caption, place }) };
  };
  // What leaves of the capture, once the choice has had its say.
  const kept = (exif: ExifData) => filterExif(exif, keep);

  if (head && head.length > 0) {
    const copied = readExifBlock(head);
    if (copied) {
      const own = parseExif(copied.buffer);
      const rights = rightsOf(own);
      if (keepsWholeBlock(keep)) {
        // Every account names the software: it is the one mark that tells this
        // export from the camera's own file once the rest is a copy
        // (`software-mark.ts`). The author's tags go over the camera's own.
        const block = retagExifBlock(copied, {
          pixelWidth: delivered.width,
          pixelHeight: delivered.height,
          software: ATELIER_SOFTWARE,
          ...authorTags(keep, rights, caption),
        });
        return signed(block, 'block', rights, mergeExif(own, vouched));
      }
      // A group left out: the block is REBUILT from its fields, and what the
      // fields do not name — the maker notes, the serials — stays behind.
      const merged = mergeExif(own, vouched) ?? own;
      return signed(build(kept(merged), delivered, authorTags(keep, rights, caption)), 'fields', rights, merged);
    }
    const fields = parseExif(head.buffer.slice(head.byteOffset, head.byteOffset + head.byteLength));
    const merged = mergeExif(isEmptyExif(fields) ? null : fields, vouched);
    if (merged && !isEmptyExif(merged)) {
      const rights = rightsOf(merged);
      return signed(build(kept(merged), delivered, authorTags(keep, rights, caption)), 'fields', rights, merged);
    }
  }
  if (vouched && !isEmptyExif(vouched)) {
    const rights = rightsOf(vouched);
    return signed(build(kept(vouched), delivered, authorTags(keep, rights, caption)), 'vouched', rights, vouched);
  }
  const rights = rightsOf(null);
  return signed(build({}, delivered, authorTags(keep, rights, caption)), 'none', rights, null);
}

/** The author's three tags, as the writers take them: a string writes, null clears the capture's, undefined keeps it. */
export interface AuthorTags {
  artist?: string | null;
  copyright?: string | null;
  description?: string | null;
}

/**
 * What the author's half writes over the capture's. A group left out CLEARS
 * the capture's own value too — "no rights" means none, not the camera's
 * owner string — while a group kept with nothing to say leaves it alone.
 */
function authorTags(keep: MetaChoice, rights: DeliveryRights, caption: string | null): AuthorTags {
  const tags: AuthorTags = {};
  if (!keep.rights) {
    tags.artist = null;
    tags.copyright = null;
  } else if (rights.creator) {
    tags.artist = rights.creator;
    tags.copyright = rights.copyright;
  }
  if (!keep.words) tags.description = null;
  else if (caption) tags.description = caption;
  return tags;
}

function build(exif: ExifData, delivered: DeliveredSize, tags: AuthorTags): Uint8Array<ArrayBuffer> {
  return buildExifBlock(exif, {
    software: ATELIER_SOFTWARE,
    pixelWidth: delivered.width,
    pixelHeight: delivered.height,
    ...tags,
  });
}

/**
 * The same JPEG carrying `block` and the XMP packet. A block the format cannot
 * hold — a copied one can be larger than a segment — is REBUILT from what can
 * be read of it rather than dropped, so the position and the body still
 * travel. A packet too large for its segment (a caption of tens of kilobytes)
 * is left out rather than failing the picture; the EXIF still signs it.
 */
export async function stampExif(jpeg: Blob, exif: ExportExif, delivered: DeliveredSize): Promise<Blob> {
  let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(await jpeg.arrayBuffer());
  if (exif.block) {
    try {
      bytes = withExifBlock(bytes, exif.block);
    } catch {
      const fields = parseExif(exif.block.buffer.slice(exif.block.byteOffset));
      bytes = withExifBlock(bytes, build(filterExif(fields, exif.keep), delivered, exif.tags));
    }
  }
  try {
    if (exif.xmp) bytes = withXmpPacket(bytes, exif.xmp);
  } catch {
    // Signed in the EXIF alone.
  }
  return new Blob([bytes], { type: 'image/jpeg' });
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
      return 'no camera EXIF — nothing is known about this picture, only the signature is written';
  }
}
