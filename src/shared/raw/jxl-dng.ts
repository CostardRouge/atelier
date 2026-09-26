/**
 * A ProRAW-style DNG — LinearRaw, JPEG XL tiles — decoded ONE TILE AT A TIME
 * into the plane `raw-decoder.ts` converts, never through LibRaw, which cannot
 * read JPEG XL (`linear-dng.ts` for the arithmetic and what it leaves out).
 *
 * What this thread holds at any moment: the output (the region asked, at the
 * size asked — box sums or LibRaw-style 16-bit codes) and ONE tile's bytes,
 * its PNG and its samples. A tile outside the region is never read: a loupe on
 * a phone decodes the few tiles under the view and nothing else, which is the
 * tile decode a small memory needs, handed over by the format itself.
 */

import { parseExif } from '../exif/exif-parser';
import { yieldToMain } from '../lib/yield-to-main';
import type { TaskHandle } from '../tasks/tasks';
import {
  codeTable,
  developTile,
  linearDngColor,
  orientedSize,
  storedRect,
  type LinearDng,
  type LinearDngColor,
  type PixelRect,
} from './linear-dng';
import { linearToBt709, type LinearRgb } from './raw-image';

export interface JxlDngPlane {
  /** The shown frame's size at full density. */
  frame: { width: number; height: number };
  /** The rectangle decoded, in the shown frame's pixels, snapped to the box grid. */
  region: PixelRect;
  factor: number;
  width: number;
  height: number;
  /** Whole density: LibRaw's 16-bit BT.709 codes. */
  rgb16: Uint16Array | null;
  /** Box-averaged: linear light. */
  linear: LinearRgb | null;
  color: LinearDngColor;
  tiles: number;
  exif: { iso: number | null; shutter: number | null; aperture: number | null; focal: number | null };
}

export interface JxlDngRequest {
  /** A rectangle of the shown frame at full density, or null for the whole. */
  region: PixelRect | null;
  /** The box factor, from the caller's options (`boxFactorFor` over the region). */
  factorFor: (width: number, height: number) => number;
  signal: AbortSignal;
  cancelled: () => DOMException;
  task: TaskHandle | null;
}

let codes: Uint16Array | null = null;

const positive = (v: number | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** Decode `info`'s tiles covering the request into one plane. */
export async function decodeJxlDngPlane(file: File, head: ArrayBuffer, info: LinearDng, req: JxlDngRequest): Promise<JxlDngPlane> {
  const { decodeJxlTile, jxlPoolSize } = await import('../media/jxl-pool');
  const frame = orientedSize(info.width, info.height, info.orientation);
  const asked = req.region ?? { x: 0, y: 0, w: frame.width, h: frame.height };
  const clipped = {
    x: Math.max(0, Math.floor(asked.x)),
    y: Math.max(0, Math.floor(asked.y)),
    w: 0,
    h: 0,
  };
  clipped.w = Math.min(frame.width, Math.ceil(asked.x + asked.w)) - clipped.x;
  clipped.h = Math.min(frame.height, Math.ceil(asked.y + asked.h)) - clipped.y;
  if (clipped.w <= 0 || clipped.h <= 0) throw new Error(`The region asked of ${file.name} is off the picture.`);
  const factor = Math.max(1, req.factorFor(clipped.w, clipped.h));
  // Snap to the box grid, so a region's cells are the whole frame's cells.
  const region = {
    x: Math.floor(clipped.x / factor) * factor,
    y: Math.floor(clipped.y / factor) * factor,
    w: 0,
    h: 0,
  };
  region.w = clipped.x + clipped.w - region.x;
  region.h = clipped.y + clipped.h - region.y;
  const width = factor === 1 ? region.w : Math.floor(region.w / factor);
  const height = factor === 1 ? region.h : Math.floor(region.h / factor);
  if (width <= 0 || height <= 0) throw new Error(`The region asked of ${file.name} is smaller than one pixel at this size.`);

  const color = linearDngColor(info);
  const rgb16 = factor === 1 ? new Uint16Array(width * height * 3) : null;
  const sums = factor === 1 ? null : new Float32Array(width * height * 3);
  codes ??= codeTable(linearToBt709);
  const target = rgb16 ? ({ kind: 'codes', rgb16, codeOf: codes } as const) : ({ kind: 'sums', sums: sums!, factor } as const);
  const spec = { info, color, region, outWidth: width, outHeight: height };

  // Only the tiles under the region's stored rectangle.
  const stored = storedRect(region, info.width, info.height, info.orientation);
  const col0 = Math.floor(stored.x / info.tileWidth);
  const col1 = Math.floor((stored.x + stored.w - 1) / info.tileWidth);
  const row0 = Math.floor(stored.y / info.tileLength);
  const row1 = Math.floor((stored.y + stored.h - 1) / info.tileLength);
  const cells: { row: number; col: number }[] = [];
  for (let row = row0; row <= row1; row += 1) for (let col = col0; col <= col1; col += 1) cells.push({ row, col });
  const total = cells.length;
  // A window of tiles decoding on the pool's workers at once, developed in
  // order as they land: the samples in flight are never more than the window.
  const ahead = jxlPoolSize();
  const decoding: Promise<Awaited<ReturnType<typeof decodeJxlTile>>>[] = [];
  const start = (k: number) => {
    const { row, col } = cells[k];
    const index = row * info.across + col;
    const { offset, length } = info.tiles[index];
    decoding[k] = (async () => {
      if (offset + length > file.size) throw new Error(`${file.name} is shorter than its tile table says.`);
      const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
      try {
        return await decodeJxlTile(bytes);
      } catch (err) {
        throw new Error(`The JPEG XL tile ${index + 1} of ${file.name} did not decode: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    // Awaited below in order; a rejection before then is not unhandled.
    decoding[k].catch(() => {});
  };
  for (let k = 0; k < Math.min(ahead, total); k += 1) start(k);
  for (let k = 0; k < total; k += 1) {
    if (req.signal.aborted) throw req.cancelled();
    req.task?.update({ progress: k / total, detail: total > 1 ? `tile ${k + 1} of ${total}` : 'the sensor’s data' });
    const decoded = await decoding[k];
    delete decoding[k];
    if (k + ahead < total) start(k + ahead);
    if (req.signal.aborted) throw req.cancelled();
    if (decoded.channels !== 3) throw new Error(`${file.name}'s tiles hold ${decoded.channels} channel(s), not three.`);
    const { row, col } = cells[k];
    const x0 = col * info.tileWidth;
    const y0 = row * info.tileLength;
    developTile(
      {
        samples: decoded.bitDepth === 16 ? decoded.data : widen(decoded.data),
        channels: 3,
        tileWidth: decoded.width,
        x0,
        y0,
        validWidth: Math.min(decoded.width, info.width - x0),
        validHeight: Math.min(decoded.height, info.height - y0),
      },
      spec,
      target,
    );
    await yieldToMain();
  }
  req.task?.update({ progress: null, detail: 'the sensor’s data' });

  let linear: LinearRgb | null = null;
  if (sums) {
    const inv = 1 / (factor * factor);
    for (let i = 0; i < sums.length; i += 1) sums[i] *= inv;
    linear = { width, height, data: sums };
  }
  let exif: ReturnType<typeof parseExif> | null = null;
  try {
    exif = parseExif(head);
  } catch {
    exif = null;
  }
  return {
    frame,
    region,
    factor,
    width,
    height,
    rgb16,
    linear,
    color,
    tiles: total,
    exif: {
      iso: positive(exif?.iso),
      shutter: positive(exif?.exposureTime),
      aperture: positive(exif?.fNumber),
      focal: positive(exif?.focalLength),
    },
  };
}

/** Eight-bit samples brought to the sixteen-bit scale `developTile` reads. */
function widen(data: Uint16Array): Uint16Array {
  const out = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i += 1) out[i] = data[i] * 257;
  return out;
}
