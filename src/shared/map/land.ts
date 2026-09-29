/**
 * The world's land, as the Trips overview's map draws it — the pure half of
 * `public/geo/land.json` (`load-land.ts` fetches it).
 *
 * The file is Natural Earth's 1:50m land in a compact form of our own
 * (`scripts/gen-coastline.mjs`): every coordinate an integer of 1/`scale`
 * degree, every ring a flat run whose first pair is absolute and the rest
 * DELTAS. A coast moves a few hundredths of a degree per point, so a delta is
 * two or three digits where an absolute is seven — a third of the GeoJSON's
 * weight. This turns it back into the GeoJSON MapLibre takes.
 *
 * Rings are already FLAT (unwrapped across the antimeridian, a ring round a
 * pole closed through it) and on the world the camera opens on, so nothing
 * here has to know about the sphere.
 */

/** The file as it ships. */
export interface LandFile {
  attribution: string;
  /** Units per degree. */
  scale: number;
  /** Polygons → rings → a flat run: x0, y0, then dx, dy per point. */
  polygons: number[][][];
}

export interface LandCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'MultiPolygon'; coordinates: [number, number][][][] };
  }[];
}

/** One ring back to degrees. A run of odd length, or shorter than a triangle, is refused. */
export function decodeRing(run: readonly number[], scale: number): [number, number][] | null {
  if (run.length % 2 !== 0 || run.length < 8) return null;
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < run.length; i += 2) {
    x += run[i];
    y += run[i + 1];
    out.push([x / scale, y / scale]);
  }
  return out;
}

/**
 * The file as ONE MultiPolygon feature — one fill layer, one source, and the
 * map's worker tiles it once. Anything malformed is left out rather than
 * thrown: a missing island is a smaller fault than a map that does not draw.
 */
export function parseLand(value: unknown): LandCollection {
  const file = value as Partial<LandFile> | null;
  const scale = typeof file?.scale === 'number' && file.scale > 0 ? file.scale : 0;
  const coordinates: [number, number][][][] = [];
  if (scale && Array.isArray(file?.polygons)) {
    for (const polygon of file.polygons) {
      if (!Array.isArray(polygon)) continue;
      const rings: [number, number][][] = [];
      for (const run of polygon) {
        if (!Array.isArray(run) || !run.every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
        const ring = decodeRing(run, scale);
        if (ring) rings.push(ring);
      }
      if (rings.length) coordinates.push(rings);
    }
  }
  return {
    type: 'FeatureCollection',
    features: coordinates.length
      ? [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates } }]
      : [],
  };
}
