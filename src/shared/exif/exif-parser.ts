/**
 * A small, dependency-free EXIF reader.
 *
 * Reads the standard tags a photographer cares about — camera, lens, exposure
 * and GPS — out of a JPEG (its EXIF block lives in the `APP1` marker) or a
 * TIFF-based file (DNG and most camera RAW begin with a TIFF header, so the
 * same IFD walk works directly on them). Anything else, or a malformed block,
 * yields an empty result rather than throwing — callers treat "no EXIF" and
 * "couldn't read it" the same way.
 *
 * It lives in `shared/` because it has two consumers: the Photo EXIF tool and
 * Road Trip, which reads `dateTimeOriginal` to know the day a picture was
 * actually taken. A tool never reaches into another tool — the second consumer
 * is what moves a brick down here (the same move `StylePanel` made).
 *
 * Pure and DOM-free: it works on an `ArrayBuffer` (the caller reads the first
 * slice of the file), so it runs unchanged in a worker, a Node test, or a
 * future native shell. Every offset is bounds-checked against the buffer, so a
 * truncated slice simply drops the fields that fall outside it.
 */

export interface GpsCoord {
  /** Decimal degrees, signed (south/west negative). */
  lat: number;
  lon: number;
}

export interface ExifData {
  make?: string;
  model?: string;
  lensMake?: string;
  lensModel?: string;
  software?: string;
  artist?: string;
  // Exposure
  iso?: number;
  /** Seconds, e.g. `0.005` for 1/200 s. */
  exposureTime?: number;
  fNumber?: number;
  /** Millimetres. */
  focalLength?: number;
  /** Millimetres, 35 mm-equivalent. */
  focalLength35?: number;
  /** Exposure compensation, in EV. */
  exposureBias?: number;
  exposureProgram?: number;
  meteringMode?: number;
  whiteBalance?: number;
  flash?: number;
  // Image
  pixelWidth?: number;
  pixelHeight?: number;
  orientation?: number;
  dateTimeOriginal?: string;
  // GPS
  gps?: GpsCoord;
  /** Metres above sea level (negative below). */
  gpsAltitude?: number;
  /**
   * Metres above the take-off point — a DRONE fact, written by DJI as the
   * XMP tag `drone-dji:RelativeAltitude`. This reader does not walk XMP, so
   * it arrives from a source that already parsed it (`MediaOrigin.exif`);
   * the field lives here because it belongs to the same struct, and a future
   * XMP reader would fill it from the file itself.
   */
  relativeAltitude?: number;
}

/**
 * How many leading bytes of a file to read for EXIF. A JPEG's `APP1` segment is
 * capped at ~64 KB and sits near the front; TIFF/RAW front-load their IFDs too.
 * 256 KB is a generous cushion that stays cheap to read per photo.
 */
export const EXIF_SLICE_BYTES = 256 * 1024;

// --- TIFF tag types & sizes -------------------------------------------------

const TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

interface Entry {
  type: number;
  count: number;
  /** Absolute offset (into the buffer) of the value bytes. */
  valueOffset: number;
}

function readNumberAt(
  view: DataView,
  offset: number,
  type: number,
  little: boolean,
): number {
  switch (type) {
    case 1:
    case 7:
      return view.getUint8(offset);
    case 6:
      return view.getInt8(offset);
    case 3:
      return view.getUint16(offset, little);
    case 8:
      return view.getInt16(offset, little);
    case 4:
      return view.getUint32(offset, little);
    case 9:
      return view.getInt32(offset, little);
    case 11:
      return view.getFloat32(offset, little);
    case 12:
      return view.getFloat64(offset, little);
    case 5: {
      const den = view.getUint32(offset + 4, little);
      return den === 0 ? 0 : view.getUint32(offset, little) / den;
    }
    case 10: {
      const den = view.getInt32(offset + 4, little);
      return den === 0 ? 0 : view.getInt32(offset, little) / den;
    }
    default:
      return NaN;
  }
}

/** Absolute offset of an entry's value bytes — inline if ≤4 bytes, else pointed. */
function valueOffsetOf(
  view: DataView,
  tiffStart: number,
  entryOffset: number,
  type: number,
  count: number,
  little: boolean,
): number {
  const byteLen = (TYPE_SIZE[type] ?? 0) * count;
  return byteLen > 4
    ? tiffStart + view.getUint32(entryOffset + 8, little)
    : entryOffset + 8;
}

/** Parse one IFD into a tag→entry map. Stops cleanly on any out-of-bounds read. */
function parseIfd(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  little: boolean,
): Map<number, Entry> {
  const map = new Map<number, Entry>();
  if (ifdOffset < 0 || ifdOffset + 2 > view.byteLength) return map;
  const count = view.getUint16(ifdOffset, little);
  for (let i = 0; i < count; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, little);
    const type = view.getUint16(entryOffset + 2, little);
    const cnt = view.getUint32(entryOffset + 4, little);
    if (!TYPE_SIZE[type]) continue;
    map.set(tag, {
      type,
      count: cnt,
      valueOffset: valueOffsetOf(view, tiffStart, entryOffset, type, cnt, little),
    });
  }
  return map;
}

/** First numeric value of an entry, or undefined if missing/out of bounds. */
function num(view: DataView, entry: Entry | undefined, little: boolean): number | undefined {
  if (!entry) return undefined;
  const size = TYPE_SIZE[entry.type] ?? 0;
  if (size === 0 || entry.valueOffset + size > view.byteLength) return undefined;
  const v = readNumberAt(view, entry.valueOffset, entry.type, little);
  return Number.isFinite(v) ? v : undefined;
}

/** All numeric values of an entry (e.g. the 3 rationals of a GPS coordinate). */
function nums(view: DataView, entry: Entry | undefined, little: boolean): number[] | undefined {
  if (!entry) return undefined;
  const size = TYPE_SIZE[entry.type] ?? 0;
  if (size === 0 || entry.valueOffset + size * entry.count > view.byteLength) {
    return undefined;
  }
  const out: number[] = [];
  for (let i = 0; i < entry.count; i++) {
    out.push(readNumberAt(view, entry.valueOffset + i * size, entry.type, little));
  }
  return out;
}

/** ASCII value of an entry, trimmed and NUL-terminated, or undefined. */
function str(view: DataView, entry: Entry | undefined): string | undefined {
  if (!entry || entry.type !== 2) return undefined;
  if (entry.valueOffset + entry.count > view.byteLength) return undefined;
  let s = '';
  for (let i = 0; i < entry.count; i++) {
    const c = view.getUint8(entry.valueOffset + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim() || undefined;
}

/** Degrees/minutes/seconds rationals + hemisphere ref → signed decimal degrees. */
function toDecimal(values: number[] | undefined, ref: string | undefined): number | undefined {
  if (!values || values.length < 3) return undefined;
  const [d, m, s] = values;
  let dec = d + m / 60 + s / 3600;
  if (!Number.isFinite(dec)) return undefined;
  if (ref === 'S' || ref === 'W') dec = -dec;
  return dec;
}

// --- Tag numbers ------------------------------------------------------------

const IFD0 = {
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  software: 0x0131,
  artist: 0x013b,
  exifPointer: 0x8769,
  gpsPointer: 0x8825,
};

const EXIF = {
  exposureTime: 0x829a,
  fNumber: 0x829d,
  exposureProgram: 0x8822,
  iso: 0x8827,
  dateTimeOriginal: 0x9003,
  exposureBias: 0x9204,
  meteringMode: 0x9207,
  flash: 0x9209,
  focalLength: 0x920a,
  pixelWidth: 0xa002,
  pixelHeight: 0xa003,
  whiteBalance: 0xa403,
  focalLength35: 0xa405,
  lensMake: 0xa433,
  lensModel: 0xa434,
};

const GPS = {
  latRef: 0x0001,
  lat: 0x0002,
  lonRef: 0x0003,
  lon: 0x0004,
  altRef: 0x0005,
  alt: 0x0006,
};

/** Locate the TIFF block inside a JPEG's `APP1` (Exif) segment, or -1. */
function findExifInJpeg(view: DataView): number {
  let offset = 2; // past SOI
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break; // not a marker — give up
    const marker = view.getUint8(offset + 1);
    // Start of scan / end of image: pixel data follows, no more metadata.
    if (marker === 0xda || marker === 0xd9) break;
    const segLen = view.getUint16(offset + 2, false);
    if (marker === 0xe1) {
      const p = offset + 4;
      // "Exif\0\0"
      if (
        p + 6 <= view.byteLength &&
        view.getUint32(p, false) === 0x45786966 &&
        view.getUint16(p + 4, false) === 0x0000
      ) {
        return p + 6;
      }
    }
    offset += 2 + segLen;
  }
  return -1;
}

/** Walk a TIFF block (IFD0 → Exif sub-IFD → GPS sub-IFD) into an ExifData. */
function readTiff(view: DataView, tiffStart: number): ExifData {
  if (tiffStart < 0 || tiffStart + 8 > view.byteLength) return {};
  const bom = view.getUint16(tiffStart, false);
  const little = bom === 0x4949;
  if (!little && bom !== 0x4d4d) return {};
  if (view.getUint16(tiffStart + 2, little) !== 0x002a) return {};

  const ifd0 = parseIfd(view, tiffStart, tiffStart + view.getUint32(tiffStart + 4, little), little);
  const out: ExifData = {
    make: str(view, ifd0.get(IFD0.make)),
    model: str(view, ifd0.get(IFD0.model)),
    orientation: num(view, ifd0.get(IFD0.orientation), little),
    software: str(view, ifd0.get(IFD0.software)),
    artist: str(view, ifd0.get(IFD0.artist)),
  };

  const exifPtr = num(view, ifd0.get(IFD0.exifPointer), little);
  if (exifPtr !== undefined) {
    const exif = parseIfd(view, tiffStart, tiffStart + exifPtr, little);
    out.exposureTime = num(view, exif.get(EXIF.exposureTime), little);
    out.fNumber = num(view, exif.get(EXIF.fNumber), little);
    out.iso = num(view, exif.get(EXIF.iso), little);
    out.exposureProgram = num(view, exif.get(EXIF.exposureProgram), little);
    out.dateTimeOriginal = str(view, exif.get(EXIF.dateTimeOriginal));
    out.exposureBias = num(view, exif.get(EXIF.exposureBias), little);
    out.meteringMode = num(view, exif.get(EXIF.meteringMode), little);
    out.flash = num(view, exif.get(EXIF.flash), little);
    out.focalLength = num(view, exif.get(EXIF.focalLength), little);
    out.focalLength35 = num(view, exif.get(EXIF.focalLength35), little);
    out.whiteBalance = num(view, exif.get(EXIF.whiteBalance), little);
    out.lensMake = str(view, exif.get(EXIF.lensMake));
    out.lensModel = str(view, exif.get(EXIF.lensModel));
    out.pixelWidth = num(view, exif.get(EXIF.pixelWidth), little);
    out.pixelHeight = num(view, exif.get(EXIF.pixelHeight), little);
  }

  const gpsPtr = num(view, ifd0.get(IFD0.gpsPointer), little);
  if (gpsPtr !== undefined) {
    const gps = parseIfd(view, tiffStart, tiffStart + gpsPtr, little);
    const lat = toDecimal(nums(view, gps.get(GPS.lat), little), str(view, gps.get(GPS.latRef)));
    const lon = toDecimal(nums(view, gps.get(GPS.lon), little), str(view, gps.get(GPS.lonRef)));
    if (lat !== undefined && lon !== undefined) out.gps = { lat, lon };
    const alt = num(view, gps.get(GPS.alt), little);
    if (alt !== undefined) {
      out.gpsAltitude = num(view, gps.get(GPS.altRef), little) === 1 ? -alt : alt;
    }
  }

  // Drop the keys that came back empty, for a tidy object.
  for (const key of Object.keys(out) as (keyof ExifData)[]) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

/** Parse EXIF from the leading bytes of a JPEG or TIFF/RAW file. */
export function parseExif(buffer: ArrayBuffer): ExifData {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 8) return {};
    const head = view.getUint16(0, false);
    if (head === 0xffd8) return readTiff(view, findExifInJpeg(view)); // JPEG
    if (head === 0x4949 || head === 0x4d4d) return readTiff(view, 0); // TIFF/RAW
    return {};
  } catch {
    return {};
  }
}

/** True when an ExifData carries no usable field. */
export function isEmptyExif(data: ExifData): boolean {
  return Object.keys(data).length === 0;
}
