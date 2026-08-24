import { describe, expect, it } from 'vitest';
import { isEmptyExif, parseExif } from './exif-parser';

/**
 * A tiny little-endian TIFF encoder, used to drive the parser with known input.
 * It lays out IFD0 → (Exif sub-IFD) → (GPS sub-IFD) → a heap for values that
 * don't fit inline, wiring the sub-IFD pointer tags automatically. Doubling as
 * documentation of the on-disk shape the parser walks.
 */
type EntryInput =
  | { tag: number; type: 2; ascii: string }
  | { tag: number; type: 3; values: number[] }
  | { tag: number; type: 4; values: number[] }
  | { tag: number; type: 5; rationals: Array<[number, number]> }
  | { tag: number; type: 10; rationals: Array<[number, number]> };

function encodeValue(entry: EntryInput): { count: number; bytes: Uint8Array } {
  if (entry.type === 2) {
    const bytes = new Uint8Array(entry.ascii.length + 1);
    for (let i = 0; i < entry.ascii.length; i++) bytes[i] = entry.ascii.charCodeAt(i);
    return { count: bytes.length, bytes };
  }
  if (entry.type === 3 || entry.type === 4) {
    const size = entry.type === 3 ? 2 : 4;
    const bytes = new Uint8Array(size * entry.values.length);
    const dv = new DataView(bytes.buffer);
    entry.values.forEach((v, i) =>
      size === 2 ? dv.setUint16(i * 2, v, true) : dv.setUint32(i * 4, v, true),
    );
    return { count: entry.values.length, bytes };
  }
  const bytes = new Uint8Array(8 * entry.rationals.length);
  const dv = new DataView(bytes.buffer);
  entry.rationals.forEach(([n, d], i) => {
    if (entry.type === 10) {
      dv.setInt32(i * 8, n, true);
      dv.setInt32(i * 8 + 4, d, true);
    } else {
      dv.setUint32(i * 8, n, true);
      dv.setUint32(i * 8 + 4, d, true);
    }
  });
  return { count: entry.rationals.length, bytes };
}

interface Placed {
  tag: number;
  type: number;
  count: number;
  inline?: Uint8Array;
  offset?: number;
}

function buildTiff(
  ifd0In: EntryInput[],
  exifIn: EntryInput[] = [],
  gpsIn: EntryInput[] = [],
): ArrayBuffer {
  const ifdBytes = (n: number) => (n ? 2 + 12 * n + 4 : 0);
  const nPtr = (exifIn.length ? 1 : 0) + (gpsIn.length ? 1 : 0);
  const ifd0Off = 8;
  const exifOff = ifd0Off + ifdBytes(ifd0In.length + nPtr);
  const gpsOff = exifOff + ifdBytes(exifIn.length);
  const heapStart = gpsOff + ifdBytes(gpsIn.length);

  const ifd0: EntryInput[] = [...ifd0In];
  if (exifIn.length) ifd0.push({ tag: 0x8769, type: 4, values: [exifOff] });
  if (gpsIn.length) ifd0.push({ tag: 0x8825, type: 4, values: [gpsOff] });

  let heapCursor = heapStart;
  const heapChunks: Array<{ at: number; bytes: Uint8Array }> = [];
  const place = (entries: EntryInput[]): Placed[] =>
    entries.map((e) => {
      const { count, bytes } = encodeValue(e);
      if (bytes.length <= 4) {
        const inline = new Uint8Array(4);
        inline.set(bytes);
        return { tag: e.tag, type: e.type, count, inline };
      }
      if (heapCursor % 2 === 1) heapCursor++;
      const at = heapCursor;
      heapChunks.push({ at, bytes });
      heapCursor += bytes.length;
      return { tag: e.tag, type: e.type, count, offset: at };
    });

  const ifd0Placed = place(ifd0);
  const exifPlaced = place(exifIn);
  const gpsPlaced = place(gpsIn);

  const buf = new ArrayBuffer(heapCursor);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  u8[0] = 0x49; // 'I'
  u8[1] = 0x49; // 'I' → little-endian
  view.setUint16(2, 0x002a, true);
  view.setUint32(4, ifd0Off, true);

  const writeIfd = (offset: number, placed: Placed[]) => {
    if (!placed.length) return;
    view.setUint16(offset, placed.length, true);
    placed.forEach((p, i) => {
      const eo = offset + 2 + i * 12;
      view.setUint16(eo, p.tag, true);
      view.setUint16(eo + 2, p.type, true);
      view.setUint32(eo + 4, p.count, true);
      if (p.inline) u8.set(p.inline, eo + 8);
      else view.setUint32(eo + 8, p.offset ?? 0, true);
    });
    view.setUint32(offset + 2 + placed.length * 12, 0, true);
  };
  writeIfd(ifd0Off, ifd0Placed);
  writeIfd(exifOff, exifPlaced);
  writeIfd(gpsOff, gpsPlaced);
  for (const c of heapChunks) u8.set(c.bytes, c.at);
  return buf;
}

/** Wrap a TIFF block in a minimal JPEG `APP1` (Exif) segment. */
function wrapJpeg(tiff: ArrayBuffer): ArrayBuffer {
  const exif = new Uint8Array(tiff);
  const segLen = 8 + exif.length; // 2 length bytes + "Exif\0\0" + tiff
  const u8 = new Uint8Array(2 + 2 + segLen + 2);
  const view = new DataView(u8.buffer);
  view.setUint16(0, 0xffd8, false); // SOI
  view.setUint16(2, 0xffe1, false); // APP1
  view.setUint16(4, segLen, false); // segment length (big-endian)
  u8.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6); // "Exif\0\0"
  u8.set(exif, 12);
  view.setUint16(12 + exif.length, 0xffd9, false); // EOI
  return u8.buffer;
}

// A representative SONY frame: camera, exposure, and a San Francisco location.
const FIXTURE = buildTiff(
  [
    { tag: 0x010f, type: 2, ascii: 'SONY' },
    { tag: 0x0110, type: 2, ascii: 'ILCE-7M3' },
    { tag: 0x0112, type: 3, values: [6] }, // orientation: rotated 90° CW
  ],
  [
    { tag: 0x8827, type: 3, values: [400] }, // ISO
    { tag: 0x829d, type: 5, rationals: [[28, 10]] }, // FNumber 2.8
    { tag: 0x829a, type: 5, rationals: [[1, 200]] }, // ExposureTime 1/200
    { tag: 0x920a, type: 5, rationals: [[24, 1]] }, // FocalLength 24mm
    { tag: 0x9204, type: 10, rationals: [[1, 3]] }, // ExposureBias +0.33 EV
    { tag: 0x9003, type: 2, ascii: '2026:05:30 05:49:34' }, // DateTimeOriginal
  ],
  [
    { tag: 0x0001, type: 2, ascii: 'N' }, // lat ref
    {
      tag: 0x0002,
      type: 5,
      rationals: [
        [37, 1],
        [46, 1],
        [2964, 100],
      ],
    }, // 37° 46' 29.64"
    { tag: 0x0003, type: 2, ascii: 'W' }, // lon ref
    {
      tag: 0x0004,
      type: 5,
      rationals: [
        [122, 1],
        [25, 1],
        [984, 100],
      ],
    }, // 122° 25' 9.84"
  ],
);

describe('parseExif', () => {
  const data = parseExif(FIXTURE);

  it('reads the camera body and orientation from IFD0', () => {
    expect(data.make).toBe('SONY');
    expect(data.model).toBe('ILCE-7M3');
    expect(data.orientation).toBe(6);
  });

  it('reads exposure fields from the Exif sub-IFD', () => {
    expect(data.iso).toBe(400);
    expect(data.fNumber).toBeCloseTo(2.8, 5);
    expect(data.exposureTime).toBeCloseTo(0.005, 5);
    expect(data.focalLength).toBe(24);
    expect(data.exposureBias).toBeCloseTo(0.333, 3);
    expect(data.dateTimeOriginal).toBe('2026:05:30 05:49:34');
  });

  it('converts GPS DMS + hemisphere to signed decimal degrees', () => {
    expect(data.gps).toBeDefined();
    expect(data.gps?.lat).toBeCloseTo(37.7749, 4);
    // West longitude is negative.
    expect(data.gps?.lon).toBeCloseTo(-122.4194, 4);
  });

  it('parses the same data when the TIFF is wrapped in a JPEG APP1', () => {
    const fromJpeg = parseExif(wrapJpeg(FIXTURE));
    expect(fromJpeg.make).toBe('SONY');
    expect(fromJpeg.model).toBe('ILCE-7M3');
    expect(fromJpeg.fNumber).toBeCloseTo(2.8, 5);
    expect(fromJpeg.gps?.lat).toBeCloseTo(37.7749, 4);
  });

  it('returns an empty result for non-EXIF bytes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(isEmptyExif(parseExif(png.buffer))).toBe(true);
  });

  it('never throws on a truncated buffer', () => {
    const truncated = FIXTURE.slice(0, 20);
    expect(() => parseExif(truncated)).not.toThrow();
  });
});
