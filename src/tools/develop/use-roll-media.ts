import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  FETCH_RADIUS,
  KEEP_RADIUS,
  fetchOrder,
  keepWindow,
  type PictureAvailability,
} from '../../shared/develop/roll-media';
import { sameMediaRef, variantNumber, type RollPicture } from '../../shared/develop/roll-types';
import { findMedia } from '../../shared/projects/media-identity';
import { DEFAULT_SOURCE_ID } from '../../shared/sources/source';
import { WinnowClient, WinnowError } from '../../shared/sources/winnow/client';
import { splitAssetId } from '../../shared/sources/winnow/finals';
import { refetchMedia, resolvableSource } from '../../shared/sources/winnow/resolve-media';
import { listWinnowConnections, subscribeWinnowConnections } from '../../shared/sources/winnow/store';

type Failure = Extract<PictureAvailability, { kind: 'failed' | 'gone' }>;

export interface RollMedia {
  /** The pictures whose bytes are in hand, by picture id. */
  files: ReadonlyMap<string, File>;
  /** What can be said about every picture's bytes, by picture id. */
  availability: ReadonlyMap<string, PictureAvailability>;
  /**
   * The bytes of one picture for a job that needs them now (an export): the
   * Library's, the roll's own, or fetched on the spot. Null when nothing can
   * answer. A picture fetched here far from the open one is not kept.
   */
  fileFor: (picture: RollPicture) => Promise<File | null>;
  /** Ask again for every picture whose instance answered badly. */
  retryFailed: () => void;
  /**
   * The instance's own thumbnail for a picture whose bytes are not in hand
   * and whose cell has none of its own yet — a strip that shows every
   * picture before any is fetched. Null for a picture no connected instance
   * holds.
   */
  remoteThumb: (picture: RollPicture) => { client: WinnowClient; id: number } | null;
}

/** The main file of a fetched asset: the still, never a `.srt`. */
function stillOf(files: File[] | null): File | null {
  return files?.find((f) => !/\.srt$/i.test(f.name)) ?? null;
}

/**
 * A roll's pictures, found without the person having to put them in the
 * Library first — the maintainer's report of 2026-09-16: a roll reopened
 * after a reload showed its thumbnails and nothing else until its day was
 * ticked again in the sidebar.
 *
 * - **What is in hand first**, by name then hash (`findMedia`): the Library's
 *   files, and the folders and drops the roll keeps (`use-roll-folders.ts`).
 * - **Else the instance its ref names**, fetched by the ROLL through
 *   `refetchMedia` — `materialize`, so the file is vouched for with the
 *   original's hash, its EXIF and a `fetchOriginal`, and the export's `Auto`
 *   still works. The bytes stay in this hook's pool and are NOT added to the
 *   Library (decision Q1): the roll is already the working list.
 * - **Only what is near**: the open picture, then its neighbours
 *   (`FETCH_RADIUS`), one request at a time; what drifts out of
 *   `KEEP_RADIUS` is let go. Only a CONNECTED instance, only while the roll is
 *   open — the rule `resolve-media.ts` states for Trips.
 * - A failure is kept per picture and said once; nothing retries on its own.
 */
export function useRollMedia({
  pictures,
  openId,
  localPhotos,
}: {
  pictures: readonly RollPicture[];
  openId: string | null;
  /** The photographs in hand on this device: the Library's, and the roll's own folders and drops. */
  localPhotos: readonly File[];
}): RollMedia {
  // A connection added or forgotten changes what can be fetched.
  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);

  const latest = useRef(pictures);
  latest.current = pictures;
  const refKey = pictures.map((p) => `${p.id}:${p.ref.name}:${p.ref.hash ?? ''}:${p.ref.assetId ?? ''}`).join('|');
  // Keyed on what the pictures ARE, so an edit to a develop does not re-ask.
  const ids = useMemo(() => refKey.split('|').filter(Boolean).map((k) => k.slice(0, k.indexOf(':'))), [refKey]);

  // VARIANTS of one capture (item 30) share its bytes: each picture id maps to
  // the others holding the same file. Only pictures that HAVE a variant are
  // compared, so a roll with none pays nothing.
  const mates = useMemo(() => {
    const out = new Map<string, string[]>();
    const list = latest.current;
    for (const v of list) {
      if (variantNumber(v) < 2) continue;
      const family = list.filter((p) => sameMediaRef(p.ref, v.ref)).map((p) => p.id);
      for (const id of family) out.set(id, family.filter((other) => other !== id));
    }
    return out;
    // Keyed on what the pictures ARE (`ids` follows `refKey`).
  }, [ids]);
  const matesRef = useRef(mates);
  matesRef.current = mates;

  // --- the Library's half ---------------------------------------------------
  const [fromLibrary, setFromLibrary] = useState<ReadonlyMap<string, File>>(new Map());
  useEffect(() => {
    let alive = true;
    void (async () => {
      const found = new Map<string, File>();
      for (const p of latest.current) {
        const file = await findMedia(p.ref, localPhotos);
        if (file) found.set(p.id, file);
      }
      if (alive) setFromLibrary(found);
    })();
    return () => {
      alive = false;
    };
  }, [refKey, localPhotos]);

  // --- the roll's own half ---------------------------------------------------
  const [pool, setPool] = useState<ReadonlyMap<string, File>>(new Map());
  const poolRef = useRef(pool);
  poolRef.current = pool;
  const [fetching, setFetching] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<ReadonlyMap<string, Failure>>(new Map());
  const failuresRef = useRef(failures);
  failuresRef.current = failures;
  const inflight = useRef(new Map<string, Promise<File | null>>());
  const openRef = useRef(openId);
  openRef.current = openId;

  const fetchOne = useCallback((picture: RollPicture, keep: boolean): Promise<File | null> => {
    // A variant whose twin is on its way waits for that one fetch.
    const running = [picture.id, ...(matesRef.current.get(picture.id) ?? [])]
      .map((id) => inflight.current.get(id))
      .find(Boolean);
    if (running) return running;
    const sourceId = resolvableSource(picture.ref);
    if (!sourceId) return Promise.resolve(null);
    setFetching((s) => new Set(s).add(picture.id));
    const done = (fn: () => void) => {
      inflight.current.delete(picture.id);
      setFetching((s) => {
        const next = new Set(s);
        next.delete(picture.id);
        return next;
      });
      fn();
    };
    const promise = refetchMedia(picture.ref).then(
      (files) => {
        const file = stillOf(files);
        done(() => {
          if (!file) {
            setFailures((m) => new Map(m).set(picture.id, { kind: 'gone', sourceId }));
            return;
          }
          // Kept only when it is still near the open picture once it lands.
          const wanted = keepWindow(latest.current.map((p) => p.id), openRef.current);
          if (keep && wanted.has(picture.id)) setPool((m) => new Map(m).set(picture.id, file));
        });
        return file;
      },
      (err: unknown) => {
        const unauthenticated = err instanceof WinnowError && err.kind === 'unauthenticated';
        const failure: Failure = {
          kind: 'failed',
          sourceId,
          problem: unauthenticated
            ? `Not signed in to ${sourceId}.`
            : err instanceof Error
              ? err.message
              : String(err),
          ...(unauthenticated ? { loginUrl: `https://${sourceId}/login` } : {}),
        };
        done(() => setFailures((m) => new Map(m).set(picture.id, failure)));
        return null;
      },
    );
    inflight.current.set(picture.id, promise);
    return promise;
  }, []);

  // Fetch what is near the open picture, one at a time, nearest first; let go
  // of what has drifted away.
  useEffect(() => {
    const wanted = keepWindow(ids, openId, KEEP_RADIUS);
    // A file is kept while ANY variant of it is near.
    const near = (id: string) => wanted.has(id) || (mates.get(id) ?? []).some((m) => wanted.has(m));
    setPool((m) => {
      if ([...m.keys()].every(near)) return m;
      return new Map([...m].filter(([id]) => near(id)));
    });
    const inHand = (id: string) => fromLibrary.has(id) || poolRef.current.has(id);
    const queue = fetchOrder(ids, openId, FETCH_RADIUS).filter(
      (id) => !inHand(id) && !(mates.get(id) ?? []).some(inHand) && !failuresRef.current.has(id),
    );
    if (queue.length === 0) return;
    let alive = true;
    void (async () => {
      for (const id of queue) {
        if (!alive) return;
        const picture = latest.current.find((p) => p.id === id);
        if (picture) await fetchOne(picture, true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ids, openId, fromLibrary, connections, failures, fetchOne, mates]);

  const files = useMemo(() => {
    const out = new Map(pool);
    for (const [id, file] of fromLibrary) out.set(id, file);
    // A variant draws from its twin's bytes.
    for (const [id, others] of mates) {
      if (out.has(id)) continue;
      const twin = others.find((o) => out.has(o));
      if (twin) out.set(id, out.get(twin)!);
    }
    return out;
  }, [pool, fromLibrary, mates]);

  const availability = useMemo(() => {
    void connections;
    const out = new Map<string, PictureAvailability>();
    for (const p of pictures) {
      if (files.has(p.id)) {
        out.set(p.id, { kind: 'ready' });
        continue;
      }
      const failure = failures.get(p.id);
      const sourceId = resolvableSource(p.ref);
      if (fetching.has(p.id) && sourceId) out.set(p.id, { kind: 'fetching', sourceId });
      else if (failure) out.set(p.id, failure);
      else if (sourceId) out.set(p.id, { kind: 'waiting', sourceId });
      else {
        const host = splitAssetId(p.ref.assetId)?.host;
        out.set(p.id, host && host !== DEFAULT_SOURCE_ID ? { kind: 'unconnected', sourceId: host } : { kind: 'local' });
      }
    }
    return out;
  }, [pictures, files, failures, fetching, connections]);

  const fileFor = useCallback(
    async (picture: RollPicture): Promise<File | null> => {
      const inHand = files.get(picture.id);
      if (inHand) return inHand;
      return fetchOne(picture, false);
    },
    [files, fetchOne],
  );

  const retryFailed = useCallback(() => setFailures(new Map()), []);

  const clients = useMemo(
    () => new Map(connections.map((c) => [c.id, new WinnowClient({ baseUrl: c.baseUrl, auth: c.auth })])),
    [connections],
  );
  const remoteThumb = useCallback(
    (picture: RollPicture) => {
      const split = splitAssetId(picture.ref.assetId);
      const client = split ? clients.get(split.host) : undefined;
      return split && client ? { client, id: split.id } : null;
    },
    [clients],
  );

  return { files, availability, fileFor, retryFailed, remoteThumb };
}
