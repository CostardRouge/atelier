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
import { readExifBlock, withExifBlock } from './exif-block';
import { buildOrientationBlock } from './exif-build';
import { describeOpcodes, parseOpcodeList, type DngOpcodes } from './dng-opcodes';

/** IFDs are front-loaded in a TIFF; this is plenty to walk them and find the previews. */
export const RAW_PROBE_BYTES = 1024 * 1024;

const TAG = {
  subfileType: 254,
  orientation: 274,
  width: 256,
  height: 257,
  compression: 259,
  photometric: 262,
  stripOffsets: 273,
  stripByteCounts: 279,
  subIfds: 330,
  opcodeList3: 51022,
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
  /** EXIF Orientation (tag 274), where this IFD states one. */
  orientation?: number;
  /** Where this IFD's whole image sits, when it has one. */
  imageOffset?: number;
  imageLength?: number;
}

export interface RawPreview {
  offset: number;
  length: number;
  width?: number;
  height?: number;
  /**
   * The orientation this render's OWN IFD states, where it states one. It
   * describes the render; the capture's is `RawProbe.orientation`, and where
   * both are there this one wins.
   */
  orientation?: number;
}

export interface RawProbe {
  little: boolean;
  /** IFD0, then its SubIFDs, then the rest of the IFD0 chain. */
  ifds: RawIfd[];
  /** The biggest embedded JPEG a browser can draw, or null when there is none. */
  preview: RawPreview | null;
  /**
   * How the camera was HELD (tag 274 of IFD0, the sensor plane's as a
   * fallback), or null when the file says nothing. Every axis this module
   * reports is the sensor's own; this is what turns them into the
   * photograph's.
   */
  orientation: number | null;
  /** The DNG opcode lists the file carries; a decoder that skips them vignettes. */
  opcodes: number[];
  /**
   * What `OpcodeList3` — the list that applies to the DEMOSAICED image, which
   * is the only one this engine can act on — really asks for, read from the
   * file (`dng-opcodes.ts`). Null when the file carries none, and then no rung
   * above `gain` is offered: a correction nobody measured is worse than none.
   */
  calibration: DngOpcodes | null;
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
    orientation: num(view, map.get(TAG.orientation), little),
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
    let calibration: DngOpcodes | null = null;
    const seen = new Set<number>();

    const visit = (offset: number, depth: number): number => {
      if (!offset || offset >= view.byteLength || seen.has(offset) || depth > 4) return 0;
      seen.add(offset);
      const { entry, map, next } = readIfd(view, 0, offset, little);
      ifds.push(entry);
      for (const tag of OPCODE_TAGS) if (map.has(tag) && !opcodes.includes(tag)) opcodes.push(tag);
      // Only list 3: lists 1 and 2 act on the MOSAIC, before and during
      // demosaicing, which happens inside LibRaw where nothing here can
      // reach. Reading them would offer a correction that cannot be applied.
      const three = map.get(TAG.opcodeList3);
      if (three && !calibration) {
        const read = parseOpcodeList(view, three.valueOffset, three.count);
        if (read.gainMaps.length || read.warp || read.unread.length) calibration = read;
      }
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

    // IFD0 is where a camera writes how it was held; a file whose IFD0 says
    // nothing but whose sensor plane does is the fallback, and nothing else is
    // read as the capture's — a render's own tag describes the render.
    const orientation = ifds[0]?.orientation ?? ifds.find(isSensor)?.orientation ?? null;
    return { little, ifds, preview: pickPreview(ifds), orientation, opcodes, calibration };
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
      best = {
        offset,
        length,
        width: ifd.width,
        height: ifd.height,
        // Set only where the IFD states one, so a preview that says nothing
        // compares equal to what it always was.
        ...(ifd.orientation !== undefined ? { orientation: ifd.orientation } : {}),
      };
    }
  }
  return best;
}

/** A CFA (32803) or LinearRaw (34892) plane: the sensor's data, not a render. */
function isSensor(ifd: RawIfd): boolean {
  return ifd.photometric === 32803 || ifd.photometric === 34892;
}

/** The sensor plane, for the report: the IFD that is not a render. */
export function sensorIfd(probe: RawProbe): RawIfd | null {
  return probe.ifds.find(isSensor) ?? null;
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
  // What list 3 really asks for, once it has been read rather than counted.
  const asked = describeOpcodes(probe.calibration);
  if (asked) parts.push(asked);
  return parts.join(' · ');
}

/**
 * The orientations that TRANSPOSE the frame — the quarter turns. 1 to 4 are the
 * identity, the two mirrors and the half turn, none of which swaps the axes.
 */
const TRANSPOSES = 5;

/**
 * The orientation the embedded render should be GIVEN, or 1 when it must be
 * left exactly as it is.
 *
 * The camera's own tag is in the container's IFD0, and the render is a slice
 * of bytes from the middle of that container — so the tag never reaches the
 * decoder unless it is put in the slice (`extractRawPreview`). Handing it over
 * blind would turn a render the camera ALREADY turned, so two things can
 * withdraw it:
 *
 * - a render whose own IFD states an orientation answers for itself, and that
 *   is the one to use — it describes the render, IFD0's describes the capture;
 * - a render whose frame is the TRANSPOSE of the sensor plane's has been
 *   turned already, and turning it again would lay the photograph down.
 *
 * The shape test is asked only of the quarter turns: a half turn or a mirror
 * leaves the frame as it was, so shape says nothing about them.
 */
export function previewOrientation(probe: RawProbe): number {
  const stated = probe.preview?.orientation ?? probe.orientation ?? 1;
  if (!(stated > 1) || stated > 8) return 1;
  if (stated < TRANSPOSES) return stated;
  const sensor = sensorIfd(probe);
  const preview = probe.preview;
  if (sensor?.width && sensor?.height && preview?.width && preview?.height) {
    if (sensor.width >= sensor.height !== preview.width >= preview.height) return 1;
  }
  return stated;
}

/**
 * The same JPEG carrying an orientation-only EXIF block, so a decoder asked
 * for `imageOrientation: 'from-image'` has something to read — the SAME array
 * back where nothing should be added.
 *
 * It declines for a picture that already carries a block of its own: the
 * browser honours that one, and inserting ahead of it would answer for a
 * frame nobody here has measured.
 */
export function uprightJpeg(bytes: Uint8Array<ArrayBuffer>, orientation: number): Uint8Array<ArrayBuffer> {
  if (!(orientation > 1)) return bytes;
  if (readExifBlock(bytes)) return bytes;
  try {
    return withExifBlock(bytes, buildOrientationBlock(orientation));
  } catch {
    // Not a JPEG at all, or a block a segment cannot hold: the picture is
    // worth more than the turn.
    return bytes;
  }
}

// --- the fetching half ------------------------------------------------------

/**
 * Past this, a preview pointer is not worth believing enough to read into
 * memory to splice — the slice itself is lazy and costs nothing either way.
 */
const PREVIEW_SPLICE_MAX = 32 * 1024 * 1024;

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
  const slice = file.slice(offset, offset + length, 'image/jpeg');
  // A landscape capture — the overwhelming majority — keeps the byte-exact
  // lazy slice and pays nothing. Only a turned one is read into memory, and
  // that render is about to become a bitmap many times its size anyway.
  const orientation = previewOrientation(probe);
  if (orientation === 1 || length > PREVIEW_SPLICE_MAX) return slice;
  try {
    const bytes = new Uint8Array(await slice.arrayBuffer());
    const upright = uprightJpeg(bytes, orientation);
    return upright === bytes ? slice : new Blob([upright], { type: 'image/jpeg' });
  } catch {
    return slice;
  }
}

/**
 * What a RAW holds, in two sizes, read from its head alone.
 *
 * Both are the pixels as they are SHOWN — turned the way the camera was held,
 * which is how the decoders hand them over (LibRaw applies the flip itself,
 * and the render is given the tag by `extractRawPreview`). The stored,
 * unturned plane is `sensorIfd()` and stays that way: these two views answer
 * different questions and must not be unified.
 */
export interface RawSizes {
  /** The sensor plane's own pixels, when the file states them. */
  sensor: { width: number; height: number } | null;
  /** The biggest embedded render a browser could draw, when its size is stated. */
  render: { width: number; height: number } | null;
  /** How the camera was held, or null when the file says nothing. */
  orientation: number | null;
}

/** A stated size as it is SHOWN: the axes swapped for a quarter turn. */
function shownSize(
  width: number | undefined,
  height: number | undefined,
  turned: boolean,
): { width: number; height: number } | null {
  if (!width || !height) return null;
  return turned ? { width: height, height: width } : { width, height };
}

/** The two sizes from a head already in hand — pure, so a fetched head needs no second read. */
export function rawSizesFrom(head: ArrayBuffer): RawSizes {
  const probe = probeRaw(head);
  if (!probe) return { sensor: null, render: null, orientation: null };
  const sensor = sensorIfd(probe);
  const preview = probe.preview;
  // The sensor is turned by the CAPTURE's tag, which is what LibRaw applies
  // when it decodes the plane; the render by whatever it is really going to be
  // given, so a render the camera already turned is not counted twice.
  const sensorTurned = (probe.orientation ?? 1) >= TRANSPOSES;
  const renderTurned = previewOrientation(probe) >= TRANSPOSES;
  return {
    sensor: shownSize(sensor?.width, sensor?.height, sensorTurned),
    render: shownSize(preview?.width, preview?.height, renderTurned),
    orientation: probe.orientation,
  };
}

/**
 * What the CALIBRATION in a RAW on hand asks for, read from its head alone —
 * a megabyte, no decoder (`dng-opcodes.ts`). Null for a file that carries
 * none, which is what decides whether the rungs above `gain` are offered at
 * all: never a correction nobody measured.
 */
export async function rawCalibration(file: Blob): Promise<DngOpcodes | null> {
  try {
    const head = await file.slice(0, Math.min(RAW_PROBE_BYTES, file.size)).arrayBuffer();
    return probeRaw(head)?.calibration ?? null;
  } catch {
    return null;
  }
}

/**
 * The two sizes of a RAW on hand: what its sensor holds, and what of it a
 * browser can actually draw. A megabyte of the head, never the file — which is
 * the whole point: the answer to "why is this DNG pixelated" is a pair of
 * numbers the IFDs state, and no decoder is needed to read them.
 */
export async function rawSizes(file: Blob): Promise<RawSizes> {
  try {
    const head = await file.slice(0, Math.min(RAW_PROBE_BYTES, file.size)).arrayBuffer();
    return rawSizesFrom(head);
  } catch {
    return { sensor: null, render: null, orientation: null };
  }
}
