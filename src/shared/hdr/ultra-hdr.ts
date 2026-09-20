/**
 * ULTRA HDR JPEG — the container: an ordinary JPEG (the SDR base every
 * decoder shows) carrying a second, small JPEG (the gain map, `gain-map.ts`)
 * after its own EOI, joined by two pieces of metadata a viewer reads:
 *
 * - an XMP packet in the base's APP1 — a GContainer `Directory` naming the
 *   two items (Primary, GainMap with its byte `Length`) and `hdrgm:Version`;
 * - an MPF (CIPA DC-007, "Multi-Picture Format") APP2 segment in the base,
 *   a tiny TIFF whose MP entries give each image's size and its offset from
 *   the MP header — how a viewer finds the second image without walking the
 *   first's entropy data;
 * - an XMP packet in the gain map's own APP1 with the `hdrgm:` numbers
 *   (`GainMapMin/Max`, `Gamma`, the offsets, the capacities).
 *
 * Written by hand, in the repo's own tradition (`exif-parser.ts`, `qr.ts`,
 * the `colr` guard): a few hundred lines of segment writing against a new
 * wasm dependency. And READ back by the same module — `readUltraHdr` is what
 * lets the export claim "Ultra HDR" only after the file it wrote says so.
 *
 * Pure and DOM-free: bytes in, bytes out.
 */

import type { GainMapMeta } from './gain-map';

const SOI = 0xffd8;
const MARKER_APP0 = 0xe0;
const MARKER_APP1 = 0xe1;
const MARKER_APP2 = 0xe2;
const MARKER_SOS = 0xda;
const MARKER_EOI = 0xd9;

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
const MPF_HEADER = 'MPF\0';
const HDRGM_NS = 'http://ns.adobe.com/hdr-gain-map/1.0/';
const CONTAINER_NS = 'http://ns.google.com/photos/1.0/container/';
const ITEM_NS = 'http://ns.google.com/photos/1.0/container/item/';

/** One marker segment of a JPEG before its scan: where it starts, its marker, its payload. */
export interface JpegSegment {
  marker: number;
  /** The byte offset of the 0xFF. */
  start: number;
  /** Marker + length + payload. */
  length: number;
  /** The payload (after the two length bytes). */
  data: Uint8Array;
}

/** The segments up to (not including) SOS, or null when the bytes are not a JPEG. */
export function jpegSegments(bytes: Uint8Array): JpegSegment[] | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const out: JpegSegment[] = [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === MARKER_SOS || marker === MARKER_EOI) break;
    // A stand-alone marker (RSTn, TEM) has no length; none precedes the scan
    // in a file a browser writes, but a walk must not misread one.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const len = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (len < 2 || offset + 2 + len > bytes.length) return null;
    out.push({ marker, start: offset, length: 2 + len, data: bytes.subarray(offset + 4, offset + 2 + len) });
    offset += 2 + len;
  }
  return out;
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function startsWith(bytes: Uint8Array, head: string): boolean {
  if (bytes.length < head.length) return false;
  for (let i = 0; i < head.length; i += 1) if (bytes[i] !== head.charCodeAt(i)) return false;
  return true;
}

/** A marker segment: FF marker, big-endian length (payload + 2), payload. */
export function makeSegment(marker: number, payload: Uint8Array): Uint8Array {
  const len = payload.length + 2;
  if (len > 0xffff) throw new Error('A JPEG segment holds at most 65533 bytes.');
  const out = new Uint8Array(2 + len);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = len >> 8;
  out[3] = len & 0xff;
  out.set(payload, 4);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A number as XMP writes it: plain, no exponent, no trailing zeros. */
function num(v: number): string {
  return Number(v.toFixed(6)).toString();
}

function xmpPacket(description: string): string {
  return (
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Atelier">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    description +
    `</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
  );
}

/** The base image's XMP: the container directory and the version. */
export function primaryXmp(gainMapLength: number): string {
  return xmpPacket(
    `<rdf:Description rdf:about="" xmlns:Container="${CONTAINER_NS}" xmlns:Item="${ITEM_NS}" xmlns:hdrgm="${HDRGM_NS}" hdrgm:Version="1.0">` +
      `<Container:Directory><rdf:Seq>` +
      `<rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="Primary" Item:Mime="image/jpeg"/></rdf:li>` +
      `<rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="GainMap" Item:Mime="image/jpeg" Item:Length="${gainMapLength}"/></rdf:li>` +
      `</rdf:Seq></Container:Directory>` +
      `</rdf:Description>`,
  );
}

/** The gain map's XMP: the numbers a viewer applies it with. */
export function gainMapXmp(meta: GainMapMeta): string {
  return xmpPacket(
    `<rdf:Description rdf:about="" xmlns:hdrgm="${HDRGM_NS}" hdrgm:Version="1.0"` +
      ` hdrgm:GainMapMin="${num(meta.gainMapMin)}" hdrgm:GainMapMax="${num(meta.gainMapMax)}"` +
      ` hdrgm:Gamma="${num(meta.gamma)}" hdrgm:OffsetSDR="${num(meta.offsetSdr)}" hdrgm:OffsetHDR="${num(meta.offsetHdr)}"` +
      ` hdrgm:HDRCapacityMin="${num(meta.hdrCapacityMin)}" hdrgm:HDRCapacityMax="${num(meta.hdrCapacityMax)}"` +
      ` hdrgm:BaseRenditionIsHDR="False"/>`,
  );
}

function xmpSegment(packet: string): Uint8Array {
  return makeSegment(MARKER_APP1, concat([ascii(XMP_HEADER), utf8(packet)]));
}

/** Where the MP entries' offsets are counted from: the endian field, past "MPF\0". */
const MP_HEADER_IN_SEGMENT = 2 + 2 + MPF_HEADER.length;
/** The MPF payload: "MPF\0" + TIFF header (8) + IFD (2 + 3×12 + 4) + two 16-byte entries. */
const MPF_PAYLOAD_LENGTH = MPF_HEADER.length + 8 + 2 + 3 * 12 + 4 + 2 * 16;
export const MPF_SEGMENT_LENGTH = 4 + MPF_PAYLOAD_LENGTH;

/**
 * The MPF APP2 segment for a base image and one secondary: big-endian, three
 * IFD entries (version, count, the entry table), the two entries. `offset` is
 * the secondary's distance from the MP header's endian field; the primary's
 * is 0 by definition.
 */
export function mpfSegment(primarySize: number, secondarySize: number, secondaryOffset: number): Uint8Array {
  const payload = new Uint8Array(MPF_PAYLOAD_LENGTH);
  const view = new DataView(payload.buffer);
  payload.set(ascii(MPF_HEADER), 0);
  let at = MPF_HEADER.length;
  // TIFF header: "MM", 42, first IFD at 8.
  payload.set(ascii('MM'), at);
  view.setUint16(at + 2, 0x002a);
  view.setUint32(at + 4, 8);
  at += 8;
  view.setUint16(at, 3);
  at += 2;
  // MPFVersion, UNDEFINED ×4, "0100".
  view.setUint16(at, 0xb000);
  view.setUint16(at + 2, 7);
  view.setUint32(at + 4, 4);
  payload.set(ascii('0100'), at + 8);
  at += 12;
  // NumberOfImages, LONG ×1.
  view.setUint16(at, 0xb001);
  view.setUint16(at + 2, 4);
  view.setUint32(at + 4, 1);
  view.setUint32(at + 8, 2);
  at += 12;
  // MPEntry, UNDEFINED ×32, at the offset right after this IFD.
  const entriesAt = 8 + 2 + 3 * 12 + 4;
  view.setUint16(at, 0xb002);
  view.setUint16(at + 2, 7);
  view.setUint32(at + 4, 32);
  view.setUint32(at + 8, entriesAt);
  at += 12;
  view.setUint32(at, 0); // no next IFD
  at += 4;
  // Entry 1: the primary — "Baseline MP Primary Image", JPEG.
  view.setUint32(at, 0x030000);
  view.setUint32(at + 4, primarySize);
  view.setUint32(at + 8, 0);
  view.setUint16(at + 12, 0);
  view.setUint16(at + 14, 0);
  at += 16;
  // Entry 2: the gain map — an undefined type, JPEG.
  view.setUint32(at, 0x000000);
  view.setUint32(at + 4, secondarySize);
  view.setUint32(at + 8, secondaryOffset);
  view.setUint16(at + 12, 0);
  view.setUint16(at + 14, 0);
  return makeSegment(MARKER_APP2, payload);
}

/** Where new APP segments go: after SOI and the leading APP0/APP1 a browser or a camera wrote. */
function insertionPoint(bytes: Uint8Array): number {
  const segments = jpegSegments(bytes);
  if (!segments) throw new Error('Not a JPEG.');
  let at = 2;
  for (const s of segments) {
    if (s.marker !== MARKER_APP0 && s.marker !== MARKER_APP1) break;
    at = s.start + s.length;
  }
  return at;
}

/**
 * The file: the base with its XMP and MPF inserted, then the gain map with
 * its own XMP, back to back. A base that already carries an XMP packet keeps
 * it — a second APP1 is legal and viewers read the one with the directory.
 */
export function wrapUltraHdr(primary: Uint8Array, gainMap: Uint8Array, meta: GainMapMeta): Uint8Array {
  const mapAt = insertionPoint(gainMap);
  const mapOut = concat([gainMap.subarray(0, mapAt), xmpSegment(gainMapXmp(meta)), gainMap.subarray(mapAt)]);
  const at = insertionPoint(primary);
  const xmp = xmpSegment(primaryXmp(mapOut.length));
  // The MPF offset is counted from its own endian field, so the base's final
  // length is known before the segment is written.
  const primaryLength = primary.length + xmp.length + MPF_SEGMENT_LENGTH;
  const mpHeaderAt = at + xmp.length + MP_HEADER_IN_SEGMENT;
  const mpf = mpfSegment(primaryLength, mapOut.length, primaryLength - mpHeaderAt);
  return concat([primary.subarray(0, at), xmp, mpf, primary.subarray(at), mapOut]);
}

export interface UltraHdrParts {
  /** The base image alone — what every decoder shows. */
  primary: Uint8Array;
  gainMap: Uint8Array;
  meta: GainMapMeta;
  /** How the gain map was found: by the MPF entry, or by the directory's Length from the end. */
  foundBy: 'mpf' | 'length';
}

function attr(xmp: string, name: string): number | null {
  const m = new RegExp(`hdrgm:${name}="([^"]*)"`).exec(xmp);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** The `hdrgm:` numbers out of an XMP packet, or null when one is missing. */
export function parseGainMapMeta(xmp: string): GainMapMeta | null {
  const gainMapMin = attr(xmp, 'GainMapMin');
  const gainMapMax = attr(xmp, 'GainMapMax');
  if (gainMapMax === null) return null;
  return {
    gainMapMin: gainMapMin ?? 0,
    gainMapMax,
    gamma: attr(xmp, 'Gamma') ?? 1,
    offsetSdr: attr(xmp, 'OffsetSDR') ?? 1 / 64,
    offsetHdr: attr(xmp, 'OffsetHDR') ?? 1 / 64,
    hdrCapacityMin: attr(xmp, 'HDRCapacityMin') ?? 0,
    hdrCapacityMax: attr(xmp, 'HDRCapacityMax') ?? gainMapMax,
  };
}

function xmpOf(segments: readonly JpegSegment[]): string[] {
  return segments
    .filter((s) => s.marker === MARKER_APP1 && startsWith(s.data, XMP_HEADER))
    .map((s) => text(s.data.subarray(XMP_HEADER.length)));
}

/** The second image's size and offset (from the MP header) out of an MPF segment, or null. */
export function parseMpf(payload: Uint8Array): { size: number; offset: number; headerAt: number } | null {
  if (!startsWith(payload, MPF_HEADER)) return null;
  const headerAt = MPF_HEADER.length;
  const view = new DataView(payload.buffer, payload.byteOffset + headerAt, payload.byteLength - headerAt);
  if (view.byteLength < 8) return null;
  const little = view.getUint16(0) === 0x4949;
  if (!little && view.getUint16(0) !== 0x4d4d) return null;
  const ifd = view.getUint32(4, little);
  if (ifd + 2 > view.byteLength) return null;
  const count = view.getUint16(ifd, little);
  let entriesAt = -1;
  let images = 0;
  for (let i = 0; i < count; i += 1) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > view.byteLength) return null;
    const tag = view.getUint16(e, little);
    if (tag === 0xb001) images = view.getUint32(e + 8, little);
    if (tag === 0xb002) entriesAt = view.getUint32(e + 8, little);
  }
  if (entriesAt < 0 || images < 2) return null;
  for (let i = 0; i < images; i += 1) {
    const e = entriesAt + i * 16;
    if (e + 16 > view.byteLength) return null;
    const offset = view.getUint32(e + 8, little);
    if (offset === 0) continue; // the primary
    return { size: view.getUint32(e + 4, little), offset, headerAt };
  }
  return null;
}

/**
 * Read an Ultra HDR JPEG back: the base, the gain map and its numbers — or
 * null for a plain JPEG. The gain map is found by the MPF entry, else by the
 * directory's `Length` counted from the end of the file (how the container
 * spec says to fall back), and its own XMP must carry the numbers.
 */
export function readUltraHdr(bytes: Uint8Array): UltraHdrParts | null {
  const segments = jpegSegments(bytes);
  if (!segments) return null;
  const xmps = xmpOf(segments);
  const directory = xmps.find((x) => x.includes(CONTAINER_NS) && x.includes('GainMap'));
  if (!directory) return null;
  let gainMap: Uint8Array | null = null;
  let foundBy: UltraHdrParts['foundBy'] = 'mpf';
  const mpfSeg = segments.find((s) => s.marker === MARKER_APP2 && startsWith(s.data, MPF_HEADER));
  const mpf = mpfSeg ? parseMpf(mpfSeg.data) : null;
  if (mpf) {
    const headerPos = mpfSeg!.start + 4 + mpf.headerAt;
    const from = headerPos + mpf.offset;
    if (from >= 0 && from + mpf.size <= bytes.length && bytes[from] === 0xff && bytes[from + 1] === 0xd8) {
      gainMap = bytes.subarray(from, from + mpf.size);
    }
  }
  if (!gainMap) {
    const m = /Item:Semantic="GainMap"[^>]*Item:Length="(\d+)"/.exec(directory);
    const length = m ? Number(m[1]) : 0;
    if (length > 0 && length < bytes.length) {
      const from = bytes.length - length;
      if (bytes[from] === 0xff && bytes[from + 1] === 0xd8) {
        gainMap = bytes.subarray(from);
        foundBy = 'length';
      }
    }
  }
  if (!gainMap) return null;
  const mapSegments = jpegSegments(gainMap);
  if (!mapSegments) return null;
  const metaXmp = xmpOf(mapSegments).find((x) => x.includes(HDRGM_NS));
  const meta = metaXmp ? parseGainMapMeta(metaXmp) : null;
  if (!meta) return null;
  const primaryEnd = bytes.length - gainMap.length;
  return { primary: bytes.subarray(0, primaryEnd), gainMap, meta, foundBy };
}

/** Whether these bytes start like a JPEG at all. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && ((bytes[0] << 8) | bytes[1]) === SOI;
}
