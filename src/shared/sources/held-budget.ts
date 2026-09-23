/**
 * How much the session may HOLD of the originals it fetched, and which to let
 * go when it holds more (R9 of `docs/capture-renditions.md`, his D16).
 *
 * `original-cache.ts` had no bound: a forty-picture roll developed from its
 * DNGs is forty times 74 MB, which is an ended tab on a phone and a swollen
 * one on a desktop. The bound is a byte CEILING and the policy is least
 * recently USED — a read counts as a use, since a read is what the stage,
 * the plan and the export do with a held file — and what is evicted is only
 * the cache's reference: a consumer holding the `File` keeps it, and the next
 * one to ask fetches again. Pure and DOM-free; the cache calls it.
 */

const MIB = 1024 * 1024;

/** Where the ceiling lands when the browser says nothing about the device. */
export const DEFAULT_HELD_CEILING = 512 * MIB;
const LEAST_CEILING = 256 * MIB;
const MOST_CEILING = 1024 * MIB;

/**
 * The ceiling for this device: a quarter of the memory the browser reports
 * (`navigator.deviceMemory`, in GiB, Chrome only and coarse on purpose),
 * kept between 256 MiB and 1 GiB. A quarter, because the tab also feeds a
 * stage at its pixel budget, a decoder and an export from the same memory.
 */
export function heldCeiling(deviceMemoryGiB: number | null | undefined): number {
  if (!deviceMemoryGiB || !Number.isFinite(deviceMemoryGiB) || deviceMemoryGiB <= 0) return DEFAULT_HELD_CEILING;
  const quarter = (deviceMemoryGiB * 1024 * MIB) / 4;
  return Math.min(MOST_CEILING, Math.max(LEAST_CEILING, Math.round(quarter)));
}

export interface HeldEntry {
  key: string;
  bytes: number;
  /** A monotonic tick of the last hold or read — higher is more recent. */
  lastUsed: number;
}

/**
 * The keys to drop so the rest fits under `ceiling`: the least recently used
 * first, and never the one used LAST — it is the file being worked on, and a
 * single file over the ceiling is held rather than fetched on every read.
 */
export function toEvict(entries: readonly HeldEntry[], ceiling: number): string[] {
  let total = 0;
  for (const e of entries) total += e.bytes;
  if (total <= ceiling || entries.length < 2) return [];
  const byAge = [...entries].sort((a, b) => a.lastUsed - b.lastUsed);
  const newest = byAge[byAge.length - 1];
  const out: string[] = [];
  for (const e of byAge) {
    if (total <= ceiling) break;
    if (e === newest) break;
    out.push(e.key);
    total -= e.bytes;
  }
  return out;
}
