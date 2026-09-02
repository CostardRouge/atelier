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
  /** Where this file came from, when a source handed it over. */
  origin?: MediaOrigin;
}

/**
 * What a source says about a file it handed over — enough for the export to
 * be honest about what it is holding, and to go and get the real thing.
 *
 * A remote source usually hands over its EDITING rendition: fast to fetch and
 * certain to decode, but smaller than the capture. That is the right thing to
 * scrub and compose on and the wrong thing to deliver from, so the origin
 * carries the original's true pixel size (for the export to state what a
 * variant will really produce) and a way to fetch its bytes on demand.
 *
 * `fetchOriginal` is a thunk rather than a URL because only the source knows
 * how to authenticate the request. It is absent when this file already IS the
 * original — there is nothing better to fetch.
 */
export interface MediaOrigin {
  /** The source that handed it over, e.g. `winnow.steeve.website`. */
  sourceId: string;
  /** What this file is: the source's editing rendition, or the capture itself. */
  fidelity: 'proxy' | 'original';
  /** The ORIGINAL's pixel size, when the source knows it. */
  width: number | null;
  height: number | null;
  fetchOriginal?: () => Promise<File>;
}
const known = new Map<string, KnownIdentity>();

export function registerMediaIdentity(file: File, identity: KnownIdentity): void {
  known.set(fileIdentity(file), identity);
}

export function knownIdentity(file: File): KnownIdentity | null {
  return known.get(fileIdentity(file)) ?? null;
}

/** Where `file` came from, or null for a file the user opened themselves. */
export function mediaOrigin(file: File | null): MediaOrigin | null {
  return (file && known.get(fileIdentity(file))?.origin) ?? null;
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
