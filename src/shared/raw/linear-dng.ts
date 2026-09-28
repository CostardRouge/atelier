/**
 * A LINEAR-RAW DNG whose sensor data is JPEG XL — Apple's ProRAW with JPEG XL
 * compression — read and developed without LibRaw. Pure and DOM-free.
 *
 * LibRaw reads a JPEG XL tile only when built with Adobe's DNG SDK, which the
 * npm build is not (`describeCompression`, 52546). But a LinearRaw DNG is the
 * easy half of a RAW: it is already demosaiced — three samples a pixel, linear
 * in the camera's own colour space — so what LibRaw would do to it is only
 * arithmetic, and the arithmetic is dcraw's, reproduced here:
 *
 * 1. a sample's black and white levels bring it to [0, 1] of the sensor;
 * 2. the as-shot white balance (`1 / AsShotNeutral`) is applied, normalised so
 *    the SMALLEST multiplier is 1 and every channel clips at the sensor's white
 *    (dcraw's `-H 0`, the `highlight: 0` the LibRaw path asks for);
 * 3. the camera colour becomes linear sRGB through `rgb_cam`, built exactly as
 *    dcraw's `cam_xyz_coeff` builds it from the DNG's `ColorMatrix` (XYZ →
 *    camera): `cam_rgb = ColorMatrix · xyz_rgb`, each row normalised to sum 1,
 *    inverted — and clipped to [0, 1].
 *
 * The one output is what `raw-decoder.ts` already takes from LibRaw: linear
 * sRGB with the sensor's white at 1, so the gain, the half-floats, the as-shot
 * bytes and the white balance in kelvin (`RawWhite`) all come for free.
 *
 * The file is TILED, each tile its own JPEG XL codestream, so a picture is
 * decoded one tile at a time straight into its place — the tile decode a
 * phone needs, given by the format itself. What is NOT applied, deliberately
 * or for want of a file to measure: `BaselineExposure` (LibRaw ignores it too;
 * the develop meters its own exposure), `ProfileGainTableMap` (Apple's local
 * tone map), `CameraCalibration`/`AnalogBalance` (identity on every ProRAW
 * read so far — by report, not measured), `DefaultCrop`, and the opcode lists.
 */

import { num, nums, parseIfd, type Entry } from '../exif/exif-parser';
import { inverse3, mul3, type RawWhite } from './white-balance';

const TAG = {
  subfileType: 254,
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  photometric: 262,
  make: 271,
  model: 272,
  stripOffsets: 273,
  orientation: 274,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  planar: 284,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  subIfds: 330,
  uniqueModel: 50708,
  blackLevel: 50714,
  whiteLevel: 50717,
  colorMatrix1: 50721,
  colorMatrix2: 50722,
  asShotNeutral: 50728,
  baselineExposure: 50730,
  illuminant1: 50778,
  illuminant2: 50779,
} as const;

/** JPEG XL, in a DNG 1.7 (`describeCompression`). */
export const JXL_COMPRESSION = 52546;
/** PhotometricInterpretation LinearRaw: demosaiced, linear, camera colour. */
export const LINEAR_RAW = 34892;
/** CalibrationIlluminant D65. */
const D65 = 21;

/** Linear sRGB → XYZ (D65) — dcraw's `xyz_rgb`. */
const XYZ_RGB = [0.412453, 0.35758, 0.180423, 0.212671, 0.71516, 0.072169, 0.019334, 0.119193, 0.950227];

export interface LinearDngTile {
  offset: number;
  length: number;
}

export interface LinearDng {
  /** The stored frame, before the orientation turns it. */
  width: number;
  height: number;
  tileWidth: number;
  tileLength: number;
  /** Tiles across and down; `tiles` is row-major over them. */
  across: number;
  down: number;
  tiles: LinearDngTile[];
  bitsPerSample: number;
  /** Black level per channel, R G B, in the sensor's own units. */
  black: [number, number, number];
  white: number;
  /** EXIF orientation of the capture, 1 when the file says nothing. */
  orientation: number;
  /** XYZ → camera, 3×3 row-major — the D65 matrix where the file has one. */
  colorMatrix: number[] | null;
  /** The camera's reading of a neutral, R G B. */
  asShotNeutral: [number, number, number] | null;
  make: string;
  model: string;
}

function ascii(view: DataView, entry: Entry | undefined): string {
  if (!entry || entry.type !== 2) return '';
  let s = '';
  for (let i = 0; i < entry.count && entry.valueOffset + i < view.byteLength; i += 1) {
    const c = view.getUint8(entry.valueOffset + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

function three(values: number[] | undefined): [number, number, number] | null {
  if (!values?.length) return null;
  if (values.length >= 3) return [values[0], values[1], values[2]];
  return [values[0], values[0], values[0]];
}

/**
 * A DNG whose sensor IFD is LinearRaw compressed as JPEG XL, read from its
 * head — or null for anything else (a CFA DNG, an uncompressed LinearRaw
 * LibRaw reads itself, a non-TIFF). Needs the tile tables in the head, which
 * is where every writer puts them.
 */
export function readLinearDng(head: ArrayBuffer): LinearDng | null {
  try {
    const view = new DataView(head);
    if (view.byteLength < 16) return null;
    const bom = view.getUint16(0, false);
    const little = bom === 0x4949;
    if (!little && bom !== 0x4d4d) return null;
    if (view.getUint16(2, little) !== 0x002a) return null;

    const maps: Map<number, Entry>[] = [];
    const seen = new Set<number>();
    const visit = (offset: number, depth: number): number => {
      if (!offset || offset >= view.byteLength || seen.has(offset) || depth > 4) return 0;
      seen.add(offset);
      const map = parseIfd(view, 0, offset, little);
      maps.push(map);
      for (const sub of nums(view, map.get(TAG.subIfds), little) ?? []) visit(sub, depth + 1);
      const count = offset + 2 <= view.byteLength ? view.getUint16(offset, little) : 0;
      const nextAt = offset + 2 + count * 12;
      return nextAt + 4 <= view.byteLength ? view.getUint32(nextAt, little) : 0;
    };
    let offset = view.getUint32(4, little);
    for (let guard = 0; offset && guard < 16; guard += 1) offset = visit(offset, 0);

    const n = (map: Map<number, Entry>, tag: number) => num(view, map.get(tag), little);
    const sensor = maps.find(
      (m) => n(m, TAG.photometric) === LINEAR_RAW && n(m, TAG.compression) === JXL_COMPRESSION,
    );
    if (!sensor) return null;
    const width = n(sensor, TAG.width);
    const height = n(sensor, TAG.height);
    const spp = n(sensor, TAG.samplesPerPixel) ?? 1;
    if (!width || !height || spp < 3 || (n(sensor, TAG.planar) ?? 1) !== 1) return null;

    // Tiles, or strips read as full-width tiles.
    let tileWidth = n(sensor, TAG.tileWidth);
    let tileLength = n(sensor, TAG.tileLength);
    let offsets = nums(view, sensor.get(TAG.tileOffsets), little);
    let counts = nums(view, sensor.get(TAG.tileByteCounts), little);
    if (!tileWidth || !tileLength || !offsets || !counts) {
      tileWidth = width;
      tileLength = n(sensor, TAG.rowsPerStrip) ?? height;
      offsets = nums(view, sensor.get(TAG.stripOffsets), little);
      counts = nums(view, sensor.get(TAG.stripByteCounts), little);
    }
    const across = Math.ceil(width / tileWidth);
    const down = Math.ceil(height / tileLength);
    if (!offsets || !counts || offsets.length < across * down || counts.length < across * down) return null;

    const ifd0 = maps[0];
    // Where both matrices are there, the one calibrated under D65 — dcraw's pick.
    const m1 = nums(view, ifd0.get(TAG.colorMatrix1), little) ?? nums(view, sensor.get(TAG.colorMatrix1), little);
    const m2 = nums(view, ifd0.get(TAG.colorMatrix2), little) ?? nums(view, sensor.get(TAG.colorMatrix2), little);
    const ill1 = n(ifd0, TAG.illuminant1);
    const ill2 = n(ifd0, TAG.illuminant2);
    const matrix = (m2?.length === 9 && (ill2 === D65 || ill1 !== D65) ? m2 : null) ?? (m1?.length === 9 ? m1 : null);

    const bps = nums(view, sensor.get(TAG.bitsPerSample), little)?.[0] ?? 16;
    const black = three(nums(view, sensor.get(TAG.blackLevel), little)) ?? [0, 0, 0];
    const white = nums(view, sensor.get(TAG.whiteLevel), little)?.[0] ?? 2 ** bps - 1;
    return {
      width,
      height,
      tileWidth,
      tileLength,
      across,
      down,
      tiles: Array.from({ length: across * down }, (_, i) => ({ offset: offsets![i], length: counts![i] })),
      bitsPerSample: bps,
      black,
      white,
      orientation: n(ifd0, TAG.orientation) ?? n(sensor, TAG.orientation) ?? 1,
      colorMatrix: matrix,
      asShotNeutral: three(nums(view, ifd0.get(TAG.asShotNeutral), little)),
      make: ascii(view, ifd0.get(TAG.make)),
      model: ascii(view, ifd0.get(TAG.model)) || ascii(view, ifd0.get(TAG.uniqueModel)),
    };
  } catch {
    return null;
  }
}

// --- Orientation --------------------------------------------------------------

/** The frame as SHOWN: the axes swapped for a quarter turn (EXIF 5–8). */
export function orientedSize(width: number, height: number, orientation: number): { width: number; height: number } {
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

/** Where stored pixel `(x, y)` of a `width`×`height` frame lands once turned by EXIF `orientation`. */
export function orientPoint(x: number, y: number, width: number, height: number, orientation: number): [number, number] {
  switch (orientation) {
    case 2:
      return [width - 1 - x, y];
    case 3:
      return [width - 1 - x, height - 1 - y];
    case 4:
      return [x, height - 1 - y];
    case 5:
      return [y, x];
    case 6:
      return [height - 1 - y, x];
    case 7:
      return [height - 1 - y, width - 1 - x];
    case 8:
      return [y, width - 1 - x];
    default:
      return [x, y];
  }
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The stored rectangle a SHOWN one comes from — its two corners mapped back and ordered. */
export function storedRect(shown: PixelRect, width: number, height: number, orientation: number): PixelRect {
  const size = orientedSize(width, height, orientation);
  // The inverse of each orientation is itself, except 6 and 8, which swap.
  const inverse = orientation === 6 ? 8 : orientation === 8 ? 6 : orientation;
  const [ax, ay] = orientPoint(shown.x, shown.y, size.width, size.height, inverse);
  const [bx, by] = orientPoint(shown.x + shown.w - 1, shown.y + shown.h - 1, size.width, size.height, inverse);
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  return { x, y, w: Math.abs(bx - ax) + 1, h: Math.abs(by - ay) + 1 };
}

// --- Colour -------------------------------------------------------------------

export interface LinearDngColor {
  /** The as-shot multipliers, the smallest at 1 so every channel clips at the sensor's white. */
  mul: [number, number, number];
  /** Camera → linear sRGB, 3×3 row-major — dcraw's `rgb_cam`. */
  rgbCam: number[];
  /** What the white balance in kelvin reads (`white-balance.ts`), or null without a matrix. */
  white: RawWhite | null;
}

/**
 * The colour a LinearRaw DNG is developed with. Without a matrix the camera's
 * channels are taken for sRGB's — said by `white: null`, which takes the
 * kelvin controls away rather than inventing a camera.
 */
export function linearDngColor(info: Pick<LinearDng, 'colorMatrix' | 'asShotNeutral'>): LinearDngColor {
  const neutral = info.asShotNeutral && info.asShotNeutral.every((v) => v > 0) ? info.asShotNeutral : null;
  const raw: [number, number, number] = neutral ? [1 / neutral[0], 1 / neutral[1], 1 / neutral[2]] : [1, 1, 1];
  const least = Math.min(...raw);
  const mul: [number, number, number] = [raw[0] / least, raw[1] / least, raw[2] / least];

  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (!info.colorMatrix) return { mul, rgbCam: identity, white: null };
  const camRgb = mul3(info.colorMatrix, XYZ_RGB);
  for (let r = 0; r < 3; r += 1) {
    const sum = camRgb[r * 3] + camRgb[r * 3 + 1] + camRgb[r * 3 + 2];
    if (!(Math.abs(sum) > 1e-9)) return { mul, rgbCam: identity, white: null };
    for (let c = 0; c < 3; c += 1) camRgb[r * 3 + c] /= sum;
  }
  const rgbCam = inverse3(camRgb);
  if (!rgbCam) return { mul, rgbCam: identity, white: null };
  const white: RawWhite | null = inverse3(info.colorMatrix)
    ? { asShot: [raw[0] / raw[1], 1, raw[2] / raw[1]], camXyz: [...info.colorMatrix], rgbCam }
    : null;
  return { mul, rgbCam, white };
}

// --- One tile into its place --------------------------------------------------

/** Where a developed tile goes. */
export type TileTarget =
  | {
      /** Whole density: LibRaw's own 16-bit BT.709 codes, `rgb16` being `outWidth`×… of them. */
      kind: 'codes';
      rgb16: Uint16Array;
      /** linear [0,1] quantised to 1/65535 → the code LibRaw would write (`codeTable`). */
      codeOf: Uint16Array;
    }
  | {
      /** Box-averaged: linear light SUMMED into cells of `factor`², divided by the caller once. */
      kind: 'sums';
      sums: Float32Array;
      factor: number;
    };

export interface TileSpec {
  /** The tile's decoded samples: `tileWidth`×`tileLength`, `channels` a pixel, 0–65535 of full scale. */
  samples: Uint16Array;
  channels: number;
  tileWidth: number;
  /** The stored pixel the tile's first sample is. */
  x0: number;
  y0: number;
  /** How many of its columns and rows are inside the image — an edge tile is padded. */
  validWidth: number;
  validHeight: number;
}

export interface FrameSpec {
  info: Pick<LinearDng, 'width' | 'height' | 'orientation' | 'black' | 'white' | 'bitsPerSample'>;
  color: LinearDngColor;
  /** The SHOWN rectangle being decoded, in the shown frame's own pixels. */
  region: PixelRect;
  /** The output's size: the region at whole density, or its box cells. */
  outWidth: number;
  outHeight: number;
}

/** The code table for a `codes` target: 65 536 entries, built by the caller once. */
export function codeTable(toCode: (linear: number) => number): Uint16Array {
  const table = new Uint16Array(65536);
  for (let i = 0; i < 65536; i += 1) table[i] = Math.max(0, Math.min(65535, Math.round(toCode(i / 65535) * 65535)));
  return table;
}

/**
 * Develop one decoded tile and write it where it belongs: every pixel inside
 * the image and inside `frame.region`, turned by the capture's orientation.
 * The arithmetic of the module comment, one pixel at a time.
 */
export function developTile(tile: TileSpec, frame: FrameSpec, target: TileTarget): void {
  const { info, color, region, outWidth, outHeight } = frame;
  const scale = (2 ** info.bitsPerSample - 1) / 65535;
  const [b0, b1, b2] = info.black;
  const k0 = 1 / Math.max(1e-9, info.white - b0);
  const k1 = 1 / Math.max(1e-9, info.white - b1);
  const k2 = 1 / Math.max(1e-9, info.white - b2);
  const [m0, m1, m2] = color.mul;
  const [M0, M1, M2, M3, M4, M5, M6, M7, M8] = color.rgbCam;
  const { samples, channels, tileWidth, x0, y0, validWidth, validHeight } = tile;
  const factor = target.kind === 'sums' ? target.factor : 1;
  const codes = target.kind === 'codes' ? target.rgb16 : null;
  const codeOf = target.kind === 'codes' ? target.codeOf : null;
  const sums = target.kind === 'sums' ? target.sums : null;
  // Every orientation is affine in (x, y): where (0,0) lands, and how far one
  // step along x and along y moves it — so no point is built per pixel.
  const [ox, oy] = orientPoint(0, 0, info.width, info.height, info.orientation);
  const [xx, xy] = orientPoint(1, 0, info.width, info.height, info.orientation);
  const [yx, yy] = orientPoint(0, 1, info.width, info.height, info.orientation);
  const stepXx = xx - ox;
  const stepXy = xy - oy;
  const stepYx = yx - ox;
  const stepYy = yy - oy;
  for (let ty = 0; ty < validHeight; ty += 1) {
    const sy = y0 + ty;
    // The shown point of this row's first sample, relative to the region.
    let rx = ox + x0 * stepXx + sy * stepYx - region.x;
    let ry = oy + x0 * stepXy + sy * stepYy - region.y;
    let i = ty * tileWidth * channels;
    for (let tx = 0; tx < validWidth; tx += 1, rx += stepXx, ry += stepXy, i += channels) {
      if (rx < 0 || ry < 0 || rx >= region.w || ry >= region.h) continue;
      const cx = factor === 1 ? rx : Math.floor(rx / factor);
      const cy = factor === 1 ? ry : Math.floor(ry / factor);
      if (cx >= outWidth || cy >= outHeight) continue;
      let r = (samples[i] * scale - b0) * k0 * m0;
      let g = (samples[i + 1] * scale - b1) * k1 * m1;
      let b = (samples[i + 2] * scale - b2) * k2 * m2;
      r = r < 0 ? 0 : r > 1 ? 1 : r;
      g = g < 0 ? 0 : g > 1 ? 1 : g;
      b = b < 0 ? 0 : b > 1 ? 1 : b;
      let R = M0 * r + M1 * g + M2 * b;
      let G = M3 * r + M4 * g + M5 * b;
      let B = M6 * r + M7 * g + M8 * b;
      R = R < 0 ? 0 : R > 1 ? 1 : R;
      G = G < 0 ? 0 : G > 1 ? 1 : G;
      B = B < 0 ? 0 : B > 1 ? 1 : B;
      const o = (cy * outWidth + cx) * 3;
      if (codes && codeOf) {
        codes[o] = codeOf[(R * 65535 + 0.5) | 0];
        codes[o + 1] = codeOf[(G * 65535 + 0.5) | 0];
        codes[o + 2] = codeOf[(B * 65535 + 0.5) | 0];
      } else if (sums) {
        sums[o] += R;
        sums[o + 1] += G;
        sums[o + 2] += B;
      }
    }
  }
}
