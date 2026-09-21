/**
 * Originals fetched for a delivery, HELD FOR THE SESSION and nothing longer
 * (`docs/develop-originals.md` §7, decision 3): a 24 MB capture pulled through
 * a tunnel for one export is kept so the next export of the same picture does
 * not pull it again, and is dropped with the tab. Never persisted — a byte
 * cache was declined once, and the document already says where the bytes
 * live (`architecture.md`, «A remote ref is re-FETCHED, never cached»).
 *
 * Keyed by the source's own asset id (`"<host>/<id>"`), the identity every
 * materialised file is vouched for with.
 *
 * BOUNDED since 2026-09-21 (R9 of `docs/capture-renditions.md`): a byte
 * ceiling sized from the device (`held-budget.ts`), the least recently USED
 * let go first when a hold crosses it, the file used last never. A read is a
 * use. What goes is the cache's reference only — a stage or an export still
 * holding the `File` keeps it, and the next reader fetches again.
 */

import { heldCeiling, toEvict, type HeldEntry } from './held-budget';

const held = new Map<string, { file: File; lastUsed: number }>();
let tick = 0;

// What the session holds changes under a component that planned from it —
// the stage fetches a file, the export's plan still says "to fetch". A
// version and a subscription let `useSyncExternalStore` follow it.
let version = 0;
const listeners = new Set<() => void>();
function changed(): void {
  version += 1;
  for (const fn of listeners) fn();
}

/** The ceiling this device gets — from the browser's own word on its memory, else the default. */
let ceilingOverride: number | null = null;
export function heldCeilingBytes(): number {
  if (ceilingOverride !== null) return ceilingOverride;
  const memory =
    typeof navigator !== 'undefined' && 'deviceMemory' in navigator
      ? (navigator as { deviceMemory?: number }).deviceMemory
      : undefined;
  return heldCeiling(memory);
}

/** For a spec, or a diagnostic: a ceiling of one's own; null returns to the device's. */
export function overrideHeldCeiling(bytes: number | null): void {
  ceilingOverride = bytes;
}

export function heldOriginal(assetId: string): File | null {
  const entry = held.get(assetId);
  if (!entry) return null;
  entry.lastUsed = ++tick;
  return entry.file;
}

export function holdOriginal(assetId: string, file: File): void {
  held.set(assetId, { file, lastUsed: ++tick });
  const entries: HeldEntry[] = [...held].map(([key, e]) => ({ key, bytes: e.file.size, lastUsed: e.lastUsed }));
  for (const key of toEvict(entries, heldCeilingBytes())) held.delete(key);
  changed();
}

/** Bumped whenever something is held or dropped — for `useSyncExternalStore`. */
export function heldVersion(): number {
  return version;
}

export function subscribeHeld(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** How many bytes the session is holding — for a line that says so. */
export function heldOriginalBytes(): number {
  let n = 0;
  for (const e of held.values()) n += e.file.size;
  return n;
}

/** The keys held right now, most recently used first — for a line that says what would go. */
export function heldOriginalKeys(): string[] {
  return [...held].sort((a, b) => b[1].lastUsed - a[1].lastUsed).map(([key]) => key);
}

export function dropHeldOriginals(): void {
  held.clear();
  renders.clear();
  changed();
}

/**
 * What the session has LEARNED about an original without holding it: how big
 * the render inside a RAW is (2026-09-20).
 *
 * A browser decodes nothing else of a RAW, and the size is stated in the
 * file's head — a megabyte, not the seventy-four the capture weighs. It is
 * cached here beside the originals because it answers the same question and
 * has the same lifetime: this session, keyed by the source's asset id. What
 * it is FOR is refusing to guess — `develop-originals.md` decision 4 assumed
 * a RAW's embedded render is full-size, and on the maintainer's DJI it is
 * 960 × 540 against a 2048 px proxy. Never evicted: a pair of numbers weighs
 * nothing.
 *
 * `undefined` means "not read yet"; `null` means read and the file said
 * nothing, which is not the same thing and must not be re-read forever.
 */
const renders = new Map<string, { width: number; height: number } | null>();

export function heldRawRender(assetId: string): { width: number; height: number } | null | undefined {
  return renders.get(assetId);
}

export function holdRawRender(assetId: string, size: { width: number; height: number } | null): void {
  renders.set(assetId, size);
}
