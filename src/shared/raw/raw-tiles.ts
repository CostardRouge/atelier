/**
 * Where a RAW is CUT when it is decoded in tiles — the pure half of the tile
 * path in `raw-decoder.ts`.
 *
 * LibRaw decodes a rectangle of the sensor on request (`cropbox`), and a
 * rectangle costs it the buffers of the rectangle alone: its 8-byte work
 * image and its 6-byte output, against the whole frame's — which is what
 * makes a 36-megapixel sensor decodable whole on a phone at all
 * (`device-memory.md`, «Tiles»). What it does NOT save is the file's own copy
 * and the unpacked sensor plane, both whole for every tile; and a tile costs
 * one more `open()` of the file. So a decode is cut only where its output
 * would be past a budget, into as few tiles as fit it.
 *
 * Three facts, each MEASURED on the synthetic DNG the tests describe
 * (2026-09-25, headless Chromium on libraw-wasm 1.6):
 *
 * - `cropbox` is `[left, top, width, height]` in SENSOR pixels of the visible
 *   area, before the picture is turned; LibRaw clips it to the frame and
 *   turns the tile as it turns the whole, so a tile's place in the decoded
 *   frame is the rectangle's place under the flip (`placeRect`).
 * - The demosaic reads neighbours: a tile equals the whole decode EXACTLY
 *   from 5 px inside its edge (AHD), and everywhere at the sensor's own edge.
 *   `RAW_TILE_MARGIN` is 8, and the margin rows are decoded and thrown away.
 * - With `adjustMaximumThr: 0` (the decoder's setting since the same day)
 *   nothing in LibRaw's pipeline depends on the tile's content — its default
 *   scaled each tile by its own brightest pixel — so tiles are the whole
 *   decode's bytes, to the bit.
 *
 * Tiles are HORIZONTAL BANDS of the decoded frame, full width, so the
 * conversion in `raw-image.ts` — written for rows — takes them with an
 * offset and nothing else. A camera held on its side is decoded from COLUMN
 * bands of the sensor, which LibRaw's turn lays down as rows. Interior
 * boundaries fall on multiples of the box factor and of LibRaw's half-size
 * quad, so every box of the averaged picture is summed from the same codes
 * in the same order as it would be from the whole plane.
 *
 * Pure and DOM-free; specs beside it.
 */

/**
 * LibRaw's own flip codes for the four ways a camera is held that keep the
 * pixel grid: none, a half turn, a quarter turn each way. dcraw's table over
 * the EXIF orientation is `"50132467"[orientation & 7]`; the mirrored
 * orientations (2, 4, 5, 7) give 1, 2, 4 and 7, which no camera writes and
 * which are decoded whole rather than tiled.
 */
export type TileFlip = 0 | 3 | 5 | 6;

/** LibRaw's flip for an EXIF orientation, 0 when the file says nothing. */
export function librawFlip(orientation: number | null | undefined): number {
  if (!orientation || orientation < 1 || orientation > 8) return 0;
  return Number('50132467'[orientation & 7]);
}

export function isTileFlip(flip: number): flip is TileFlip {
  return flip === 0 || flip === 3 || flip === 5 || flip === 6;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A tile flip that transposes the frame — a quarter turn. */
export function transposes(flip: TileFlip): boolean {
  return flip === 5 || flip === 6;
}

/**
 * Where a rectangle of the SENSOR (visible area, before the turn, `width` ×
 * `height`) lands in LibRaw's decoded frame at the same resolution. Measured
 * against LibRaw's output for each flip: a marker rectangle decoded alone
 * and matched inside the whole decode — 0 codes at the placement below,
 * thousands at every other.
 */
export function placeRect(rect: Rect, width: number, height: number, flip: TileFlip): Rect {
  switch (flip) {
    case 0:
      return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    case 3:
      return { x: width - rect.x - rect.w, y: height - rect.y - rect.h, w: rect.w, h: rect.h };
    case 6:
      // A quarter turn clockwise: the sensor's top edge becomes the right edge.
      return { x: height - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w };
    case 5:
      // Counter-clockwise: the sensor's top edge becomes the left edge.
      return { x: rect.y, y: width - rect.x - rect.w, w: rect.h, h: rect.w };
  }
}

/** The inverse of `placeRect`: a rectangle of the decoded frame back on the sensor. */
export function unplaceRect(rect: Rect, width: number, height: number, flip: TileFlip): Rect {
  switch (flip) {
    case 0:
      return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    case 3:
      return { x: width - rect.x - rect.w, y: height - rect.y - rect.h, w: rect.w, h: rect.h };
    case 6:
      return { x: rect.y, y: height - rect.x - rect.w, w: rect.h, h: rect.w };
    case 5:
      return { x: width - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w };
  }
}

/** The decoded frame's size at sensor resolution: the axes swapped by a quarter turn. */
export function decodedFrame(width: number, height: number, flip: TileFlip): { width: number; height: number } {
  return transposes(flip) ? { width: height, height: width } : { width, height };
}

/** LibRaw's half-size output for `n` pixels on one edge — `(n + 1) >> 1`, measured. */
export function halfEdge(n: number): number {
  return (n + 1) >> 1;
}

/** Sensor pixels each side of a tile decoded and discarded — past the 5 px the demosaic reads. */
export const RAW_TILE_MARGIN = 8;

export interface RawTile {
  /** LibRaw's `cropbox`: `[left, top, width, height]` in sensor pixels, margins included, inside the frame. */
  crop: [number, number, number, number];
  /** The plane rows this tile's INTERIOR fills in the decoded frame at the decode's own shrink: `[from, to)`. */
  rows: { from: number; to: number };
  /** Plane rows of the tile's own output above the interior — the margin, once LibRaw has turned the tile. */
  skip: number;
  /** Plane columns of the tile's own output left of the interior — a region's side margin; 0 for a full-width band. */
  skipX: number;
  /** The size LibRaw must hand back for this tile at the decode's shrink; any other answer is a plan that does not hold. */
  size: { width: number; height: number };
}

export interface TilePlanOptions {
  /** The sensor's visible size, before the turn. */
  width: number;
  height: number;
  flip: TileFlip;
  /** LibRaw's half-size decode (`-h`): every edge halved, a 2×2 quad per output pixel. */
  halved: boolean;
  /** The integer box factor the plane is then averaged by (`rawBoxFactor`); interior boundaries fall on its multiples. */
  factor: number;
  /** The most OUTPUT pixels one tile may hold, margins included — LibRaw's own buffers cost 14 bytes each. */
  tilePixels: number;
  /** A rectangle of the DECODED frame, at sensor resolution, to decode alone; the whole frame when absent. */
  region?: Rect | null;
  margin?: number;
}

export interface TilePlan {
  tiles: RawTile[];
  /** The decoded plane's size at the decode's shrink — the whole frame's, or the region's. */
  plane: { width: number; height: number };
  /** Where the plane sits in the whole decoded frame at the decode's shrink, for a region; the origin otherwise. */
  origin: { x: number; y: number };
}

/**
 * The tiles a decode is cut into, or null when one `open()` of the whole
 * frame is the answer — the output within the budget and no region asked.
 *
 * Also null where a cut cannot be exact: a half-size decode of a frame whose
 * boundaries would fall on odd sensor columns or rows (an odd-sized sensor
 * turned the wrong way — LibRaw's quads would straddle the cut).
 */
export function planRawTiles(o: TilePlanOptions): TilePlan | null {
  const { width, height, flip, halved, tilePixels } = o;
  if (!(width > 0) || !(height > 0)) return null;
  const factor = Math.max(1, Math.floor(o.factor));
  const shrink = halved ? 2 : 1;
  const frame = decodedFrame(width, height, flip);
  const region = o.region ? clipRect(o.region, frame.width, frame.height) : null;
  if (o.region && (!region || region.w <= 0 || region.h <= 0)) return null;
  // The region's own edges must sit on the grid a tile boundary needs.
  const grid = shrink * factor;
  const area = region
    ? { x: floorTo(region.x, grid), y: floorTo(region.y, grid), w: 0, h: 0 }
    : { x: 0, y: 0, w: frame.width, h: frame.height };
  if (region) {
    area.w = Math.min(frame.width, ceilTo(region.x + region.w, grid)) - area.x;
    area.h = Math.min(frame.height, ceilTo(region.y + region.h, grid)) - area.y;
  }
  // The plane this decode writes: the area at the decode's shrink.
  const plane = { width: halved ? halfEdge(area.w) : area.w, height: halved ? halfEdge(area.h) : area.h };
  if (plane.width <= 0 || plane.height <= 0) return null;
  const margin = Math.max(0, Math.round(o.margin ?? RAW_TILE_MARGIN));
  // The margin in plane rows, and back in frame rows on the grid the shrink needs.
  const skipRows = Math.ceil(margin / shrink);
  const marginOut = skipRows * shrink;
  // Interior rows per tile: what fits the budget with both margins, on the factor's grid.
  const fit = Math.floor(tilePixels / Math.max(1, plane.width)) - 2 * skipRows;
  let rowsPerTile = Math.max(factor, floorTo(fit, factor));
  if (!region && rowsPerTile >= plane.height) return null;
  if (region) rowsPerTile = Math.max(rowsPerTile, factor);
  // A half-size cut needs even boundaries on the sensor's own axis: for a
  // turned frame the bands are sensor COLUMNS and the parity is the width's.
  if (halved) {
    const axis = transposes(flip) ? width : height;
    const mirrored = flip === 3 || flip === 5;
    if (mirrored && axis % 2 !== 0) return null;
  }
  // A region has a seam on its sides too, where a full-width band has the
  // frame's own edge: it is decoded with a side margin as well.
  const xm0 = region ? Math.max(0, area.x - marginOut) : area.x;
  const xm1 = region ? Math.min(frame.width, area.x + area.w + marginOut) : area.x + area.w;
  const tiles: RawTile[] = [];
  for (let r0 = 0; r0 < plane.height; r0 += rowsPerTile) {
    const r1 = Math.min(plane.height, r0 + rowsPerTile);
    // Frame rows of the interior: the last band runs to the area's own edge.
    const y0 = area.y + r0 * shrink;
    const y1 = r1 === plane.height ? area.y + area.h : area.y + r1 * shrink;
    const ym0 = Math.max(0, y0 - marginOut);
    const ym1 = Math.min(frame.height, y1 + marginOut);
    const outRect: Rect = { x: xm0, y: ym0, w: xm1 - xm0, h: ym1 - ym0 };
    const sensor = unplaceRect(outRect, width, height, flip);
    tiles.push({
      crop: [sensor.x, sensor.y, sensor.w, sensor.h],
      rows: { from: r0, to: r1 },
      skip: (y0 - ym0) / shrink,
      skipX: (area.x - xm0) / shrink,
      size: { width: halved ? halfEdge(xm1 - xm0) : xm1 - xm0, height: halved ? halfEdge(ym1 - ym0) : ym1 - ym0 },
    });
  }
  return { tiles, plane, origin: { x: area.x / shrink, y: area.y / shrink } };
}

function floorTo(n: number, grid: number): number {
  return Math.floor(n / grid) * grid;
}

function ceilTo(n: number, grid: number): number {
  return Math.ceil(n / grid) * grid;
}

function clipRect(r: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.ceil(r.x + r.w));
  const y1 = Math.min(height, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
