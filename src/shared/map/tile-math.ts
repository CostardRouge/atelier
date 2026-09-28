/**
 * The arithmetic of drawing OpenStreetMap tiles UNDER an opener — which tiles
 * a region needs, and how a Web Mercator mosaic is laid onto the openers' own
 * projection.
 *
 * The openers do not draw in Mercator: the Itinerary and Virée project with
 * an equirectangular map whose longitude is squeezed by the cosine of the mean
 * latitude (`geo.ts`, `map-plan.ts`) — honest at a country's scale and
 * trivially invertible. Both projections are CYLINDRICAL, so a longitude is a
 * column in each and only the rows disagree: Mercator stretches latitude by
 * sec φ. That is what makes the fit exact and cheap — the mosaic is re-laid
 * row by row ONCE into a raster where latitude is linear (`rowSource`), and
 * that raster maps onto any opener's projection with one affine draw. Drawn
 * straight, Western Australia's tiles would sit 15 % off its stops.
 *
 * Pure and DOM-free; `osm-tiles.ts` is the half that fetches and draws.
 */

/** A region in degrees, west to east and south to north. */
export interface GeoBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Web Mercator's own limit: the square world stops here. */
export const MERCATOR_MAX_LAT = 85.05112878;
/** A tile's side, in pixels. */
export const TILE_PX = 256;
/**
 * The longest side a background is ever drawn at — 3072 × 1728 is 21 MB of
 * bitmap, affordable on a phone, and past a 1920 delivery for an inset map.
 */
export const BASEMAP_MAX_PX = 3072;
/** The long edge a background is sized for: the deck's own (`DECK_LONG_EDGE`). */
export const BASEMAP_FOR_EDGE = 1920;

/** A longitude as a tile column at zoom `z`, fractional. */
export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

/** A latitude as a tile row at zoom `z`, fractional; clamped to Mercator's square. */
export function latToTileY(lat: number, z: number): number {
  const phi = (Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * 2 ** z;
}

export interface TilePlan {
  z: number;
  /** Inclusive tile ranges. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  count: number;
}

/**
 * The tiles a region needs to be drawn `width` × `height` pixels without
 * being enlarged: the smallest zoom whose pixels are at least as dense as the
 * raster's in both directions, then lowered until the region holds at most
 * `maxTiles` — a softer map rather than a hundred requests to a volunteer-run
 * server. Null for a region that cannot be tiled in one piece: empty, or
 * across the antimeridian.
 */
export function planTiles(
  box: GeoBox,
  width: number,
  height: number,
  { maxTiles = 64, maxZoom = 17 }: { maxTiles?: number; maxZoom?: number } = {},
): TilePlan | null {
  const lonSpan = box.east - box.west;
  const south = Math.max(-MERCATOR_MAX_LAT, box.south);
  const north = Math.min(MERCATOR_MAX_LAT, box.north);
  const latSpan = north - south;
  if (!(lonSpan > 0) || !(latSpan > 0) || !(width > 0) || !(height > 0)) return null;
  if (box.west < -180 || box.east > 180) return null;
  // Mercator's rows are thinnest where the region is nearest the equator.
  const nearest = south <= 0 && north >= 0 ? 0 : Math.min(Math.abs(south), Math.abs(north));
  const sec = 1 / Math.cos((nearest * Math.PI) / 180);
  const wantX = (width / lonSpan) * (360 / TILE_PX);
  const wantY = (height / latSpan) * (360 / TILE_PX) / sec;
  let z = Math.max(0, Math.min(maxZoom, Math.ceil(Math.log2(Math.max(wantX, wantY, 1)))));
  for (;;) {
    const n = 2 ** z;
    const x0 = Math.max(0, Math.floor(lonToTileX(box.west, z)));
    const x1 = Math.min(n - 1, Math.floor(lonToTileX(box.east, z) - 1e-9));
    const y0 = Math.max(0, Math.floor(latToTileY(north, z)));
    const y1 = Math.min(n - 1, Math.floor(latToTileY(south, z) - 1e-9));
    const count = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (count <= maxTiles || z === 0) return { z, x0, x1, y0, y1, count };
    z -= 1;
  }
}

/**
 * Where the region's columns are in the mosaic of `plan`, in mosaic pixels —
 * the same span for every row, since longitude is linear in both projections.
 */
export function columnSource(box: GeoBox, plan: TilePlan): { sx: number; sw: number } {
  const sx = (lonToTileX(box.west, plan.z) - plan.x0) * TILE_PX;
  const ex = (lonToTileX(box.east, plan.z) - plan.x0) * TILE_PX;
  return { sx, sw: ex - sx };
}

/**
 * Which mosaic rows feed row `row` of a `rows`-tall raster in which latitude
 * is linear from `north` (row 0) to `south`: the mosaic's own y of that row's
 * top and bottom edges. Mercator stretches toward the poles, so the span is
 * taller there — which is the whole correction.
 */
export function rowSource(box: GeoBox, plan: TilePlan, row: number, rows: number): { sy: number; sh: number } {
  const latAt = (r: number) => box.north - (r / rows) * (box.north - box.south);
  const top = (latToTileY(latAt(row), plan.z) - plan.y0) * TILE_PX;
  const bottom = (latToTileY(latAt(row + 1), plan.z) - plan.y0) * TILE_PX;
  return { sy: top, sh: Math.max(1e-3, bottom - top) };
}

/**
 * A region's key — what an opener names its background by, and what the shell
 * decodes it under. Rounded, so two computations of one region agree.
 */
export function basemapKey(box: GeoBox, width: number, height: number): string {
  const r = (v: number) => v.toFixed(5);
  return `osm:${r(box.west)},${r(box.south)},${r(box.east)},${r(box.north)}@${Math.round(width)}x${Math.round(height)}`;
}

/**
 * The raster's size for a region that must be drawn `need` pixels along its
 * longer side: the region's own shape in the openers' projection (longitude
 * squeezed by the cosine of the mean latitude), capped at `cap`.
 */
export function rasterSize(box: GeoBox, need: number, cap: number): { width: number; height: number } {
  const k = Math.cos((((box.north + box.south) / 2) * Math.PI) / 180);
  const w = Math.max(1e-9, (box.east - box.west) * k);
  const h = Math.max(1e-9, box.north - box.south);
  const long = Math.max(64, Math.min(cap, Math.round(need)));
  return w >= h
    ? { width: long, height: Math.max(16, Math.round((long * h) / w)) }
    : { width: Math.max(16, Math.round((long * w) / h)), height: long };
}
