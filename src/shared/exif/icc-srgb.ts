/**
 * The colour space a delivered JPEG is IN, said inside it: a compact ICC v4
 * sRGB profile, and the `APP2` segment that carries it (`docs/lightroom-gaps.md`
 * §4, item 25).
 *
 * Every export was untagged sRGB. Most browsers assume sRGB for an untagged
 * file, but a colour-managed app need not — Lightroom, Capture One, macOS's
 * Preview on a P3 screen, a print lab — and "untagged" is a guess the reader is
 * free to make otherwise. The pixels this suite writes ARE sRGB (the canvas is
 * sRGB, `media-pipeline.md`), so the tag changes no pixel and removes the
 * guess.
 *
 * Built here from its numbers rather than shipped as a blob, in the repo's
 * tradition (`exif-build.ts`, `ultra-hdr.ts`): ~480 bytes, the shape of the
 * well-known compact v4 sRGB profiles — the Bradford-adapted primaries, a D50
 * white, the `chad` a v4 profile requires, and ONE parametric curve (the sRGB
 * function, type 3) shared by the three channels. Checked against LittleCMS
 * (Pillow's ImageCms) as an identity to IEC 61966-2.1.
 *
 * Pure and DOM-free.
 */

/** `ICC_PROFILE\0` — the identifier an `APP2` opens with when it holds a profile. */
const ICC_ID = Array.from('ICC_PROFILE\0', (c) => c.charCodeAt(0));

function s15(v: number): number {
  return Math.round(v * 65536);
}

class Writer {
  bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
  }
  u16(v: number) {
    this.u8(v >>> 8);
    this.u8(v);
  }
  u32(v: number) {
    this.u16((v >>> 16) & 0xffff);
    this.u16(v & 0xffff);
  }
  s15f16(v: number) {
    this.u32(s15(v) >>> 0);
  }
  tag(sig: string) {
    for (const c of sig) this.u8(c.charCodeAt(0));
  }
  pad4() {
    while (this.bytes.length % 4) this.u8(0);
  }
}

function xyz(x: number, y: number, z: number): number[] {
  const w = new Writer();
  w.tag('XYZ ');
  w.u32(0);
  w.s15f16(x);
  w.s15f16(y);
  w.s15f16(z);
  return w.bytes;
}

/** A multi-localised string with one English record. */
function mluc(text: string): number[] {
  const w = new Writer();
  w.tag('mluc');
  w.u32(0);
  w.u32(1); // one record
  w.u32(12); // record size
  w.tag('en');
  w.tag('US');
  w.u32(text.length * 2);
  w.u32(28); // offset from the tag's start to the string
  for (const c of text) w.u16(c.charCodeAt(0));
  return w.bytes;
}

/** The sRGB transfer function as a parametric curve, type 3. */
function srgbCurve(): number[] {
  const w = new Writer();
  w.tag('para');
  w.u32(0);
  w.u16(3);
  w.u16(0);
  w.s15f16(2.4); // g
  w.s15f16(1 / 1.055); // a
  w.s15f16(0.055 / 1.055); // b
  w.s15f16(1 / 12.92); // c
  w.s15f16(0.04045); // d
  return w.bytes;
}

function sf32(values: readonly number[]): number[] {
  const w = new Writer();
  w.tag('sf32');
  w.u32(0);
  for (const v of values) w.s15f16(v);
  return w.bytes;
}

/**
 * The profile. Primaries are sRGB's D65 primaries adapted to D50 by Bradford,
 * as ICC requires of a display profile's colorants; `chad` is that same
 * adaptation, so a reader can undo it.
 */
export function srgbProfile(): Uint8Array<ArrayBuffer> {
  const curve = srgbCurve();
  const tags: [string, number[]][] = [
    ['desc', mluc('sRGB')],
    ['cprt', mluc('No copyright, use freely')],
    ['wtpt', xyz(0.9642, 1, 0.8249)],
    // Bradford D65 → D50, the matrix every compact v4 sRGB profile carries.
    ['chad', sf32([1.0479, 0.0229, -0.0502, 0.0296, 0.9904, -0.0171, -0.0092, 0.0151, 0.7519])],
    ['rXYZ', xyz(0.4361, 0.2225, 0.0139)],
    ['gXYZ', xyz(0.3851, 0.7169, 0.0971)],
    ['bXYZ', xyz(0.1431, 0.0606, 0.7141)],
    ['rTRC', curve],
    ['gTRC', curve],
    ['bTRC', curve],
  ];

  // Lay out the data: the three curves are one block, shared.
  const tableSize = 4 + tags.length * 12;
  let offset = 128 + tableSize;
  const placed: { sig: string; offset: number; size: number }[] = [];
  const data: number[] = [];
  let curveAt = -1;
  for (const [sig, body] of tags) {
    if (body === curve && curveAt >= 0) {
      placed.push({ sig, offset: curveAt, size: body.length });
      continue;
    }
    const at = offset + data.length;
    if (body === curve) curveAt = at;
    placed.push({ sig, offset: at, size: body.length });
    data.push(...body);
    while (data.length % 4) data.push(0);
  }
  const size = offset + data.length;

  const w = new Writer();
  // --- header, 128 bytes ---
  w.u32(size);
  w.u32(0); // preferred CMM: none
  w.u32(0x04300000); // version 4.3
  w.tag('mntr');
  w.tag('RGB ');
  w.tag('XYZ ');
  // Creation date: fixed, so the bytes are the same every time they are built.
  for (const v of [2026, 9, 23, 0, 0, 0]) w.u16(v);
  w.tag('acsp');
  w.u32(0); // platform
  w.u32(0); // flags
  w.u32(0); // manufacturer
  w.u32(0); // model
  w.u32(0); // attributes (8 bytes)
  w.u32(0);
  w.u32(0); // rendering intent: perceptual
  w.s15f16(0.9642); // PCS illuminant, D50
  w.s15f16(1);
  w.s15f16(0.8249);
  w.u32(0); // creator
  for (let i = 0; i < 16; i += 1) w.u8(0); // profile ID: optional, left zero
  while (w.bytes.length < 128) w.u8(0);
  // --- tag table ---
  w.u32(placed.length);
  for (const p of placed) {
    w.tag(p.sig);
    w.u32(p.offset);
    w.u32(p.size);
  }
  w.bytes.push(...data);
  offset = w.bytes.length;
  if (offset !== size) throw new Error(`ICC profile laid out as ${offset} bytes, declared ${size}`);
  return Uint8Array.from(w.bytes);
}

let cached: Uint8Array<ArrayBuffer> | null = null;

/** The one profile, built once. */
export function srgbIcc(): Uint8Array<ArrayBuffer> {
  if (!cached) cached = srgbProfile();
  return cached;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function holdsIcc(bytes: Uint8Array, at: number, end: number): boolean {
  if (bytes[at + 1] !== 0xe2 || at + 4 + ICC_ID.length > end) return false;
  return ICC_ID.every((b, i) => bytes[at + 4 + i] === b);
}

/**
 * The same JPEG carrying `profile` as its ONE ICC profile, in an `APP2` placed
 * after the leading `APP0`/`APP1` segments (JFIF, EXIF, XMP) — where readers
 * and the Ultra HDR container expect it. A profile already there is replaced.
 */
export function withIccProfile(jpeg: Uint8Array, profile: Uint8Array = srgbIcc()): Uint8Array<ArrayBuffer> {
  if (!isJpeg(jpeg)) throw new Error('not a JPEG');
  if (profile.length + ICC_ID.length + 4 > 0xffff) throw new Error('the profile does not fit one segment');
  const keep: [number, number][] = [];
  let insertAt = 2;
  let at = 2;
  let leading = true;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff) {
    const marker = jpeg[at + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (jpeg[at + 2] << 8) | jpeg[at + 3];
    const end = at + 2 + length;
    if (length < 2 || end > jpeg.length) break;
    if (holdsIcc(jpeg, at, end)) {
      keep.push([at, end]);
    } else if (leading && (marker === 0xe0 || marker === 0xe1)) {
      insertAt = end;
    } else {
      leading = false;
    }
    at = end;
  }
  const body = ICC_ID.length + 2 + profile.length;
  const segment = new Uint8Array(4 + body);
  segment[0] = 0xff;
  segment[1] = 0xe2;
  segment[2] = ((body + 2) >> 8) & 0xff;
  segment[3] = (body + 2) & 0xff;
  segment.set(ICC_ID, 4);
  segment[4 + ICC_ID.length] = 1; // sequence number
  segment[5 + ICC_ID.length] = 1; // of one
  segment.set(profile, 6 + ICC_ID.length);

  // The file without any old profile, the new one spliced at the insertion point.
  const pieces: Uint8Array[] = [];
  let cursor = 0;
  let placed = false;
  const cuts = [...keep].sort((a, b) => a[0] - b[0]);
  for (const [start, end] of cuts) {
    if (!placed && insertAt <= start) {
      pieces.push(jpeg.subarray(cursor, insertAt), segment);
      cursor = insertAt;
      placed = true;
    }
    pieces.push(jpeg.subarray(cursor, start));
    cursor = end;
  }
  if (!placed) {
    pieces.push(jpeg.subarray(cursor, Math.max(cursor, insertAt)), segment);
    cursor = Math.max(cursor, insertAt);
  }
  pieces.push(jpeg.subarray(cursor));
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of pieces) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The ICC profile inside a JPEG, or null — for a check that the file says what was written. */
export function readIccProfile(jpeg: Uint8Array): Uint8Array | null {
  if (!isJpeg(jpeg)) return null;
  let at = 2;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff) {
    const marker = jpeg[at + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (jpeg[at + 2] << 8) | jpeg[at + 3];
    const end = at + 2 + length;
    if (length < 2 || end > jpeg.length) break;
    if (holdsIcc(jpeg, at, end)) return jpeg.slice(at + 4 + ICC_ID.length + 2, end);
    at = end;
  }
  return null;
}
