/**
 * Partial content hash — the identity Atelier and Winnow share.
 *
 * This is a byte-for-byte reimplementation of Winnow's `partialHash()`
 * (`src/lib/hash.ts` in `CostardRouge/winnow`), which is what its
 * `assets.content_hash` column stores. Computing the same value in the browser
 * is what lets one project document resolve the same media whether it was
 * dragged in from a folder or fetched from a Winnow instance — see
 * `docs/winnow-bridge.md` §4.2.
 *
 *   sha256( utf8(String(size)) ‖ head ‖ tail )
 *     head = bytes[0 .. min(64 KiB, size))
 *     tail = bytes[size - min(64 KiB, size - 64 KiB) .. size)   — only when size > 64 KiB
 *
 * Two properties matter and are both deliberate:
 *
 * - It reads **at most 128 KiB whatever the file weighs**, so hashing a folder
 *   of multi-GB rushes stays instant and the library's "handles only, nothing
 *   read eagerly" property survives.
 * - It is therefore a *partial* hash: two files that share a size and both
 *   64 KiB windows but differ in the middle collide. Winnow tolerates that and
 *   arbitrates a suspected duplicate with a full-content compare; here a hash
 *   match is strong evidence, never proof, which is why reconciliation keeps
 *   the file name as its tiebreak.
 *
 * Any change here silently breaks identity across the two projects. It is
 * pinned by fixtures in the test beside this file, generated from Winnow's own
 * implementation — regenerate them from that repository, never from this one.
 */

/** The window read from each end, and the threshold above which a tail exists. */
const WINDOW = 64 * 1024;

/** The minimal shape this needs — a `File` is one, and so is a plain `Blob`. */
export interface HashableBlob {
  readonly size: number;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

function hex(buffer: ArrayBuffer): string {
  let out = '';
  for (const byte of new Uint8Array(buffer)) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * The content hash of `blob`, as lowercase hex.
 *
 * Reads two slices at most, then digests them in one pass — the concatenation
 * never exceeds 128 KiB plus the few bytes of the size prefix.
 */
export async function partialHash(blob: HashableBlob): Promise<string> {
  const size = blob.size;
  const prefix = new TextEncoder().encode(String(size));

  const headLength = Math.min(WINDOW, size);
  const head = new Uint8Array(await blob.slice(0, headLength).arrayBuffer());

  // Below the threshold the head already covers the whole file; above it, the
  // tail starts where the head stopped until the file is long enough for the
  // two windows to separate. Mirrors Winnow's arithmetic exactly.
  const tailLength = size > WINDOW ? Math.min(WINDOW, size - WINDOW) : 0;
  const tail = tailLength
    ? new Uint8Array(await blob.slice(size - tailLength, size).arrayBuffer())
    : new Uint8Array(0);

  const message = new Uint8Array(prefix.length + head.length + tail.length);
  message.set(prefix, 0);
  message.set(head, prefix.length);
  message.set(tail, prefix.length + head.length);

  return hex(await crypto.subtle.digest('SHA-256', message));
}
