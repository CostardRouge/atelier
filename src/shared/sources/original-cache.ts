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

export function heldOriginal(assetId: string): File | null {
  return held.get(assetId) ?? null;
}

export function holdOriginal(assetId: string, file: File): void {
  held.set(assetId, file);
}

/** How many bytes the session is holding — for a line that says so. */
export function heldOriginalBytes(): number {
  let n = 0;
  for (const f of held.values()) n += f.size;
  return n;
}

export function dropHeldOriginals(): void {
  held.clear();
}
