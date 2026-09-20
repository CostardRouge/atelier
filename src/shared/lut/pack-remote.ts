/**
 * A pack kept on a connected Winnow, so a phone can grade with looks bought
 * on a Mac (step V5–V6 of `docs/lut-packs.md`).
 *
 * Two buckets, on purpose:
 *
 * - the pack's INDEX — names, the tree, what is hidden, the thumbnails — is a
 *   `lutpack` DOCUMENT, small and versioned like a trip;
 * - each LATTICE is a FILE, keyed by the SHA-256 of the `.cube` it came from.
 *   Content-addressed, so pushing a pack twice writes nothing the second time,
 *   two packs shipping the same look share one blob, and a device asks which
 *   hashes are already there before sending 40 MB.
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
  /** Lattices the instance already held, by hash. */
  reused: number;
  sent: number;
  bytes: number;
  /** Looks whose bytes this device does not hold, so nothing could be sent. */
  missingLocally: string[];
}

/**
 * Push a pack: its lattices first, then its index.
 *
 * That order is the point. The index is what another device reads to know a
 * pack exists; publishing it before the bytes would offer looks that answer
 * 404 for as long as the upload lasts — or forever, if it is interrupted.
 * The reverse leaves blobs nobody points at, which the next push recognises
 * by hash and skips.
 */
export async function pushPack(
  host: PackHost,
  index: LutPackIndex,
  latticeFor: (hash: string) => Promise<Uint8Array | null>,
  onProgress?: (progress: PushProgress) => void,
): Promise<PushPackResult> {
  const hashes = [...new Set(index.looks.map((l) => l.hash).filter((h): h is string => !!h))];
  const there = new Set((await host.client.listAppFiles(DOCS_APP)).files.map((f) => f.id));
  const wanted = hashes.filter((h) => !there.has(h));

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
    await host.client.putAppFile(DOCS_APP, hash, lattice, LATTICE_TYPE, host.maxFileBytes);
    sent += 1;
    bytes += lattice.byteLength;
  }
  onProgress?.({ done: sent, total: wanted.length, bytes });

  // The index carries no bytes — only names, the tree and the thumbnails —
  // and it is written last, when everything it names is there.
  await putPackDoc(host, index);
  return { reused: hashes.length - wanted.length, sent, bytes, missingLocally };
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

/** One lattice from the instance, or null when it does not hold that hash. */
export function fetchRemoteLattice(host: PackHost, hash: string): Promise<Uint8Array | null> {
  return host.client.getAppFile(DOCS_APP, hash);
}

/** Forget a pack there: its index, then the lattices no other pack names. */
export async function deleteRemotePack(
  host: PackHost,
  index: LutPackIndex,
  keptElsewhere: ReadonlySet<string>,
): Promise<void> {
  await host.client.deleteDoc(DOCS_APP, index.id, await currentEtag(host, index.id));
  for (const hash of new Set(index.looks.map((l) => l.hash).filter((h): h is string => !!h))) {
    if (keptElsewhere.has(hash)) continue;
    await host.client.deleteAppFile(DOCS_APP, hash);
  }
}
