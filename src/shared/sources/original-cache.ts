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
 */

const held = new Map<string, File>();

// What the session holds changes under a component that planned from it —
// the stage fetches a file, the export's plan still says "to fetch". A
// version and a subscription let `useSyncExternalStore` follow it.
let version = 0;
const listeners = new Set<() => void>();
function changed(): void {
  version += 1;
  for (const fn of listeners) fn();
}

export function heldOriginal(assetId: string): File | null {
  return held.get(assetId) ?? null;
}

export function holdOriginal(assetId: string, file: File): void {
  held.set(assetId, file);
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
  for (const f of held.values()) n += f.size;
  return n;
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
 * 960 × 540 against a 2048 px proxy.
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
