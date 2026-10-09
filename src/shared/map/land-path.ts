/**
 * The shipped coastline (`land.ts`) as an SVG path in a small projected field
 * — what Trips' picking mini-maps draw under their stops, so a field is not a
 * black box with a grid (his report, 2026-10-09). Offline: the file is the
 * one the big map and the overview's map already read from our own origin.
 *
 * Only the rings whose box meets the field are projected, and a point within
 * `minStep` field units of the last one kept is skipped: a 320-unit field
 * does not need the 1:50m coast's every vertex.
 */

import type { LandCollection } from './land';

export interface LatLonPoint {
  lat: number;
  lon: number;
}

interface Ring {
  points: [number, number][];
  west: number;
  east: number;
  south: number;
  north: number;
}

const rings = new WeakMap<LandCollection, Ring[]>();

function ringsOf(land: LandCollection): Ring[] {
  const known = rings.get(land);
  if (known) return known;
  const out: Ring[] = [];
  for (const feature of land.features) {
    for (const polygon of feature.geometry.coordinates) {
      for (const points of polygon) {
        let west = Infinity;
        let east = -Infinity;
        let south = Infinity;
        let north = -Infinity;
        for (const [lon, lat] of points) {
          if (lon < west) west = lon;
          if (lon > east) east = lon;
          if (lat < south) south = lat;
          if (lat > north) north = lat;
        }
        out.push({ points, west, east, south, north });
      }
    }
  }
  rings.set(land, out);
  return out;
}

/**
 * The land inside a field of `width`×`height`, as one even-odd path. `window`
 * is the field's extent in degrees (its corners unprojected), a little
 * margin added so a coast crossing the edge is drawn to it.
 */
export function landPath(
  land: LandCollection,
  project: (p: LatLonPoint) => { x: number; y: number },
  window: { west: number; east: number; south: number; north: number },
  minStep = 0.8,
): string {
  const parts: string[] = [];
  const mx = (window.east - window.west) * 0.1;
  const my = (window.north - window.south) * 0.1;
  const w = { west: window.west - mx, east: window.east + mx, south: window.south - my, north: window.north + my };
  for (const ring of ringsOf(land)) {
    if (ring.east < w.west || ring.west > w.east || ring.north < w.south || ring.south > w.north) continue;
    let d = '';
    let lastX = NaN;
    let lastY = NaN;
    let kept = 0;
    for (const [lon, lat] of ring.points) {
      const p = project({ lat, lon });
      if (kept > 0 && Math.abs(p.x - lastX) < minStep && Math.abs(p.y - lastY) < minStep) continue;
      d += `${kept === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      lastX = p.x;
      lastY = p.y;
      kept += 1;
    }
    if (kept >= 3) parts.push(`${d}Z`);
  }
  return parts.join('');
}
