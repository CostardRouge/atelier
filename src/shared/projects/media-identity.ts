/**
 * Turning live `File`s into `SavedMediaRef`s that carry a content hash.
 *
 * The hash itself is pure (`shared/lib/partial-hash.ts`); this is the thin
 * layer that decides *when* to pay for it. It reads 128 KiB per file at most,
 * but a project folder can hold fifty clips, so the result is memoised by the
 * cheap identity the library already uses (`name__size__lastModified`): the
 * folder is hashed once per session, and reopening a project is free.
 *
 * Failure is not fatal. A read can throw — a permission revoked mid-listing, a
 * file that vanished between the directory walk and the slice — and losing the
 * hash only means falling back to matching by name, which is what every
 * document written before this existed does anyway. So a failed hash yields a
 * ref without one rather than an exception, and the caller never has to care.
 */

import { partialHash } from '../lib/partial-hash';
import { fileIdentity } from '../library/assets';
import { savedMediaRef, type SavedMediaRef } from './project-types';

/** Keyed by `fileIdentity`, holding the promise so concurrent calls share one read. */
const cache = new Map<string, Promise<string | null>>();

/**
 * What a source told us about a file it handed over — consulted BEFORE any
 * hashing. A file fetched from Winnow is usually a proxy: hashing its own
 * bytes would give the proxy's identity, which is nobody's `content_hash`. The
 * source knows the original's hash and id, and those are what the document
 * must carry, or the same media would never resolve across sources.
 */
export interface KnownIdentity {
  assetId?: string;
  hash?: string;
}
const known = new Map<string, KnownIdentity>();

export function registerMediaIdentity(file: File, identity: KnownIdentity): void {
  known.set(fileIdentity(file), identity);
}

export function knownIdentity(file: File): KnownIdentity | null {
  return known.get(fileIdentity(file)) ?? null;
}

/**
 * The file's partial content hash, or `null` if it could not be read. A file
 * a source vouched for answers with the source's hash and reads nothing.
 */
export function mediaHash(file: File): Promise<string | null> {
  const key = fileIdentity(file);
  const vouched = known.get(key)?.hash;
  if (vouched) return Promise.resolve(vouched);
  let pending = cache.get(key);
  if (!pending) {
    pending = partialHash(file).catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}

/** A `SavedMediaRef` for `file`, carrying its hash (and source id) when known. */
export async function hashedMediaRef(file: File): Promise<SavedMediaRef> {
  const ref = savedMediaRef(file);
  const identity = knownIdentity(file);
  const hash = await mediaHash(file);
  return {
    ...ref,
    ...(identity?.assetId ? { assetId: identity.assetId } : {}),
    ...(hash ? { hash } : {}),
  };
}

/** The same, for a whole listing. Hashes run concurrently; order is preserved. */
export function hashedMediaRefs(files: readonly File[]): Promise<SavedMediaRef[]> {
  return Promise.all(files.map(hashedMediaRef));
}

/**
 * The file among `files` that IS `ref` — resolved id → hash → name, the same
 * order `reconcile.ts` uses, for the callers that hold live `File`s rather
 * than two lists of refs.
 *
 * Deliberately lazy: the name lookup runs first and costs nothing, so the
 * ordinary case never reads a byte. Only when the name has changed does it
 * hash the candidates — and even then, at most 128 KiB each, memoised.
 */
export async function findMedia(
  ref: SavedMediaRef,
  files: readonly File[],
): Promise<File | null> {
  const byName = files.find((f) => f.name.toLowerCase() === ref.name.toLowerCase());
  if (byName) return byName;
  if (!ref.hash) return null;

  // A renamed file keeps its size, so only same-size candidates can match —
  // which usually leaves one, and often none.
  const candidates = files.filter((f) => f.size === ref.size);
  for (const file of candidates) {
    if ((await mediaHash(file)) === ref.hash) return file;
  }
  return null;
}
