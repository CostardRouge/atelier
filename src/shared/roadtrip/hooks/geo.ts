/**
 * The geography the map-like openers share — a projection that fits located
 * places into a box, the great-circle distance, its formatting, and the
 * placement of names beside dots.
 *
 * Grown in the route trace, lifted out the day the drive reached for the
 * same four things; `route-plan.ts` re-exports the old names so its stored
 * options and its tests never moved. A variant importing its sibling's plan
 * would be the "tool reaches into another tool" fault at a smaller scale.
 *
 * Pure and DOM-free. The projection is equirectangular with the longitude
 * scaled by the cosine of the mean latitude — honest at the scale of a
 * country, and it needs no map. North is up, always.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DistanceUnit = 'off' | 'km' | 'mi';

/**
 * A projection that fits every point inside `box`, aspect kept and centred.
 * North is up. A set of one spot (or none) sits in the middle.
 */
export function fitProjection<P extends GeoPoint>(
  points: readonly P[],
  box: Box,
): (point: GeoPoint) => { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (points.length === 0) return () => ({ x: cx, y: cy });

  const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  const px = (p: GeoPoint) => p.lon * k;
  const py = (p: GeoPoint) => -p.lat;

  const xs = points.map(px);
  const ys = points.map(py);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX < 1e-9 && spanY < 1e-9) return () => ({ x: cx, y: cy });

  const scale = Math.min(
    spanX > 1e-9 ? box.width / spanX : Infinity,
    spanY > 1e-9 ? box.height / spanY : Infinity,
  );
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return (p) => ({ x: cx + (px(p) - midX) * scale, y: cy + (py(p) - midY) * scale });
}

/**
 * The same projection, but with its scale and centre exposed — what a camera
 * that follows something needs, since it re-centres the view without
 * changing the scale. `scale` is pixels per degree of latitude; the
 * longitude is squeezed by `k`. A set of one spot (or none) has no scale of
 * its own and takes `fallbackScale`.
 */
export interface Projection {
  /** Pixels per degree of latitude. */
  scale: number;
  /** The longitude's squeeze at the mean latitude. */
  k: number;
  /** The points' middle, in projected (pre-scale) units. */
  midX: number;
  midY: number;
  /** Project a point about a chosen screen centre. */
  at(point: GeoPoint, cx: number, cy: number): { x: number; y: number };
}

export function projectionFor<P extends GeoPoint>(
  points: readonly P[],
  width: number,
  height: number,
  fallbackScale = 1,
): Projection {
  const meanLat = points.length ? points.reduce((sum, p) => sum + p.lat, 0) / points.length : 0;
  const k = Math.cos((meanLat * Math.PI) / 180);
  const xs = points.map((p) => p.lon * k);
  const ys = points.map((p) => -p.lat);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const fits = Math.min(
    spanX > 1e-9 ? width / spanX : Infinity,
    spanY > 1e-9 ? height / spanY : Infinity,
  );
  const scale = Number.isFinite(fits) ? fits : fallbackScale;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return {
    scale,
    k,
    midX,
    midY,
    at: (p, cx, cy) => ({ x: cx + (p.lon * k - midX) * scale, y: cy + (-p.lat - midY) * scale }),
  };
}

/** Great-circle distance between two located places, in kilometres. */
export function haversineKm<P extends GeoPoint>(a: P, b: P): number {
  const R = 6371.0088;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** "1 240 km" / "770 mi" — a space in the thousands, one decimal under ten. */
export function formatDistance(km: number, unit: DistanceUnit): string {
  if (unit === 'off') return '';
  const value = unit === 'mi' ? km * 0.621371 : km;
  const text =
    value < 10
      ? value.toFixed(1)
      : Math.round(value)
          .toString()
          .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${text} ${unit}`;
}

export interface PlacedLabel {
  /** Index into the points handed in. */
  index: number;
  x: number;
  y: number;
  align: 'left' | 'right' | 'center';
  /** Which side of the dot the text sits on. */
  side: 'right' | 'left' | 'above' | 'below';
}

/**
 * Where each wanted label goes, and which are left out. Labels are placed in
 * order, each tried to the right of its dot, then the left, above, below; one
 * that would overlap a label already placed, a box the caller reserved, or
 * leave the frame is DROPPED — a name over another name says neither. The
 * paint measures text with its own font; without a measure, width is
 * estimated from the font size (an average glyph is ~0.55 em wide in the
 * suite's faces), so this stays pure.
 */
export function placeLabels(
  points: readonly { x: number; y: number; name: string; wanted: boolean }[],
  fontPx: number,
  frame: { width: number; height: number },
  dotRadius: number,
  measure: (name: string) => number = (name) => Math.max(1, name.length) * fontPx * 0.55,
  reserved: readonly { x0: number; y0: number; x1: number; y1: number }[] = [],
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const boxes = [...reserved];
  const gap = dotRadius + fontPx * 0.45;
  const lineH = fontPx * 1.2;
  const overlaps = (b: { x0: number; y0: number; x1: number; y1: number }) =>
    b.x0 < 0 ||
    b.y0 < 0 ||
    b.x1 > frame.width ||
    b.y1 > frame.height ||
    boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);

  points.forEach((p, index) => {
    if (!p.wanted || !p.name.trim()) return;
    const w = measure(p.name.trim());
    const tries: PlacedLabel[] = [
      { index, x: p.x + gap, y: p.y, align: 'left', side: 'right' },
      { index, x: p.x - gap, y: p.y, align: 'right', side: 'left' },
      { index, x: p.x, y: p.y - gap - lineH * 0.35, align: 'center', side: 'above' },
      { index, x: p.x, y: p.y + gap + lineH * 0.35, align: 'center', side: 'below' },
    ];
    for (const t of tries) {
      const x0 = t.align === 'left' ? t.x : t.align === 'right' ? t.x - w : t.x - w / 2;
      const box = { x0, y0: t.y - lineH / 2, x1: x0 + w, y1: t.y + lineH / 2 };
      if (overlaps(box)) continue;
      boxes.push(box);
      placed.push(t);
      return;
    }
  });
  return placed;
}
