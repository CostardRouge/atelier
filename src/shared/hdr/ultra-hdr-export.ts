/**
 * An Ultra HDR JPEG out of two delivered canvases — the SDR picture, and the
 * same picture developed `stops` darker — and the CHECK that earns the name:
 * the file is read back through `readUltraHdr`, its numbers compared with
 * the ones written, its gain map decoded by the browser as a viewer would
 * and held to the codes it was given, and the lift it puts on the base's
 * brightest pixel held to the rendition's. The export says "Ultra HDR" only
 * when all of that holds (`docs/photo-editor.md` §4.4: the claim after
 * decoding back, as the AAC priming was). Anything short leaves the plain
 * JPEG, and says why.
 *
 * The DOM half; the arithmetic is `gain-map.ts`, the container `ultra-hdr.ts`.
 */

import {
  applyGainMap,
  encodeGainMap,
  hdrRendition,
  isFlatGainMap,
  linearFromBytes,
  type GainMap,
  type LinearPicture,
} from './gain-map';
import { readUltraHdr, wrapUltraHdr } from './ultra-hdr';

/** The map at a quarter of the picture on each side — Android's own default, and a lift varies slowly. */
export const GAIN_MAP_SCALE = 4;
/** The map's own JPEG quality: a grey picture, and its ringing would be a halo. */
export const GAIN_MAP_QUALITY = 0.9;
/** How far the map's codes may stray through their own JPEG, in stops, before the file is not claimed. */
export const CHECK_TOLERANCE_STOPS = 0.1;

export interface UltraHdrResult {
  blob: Blob;
  /** True when the blob IS an Ultra HDR JPEG that read back within tolerance. */
  ultra: boolean;
  /** The lift the map holds, in stops (0 when flat). */
  headroom: number;
  /** The read-back's worst stray from the rendition, in stops, when it was checked. */
  checked: number | null;
  /** Why the plain JPEG left instead, when it did. */
  reason: string | null;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not encode this picture.'))), 'image/jpeg', quality);
  });
}

function readLinear(canvas: HTMLCanvasElement): LinearPicture {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not read the delivered picture.');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return linearFromBytes(data, canvas.width, canvas.height);
}

/** The gain map's codes drawn as a grey picture, for the JPEG encoder. */
function mapCanvas(map: GainMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.width;
  canvas.height = map.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not draw the gain map.');
  const image = ctx.createImageData(map.width, map.height);
  for (let p = 0, i = 0; p < map.codes.length; p += 1, i += 4) {
    const c = map.codes[p];
    image.data[i] = c;
    image.data[i + 1] = c;
    image.data[i + 2] = c;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** A decoded picture's bytes, through a 2D canvas. */
async function decodeBytes(blob: Blob): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not decode the file back.');
    ctx.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
  } finally {
    bitmap.close();
  }
}

/**
 * Read the written file back and measure it against what was written: the
 * base must decode at the picture's size, the `hdrgm:` numbers must come
 * back as they went in, the gain map — decoded by the browser, as a viewer
 * would — must hold the codes it was given within JPEG's rounding, and the
 * brightest pixel the decoded map lifts must reach the rendition's own peak.
 * The worst stray of the two, in stops. Not a pixel-for-pixel comparison
 * with the rendition: a map at a quarter of the picture softens the edge of
 * a clipped region by construction, and that softness is the format's, not
 * a fault of the file.
 */
export async function checkUltraHdr(bytes: Uint8Array, map: GainMap, hdr: LinearPicture): Promise<number | null> {
  const { width, height } = hdr;
  const parts = readUltraHdr(bytes);
  if (!parts) return null;
  const meta = parts.meta;
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  if (
    !same(meta.gainMapMin, map.meta.gainMapMin) ||
    !same(meta.gainMapMax, map.meta.gainMapMax) ||
    !same(meta.gamma, map.meta.gamma) ||
    !same(meta.hdrCapacityMax, map.meta.hdrCapacityMax)
  ) {
    return null;
  }
  const base = await decodeBytes(new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
  if (base.width !== width || base.height !== height) return null;
  const decoded = await decodeBytes(new Blob([parts.gainMap as BlobPart], { type: 'image/jpeg' }));
  if (decoded.width !== map.width || decoded.height !== map.height) return null;
  let worst = 0;
  for (let p = 0, i = 0; p < map.codes.length; p += 1, i += 4) {
    const stray = Math.abs(decoded.data[i] - map.codes[p]);
    if (stray > worst) worst = stray;
  }
  // A code is a share of the map's span; the span is in stops.
  const codeStray = (worst * (meta.gainMapMax - meta.gainMapMin)) / 255;
  // The lift a viewer applies, once the numbers hold: the decoded map on the
  // decoded base must bring its brightest pixel where the rendition's is,
  // or the map says one thing and the pixels another.
  const codes = new Uint8ClampedArray(map.width * map.height);
  for (let p = 0, i = 0; p < codes.length; p += 1, i += 4) codes[p] = decoded.data[i];
  const lifted = applyGainMap(linearFromBytes(base.data, width, height), { ...map, codes, meta }, meta.hdrCapacityMax);
  let peakHave = 0;
  let peakWant = 0;
  for (let i = 0; i < lifted.data.length; i += 3) {
    const have = 0.2126 * lifted.data[i] + 0.7152 * lifted.data[i + 1] + 0.0722 * lifted.data[i + 2];
    const want = 0.2126 * hdr.data[i] + 0.7152 * hdr.data[i + 1] + 0.0722 * hdr.data[i + 2];
    if (have > peakHave) peakHave = have;
    if (want > peakWant) peakWant = want;
  }
  const peakStray = Math.abs(Math.log2((peakHave + 1 / 64) / (peakWant + 1 / 64)));
  return Math.max(codeStray, peakStray);
}

/**
 * The file. `sdr` and `darker` are the two delivered canvases at the same
 * size; `stops` is how much darker the second was developed. The plain
 * JPEG of `sdr` is what leaves when the map would be flat (the picture had
 * nothing above white) or when the read-back does not hold.
 */
export async function encodeUltraHdr(
  sdr: HTMLCanvasElement,
  darker: HTMLCanvasElement,
  stops: number,
  quality: number,
): Promise<UltraHdrResult> {
  const sdrJpeg = await toBlob(sdr, quality);
  const sdrLin = readLinear(sdr);
  const hdr = hdrRendition(sdrLin, readLinear(darker), stops);
  const map = encodeGainMap(sdrLin, hdr, { scale: GAIN_MAP_SCALE, maxStops: stops });
  if (isFlatGainMap(map)) {
    return { blob: sdrJpeg, ultra: false, headroom: map.headroom, checked: null, reason: 'nothing above white in this picture' };
  }
  const mapJpeg = await toBlob(mapCanvas(map), GAIN_MAP_QUALITY);
  const bytes = wrapUltraHdr(
    new Uint8Array(await sdrJpeg.arrayBuffer()),
    new Uint8Array(await mapJpeg.arrayBuffer()),
    map.meta,
  );
  let checked: number | null = null;
  try {
    checked = await checkUltraHdr(bytes, map, hdr);
  } catch {
    checked = null;
  }
  if (checked === null || checked > CHECK_TOLERANCE_STOPS) {
    return {
      blob: sdrJpeg,
      ultra: false,
      headroom: map.headroom,
      checked,
      reason:
        checked === null
          ? 'the Ultra HDR file could not be read back, so the plain JPEG left'
          : `the gain map read back ${checked.toFixed(2)} stops off, so the plain JPEG left`,
    };
  }
  return {
    blob: new Blob([bytes as BlobPart], { type: 'image/jpeg' }),
    ultra: true,
    headroom: map.headroom,
    checked,
    reason: null,
  };
}
