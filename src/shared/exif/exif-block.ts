/**
 * The EXIF block as BYTES: taking it out of a JPEG, correcting the few tags a
 * development invalidates, and putting it back into another JPEG.
 *
 * This is the path that keeps EVERYTHING — the maker notes, the lens
 * corrections a body writes, the fields no struct here models — because it
 * never interprets the block, it moves it. `exif-build.ts` is the other path,
 * for an original whose block cannot be moved (a DNG, whose TIFF stream is the
 * whole file) or that has none (a WebP proxy, where the source's own answer is
 * all there is).
 *
 * These tags are corrected on the way, and only these:
 *
 * - **Orientation**, set to 1 — the delivered picture is already the way up it
 *   was looked at, and a viewer honouring the original's tag would turn it a
 *   second time. This is the one that is not optional.
 * - **The pixel dimensions**, set to the delivered ones, when the entry is
 *   there and wide enough to hold them.
 * - **The thumbnail**, dropped by cutting IFD1 loose: the original's thumbnail
 *   shows the picture BEFORE the development, and a file that previews as its
 *   own undeveloped self reads as a broken export. Its bytes stay in the block
 *   — unreferenced, and a block was under 64 KB before this, so it stays so.
 * - **Software**, set to what wrote the file — the one mark that tells an
 *   export from the camera's own file once the rest of the block is a copy
 *   (`software-mark.ts`) — and the author's `Artist`, `Copyright` and
 *   `ImageDescription` where asked (`delivery-meta.ts`). Written over the camera's entry where that entry can
 *   hold it; where it cannot, or where there is none, IFD0 is COPIED to the
 *   end of the block with the entry added and the header repointed at the
 *   copy. Every value an entry points at stays where it was, offsets being
 *   absolute, so nothing else in the block moves — the old directory becomes
 *   dead bytes, exactly like a cut-loose thumbnail.
 *
 * Pure and DOM-free, `Uint8Array` in and out.
 */

import { num, parseIfd, type Entry } from './exif-parser';

/** `Exif\0\0` — the six bytes an `APP1` segment opens with when it holds EXIF. */
const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

/**
 * The most a block can be: a JPEG segment's length is a `u16` counting itself,
 * so 65535 minus the two length bytes and the six-byte identifier.
 */
export const EXIF_BLOCK_MAX = 0xffff - 2 - EXIF_ID.length;

const SOI = 0xd8;
const SOS = 0xda;
const EOI = 0xd9;
const APP0 = 0xe0;
const APP1 = 0xe1;

interface Segment {
  marker: number;
  /** Where the `FF xx` starts. */
  start: number;
  /** One past the segment's last byte. */
  end: number;
  /** Where the payload starts — past the marker and the length. */
  body: number;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === SOI;
}

/**
 * The segments before the scan, in order. Stops at `SOS` (pixels follow, and
 * a `FF` inside them is not a marker) and on anything that is not a marker.
 */
function headerSegments(bytes: Uint8Array): Segment[] {
  const out: Segment[] = [];
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === SOS || marker === EOI) break;
    // Standalone markers carry no length (padding, restarts, SOI again).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) break;
    const end = at + 2 + length;
    if (end > bytes.length) break;
    out.push({ marker, start: at, end, body: at + 4 });
    at = end;
  }
  return out;
}

function holdsExif(bytes: Uint8Array, segment: Segment): boolean {
  if (segment.marker !== APP1 || segment.body + EXIF_ID.length > bytes.length) return false;
  return EXIF_ID.every((b, i) => bytes[segment.body + i] === b);
}

/** The TIFF block inside a JPEG's EXIF `APP1`, or null when it carries none. */
export function readExifBlock(jpeg: Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (!isJpeg(jpeg)) return null;
  for (const segment of headerSegments(jpeg)) {
    if (holdsExif(jpeg, segment)) return jpeg.slice(segment.body + EXIF_ID.length, segment.end);
  }
  return null;
}

/**
 * The same JPEG carrying `block` as its EXIF: any EXIF `APP1` it already had
 * is dropped, and the new one goes in right after the `SOI` — or after a
 * leading JFIF `APP0`, which the format says must come first.
 *
 * Throws when the block is larger than a segment can hold, rather than
 * writing a file no reader can parse: the caller falls back to a block it
 * built itself, which is small by construction.
 */
export function withExifBlock(jpeg: Uint8Array, block: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!isJpeg(jpeg)) throw new Error('not a JPEG');
  if (block.length > EXIF_BLOCK_MAX) {
    throw new Error(`the EXIF block is ${block.length} bytes, over the ${EXIF_BLOCK_MAX} a segment holds`);
  }
  const segments = headerSegments(jpeg);
  const existing = segments.find((s) => holdsExif(jpeg, s)) ?? null;
  const leadingJfif = segments[0]?.marker === APP0 ? segments[0] : null;
  const insertAt = leadingJfif ? leadingJfif.end : 2;

  const length = block.length + EXIF_ID.length + 2;
  const segment = new Uint8Array(length + 2);
  segment[0] = 0xff;
  segment[1] = APP1;
  segment[2] = (length >> 8) & 0xff;
  segment[3] = length & 0xff;
  segment.set(EXIF_ID, 4);
  segment.set(block, 4 + EXIF_ID.length);

  // Everything before the insertion point, the segment, then the rest minus
  // the EXIF segment that was there.
  const pieces: Uint8Array[] = [jpeg.subarray(0, insertAt), segment];
  const tailStart = insertAt;
  if (existing && existing.start >= tailStart) {
    pieces.push(jpeg.subarray(tailStart, existing.start), jpeg.subarray(existing.end));
  } else {
    pieces.push(jpeg.subarray(tailStart));
  }
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}

export interface RetagOptions {
  /** The delivered picture's own size; left alone when not given. */
  pixelWidth?: number;
  pixelHeight?: number;
  /** What wrote the delivered file — its `Software`; left alone when not given. */
  software?: string;
  /**
   * The author's words over the capture's (`delivery-meta.ts`): a string
   * writes it, null CLEARS what the capture carried, undefined leaves it.
   */
  artist?: string | null;
  copyright?: string | null;
  description?: string | null;
}

const IMAGE_DESCRIPTION = 0x010e;
const ORIENTATION = 0x0112;
const SOFTWARE = 0x0131;
const ARTIST = 0x013b;
const COPYRIGHT = 0x8298;
const EXIF_POINTER = 0x8769;
const PIXEL_WIDTH = 0xa002;
const PIXEL_HEIGHT = 0xa003;
const ASCII = 2;

/** Write `value` over an entry's own inline slot, when its type can hold it. */
function overwrite(view: DataView, entry: { type: number; valueOffset: number }, value: number, little: boolean): void {
  if (entry.type === 3 && value <= 0xffff && entry.valueOffset + 2 <= view.byteLength) {
    view.setUint16(entry.valueOffset, value, little);
  } else if (entry.type === 4 && entry.valueOffset + 4 <= view.byteLength) {
    view.setUint32(entry.valueOffset, value, little);
  }
}

const utf8 = new TextEncoder();

/** `text` as the bytes an ASCII entry holds: UTF-8, NUL-terminated — `exif-build.ts` says why. */
function asciiBytes(text: string): Uint8Array {
  const encoded = utf8.encode(text);
  const out = new Uint8Array(encoded.length + 1);
  out.set(encoded);
  return out;
}

/**
 * Write `text` over an ASCII entry's own bytes, NUL-padded to the entry's
 * count, when the entry is an ASCII one wide enough to hold it. False when it
 * is not — the caller then has to add an entry instead. An empty `text`
 * leaves nothing but NULs, which every reader takes for no value.
 */
function overwriteAscii(out: Uint8Array, entry: Entry | undefined, text: string): boolean {
  if (!entry || entry.type !== ASCII) return false;
  const bytes = asciiBytes(text);
  if (entry.count < bytes.length || entry.valueOffset + entry.count > out.length) return false;
  out.fill(0, entry.valueOffset, entry.valueOffset + entry.count);
  out.set(bytes, entry.valueOffset);
  return true;
}

/**
 * The block with IFD0 COPIED to its end, the given ASCII entries replaced or
 * added (kept in tag order, as the format asks), no IFD1, and the header
 * pointed at the copy. Entries are copied byte for byte, so an inline value
 * stays inline and a pointed one still points where it did. A directory that
 * runs past the block is left alone.
 */
function withIfd0Ascii(block: Uint8Array<ArrayBuffer>, little: boolean, adds: readonly (readonly [number, string])[]): Uint8Array<ArrayBuffer> {
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const ifd0At = view.getUint32(4, little);
  const count = view.getUint16(ifd0At, little);
  if (ifd0At + 2 + count * 12 > block.length) return block;

  const added = new Set(adds.map(([tag]) => tag));
  const kept: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = ifd0At + 2 + i * 12;
    if (!added.has(view.getUint16(at, little))) kept.push(at);
  }
  const values = [...adds].sort((a, b) => a[0] - b[0]).map(([tag, text]) => ({ tag, bytes: asciiBytes(text) }));
  const total = kept.length + values.length;
  // Word-aligned, as TIFF asks of every offset.
  const dirAt = block.length + (block.length & 1);
  let valueAt = dirAt + 2 + total * 12 + 4;
  const outOf = values.reduce((n, v) => n + (v.bytes.length > 4 ? v.bytes.length + (v.bytes.length & 1) : 0), 0);
  const out = new Uint8Array(valueAt + outOf);
  out.set(block);
  const o = new DataView(out.buffer);
  o.setUint32(4, dirAt, little);
  o.setUint16(dirAt, total, little);

  let at = dirAt + 2;
  let next = 0;
  const place = (v: { tag: number; bytes: Uint8Array }) => {
    o.setUint16(at, v.tag, little);
    o.setUint16(at + 2, ASCII, little);
    o.setUint32(at + 4, v.bytes.length, little);
    if (v.bytes.length <= 4) {
      out.set(v.bytes, at + 8);
    } else {
      o.setUint32(at + 8, valueAt, little);
      out.set(v.bytes, valueAt);
      valueAt += v.bytes.length + (v.bytes.length & 1);
    }
    at += 12;
  };
  for (const src of kept) {
    const tag = view.getUint16(src, little);
    while (next < values.length && values[next].tag < tag) place(values[next++]);
    out.set(block.subarray(src, src + 12), at);
    at += 12;
  }
  while (next < values.length) place(values[next++]);
  o.setUint32(at, 0, little);
  return out;
}

/**
 * A COPY of `block` with the orientation reset, the dimensions corrected, the
 * thumbnail cut loose and the software named. A block it cannot make sense
 * of comes back unchanged rather than half-written.
 */
export function retagExifBlock(block: Uint8Array, options: RetagOptions = {}): Uint8Array<ArrayBuffer> {
  const out = block.slice();
  if (out.length < 8) return out;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const order = view.getUint16(0, false);
  if (order !== 0x4949 && order !== 0x4d4d) return out;
  const little = order === 0x4949;
  if (view.getUint16(2, little) !== 42) return out;
  const ifd0At = view.getUint32(4, little);
  if (ifd0At + 2 > out.length) return out;

  const ifd0 = parseIfd(view, 0, ifd0At, little);
  const orientation = ifd0.get(ORIENTATION);
  if (orientation) overwrite(view, orientation, 1, little);

  if (options.pixelWidth !== undefined && options.pixelHeight !== undefined) {
    const pointer = num(view, ifd0.get(EXIF_POINTER), little);
    if (pointer !== undefined && pointer + 2 <= out.length) {
      const exifIfd = parseIfd(view, 0, pointer, little);
      const w = exifIfd.get(PIXEL_WIDTH);
      const h = exifIfd.get(PIXEL_HEIGHT);
      if (w) overwrite(view, w, Math.round(options.pixelWidth), little);
      if (h) overwrite(view, h, Math.round(options.pixelHeight), little);
    }
  }

  // IFD1 is the thumbnail's directory: cutting the link is what drops it.
  const count = view.getUint16(ifd0At, little);
  const nextAt = ifd0At + 2 + count * 12;
  if (nextAt + 4 <= out.length) view.setUint32(nextAt, 0, little);

  // The text tags: overwritten where the camera's entry can hold the new
  // words, cleared to NULs where the author asked for none, and ADDED — one
  // copy of IFD0 for all of them — where there was no entry or too small a one.
  const adds: [number, string][] = [];
  const texts: [number, string | null | undefined][] = [
    [SOFTWARE, options.software],
    [ARTIST, options.artist],
    [COPYRIGHT, options.copyright],
    [IMAGE_DESCRIPTION, options.description],
  ];
  for (const [tag, text] of texts) {
    if (text === undefined) continue;
    const entry = ifd0.get(tag);
    if (text === null || text === '') {
      overwriteAscii(out, entry, '');
      continue;
    }
    if (!overwriteAscii(out, entry, text)) adds.push([tag, text]);
  }
  return adds.length > 0 ? withIfd0Ascii(out, little, adds) : out;
}

/** `http://ns.adobe.com/xap/1.0/\0` — the identifier an `APP1` opens with when it holds an XMP packet. */
const XMP_ID = Array.from('http://ns.adobe.com/xap/1.0/\0', (c) => c.charCodeAt(0));

/** The most an XMP packet can be in one `APP1`: the segment's `u16` less its length bytes and the identifier. */
export const XMP_PACKET_MAX = 0xffff - 2 - XMP_ID.length;

function holdsXmp(bytes: Uint8Array, segment: Segment): boolean {
  if (segment.marker !== APP1 || segment.body + XMP_ID.length > bytes.length) return false;
  return XMP_ID.every((b, i) => bytes[segment.body + i] === b);
}

/** The XMP packet of a JPEG's main `APP1`, as text, or null when it carries none. */
export function readXmpPacket(jpeg: Uint8Array): string | null {
  if (!isJpeg(jpeg)) return null;
  for (const segment of headerSegments(jpeg)) {
    if (holdsXmp(jpeg, segment)) return new TextDecoder().decode(jpeg.subarray(segment.body + XMP_ID.length, segment.end));
  }
  return null;
}

/**
 * The same JPEG carrying `packet` as its ONE XMP: a packet already there is
 * dropped, and the new one goes right after the EXIF `APP1` (else after a
 * leading JFIF `APP0`, else after the `SOI`) — the order cameras write and
 * readers expect. Throws on a packet larger than a segment holds.
 */
export function withXmpPacket(jpeg: Uint8Array, packet: string): Uint8Array<ArrayBuffer> {
  if (!isJpeg(jpeg)) throw new Error('not a JPEG');
  const body = new TextEncoder().encode(packet);
  if (body.length > XMP_PACKET_MAX) {
    throw new Error(`the XMP packet is ${body.length} bytes, over the ${XMP_PACKET_MAX} a segment holds`);
  }
  const segments = headerSegments(jpeg);
  const existing = segments.find((s) => holdsXmp(jpeg, s)) ?? null;
  const exif = segments.find((s) => holdsExif(jpeg, s)) ?? null;
  const insertAt = exif ? exif.end : segments[0]?.marker === APP0 ? segments[0].end : 2;

  const length = body.length + XMP_ID.length + 2;
  const segment = new Uint8Array(length + 2);
  segment[0] = 0xff;
  segment[1] = APP1;
  segment[2] = (length >> 8) & 0xff;
  segment[3] = length & 0xff;
  segment.set(XMP_ID, 4);
  segment.set(body, 4 + XMP_ID.length);

  // Cut the old packet out wherever it sat, then splice the new one in.
  const without = existing
    ? [jpeg.subarray(0, existing.start), jpeg.subarray(existing.end)]
    : [jpeg];
  const shift = existing && existing.start < insertAt ? existing.end - existing.start : 0;
  const flat = new Uint8Array(without.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const piece of without) {
    flat.set(piece, at);
    at += piece.length;
  }
  const cut = insertAt - shift;
  const out = new Uint8Array(flat.length + segment.length);
  out.set(flat.subarray(0, cut), 0);
  out.set(segment, cut);
  out.set(flat.subarray(cut), cut + segment.length);
  return out;
}
