/**
 * The pictures an author picked for an opener, as they are stored in its
 * options — read defensively, and ordered the way they were shot.
 *
 * Grown in Défilé, lifted out when the drive wanted the same list with one
 * more thing on it: the POSITION a picture was shot at, so a geotagged
 * picture can be a stop on a map. Défilé re-exports the old names and
 * ignores the position. Pure and DOM-free.
 */

import { hookPictureKey, type HookPickedPicture } from './hook-variant';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A stored position, or null: two finite numbers inside the globe's bounds. */
export function readCoords(raw: unknown): { lat: number; lon: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { lat, lon } = raw as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * A stored picked list, read defensively: an entry with no readable ref or
 * day is dropped, a second entry for the same picture is dropped, a position
 * that is not two finite numbers is dropped. What a newer build wrote beside
 * the known keys is left behind, not trusted.
 */
export function readPicked(raw: unknown): HookPickedPicture[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: HookPickedPicture[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { ref, date, takenAt, coords } = item as Record<string, unknown>;
    if (typeof date !== 'string' || !ISO_DAY.test(date)) continue;
    if (!ref || typeof ref !== 'object') continue;
    const r = ref as Record<string, unknown>;
    if (typeof r.name !== 'string' || !r.name) continue;
    const clean = {
      name: r.name,
      size: Number.isFinite(r.size) ? Number(r.size) : 0,
      lastModified: Number.isFinite(r.lastModified) ? Number(r.lastModified) : 0,
      ...(typeof r.assetId === 'string' && r.assetId ? { assetId: r.assetId } : {}),
      ...(typeof r.hash === 'string' && r.hash ? { hash: r.hash } : {}),
    };
    const key = hookPictureKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    const position = readCoords(coords);
    out.push({
      ref: clean,
      date,
      ...(typeof takenAt === 'number' && Number.isFinite(takenAt) ? { takenAt } : {}),
      ...(position ? { coords: position } : {}),
    });
  }
  return out;
}

/** Picked pictures in the order they were shot: day, then instant, then name. */
export function sortPicked(picked: readonly HookPickedPicture[]): HookPickedPicture[] {
  return [...picked].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.takenAt ?? Number.MAX_SAFE_INTEGER) - (b.takenAt ?? Number.MAX_SAFE_INTEGER) ||
      a.ref.name.localeCompare(b.ref.name),
  );
}
