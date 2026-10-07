/**
 * A DNG's OWN colour profile — the tags a DNG writer puts in IFD0 to say how
 * its camera's colour becomes a picture (DNG spec 1.4, chapter 6, and 1.6
 * for the third illuminant and the gain table map). Read, never applied:
 * what to DO with them is `docs/camera-profiles.md`, and the maths that
 * would apply the matrices is `raw/dng-color.ts`.
 *
 * Read through the suite's one TIFF reader (`parseIfd`, `num`, `nums`), from
 * the head `raw-probe.ts` already walks. A table that sits past that head is
 * NAMED in `unread` rather than dropped, the opcode reader's rule
 * (`dng-opcodes.ts`): a file must never look as though it carried less than
 * it does.
 *
 * Pure and DOM-free.
 */

import { num, nums, type Entry } from './exif-parser';

/** The DNG profile tags, by number. */
export const PROFILE_TAG = {
  colorMatrix1: 50721,
  colorMatrix2: 50722,
  cameraCalibration1: 50723,
  cameraCalibration2: 50724,
  analogBalance: 50727,
  asShotNeutral: 50728,
  asShotWhiteXY: 50729,
  baselineExposure: 50730,
  illuminant1: 50778,
  illuminant2: 50779,
  profileCalibrationSignature: 50932,
  profileName: 50936,
  hueSatMapDims: 50937,
  hueSatMapData1: 50938,
  hueSatMapData2: 50939,
  toneCurve: 50940,
  embedPolicy: 50941,
  copyright: 50942,
  forwardMatrix1: 50964,
  forwardMatrix2: 50965,
  lookTableDims: 50981,
  lookTableData: 50982,
  hueSatMapEncoding: 51107,
  lookTableEncoding: 51108,
  baselineExposureOffset: 51109,
  defaultBlackRender: 51110,
  /** DNG 1.6: a local tone map (Apple's ProRAW carries one). */
  gainTableMap: 52525,
  /** DNG 1.6: a THIRD calibration illuminant, interpolated by another rule. */
  illuminant3: 52529,
} as const;

/** One calibration: the illuminant it was made under and the matrices made there. */
export interface DngCalibration {
  /** The EXIF LightSource code (17 = Standard light A, 21 = D65…). */
  illuminant: number;
  /** XYZ → reference camera, 3×3 row-major (`ColorMatrixN`). */
  colorMatrix: number[] | null;
  /** White-balanced camera → XYZ D50, 3×3 row-major (`ForwardMatrixN`). */
  forwardMatrix: number[] | null;
  /** Reference camera → this unit, 3×3 row-major (`CameraCalibrationN`). */
  cameraCalibration: number[] | null;
}

/** A hue/saturation/value table: `ProfileHueSatMap` or `ProfileLookTable`. */
export interface DngHsvTable {
  /** Hue divisions, saturation divisions, value divisions (1 = a 2.5D table). */
  dims: [number, number, number];
  /** `dims` product × 3 floats (hue shift in degrees, saturation scale, value scale), or null when past the head. */
  data: Float32Array | null;
  /** A second table, for the second illuminant (a hue/sat map only). */
  data2: Float32Array | null;
  /** Encoding 1: the value axis is sRGB-gamma encoded; 0 (default): linear. */
  srgbValue: boolean;
}

export interface DngProfile {
  /** One calibration per illuminant the file names, in tag order. */
  calibrations: DngCalibration[];
  /** The file names a third illuminant (DNG 1.6), which this reader does not take. */
  thirdIlluminant: boolean;
  analogBalance: [number, number, number] | null;
  asShotNeutral: [number, number, number] | null;
  asShotWhiteXY: [number, number] | null;
  baselineExposure: number | null;
  baselineExposureOffset: number | null;
  /** `ProfileName`, e.g. `Adobe Standard`, or ''. */
  name: string;
  copyright: string;
  calibrationSignature: string;
  /** 0 allow copying · 1 embed if used · 2 never embed · 3 no restrictions — null when unstated. */
  embedPolicy: number | null;
  hueSatMap: DngHsvTable | null;
  lookTable: DngHsvTable | null;
  /** `ProfileToneCurve` as [x, y] pairs in [0, 1], or null. */
  toneCurve: [number, number][] | null;
  /** 0 auto · 1 none. */
  defaultBlackRender: number | null;
  /** A `ProfileGainTableMap` (DNG 1.6 local tone map) is present. */
  gainTableMap: boolean;
  /** Tags present but not readable from the head, by name. */
  unread: string[];
}

function text(view: DataView, entry: Entry | undefined): string {
  // ASCII (2) per the spec; some writers store UTF-8 as BYTE (1).
  if (!entry || (entry.type !== 2 && entry.type !== 1)) return '';
  const bytes: number[] = [];
  for (let i = 0; i < entry.count && entry.valueOffset + i < view.byteLength; i += 1) {
    const c = view.getUint8(entry.valueOffset + i);
    if (c === 0) break;
    bytes.push(c);
  }
  try {
    return new TextDecoder().decode(new Uint8Array(bytes)).trim();
  } catch {
    return String.fromCharCode(...bytes).trim();
  }
}

const finite = (v: number[] | undefined): v is number[] => !!v && v.every((n) => Number.isFinite(n));

function matrix9(view: DataView, entry: Entry | undefined, little: boolean): number[] | null {
  const v = nums(view, entry, little);
  return finite(v) && v.length === 9 ? v : null;
}

function triple(view: DataView, entry: Entry | undefined, little: boolean): [number, number, number] | null {
  const v = nums(view, entry, little);
  return finite(v) && v.length === 3 ? [v[0], v[1], v[2]] : null;
}

/** A table's floats, or null — and its name in `unread` when the tag is there but its bytes are not. */
function floats(
  view: DataView,
  entry: Entry | undefined,
  little: boolean,
  expected: number,
  name: string,
  unread: string[],
): Float32Array | null {
  if (!entry) return null;
  const v = nums(view, entry, little);
  if (!v || v.length !== expected || !finite(v)) {
    unread.push(name);
    return null;
  }
  return Float32Array.from(v);
}

function hsvDims(view: DataView, entry: Entry | undefined, little: boolean): [number, number, number] | null {
  const v = nums(view, entry, little);
  if (!v || v.length < 2) return null;
  const dims: [number, number, number] = [v[0], v[1], v.length > 2 ? v[2] : 1];
  // A hue/sat table needs at least one hue division and two saturation ones;
  // a value axis of 0 is 1 (a 2.5D table). Absurd sizes are refused before
  // anything is allocated.
  if (dims[2] === 0) dims[2] = 1;
  if (!dims.every((d) => Number.isInteger(d) && d >= 1 && d <= 1024) || dims[1] < 2) return null;
  if (dims[0] * dims[1] * dims[2] > 1 << 20) return null;
  return dims;
}

/**
 * The profile a DNG's IFD0 carries, or null when it carries none of it (an
 * ARW, a TIFF that is not a DNG, a DNG with no colour data at all).
 */
export function readDngProfile(view: DataView, map: Map<number, Entry>, little: boolean): DngProfile | null {
  const T = PROFILE_TAG;
  if (!map.has(T.colorMatrix1) && !map.has(T.forwardMatrix1) && !map.has(T.profileName)) return null;
  const unread: string[] = [];

  const calibrations: DngCalibration[] = [];
  const one = (ill: number, cm: number, fm: number, cc: number) => {
    if (!map.has(cm) && !map.has(fm)) return;
    calibrations.push({
      // A missing illuminant is 0, "unknown" — the spec's own default.
      illuminant: num(view, map.get(ill), little) ?? 0,
      colorMatrix: matrix9(view, map.get(cm), little),
      forwardMatrix: matrix9(view, map.get(fm), little),
      cameraCalibration: matrix9(view, map.get(cc), little),
    });
  };
  one(T.illuminant1, T.colorMatrix1, T.forwardMatrix1, T.cameraCalibration1);
  one(T.illuminant2, T.colorMatrix2, T.forwardMatrix2, T.cameraCalibration2);

  const hsDims = hsvDims(view, map.get(T.hueSatMapDims), little);
  const hsCount = hsDims ? hsDims[0] * hsDims[1] * hsDims[2] * 3 : 0;
  const hueSatMap: DngHsvTable | null = hsDims
    ? {
        dims: hsDims,
        data: floats(view, map.get(T.hueSatMapData1), little, hsCount, 'ProfileHueSatMapData1', unread),
        data2: floats(view, map.get(T.hueSatMapData2), little, hsCount, 'ProfileHueSatMapData2', unread),
        srgbValue: num(view, map.get(T.hueSatMapEncoding), little) === 1,
      }
    : null;
  const ltDims = hsvDims(view, map.get(T.lookTableDims), little);
  const lookTable: DngHsvTable | null = ltDims
    ? {
        dims: ltDims,
        data: floats(view, map.get(T.lookTableData), little, ltDims[0] * ltDims[1] * ltDims[2] * 3, 'ProfileLookTableData', unread),
        data2: null,
        srgbValue: num(view, map.get(T.lookTableEncoding), little) === 1,
      }
    : null;

  let toneCurve: [number, number][] | null = null;
  const tc = map.get(T.toneCurve);
  if (tc) {
    const v = nums(view, tc, little);
    if (finite(v) && v.length >= 4 && v.length % 2 === 0) {
      toneCurve = [];
      for (let i = 0; i < v.length; i += 2) toneCurve.push([v[i], v[i + 1]]);
    } else unread.push('ProfileToneCurve');
  }

  const xy = nums(view, map.get(T.asShotWhiteXY), little);
  return {
    calibrations,
    thirdIlluminant: map.has(T.illuminant3),
    analogBalance: triple(view, map.get(T.analogBalance), little),
    asShotNeutral: triple(view, map.get(T.asShotNeutral), little),
    asShotWhiteXY: finite(xy) && xy.length === 2 ? [xy[0], xy[1]] : null,
    baselineExposure: num(view, map.get(T.baselineExposure), little) ?? null,
    baselineExposureOffset: num(view, map.get(T.baselineExposureOffset), little) ?? null,
    name: text(view, map.get(T.profileName)),
    copyright: text(view, map.get(T.copyright)),
    calibrationSignature: text(view, map.get(T.profileCalibrationSignature)),
    embedPolicy: num(view, map.get(T.embedPolicy), little) ?? null,
    hueSatMap,
    lookTable,
    toneCurve,
    defaultBlackRender: num(view, map.get(T.defaultBlackRender), little) ?? null,
    gainTableMap: map.has(T.gainTableMap),
    unread,
  };
}

/** The EXIF LightSource codes a calibration names, short. */
const ILLUMINANT_NAME: Record<number, string> = {
  1: 'daylight',
  2: 'fluorescent',
  3: 'tungsten',
  4: 'flash',
  9: 'fine weather',
  10: 'cloudy',
  11: 'shade',
  17: 'A',
  18: 'B',
  19: 'C',
  20: 'D55',
  21: 'D65',
  22: 'D75',
  23: 'D50',
  24: 'studio tungsten',
};

export function illuminantName(code: number): string {
  return ILLUMINANT_NAME[code] ?? (code ? `light ${code}` : 'unknown light');
}

/** `profile "Adobe Standard" · A + D65 · forward matrices · hue/sat map 90×30×1 · look table · tone curve`. */
export function describeDngProfile(p: DngProfile | null | undefined): string {
  if (!p) return '';
  const parts: string[] = [];
  if (p.name) parts.push(`profile "${p.name}"`);
  if (p.calibrations.length) {
    parts.push(
      `${p.calibrations.length > 1 ? '' : 'matrix '}${p.calibrations.map((c) => illuminantName(c.illuminant)).join(' + ')}`,
    );
  }
  if (p.thirdIlluminant) parts.push('third illuminant');
  if (p.calibrations.some((c) => c.forwardMatrix)) parts.push('forward matrices');
  if (p.hueSatMap) parts.push(`hue/sat map ${p.hueSatMap.dims.join('×')}`);
  if (p.lookTable) parts.push(`look table ${p.lookTable.dims.join('×')}`);
  if (p.toneCurve) parts.push('tone curve');
  if (p.gainTableMap) parts.push('gain table map');
  if (p.unread.length) parts.push(`unread: ${p.unread.join(', ')}`);
  return parts.join(' · ');
}
