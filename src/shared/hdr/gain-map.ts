/**
 * A GAIN MAP — how much brighter an HDR rendition of a picture is than its
 * SDR one, per pixel, as a log2 ratio — and the two directions of it: made
 * from the two renditions, and applied back to the SDR one at a display's
 * headroom. The arithmetic of ISO 21496-1 / Adobe's gain-map spec, which is
 * what Ultra HDR JPEG carries (`ultra-hdr.ts` is the container).
 *
 * Why a gain map at all (`docs/photo-editor.md` §4.4): a JPEG is 8-bit SDR,
 * every browser draws one, and an HDR display cannot be reached by a browser's
 * canvas today. A gain map rides INSIDE the JPEG as a second, small image:
 * a viewer that knows it lifts the highlights on a display that can, and
 * everything else shows the base. Nothing is fabricated for the second
 * rendition — it is the picture rendered with more headroom, and where the
 * two agree the map is flat.
 *
 * Pure and DOM-free; every function here has a spec beside it.
 */

import { toLinear } from '../lut/transfer';

/** What a decoder needs to apply the map — the `hdrgm:` XMP fields, one value each (all channels alike). */
export interface GainMapMeta {
  /** log2 of the smallest gain the map encodes (code 0). */
  gainMapMin: number;
  /** log2 of the largest gain (code 255). */
  gainMapMax: number;
  /** The encoding's gamma: code = ((gain − min) / (max − min))^(1/gamma). */
  gamma: number;
  /** Added to the SDR value before the ratio, so a black is not a division by zero. */
  offsetSdr: number;
  offsetHdr: number;
  /** log2 of the display headroom below which the map is not applied at all. */
  hdrCapacityMin: number;
  /** log2 of the display headroom at which the map is applied whole. */
  hdrCapacityMax: number;
}

export interface LinearPicture {
  width: number;
  height: number;
  /** Linear light, RGB, top row first; ≥ 0 and unbounded above. */
  data: Float32Array;
}

/** A gain map, ready to be encoded as a grey JPEG. */
export interface GainMap {
  width: number;
  height: number;
  /** One code per pixel. */
  codes: Uint8ClampedArray;
  meta: GainMapMeta;
  /** The largest lift the map holds, in stops — 0 where the two renditions agree everywhere. */
  headroom: number;
}

/** Android's default: 1/64, added to both sides of the ratio. */
export const GAIN_MAP_OFFSET = 1 / 64;
export const GAIN_MAP_GAMMA = 1;
/** The most a map is allowed to say, in stops; a RAW rarely keeps more than four above its white. */
export const MAX_GAIN_STOPS = 4;
/** Below this the map says nothing a viewer could show: the file is then a plain JPEG, and said. */
export const FLAT_GAIN_STOPS = 0.05;

const LUM_R = 0.2126;
const LUM_G = 0.7152;
const LUM_B = 0.0722;

function luminance(data: Float32Array, i: number): number {
  return LUM_R * data[i] + LUM_G * data[i + 1] + LUM_B * data[i + 2];
}

/**
 * 8-bit sRGB bytes (an `ImageData`'s RGBA) → linear light. Through a
 * 256-entry table: the export reads whole pictures, and a `pow` per byte is
 * seconds on a large one.
 */
export function linearFromBytes(bytes: Uint8ClampedArray, width: number, height: number): LinearPicture {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) table[i] = toLinear(i / 255, 'srgb');
  const n = width * height;
  const data = new Float32Array(n * 3);
  for (let p = 0, s = 0, d = 0; p < n; p += 1, s += 4, d += 3) {
    data[d] = table[bytes[s]];
    data[d + 1] = table[bytes[s + 1]];
    data[d + 2] = table[bytes[s + 2]];
  }
  return { width, height, data };
}

/**
 * The HDR rendition from the two renders the export makes: the SDR one, and
 * the same picture developed `stops` darker then lifted back by `2^stops` in
 * light. Where the SDR had room the two agree and the SDR wins (`max`, so an
 * HDR display never shows a pixel DARKER than the SDR file does); where the
 * SDR ran out at white, the darker render still holds what the sensor kept,
 * and that — lifted back — is the highlight the map will carry.
 */
export function hdrRendition(sdr: LinearPicture, darker: LinearPicture, stops: number): LinearPicture {
  if (darker.width !== sdr.width || darker.height !== sdr.height) {
    throw new Error('The two renditions must be the same size.');
  }
  const lift = Math.pow(2, stops);
  const data = new Float32Array(sdr.data.length);
  for (let i = 0; i < data.length; i += 1) {
    const back = darker.data[i] * lift;
    const base = sdr.data[i];
    data[i] = back > base ? back : base;
  }
  return { width: sdr.width, height: sdr.height, data };
}

/**
 * Box-average a single-channel map by an integer factor — a gain map is
 * commonly kept at a fraction of the picture (the decoder scales it back),
 * and a lift varies slowly except at a clipped edge, where a soft ring is
 * kinder than an aliased one.
 */
export function downscaleMap(values: Float32Array, width: number, height: number, factor: number): { width: number; height: number; values: Float32Array } {
  const f = Math.max(1, Math.floor(factor));
  if (f === 1) return { width, height, values };
  const w = Math.max(1, Math.floor(width / f));
  const h = Math.max(1, Math.floor(height / f));
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < f; dy += 1) {
        const sy = y * f + dy;
        if (sy >= height) break;
        for (let dx = 0; dx < f; dx += 1) {
          const sx = x * f + dx;
          if (sx >= width) break;
          sum += values[sy * width + sx];
          n += 1;
        }
      }
      out[y * w + x] = n ? sum / n : 0;
    }
  }
  return { width: w, height: h, values: out };
}

export interface GainMapOptions {
  /** The map's own resolution as a divisor of the picture's (4 → a quarter on each side). */
  scale?: number;
  gamma?: number;
  offset?: number;
  /** The most the map may say, in stops. */
  maxStops?: number;
}

/**
 * The map between two renditions, on LUMINANCE (one channel — the common
 * form, and the one every viewer takes). Per pixel the gain is
 * `log2((Yhdr + o) / (Ysdr + o))`; the range the picture really uses is
 * measured and becomes `gainMapMin..gainMapMax`, so the 256 codes cover the
 * lifts present rather than a fixed span. A negative gain (an HDR rendition
 * darker than the SDR) is clamped to 0: `hdrRendition` never makes one, and
 * a map that only lifts is what a viewer expects.
 */
export function encodeGainMap(sdr: LinearPicture, hdr: LinearPicture, opts: GainMapOptions = {}): GainMap {
  if (hdr.width !== sdr.width || hdr.height !== sdr.height) {
    throw new Error('The two renditions must be the same size.');
  }
  const offset = opts.offset ?? GAIN_MAP_OFFSET;
  const gamma = opts.gamma ?? GAIN_MAP_GAMMA;
  const maxStops = opts.maxStops ?? MAX_GAIN_STOPS;
  const n = sdr.width * sdr.height;
  const gains = new Float32Array(n);
  let max = 0;
  for (let p = 0, i = 0; p < n; p += 1, i += 3) {
    const ys = luminance(sdr.data, i);
    const yh = luminance(hdr.data, i);
    let g = Math.log2((yh + offset) / (ys + offset));
    if (!(g > 0)) g = 0;
    if (g > maxStops) g = maxStops;
    gains[p] = g;
    if (g > max) max = g;
  }
  const small = downscaleMap(gains, sdr.width, sdr.height, opts.scale ?? 1);
  const codes = new Uint8ClampedArray(small.width * small.height);
  const span = max > 0 ? max : 1;
  for (let p = 0; p < codes.length; p += 1) {
    const t = small.values[p] / span;
    codes[p] = Math.round(Math.pow(t < 0 ? 0 : t > 1 ? 1 : t, 1 / gamma) * 255);
  }
  return {
    width: small.width,
    height: small.height,
    codes,
    meta: {
      gainMapMin: 0,
      gainMapMax: max,
      gamma,
      offsetSdr: offset,
      offsetHdr: offset,
      hdrCapacityMin: 0,
      hdrCapacityMax: max,
    },
    headroom: max,
  };
}

/** Whether a map would change anything a viewer shows. */
export function isFlatGainMap(map: Pick<GainMap, 'headroom'>): boolean {
  return !(map.headroom > FLAT_GAIN_STOPS);
}

/**
 * The decoder's side, for the check that the file says what it was meant
 * to: the SDR rendition lifted by the map at a display of `displayStops` of
 * headroom (log2 of its peak over SDR white). The weight interpolates
 * between the two capacities exactly as a viewer does; a map at a fraction
 * of the picture is sampled nearest — a check, not a renderer.
 */
export function applyGainMap(sdr: LinearPicture, map: GainMap, displayStops: number): LinearPicture {
  const { meta } = map;
  const span = meta.hdrCapacityMax - meta.hdrCapacityMin;
  const w = span > 0 ? Math.min(1, Math.max(0, (displayStops - meta.hdrCapacityMin) / span)) : displayStops >= meta.hdrCapacityMax ? 1 : 0;
  const data = new Float32Array(sdr.data.length);
  const kx = map.width / sdr.width;
  const ky = map.height / sdr.height;
  for (let y = 0; y < sdr.height; y += 1) {
    const my = Math.min(map.height - 1, Math.floor(y * ky));
    for (let x = 0; x < sdr.width; x += 1) {
      const mx = Math.min(map.width - 1, Math.floor(x * kx));
      const code = map.codes[my * map.width + mx] / 255;
      const gain = meta.gainMapMin + (meta.gainMapMax - meta.gainMapMin) * Math.pow(code, meta.gamma);
      const lift = Math.pow(2, gain * w);
      const i = (y * sdr.width + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        const v = (sdr.data[i + c] + meta.offsetSdr) * lift - meta.offsetHdr;
        data[i + c] = v < 0 ? 0 : v;
      }
    }
  }
  return { width: sdr.width, height: sdr.height, data };
}

/** "up to 2.3 stops above white", or "flat". */
export function describeGainMap(map: Pick<GainMap, 'headroom'>): string {
  if (isFlatGainMap(map)) return 'flat — nothing above white';
  return `up to ${map.headroom.toFixed(1)} stops above white`;
}
