/**
 * What a RAW file IS — read off its own IFDs, without decoding a pixel.
 *
 * A camera RAW (DNG, ARW, NEF, CR2…) is a TIFF whose IFDs describe several
 * images: the sensor plane, and one or more RENDERS the camera made — a
 * thumbnail, often a full-size JPEG. `exif-parser.ts` already walks that
 * structure for metadata; this walks it for the PICTURES, through the very
 * same reader (`parseIfd`, `num`, `nums`) so there is one TIFF parser in the
 * suite and not two.
 *
 * Two things it is for:
 *
 * 1. **A RAW can show its camera's own render today**, with no decoder at all
 *    — `extractRawPreview` hands back the embedded JPEG's bytes. That turns
 *    "no browser decodes this" into a picture, which is worth having on its
 *    own (`docs/photo-editor.md` P3).
 * 2. **The spike's questions are answered from the file**: which compression
 *    the sensor plane uses (tag 259 — and JPEG XL, 52546, is the one that
 *    decides which decoder we would have to maintain), whether the file
 *    carries opcode lists a naive decode would skip and vignette for, and how
 *    big the embedded render really is.
 *
 * Pure and DOM-free apart from `extractRawPreview`, which only slices a Blob.
 */

import { num, nums, parseIfd, type Entry } from './exif-parser';

/** IFDs are front-loaded in a TIFF; this is plenty to walk them and find the previews. */
export const RAW_PROBE_BYTES = 1024 * 1024;

const TAG = {
  subfileType: 254,
  width: 256,
  height: 257,
  compression: 259,
  photometric: 262,
  stripOffsets: 273,
  stripByteCounts: 279,
  subIfds: 330,
  jpegOffset: 513,
  jpegLength: 514,
} as const;

/** DNG opcode lists — a gain map for lens shading among them. */
const OPCODE_TAGS = [51008, 51009, 51022];

/**
 * PhotometricInterpretation values that mean "this IFD holds a finished
 * picture a browser could draw", as against a sensor plane.
 */
const RENDERED = new Set([1 /* white is zero — a grey render */, 2 /* RGB */, 6 /* YCbCr */]);

/** Compression values whose bytes are a JPEG a browser decodes as-is. */
const JPEG_COMPRESSION = new Set([6, 7]);

export interface RawIfd {
  /** NewSubfileType: 0 the main image, 1 a reduced-resolution preview. */
  subfileType?: number;
  width?: number;
  height?: number;
  /** TIFF Compression (tag 259). */
  compression?: number;
  /** PhotometricInterpretation (tag 262): 32803 is a CFA sensor plane, 34892 LinearRaw. */
  photometric?: number;
  /** Where this IFD's whole image sits, when it has one. */
  imageOffset?: number;
  imageLength?: number;
}

export interface RawPreview {
  offset: number;
  length: number;
  width?: number;
  height?: number;
}

export interface RawProbe {
  little: boolean;
  /** IFD0, then its SubIFDs, then the rest of the IFD0 chain. */
  ifds: RawIfd[];
  /** The biggest embedded JPEG a browser can draw, or null when there is none. */
  preview: RawPreview | null;
  /** The DNG opcode lists the file carries; a decoder that skips them vignettes. */
  opcodes: number[];
}

/** What a compression code means, for a report or a panel. */
export function describeCompression(code: number | undefined): string {
  switch (code) {
    case undefined:
      return 'unstated';
    case 1:
      return 'uncompressed';
    case 6:
    case 7:
      return 'JPEG';
    case 8:
    case 32946:
      return 'deflate';
    case 34892:
      return 'lossy JPEG';
    case 52546:
      // The one that decides the decoder question: LibRaw reads JPEG XL tiles
      // only when built with Adobe's DNG SDK, which the npm build is not.
      return 'JPEG XL';
    default:
      return `compression ${code}`;
  }
}

function readIfd(view: DataView, tiffStart: number, offset: number, little: boolean): {
  entry: RawIfd;
  map: Map<number, Entry>;
  next: number;
} {
  const map = parseIfd(view, tiffStart, offset, little);
  const jpegOffset = num(view, map.get(TAG.jpegOffset), little);
  const jpegLength = num(view, map.get(TAG.jpegLength), little);
  const strips = nums(view, map.get(TAG.stripOffsets), little);
  const counts = nums(view, map.get(TAG.stripByteCounts), little);
  // A whole image in one piece is what can be sliced out; a picture split over
  // many strips would have to be reassembled, and no camera writes its JPEG
  // preview that way.
  const single = strips?.length === 1 && counts?.length === 1;
  const entry: RawIfd = {
    subfileType: num(view, map.get(TAG.subfileType), little),
    width: num(view, map.get(TAG.width), little),
    height: num(view, map.get(TAG.height), little),
    compression: num(view, map.get(TAG.compression), little),
    photometric: num(view, map.get(TAG.photometric), little),
    imageOffset: jpegOffset ?? (single ? strips![0] : undefined),
    imageLength: jpegLength ?? (single ? counts![0] : undefined),
  };
  let next = 0;
  const count = offset + 2 <= view.byteLength ? view.getUint16(offset, little) : 0;
  const nextAt = offset + 2 + count * 12;
  if (nextAt + 4 <= view.byteLength) next = view.getUint32(nextAt, little);
  return { entry, map, next };
}

/**
 * Walk a RAW's IFDs. Answers null for anything that is not a TIFF — a JPEG is
 * not a RAW, and a truncated head is not worth guessing at.
 */
export function probeRaw(buffer: ArrayBuffer): RawProbe | null {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 16) return null;
    const bom = view.getUint16(0, false);
    const little = bom === 0x4949;
    if (!little && bom !== 0x4d4d) return null;
    if (view.getUint16(2, little) !== 0x002a) return null;

    const ifds: RawIfd[] = [];
    const opcodes: number[] = [];
    const seen = new Set<number>();

    const visit = (offset: number, depth: number): number => {
      if (!offset || offset >= view.byteLength || seen.has(offset) || depth > 4) return 0;
      seen.add(offset);
      const { entry, map, next } = readIfd(view, 0, offset, little);
      ifds.push(entry);
      for (const tag of OPCODE_TAGS) if (map.has(tag) && !opcodes.includes(tag)) opcodes.push(tag);
      // SubIFDs are where a DNG keeps the sensor plane and its full-size
      // render; reading only IFD0 finds the thumbnail and misses both.
      const subs = nums(view, map.get(TAG.subIfds), little) ?? [];
      for (const sub of subs) visit(sub, depth + 1);
      return next;
    };

    let offset = view.getUint32(4, little);
    let guard = 0;
    while (offset && guard < 16) {
      offset = visit(offset, 0);
      guard += 1;
    }

    return { little, ifds, preview: pickPreview(ifds), opcodes };
  } catch {
    return null;
  }
}

/**
 * The biggest embedded JPEG, by pixel count where the dimensions are stated and
 * by byte length otherwise.
 *
 * The discriminator is PHOTOMETRIC, not compression: a DNG's sensor plane is
 * very often compression 7 as well (lossless JPEG), and taking it for a preview
 * would hand a browser a mosaic it cannot draw. A render says YCbCr or RGB; a
 * sensor plane says CFA (32803) or LinearRaw (34892).
 */
function pickPreview(ifds: readonly RawIfd[]): RawPreview | null {
  let best: RawPreview | null = null;
  let bestScore = 0;
  for (const ifd of ifds) {
    if (!JPEG_COMPRESSION.has(ifd.compression ?? -1)) continue;
    if (!RENDERED.has(ifd.photometric ?? -1)) continue;
    const { imageOffset: offset, imageLength: length } = ifd;
    if (offset === undefined || length === undefined || length <= 0) continue;
    // NOT bounds-checked against the buffer: the probe reads only the HEAD, and
    // a full-size render in a 60 MB DNG sits far past it. Rejecting it here
    // would throw away the very preview worth having. `extractRawPreview`, which
    // knows the real file size, is where the pointer is checked.
    if (!Number.isFinite(offset) || !Number.isFinite(length)) continue;
    const score = ifd.width && ifd.height ? ifd.width * ifd.height : length;
    if (score > bestScore) {
      bestScore = score;
      best = { offset, length, width: ifd.width, height: ifd.height };
    }
  }
  return best;
}

/** The sensor plane, for the report: the IFD that is not a render. */
export function sensorIfd(probe: RawProbe): RawIfd | null {
  return (
    probe.ifds.find((i) => i.photometric === 32803 || i.photometric === 34892) ?? null
  );
}

/**
 * One line about a RAW, for a panel or the spike's own report:
 * `6000×4000 · sensor JPEG XL · preview 6000×4000 · 2 opcode lists`.
 */
export function describeRaw(probe: RawProbe): string {
  const sensor = sensorIfd(probe);
  const parts: string[] = [];
  if (sensor?.width && sensor?.height) parts.push(`${sensor.width}×${sensor.height}`);
  if (sensor) parts.push(`sensor ${describeCompression(sensor.compression)}`);
  parts.push(
    probe.preview
      ? `preview ${probe.preview.width ?? '?'}×${probe.preview.height ?? '?'}`
      : 'no embedded preview',
  );
  if (probe.opcodes.length) {
    parts.push(`${probe.opcodes.length} opcode list${probe.opcodes.length > 1 ? 's' : ''}`);
  }
  return parts.join(' · ');
}

// --- the fetching half ------------------------------------------------------

/**
 * The camera's own render out of a RAW, as a JPEG blob — or null when the file
 * carries none. Reads only the head to find it, then slices the bytes: a 60 MB
 * DNG is never pulled into memory to show its preview.
 */
export async function extractRawPreview(file: Blob): Promise<Blob | null> {
  const head = await file.slice(0, Math.min(RAW_PROBE_BYTES, file.size)).arrayBuffer();
  const probe = probeRaw(head);
  if (!probe?.preview) return null;
  const { offset, length } = probe.preview;
  if (offset + length > file.size) return null;
  return file.slice(offset, offset + length, 'image/jpeg');
}
