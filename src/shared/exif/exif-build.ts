/**
 * Writing EXIF, the other half of `exif-parser.ts`.
 *
 * A picture developed here leaves as a canvas-encoded JPEG, and a canvas
 * encodes PIXELS: no GPS, no camera, no capture time, nothing. The maintainer
 * needs those back — his Gallery is where he looks a photograph up, and a
 * developed file with no position and no body is a worse record than the
 * original it came from. So an export carries the original's metadata, and
 * this module builds the block that holds it.
 *
 * It writes a TIFF block (the payload of a JPEG's `APP1`): little-endian,
 * IFD0 + an Exif IFD + a GPS IFD, no thumbnail. Everything `ExifData` can
 * hold is written, which is the REBUILD path — used where the original's own
 * block cannot be copied verbatim (a DNG, whose TIFF block is the whole file,
 * or a proxy whose only metadata is what its source vouched for). Where the
 * original IS a JPEG, `exif-block.ts` copies its block instead and keeps what
 * no struct models — the maker notes above all.
 *
 * Deliberately not written: `relativeAltitude`, DJI's height above take-off.
 * It is an XMP property, not an EXIF tag, and inventing an EXIF home for it
 * would put a number where no reader looks. An XMP packet is its own job.
 *
 * Pure and DOM-free.
 */

import type { ExifData } from './exif-parser';

// --- tag numbers, the writer's half of the parser's three maps --------------

const IFD0 = {
  imageDescription: 0x010e,
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  software: 0x0131,
  artist: 0x013b,
  copyright: 0x8298,
  exifPointer: 0x8769,
  gpsPointer: 0x8825,
};

const EXIF = {
  exposureTime: 0x829a,
  fNumber: 0x829d,
  exposureProgram: 0x8822,
  iso: 0x8827,
  exifVersion: 0x9000,
  dateTimeOriginal: 0x9003,
  dateTimeDigitized: 0x9004,
  exposureBias: 0x9204,
  meteringMode: 0x9207,
  flash: 0x9209,
  focalLength: 0x920a,
  colorSpace: 0xa001,
  pixelWidth: 0xa002,
  pixelHeight: 0xa003,
  whiteBalance: 0xa403,
  focalLength35: 0xa405,
  lensMake: 0xa433,
  lensModel: 0xa434,
};

const GPS = {
  versionId: 0x0000,
  latRef: 0x0001,
  lat: 0x0002,
  lonRef: 0x0003,
  lon: 0x0004,
  altRef: 0x0005,
  alt: 0x0006,
};

const BYTE = 1;
const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const UNDEFINED = 7;
const SRATIONAL = 10;

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 10: 8 };

/** One tag to write: its number, its type, and its values. */
interface Field {
  tag: number;
  type: number;
  /**
   * Numbers for every type but ASCII and UNDEFINED, which carry a string —
   * ASCII gains the NUL the format asks for (and is UTF-8, `stringBytes`), UNDEFINED does not (an
   * `ExifVersion` is four bytes and exactly four).
   *
   * A RATIONAL's numbers are FLAT numerator/denominator pairs, so a GPS
   * coordinate is six numbers and a count of three.
   */
  values: number[] | string;
}

/**
 * A decimal as the pair of integers EXIF stores.
 *
 * Continued fractions, so 0.005 comes back as 1/200 — the shutter a camera
 * wrote and a reader expects — rather than as 5/1000. Bounded by a
 * denominator no larger than asked for; an exact match ends it early.
 */
export function toRational(value: number, maxDenominator = 1_000_000): [number, number] {
  if (!Number.isFinite(value) || value === 0) return [0, 1];
  const sign = value < 0 ? -1 : 1;
  const target = Math.abs(value);
  if (Number.isInteger(target) && target <= 0xffffffff) return [sign * target, 1];
  let x = target;
  let [hPrev, h] = [1, Math.floor(x)];
  let [kPrev, k] = [0, 1];
  for (let i = 0; i < 32; i += 1) {
    const frac = x - Math.floor(x);
    if (frac < 1e-12) break;
    x = 1 / frac;
    const a = Math.floor(x);
    const hNext = a * h + hPrev;
    const kNext = a * k + kPrev;
    if (kNext > maxDenominator || !Number.isFinite(hNext) || hNext > 0xffffffff) break;
    [hPrev, h] = [h, hNext];
    [kPrev, k] = [k, kNext];
    if (Math.abs(h / k - target) < 1e-12) break;
  }
  return [sign * h, k];
}

/**
 * Degrees as the three rationals EXIF stores, flat — the seconds keep the
 * precision, at a ten-thousandth of a second of arc (about 3 µm).
 */
export function toDegreesMinutesSeconds(degrees: number): number[] {
  const abs = Math.abs(degrees);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = (abs - d - m / 60) * 3600;
  return [d, 1, m, 1, Math.round(s * 10_000), 10_000];
}

function ascii(tag: number, value: string | undefined): Field | null {
  const text = value?.trim();
  return text ? { tag, type: ASCII, values: text } : null;
}

function short(tag: number, value: number | undefined): Field | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  const v = Math.round(value);
  return v >= 0 && v <= 0xffff ? { tag, type: SHORT, values: [v] } : null;
}

function long(tag: number, value: number | undefined): Field | null {
  if (value === undefined || !Number.isFinite(value) || value < 0) return null;
  return { tag, type: LONG, values: [Math.round(value)] };
}

function rational(tag: number, value: number | undefined): Field | null {
  if (value === undefined || !Number.isFinite(value) || value < 0) return null;
  return { tag, type: RATIONAL, values: toRational(value) };
}

function srational(tag: number, value: number | undefined): Field | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return { tag, type: SRATIONAL, values: toRational(value) };
}

const utf8 = new TextEncoder();

/**
 * A string field's bytes. An ASCII tag is written as UTF-8 plus its NUL:
 * the format says seven bits, but a copyright line opens with `©` and a
 * caption is written in whatever language its author speaks, and UTF-8 is
 * what Lightroom, Capture One and exiftool write and read there — the XMP
 * copy (`delivery-meta.ts`) is the Unicode record either way. UNDEFINED is
 * byte for byte (an `ExifVersion` is four bytes and exactly four).
 */
function stringBytes(field: Field & { values: string }): Uint8Array {
  if (field.type === UNDEFINED) return Uint8Array.from(field.values, (c) => c.charCodeAt(0) & 0xff);
  const text = utf8.encode(field.values);
  const out = new Uint8Array(text.length + 1);
  out.set(text);
  return out;
}

/** How many VALUES a field holds, in the sense the entry's count means. */
function fieldCount(field: Field): number {
  if (typeof field.values === 'string') return stringBytes(field as Field & { values: string }).length;
  if (field.type === RATIONAL || field.type === SRATIONAL) return field.values.length / 2;
  return field.values.length;
}

function fieldBytes(field: Field): number {
  return (TYPE_SIZE[field.type] ?? 1) * fieldCount(field);
}

/** An IFD's own size on the wire: its count, its entries, and the next-IFD pointer. */
function ifdSize(entries: number): number {
  return 2 + entries * 12 + 4;
}

/** One field's value bytes, little-endian, pushed one at a time. */
function writeValue(field: Field, push: (byte: number) => void): void {
  if (typeof field.values === 'string') {
    for (const b of stringBytes(field as Field & { values: string })) push(b);
    return;
  }
  // A rational's two halves are 4-byte words, so every number here fits one.
  const width = field.type === RATIONAL || field.type === SRATIONAL ? 4 : (TYPE_SIZE[field.type] ?? 1);
  for (const value of field.values) {
    const v = field.type === SRATIONAL ? value | 0 : value >>> 0;
    for (let b = 0; b < width; b += 1) push((v >> (8 * b)) & 0xff);
  }
}

/**
 * Write one IFD at `at`, its long values appended to `data` (which will land
 * at `dataStart`). Entries are sorted by tag, as the format asks.
 */
function writeIfd(
  view: DataView,
  bytes: Uint8Array,
  at: number,
  fields: readonly Field[],
  dataStart: number,
  data: number[],
): void {
  const sorted = [...fields].sort((a, b) => a.tag - b.tag);
  view.setUint16(at, sorted.length, true);
  sorted.forEach((field, i) => {
    const entry = at + 2 + i * 12;
    view.setUint16(entry, field.tag, true);
    view.setUint16(entry + 2, field.type, true);
    view.setUint32(entry + 4, fieldCount(field), true);
    if (fieldBytes(field) > 4) {
      view.setUint32(entry + 8, dataStart + data.length, true);
      writeValue(field, (b) => data.push(b));
      // A value area starts on an even offset, as TIFF asks.
      if (data.length % 2 === 1) data.push(0);
    } else {
      let k = 0;
      writeValue(field, (b) => {
        bytes[entry + 8 + k] = b;
        k += 1;
      });
    }
  });
  view.setUint32(at + 2 + sorted.length * 12, 0, true);
}

export interface BuildExifOptions {
  /** What wrote the file — `Software`, a courtesy to whoever reads it later. */
  software?: string;
  /**
   * The author's own words, written OVER what the capture carried: `Artist`,
   * `Copyright` and `ImageDescription` (`delivery-meta.ts`). Null clears the
   * capture's value; undefined keeps it.
   */
  artist?: string | null;
  copyright?: string | null;
  description?: string | null;
  /** The delivered picture's own size, which is never the original's. */
  pixelWidth?: number;
  pixelHeight?: number;
}

/**
 * An EXIF block (a TIFF stream) holding everything `exif` says.
 *
 * Orientation is always written as 1: a developed picture is delivered the
 * way up it was looked at, so carrying the original's orientation over would
 * turn it a second time. The pixel dimensions are the DELIVERED ones, for the
 * same reason. No thumbnail is written — a stale one is worse than none.
 *
 * The one picture that needs the opposite is a RAW's embedded render, which
 * nobody has turned yet: `buildOrientationBlock` below, and never a relaxation
 * of the rule here.
 */
export function buildExifBlock(exif: ExifData, options: BuildExifOptions = {}): Uint8Array<ArrayBuffer> {
  const ifd0: Field[] = [
    ascii(IFD0.make, exif.make),
    ascii(IFD0.model, exif.model),
    ascii(IFD0.artist, options.artist === undefined ? exif.artist : (options.artist ?? undefined)),
    ascii(IFD0.copyright, options.copyright === undefined ? exif.copyright : (options.copyright ?? undefined)),
    ascii(IFD0.imageDescription, options.description === undefined ? exif.imageDescription : (options.description ?? undefined)),
    ascii(IFD0.software, options.software ?? exif.software),
    { tag: IFD0.orientation, type: SHORT, values: [1] },
  ].filter((f): f is Field => f !== null);

  const exifIfd: Field[] = [
    { tag: EXIF.exifVersion, type: UNDEFINED, values: '0232' },
    { tag: EXIF.colorSpace, type: SHORT, values: [1] },
    rational(EXIF.exposureTime, exif.exposureTime),
    rational(EXIF.fNumber, exif.fNumber),
    short(EXIF.exposureProgram, exif.exposureProgram),
    short(EXIF.iso, exif.iso),
    ascii(EXIF.dateTimeOriginal, exif.dateTimeOriginal),
    ascii(EXIF.dateTimeDigitized, exif.dateTimeOriginal),
    srational(EXIF.exposureBias, exif.exposureBias),
    short(EXIF.meteringMode, exif.meteringMode),
    short(EXIF.flash, exif.flash),
    rational(EXIF.focalLength, exif.focalLength),
    short(EXIF.whiteBalance, exif.whiteBalance),
    short(EXIF.focalLength35, exif.focalLength35),
    ascii(EXIF.lensMake, exif.lensMake),
    ascii(EXIF.lensModel, exif.lensModel),
    long(EXIF.pixelWidth, options.pixelWidth ?? exif.pixelWidth),
    long(EXIF.pixelHeight, options.pixelHeight ?? exif.pixelHeight),
  ].filter((f): f is Field => f !== null);

  const gpsIfd: Field[] = [];
  if (exif.gps && Number.isFinite(exif.gps.lat) && Number.isFinite(exif.gps.lon)) {
    gpsIfd.push(
      { tag: GPS.versionId, type: BYTE, values: [2, 3, 0, 0] },
      { tag: GPS.latRef, type: ASCII, values: exif.gps.lat < 0 ? 'S' : 'N' },
      { tag: GPS.lat, type: RATIONAL, values: toDegreesMinutesSeconds(exif.gps.lat) },
      { tag: GPS.lonRef, type: ASCII, values: exif.gps.lon < 0 ? 'W' : 'E' },
      { tag: GPS.lon, type: RATIONAL, values: toDegreesMinutesSeconds(exif.gps.lon) },
    );
  }
  if (exif.gpsAltitude !== undefined && Number.isFinite(exif.gpsAltitude)) {
    gpsIfd.push(
      { tag: GPS.altRef, type: BYTE, values: [exif.gpsAltitude < 0 ? 1 : 0] },
      { tag: GPS.alt, type: RATIONAL, values: toRational(Math.abs(exif.gpsAltitude)) },
    );
  }

  // Every IFD's length is known before anything is written — a field's size
  // does not depend on where it lands — so the pointers can be filled in now.
  const hasGps = gpsIfd.length > 0;
  const ifd0Offset = 8;
  const exifOffset = ifd0Offset + ifdSize(ifd0.length + 1 + (hasGps ? 1 : 0));
  const gpsOffset = exifOffset + ifdSize(exifIfd.length);
  ifd0.push({ tag: IFD0.exifPointer, type: LONG, values: [exifOffset] });
  if (hasGps) ifd0.push({ tag: IFD0.gpsPointer, type: LONG, values: [gpsOffset] });
  const dataStart = gpsOffset + (hasGps ? ifdSize(gpsIfd.length) : 0);

  // Each long value is padded to an even length, so the slack is one byte per
  // field; the block is cut to what was really written.
  const slack = [...ifd0, ...exifIfd, ...gpsIfd].reduce(
    (sum, f) => sum + (fieldBytes(f) > 4 ? fieldBytes(f) + 1 : 0),
    0,
  );
  const bytes = new Uint8Array(dataStart + slack);
  const view = new DataView(bytes.buffer);
  // `II`, 42, then IFD0's offset: the header every TIFF stream opens with.
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifd0Offset, true);

  const data: number[] = [];
  writeIfd(view, bytes, ifd0Offset, ifd0, dataStart, data);
  writeIfd(view, bytes, exifOffset, exifIfd, dataStart, data);
  if (hasGps) writeIfd(view, bytes, gpsOffset, gpsIfd, dataStart, data);
  bytes.set(data, dataStart);
  return bytes.slice(0, dataStart + data.length);
}

/**
 * A block holding ONE tag: the orientation, and nothing else.
 *
 * Twenty-six bytes — `II`, 42, IFD0 at 8, one SHORT entry whose value is
 * inline, no next IFD — meant to be spliced into a JPEG by `withExifBlock`, so
 * that a decoder asked for `imageOrientation: 'from-image'` finally has
 * something to read.
 *
 * **Why this exists beside `buildExifBlock`, which writes 1 and only 1.** The
 * two builders answer opposite questions, and both answers are right. An
 * EXPORT is delivered the way up it was looked at, so its block says 1 or a
 * viewer would turn it a second time. A RAW's embedded render, sliced out of
 * the middle of its TIFF (`raw-probe.ts`), was never turned by anyone: the
 * camera's orientation sits in the container's IFD0, outside the slice, so the
 * bytes handed to the decoder have to be told (`media-pipeline.md`).
 */
export function buildOrientationBlock(orientation: number): Uint8Array<ArrayBuffer> {
  const field: Field = { tag: IFD0.orientation, type: SHORT, values: [Math.round(orientation)] };
  const ifd0Offset = 8;
  const bytes = new Uint8Array(ifd0Offset + ifdSize(1));
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifd0Offset, true);
  // A SHORT's two bytes fit an entry's own slot, so nothing is appended and
  // the data area stays empty — `dataStart` is past the end and never read.
  writeIfd(view, bytes, ifd0Offset, [field], bytes.length, []);
  return bytes;
}
