/**
 * The subject masks a CARRIED edit draws with (`carried-edit.ts`), asked of
 * the model once per picture and size, and held for the session.
 *
 * A host redraws a slide or a media many times — every repaint, every
 * thumbnail, every export — and a subject is an inference per point. The
 * mask is sampled in image coordinates, but it is CUT at the size of the
 * picture it was asked on, so a file is segmented at its own size rather than
 * upscaling the stage's: the key is the file the edit was made on (its
 * `from.media`, which `carriedOn` already holds to the host's picture), the
 * subjects' points and refinements, and the size asked at.
 */

import type { BrushRaster } from '../render/brush-raster';
import { carriedNeedsRasters, type CarriedEdit } from './carried-edit';
import { subjectLayersForRender } from './layer';
import { resolveSubjectRasters } from './subject-rasters';

type Rasters = ReadonlyMap<string, BrushRaster>;

const EMPTY: Rasters = new Map();
/** How many pictures' masks are held — a deck's worth at two sizes. */
const HELD = 24;
const held = new Map<string, { asked: Promise<Rasters>; value: Rasters | null }>();

/** The key the masks are held under. */
export function carriedRasterKey(edit: CarriedEdit, size: { width: number; height: number }): string {
  const { name, size: bytes, assetId, hash } = edit.from.media;
  const subjects = subjectLayersForRender(edit.values.layers).map((l) => [l.id, l.mask]);
  return JSON.stringify([name, bytes, assetId ?? '', hash ?? '', Math.round(size.width), Math.round(size.height), subjects]);
}

/**
 * The masks, or an empty map at once when the edit needs none. A model that
 * will not load leaves a layer out of the map, so it draws nothing — the
 * export's own rule (`subject-rasters.ts`).
 */
export function carriedRasters(
  edit: CarriedEdit | null | undefined,
  image: () => TexImageSource,
  size: { width: number; height: number },
): Promise<Rasters> {
  if (!edit || !carriedNeedsRasters(edit)) return Promise.resolve(EMPTY);
  const key = carriedRasterKey(edit, size);
  const hit = held.get(key);
  if (hit) {
    // Least recently used goes first.
    held.delete(key);
    held.set(key, hit);
    return hit.asked;
  }
  const entry: { asked: Promise<Rasters>; value: Rasters | null } = { asked: Promise.resolve(EMPTY), value: null };
  entry.asked = resolveSubjectRasters(edit.values.layers, image())
    .catch(() => new Map<string, BrushRaster>())
    .then((value) => {
      entry.value = value;
      return value;
    });
  held.set(key, entry);
  while (held.size > HELD) held.delete(held.keys().next().value as string);
  return entry.asked;
}

/**
 * The masks when they are already in — what a synchronous paint can use —, an
 * empty map when the edit needs none, null while they are still being asked.
 */
export function heldCarriedRasters(
  edit: CarriedEdit | null | undefined,
  size: { width: number; height: number },
): Rasters | null {
  if (!edit || !carriedNeedsRasters(edit)) return EMPTY;
  return held.get(carriedRasterKey(edit, size))?.value ?? null;
}
