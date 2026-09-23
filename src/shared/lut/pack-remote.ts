/**
 * A pack kept on a connected Winnow, so a phone can grade with looks bought
 * on a Mac (step V5–V6 of `docs/lut-packs.md`).
 *
 * Two buckets, on purpose:
 *
 * - the pack's INDEX — names, the tree, what is hidden, the thumbnails — is a
 *   `lutpack` DOCUMENT, small and versioned like a trip;
 * - each LATTICE is a FILE, keyed by the SHA-256 of **the encoded lattice
 *   itself** — `PackLook.blob`, not `PackLook.hash`, which is the `.cube`
 *   text's. The instance hashes the body it is given and refuses a path that
 *   does not match, so the key can only ever be the bytes that travel.
 *   Content-addressed, so pushing a pack twice writes nothing the second time,
 *   two looks holding the same lattice share one blob, and a device asks which
 *   blobs are already there before sending 40 MB.
 *
 * What is deliberately NOT here: a sync engine. A pack is pushed when the
 * author asks (`keepPackOn`), pulled when the author asks (`fetchRemotePacks`
 * + `adoptRemotePack`), and a lattice is fetched on first use and cached
 * (`pack-vault.ts`). Atelier never writes to an instance on its own — the
 * rule the whole bridge rests on.
 *
 * No DOM. Failures come back as the client's own `WinnowError`.
 */

import { DOCS_APP, WinnowClient, WinnowError, hasFileBucket } from '../sources/winnow/client';
import { getWinnowConnection, listWinnowConnections } from '../sources/winnow/store';
import { migratePackIndex, type LutPackIndex } from './lut-pack';
import { sha256Hex } from './pack-codec';

/** The document kind Winnow lists a pack index by. */
export const PACK_KIND = 'lutpack';
/** The pack document's own version, beside the body, as every document has. */
export const PACK_DOC_VERSION = 1;
/** What a lattice is sent as — bytes Winnow never reads (`pack-codec.ts`). */
const LATTICE_TYPE = 'application/octet-stream';

/** An instance this browser is connected to that can keep a pack. */
export interface PackHost {
  /** The source id — the instance's host, what the sheet prints. */
  sourceId: string;
  client: WinnowClient;
  /** The document cap, checked before a PUT. */
  maxDocBytes: number | null;
  /** The per-file cap, checked before a lattice is sent. */
  maxFileBytes: number | null;
}

/**
 * The instances that can hold a pack: connected, with a document bucket that
 * lists `lutpack`, AND with the file bucket. An instance that predates either
 * is not offered, rather than failing after the first upload.
 */
export function packHosts(): PackHost[] {
  return listWinnowConnections()
    .filter((c) => c.capabilities?.documents.bucket)
    .filter((c) => (c.capabilities?.documents.kinds ?? []).includes(PACK_KIND))
    .filter((c) => hasFileBucket(c.capabilities))
    .map((c) => ({
      sourceId: c.id,
      client: clientFor(c.id)!,
      maxDocBytes: c.capabilities?.documents.maxBytes ?? null,
      maxFileBytes: c.capabilities?.files?.maxBytes ?? null,
    }));
}

/** The host of one source id, or null when it cannot keep a pack. */
export function packHost(sourceId: string): PackHost | null {
  return packHosts().find((h) => h.sourceId === sourceId) ?? null;
}

function clientFor(sourceId: string): WinnowClient | null {
  const conn = getWinnowConnection(sourceId);
  return conn ? new WinnowClient({ baseUrl: conn.baseUrl, auth: conn.auth }) : null;
}

export interface PushProgress {
  /** Looks sent so far, of those that had to be sent. */
  done: number;
  total: number;
  /** Bytes written this push — nothing when the instance already held them. */
  bytes: number;
}

export interface PushPackResult {
  /** Lattices the instance already held, by blob. */
  reused: number;
  sent: number;
  bytes: number;
  /** Looks whose bytes this device does not hold, so nothing could be sent. */
  missingLocally: string[];
  /**
   * The index AS PUSHED — the same pack with each sent look's `blob` filled
   * in. The caller saves it, so the next push knows what the instance calls
   * those bytes without reading 40 MB back out of the vault to hash it again.
   */
  index: LutPackIndex;
}

/**
 * Push a pack: its lattices first, then its index.
 *
 * That order is the point. The index is what another device reads to know a
 * pack exists; publishing it before the bytes would offer looks that answer
 * 404 for as long as the upload lasts — or forever, if it is interrupted.
 * The reverse leaves blobs nobody points at, which the next push recognises
 * by blob and skips.
 *
 * `latticeFor` is asked by the look's `hash`, because that is what the local
 * vault is keyed on. What comes back is hashed AGAIN, and that second number
 * is the id it is stored under there: the two are different — the first is of
 * the `.cube` text, the second of the 16-bit lattice — and only the second one
 * the instance will accept.
 */
export async function pushPack(
  host: PackHost,
  index: LutPackIndex,
  latticeFor: (hash: string) => Promise<Uint8Array | null>,
  onProgress?: (progress: PushProgress) => void,
): Promise<PushPackResult> {
  const hashes = [...new Set(index.looks.map((l) => l.hash).filter((h): h is string => !!h))];
  const there = new Set((await host.client.listAppFiles(DOCS_APP)).files.map((f) => f.id));

  // What the index already says the instance calls a look's bytes, kept only
  // where the instance really holds it. A look pushed by an older build — or
  // by this one before it reached the upload — carries nothing, and is read
  // and hashed below rather than assumed.
  const blobs = new Map<string, string>();
  for (const look of index.looks) {
    if (look.hash && look.blob && there.has(look.blob)) blobs.set(look.hash, look.blob);
  }
  const wanted = hashes.filter((h) => !blobs.has(h));

  const missingLocally: string[] = [];
  let sent = 0;
  let bytes = 0;
  for (const hash of wanted) {
    onProgress?.({ done: sent, total: wanted.length, bytes });
    const lattice = await latticeFor(hash);
    if (!lattice) {
      // The index names a look whose bytes are not on THIS device — a pack
      // pulled here and never fully fetched. Said, never silently dropped
      // from the index, since another device may well hold it.
      missingLocally.push(hash);
      continue;
    }
    // MEASURED from the bytes that are about to travel, never carried over
    // from the look: the instance hashes the body and refuses a path that
    // disagrees, so a guessed id is a 400 and not a mislabelled file.
    const blob = await sha256Hex(lattice);
    blobs.set(hash, blob);
    // Another look of this pack encodes to the same lattice, or the instance
    // held it under its true id all along: nothing to write.
    if (there.has(blob)) continue;
    await host.client.putAppFile(DOCS_APP, blob, lattice, LATTICE_TYPE, host.maxFileBytes);
    there.add(blob);
    sent += 1;
    bytes += lattice.byteLength;
  }
  onProgress?.({ done: sent, total: wanted.length, bytes });

  // The index carries no bytes — only names, the tree and the thumbnails —
  // and it is written last, when everything it names is there. It goes out
  // carrying the blobs, which is what another device reads to fetch them.
  const pushed: LutPackIndex = {
    ...index,
    looks: index.looks.map((look) => {
      const blob = look.hash ? blobs.get(look.hash) : undefined;
      return blob && blob !== look.blob ? { ...look, blob } : look;
    }),
  };
  await putPackDoc(host, pushed);
  return {
    reused: hashes.length - sent - missingLocally.length,
    sent,
    bytes,
    missingLocally,
    index: pushed,
  };
}

/**
 * Write the index alone — what a hide/show change costs. The etag dance is
 * deliberately skipped: a pack is a library one device owns and edits, so a
 * refused write would only ask the author a question about a thing they have
 * not changed anywhere else. (A trip is the opposite case, and does hold its
 * revision.)
 */
export async function putPackDoc(host: PackHost, index: LutPackIndex): Promise<void> {
  const current = await currentEtag(host, index.id);
  await host.client.putDoc(
    DOCS_APP,
    index.id,
    { kind: PACK_KIND, version: PACK_DOC_VERSION, doc: index },
    current,
    host.maxDocBytes,
  );
}

async function currentEtag(host: PackHost, id: string): Promise<string | null> {
  try {
    const got = await host.client.getDoc(DOCS_APP, id);
    return got === 'not-modified' ? null : got.row.etag;
  } catch (err) {
    // Never pushed there, or gone: a create takes no If-Match.
    if (err instanceof WinnowError && err.kind === 'notfound') return null;
    throw err;
  }
}

/** Every pack this account keeps on that instance. */
export async function fetchRemotePacks(host: PackHost): Promise<LutPackIndex[]> {
  const rows = await host.client.listDocs<unknown>(DOCS_APP, PACK_KIND);
  return rows
    .map((row) => migratePackIndex(row.doc))
    .filter((index): index is LutPackIndex => index !== null);
}

/**
 * One lattice from the instance, or null when it does not hold that blob —
 * the look's `blob`, the id the bytes are stored under there, never its
 * `hash`, which names the `.cube` they were encoded from.
 */
export function fetchRemoteLattice(host: PackHost, blob: string): Promise<Uint8Array | null> {
  return host.client.getAppFile(DOCS_APP, blob);
}

/**
 * Forget a pack there: its index, then the lattices no other pack names.
 * `keptElsewhere` holds BLOBS, for the same reason: it is the file store's
 * vocabulary, and a look's `hash` names nothing on the instance.
 *
 * **The INDEX goes first, and that is the exact mirror of `pushPack`'s
 * order.** A push writes bytes then the index, because an index published
 * before its bytes offers looks that answer 404. A delete writes the index
 * then the bytes, for the same reason read backwards: an index that still
 * names a look whose lattice is gone offers a 404 on every picture, while an
 * index that has dropped a look whose bytes linger merely wastes space — and
 * the next forget of that pack reclaims it, since `freedBlobs` reads the
 * indexes and no surviving look names those bytes.
 */
export async function deleteRemotePack(
  host: PackHost,
  index: LutPackIndex,
  keptElsewhere: ReadonlySet<string>,
): Promise<void> {
  await host.client.deleteDoc(DOCS_APP, index.id, await currentEtag(host, index.id));
  for (const blob of new Set(index.looks.map((l) => l.blob).filter((b): b is string => !!b))) {
    if (keptElsewhere.has(blob)) continue;
    await host.client.deleteAppFile(DOCS_APP, blob);
  }
}

/**
 * Forget SOME of a pack's looks there: the index WITHOUT them, then the
 * lattices no look that survives still names — the same order, for the same
 * reason as above.
 *
 * `next` is the pack as it will now stand (`withoutLooks`) and `blobs` the
 * ones the caller has established are free (`freedBlobs`). Neither is worked
 * out here: the index published there must be the very one this browser saves,
 * or the two copies of the pack start disagreeing about what it holds.
 */
export async function deleteRemoteLooks(
  host: PackHost,
  next: LutPackIndex,
  blobs: readonly string[],
): Promise<void> {
  await putPackDoc(host, next);
  for (const blob of new Set(blobs)) await host.client.deleteAppFile(DOCS_APP, blob);
}
