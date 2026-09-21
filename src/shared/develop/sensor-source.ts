/**
 * WHERE THE SENSOR'S DATA COMES FROM, for one picture — the one answer the
 * workbench and the export both need, so it is decided here once
 * (`docs/capture-renditions.md` §9, R3b).
 *
 * Four reaches, in the order they are tried:
 *
 * - **`file`** — the file in hand IS the RAW (a DNG dropped into Develop).
 * - **`sibling`** — a RAW a folder listed beside it (`AssetParts.siblings`):
 *   the DNG beside a DJI's JPEG. In hand, no fetch.
 * - **`original`** — the proxy's OWN original is the RAW (a lone DNG on a
 *   Winnow). Fetched once, held for the session.
 * - **`companion`** — the capture's OTHER file on the instance
 *   (`MediaOrigin.companion`): the ARW behind a Sony's HIF, the DNG behind a
 *   DJI's JPEG. Fetched once, held for the session under its own asset id.
 *
 * A fetched RAW is held in `sources/original-cache.ts` like any original, so
 * the export never pulls what the stage already pulled. Pure but for the
 * cache reads; the fetch is the caller's to await.
 */

import { isRawImage } from '../library/assets';
import type { MediaOrigin } from '../projects/media-identity';
import type { FetchFile } from '../sources/fetch-options';
import { heldOriginal, holdOriginal } from '../sources/original-cache';
import { trackedFetch } from '../tasks/tracked';

export type SensorReach = 'file' | 'sibling' | 'original' | 'companion';

export interface SensorSource {
  reach: SensorReach;
  /** The RAW's own name and weight — what a row says before anyone clicks. */
  name: string;
  bytes: number | null;
  /** The session cache's key for a fetched RAW; null where it is in hand. */
  key: string | null;
  /** The RAW when it is in hand already — the file, a sibling, or a held fetch. */
  held: File | null;
  /** How to get it when it is not; null where nothing can. */
  fetch: FetchFile | null;
}

/**
 * The sensor's source for `file`, or null when no RAW of this capture is
 * reachable at all. `siblings` are the capture's other files a folder
 * listed beside it; an instance's picture has none and carries its
 * companion on its origin instead.
 */
export function sensorSourceFor(
  file: File,
  origin: MediaOrigin | null,
  siblings: readonly File[] = [],
  assetId: string | null = null,
): SensorSource | null {
  if (isRawImage(file.name)) {
    return { reach: 'file', name: file.name, bytes: file.size, key: null, held: file, fetch: null };
  }
  const sibling = siblings.find((s) => isRawImage(s.name));
  if (sibling) {
    return { reach: 'sibling', name: sibling.name, bytes: sibling.size, key: null, held: sibling, fetch: null };
  }
  if (origin?.fidelity === 'proxy' && origin.name && isRawImage(origin.name) && origin.fetchOriginal) {
    return {
      reach: 'original',
      name: origin.name,
      bytes: origin.bytes ?? null,
      key: assetId,
      held: assetId ? heldOriginal(assetId) : null,
      fetch: origin.fetchOriginal,
    };
  }
  const companion = origin?.companion;
  if (companion && isRawImage(companion.name)) {
    return {
      reach: 'companion',
      name: companion.name,
      bytes: companion.bytes,
      key: companion.assetId,
      held: heldOriginal(companion.assetId),
      fetch: companion.fetchFile,
    };
  }
  return null;
}

/**
 * The DELIVERED file a stored rendition names (`RollPicture.rendition`,
 * `delivered:<name>`), found the same way the sensor is: the file itself, a
 * folder sibling, the proxy's original, the capture's companion — by NAME,
 * since two files of one capture never share one. Null for `proxy`, for
 * nothing stored, and for a name this capture no longer offers, in which
 * case the picture leaves from where it opens.
 */
export function deliveredSourceFor(
  rendition: string | null | undefined,
  file: File,
  origin: MediaOrigin | null,
  siblings: readonly File[] = [],
  assetId: string | null = null,
): SensorSource | null {
  if (!rendition || !rendition.startsWith('delivered:')) return null;
  const wanted = rendition.slice('delivered:'.length).toLowerCase();
  const isNamed = (name: string) => name.toLowerCase() === wanted;
  if (isNamed(file.name) && origin?.fidelity !== 'proxy') {
    return { reach: 'file', name: file.name, bytes: file.size, key: null, held: file, fetch: null };
  }
  const sibling = siblings.find((s) => isNamed(s.name));
  if (sibling) {
    return { reach: 'sibling', name: sibling.name, bytes: sibling.size, key: null, held: sibling, fetch: null };
  }
  if (origin?.fidelity === 'proxy' && origin.name && isNamed(origin.name) && origin.fetchOriginal) {
    return {
      reach: 'original',
      name: origin.name,
      bytes: origin.bytes ?? null,
      key: assetId,
      held: assetId ? heldOriginal(assetId) : null,
      fetch: origin.fetchOriginal,
    };
  }
  const companion = origin?.companion;
  if (companion && isNamed(companion.name)) {
    return {
      reach: 'companion',
      name: companion.name,
      bytes: companion.bytes,
      key: companion.assetId,
      held: heldOriginal(companion.assetId),
      fetch: companion.fetchFile,
    };
  }
  return null;
}

/**
 * A source's bytes: what is held, else fetched once — as a TASK named after
 * the file, on the picture's edge (`scope`), cancellable — and held for the
 * session. A cancelled fetch rejects with an `AbortError` (`fetch-options.ts`).
 */
export async function fetchSourceFile(source: SensorSource, scope: string | null = null, signal?: AbortSignal): Promise<File> {
  if (source.held) return source.held;
  const held = source.key ? heldOriginal(source.key) : null;
  if (held) return held;
  const fetch = source.fetch;
  if (!fetch) throw new Error(`${source.name} is not reachable from here`);
  const fetched = await trackedFetch({ label: `Fetching ${source.name}`, scope, bytes: source.bytes, signal }, (opts) => fetch(opts));
  if (source.key) holdOriginal(source.key, fetched);
  return fetched;
}
