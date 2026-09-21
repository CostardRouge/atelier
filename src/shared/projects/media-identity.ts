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

import type { ExifData } from '../exif/exif-parser';
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
  /**
   * The ORIGINAL's own file name and weight (O1 of `docs/develop-originals.md`):
   * its extension says whether a browser could decode it at all — a RAW is
   * delivered from its render, never fetched blind — and the bytes say what
   * a fetch would cost through a tunnel. Absent when the source does not say.
   */
  name?: string;
  bytes?: number | null;
  fetchOriginal?: () => Promise<File>;
  /**
   * The ORIGINAL's leading bytes — its EXIF, and nothing else. A delivered
   * picture carries the original's metadata whatever its pixels were taken
   * from (the maintainer's rule, `exif/stamp-exif.ts`), so the export needs
   * that block even in Proxies mode, where the file itself is never fetched.
   */
  fetchOriginalHead?: (bytes: number) => Promise<ArrayBuffer>;
  /**
   * What the source knows about the CAPTURE's EXIF — exposure, position, the
   * time it was taken, and a drone's height above take-off.
   *
   * A source's editing rendition is a re-encode, and a re-encode drops the
   * metadata: Winnow's photo proxy is a WebP with no EXIF at all, so a picture
   * edited from it would read `—` on every exposure and position element
   * despite the source having parsed all of it at ingest. This carries those
   * facts across, at no network cost, for the file's own EXIF to be preferred
   * over wherever it has any.
   */
  exif?: ExifData;
  /**
   * The capture's OTHER file, where the source paired two into one media — a
   * Sony `.ARW` beside its `.HIF`, a DJI `.DNG` beside its `.JPG`
   * (`docs/capture-renditions.md`).
   *
   * It is what makes the sensor's data reachable at all for those captures:
   * the file in hand is the primary's proxy, the primary's own original is a
   * HEIF or a JPEG, and the RAW is a different asset entirely. Absent where
   * the source pairs nothing, and — the trap — **never assume it is a RAW**: a
   * Live Photo's companion is a `.mov`.
   */
  companion?: CaptureCompanion;
}

/** The other half of a paired capture, and how to get it. */
export interface CaptureCompanion {
  /** `<host>/<id>`, so it is held and re-found exactly like any other asset. */
  assetId: string;
  name: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
  fetchFile: () => Promise<File>;
  /** Its leading bytes — the head a RAW probe reads, without pulling 35 MB. */
  fetchHead: (bytes: number) => Promise<ArrayBuffer>;
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
