import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { RollPicture } from '../../shared/develop/roll-types';
import { DEFAULT_SOURCE_ID } from '../../shared/sources/source';
import { WinnowClient, WinnowError } from '../../shared/sources/winnow/client';
import { cullingFromRow, type Culling } from '../../shared/sources/winnow/culling';
import { splitAssetId } from '../../shared/sources/winnow/finals';
import { listWinnowConnections, subscribeWinnowConnections } from '../../shared/sources/winnow/store';

/** How long an answer is believed before a return to the tab asks again — culling goes on in Winnow meanwhile. */
const FRESH_MS = 60_000;
/** Ids per list request: a URL of a few kilobytes, well inside any proxy's limit. */
const CHUNK = 200;

interface Kept {
  culling: Culling | null;
  at: number;
}

/**
 * What each instance said, for the session, keyed `host/id` — the assetId
 * spelling. Module state, so a second roll from the same day, or the same
 * roll reopened, asks nothing it was just told.
 */
const kept = new Map<string, Kept>();

export interface RollCulling {
  /** Winnow's word on each picture it answered for, by picture id. A picture absent here has none. */
  byPicture: ReadonlyMap<string, Culling>;
  /** Whether any picture of the roll could have an answer at all — a roll from this computer has none to show. */
  reachable: boolean;
  /** A request out now. */
  asking: boolean;
  /** Why the last ask failed, said once; null when it did not. */
  problem: string | null;
  /** Ask every instance again, whatever was kept. */
  refresh: () => void;
}

/**
 * Winnow's picks, stars and colour labels for a roll's pictures — READ, never
 * written (`shared/sources/winnow/culling.ts`, item 33 of
 * `docs/lightroom-gaps.md`).
 *
 * - **One list request per hundred-odd pictures**, per connected instance:
 *   the rows the roll's refs name, which carry the culling already joined.
 *   Nothing is fetched but those rows — no bytes, no thumbnail.
 * - **Asked when the roll's pictures change, and again when the tab comes
 *   back** after a minute away: the maintainer culls in Winnow and edits here,
 *   so the answer must follow him between the two without a reload. Never
 *   stored on the roll — a copy there would go stale, and would read as the
 *   roll's own rating.
 * - A picture from this computer, or on an instance that is not connected,
 *   has no answer, and the filter says so rather than calling it unrated.
 */
export function useRollCulling(pictures: readonly RollPicture[]): RollCulling {
  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  const clients = useMemo(
    () => new Map(connections.map((c) => [c.id, new WinnowClient({ baseUrl: c.baseUrl, auth: c.auth })])),
    [connections],
  );

  // What the roll asks about, by host — keyed on the refs alone, since
  // `pictures` changes on every edit and an edit must ask nothing.
  const refKey = pictures.map((p) => p.ref.assetId ?? '').join('|');
  const wanted = useMemo(() => {
    const byHost = new Map<string, number[]>();
    for (const assetId of refKey.split('|')) {
      const split = splitAssetId(assetId);
      if (!split || split.host === DEFAULT_SOURCE_ID || !clients.has(split.host)) continue;
      const ids = byHost.get(split.host) ?? [];
      if (!ids.includes(split.id)) ids.push(split.id);
      byHost.set(split.host, ids);
    }
    return byHost;
  }, [refKey, clients]);

  const [version, setVersion] = useState(0);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const running = useRef(0);

  const ask = useCallback(
    async (maxAge: number) => {
      const now = Date.now();
      const jobs: { host: string; client: WinnowClient; ids: number[] }[] = [];
      for (const [host, ids] of wanted) {
        const client = clients.get(host);
        const stale = ids.filter((id) => {
          const k = kept.get(`${host}/${id}`);
          return !k || now - k.at > maxAge;
        });
        if (client && stale.length) jobs.push({ host, client, ids: stale });
      }
      if (jobs.length === 0) return;
      const run = ++running.current;
      setAsking(true);
      let failed: string | null = null;
      for (const job of jobs) {
        for (let i = 0; i < job.ids.length; i += CHUNK) {
          const ids = job.ids.slice(i, i + CHUNK);
          try {
            const rows = await job.client.assetsByIds(ids);
            const at = Date.now();
            const seen = new Set<number>();
            for (const row of rows) {
              seen.add(row.id);
              kept.set(`${job.host}/${row.id}`, { culling: cullingFromRow(row), at });
            }
            // An id the instance no longer holds has no culling — kept as such, so it is not asked again at once.
            for (const id of ids) if (!seen.has(id)) kept.set(`${job.host}/${id}`, { culling: null, at });
          } catch (err) {
            failed =
              err instanceof WinnowError && err.kind === 'unauthenticated'
                ? `not signed in to ${job.host}`
                : `${job.host} did not answer`;
            break;
          }
        }
      }
      if (run !== running.current) return;
      setAsking(false);
      setProblem(failed);
      setVersion((v) => v + 1);
    },
    [wanted, clients],
  );

  useEffect(() => {
    void ask(FRESH_MS);
  }, [ask]);

  // Back from Winnow's tab: ask again what is older than a minute.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void ask(FRESH_MS);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [ask]);

  const byPicture = useMemo(() => {
    void version;
    const out = new Map<string, Culling>();
    for (const p of pictures) {
      const split = splitAssetId(p.ref.assetId);
      const k = split ? kept.get(`${split.host}/${split.id}`) : undefined;
      if (k?.culling) out.set(p.id, k.culling);
    }
    return out;
  }, [pictures, version]);

  const refresh = useCallback(() => void ask(0), [ask]);
  return { byPicture, reachable: wanted.size > 0, asking, problem, refresh };
}
