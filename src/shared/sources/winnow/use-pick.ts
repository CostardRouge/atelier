import { useCallback, useState } from 'react';
import { WinnowError, type WinnowAssetRow, type WinnowClient } from './client';
import { materialize } from './materialize';
import { isAbortError } from '../fetch-options';
import { fileBaseName } from '../../library/assets';
import type { RowsProblem } from './use-scope-rows';

export interface InstancePicker {
  /**
   * Fetch this row into the pool, or re-activate it when it is already there.
   * Resolves with the Library asset id it landed on, or null when nothing
   * arrived — the caller that chains something onto the picture (starting a
   * piece from it) must not act on a fetch that failed.
   */
  pick: (row: WinnowAssetRow) => Promise<string | null>;
  /**
   * Fetch this row into the pool WITHOUT making it active — for a picture
   * handed to something that takes it in (`MediaIntake`): activating would
   * also put it on whatever the tool has open. A row already in the pool
   * resolves at once with its asset id.
   */
  bring: (row: WinnowAssetRow) => Promise<string | null>;
  /** The row being fetched right now, so a tile can say so and the rest wait. */
  fetching: number | null;
  problem: RowsProblem | null;
  clearProblem: () => void;
}

/**
 * Bringing ONE picture across from an instance, shared by the two surfaces
 * that offer it — the Library's tile grid and the lightbox over it.
 *
 * It exists because the second surface arrived: the fetch, its in-flight tile,
 * and the sign-in link a 401 must become were all state inside the grid, and a
 * viewer that could not add the picture it was showing would be a strange
 * viewer. Owning it above both keeps one answer to "is this already here?".
 *
 * A row already in the pool is never fetched twice — it is activated instead,
 * which is what a person clicking a picture they already have means.
 */
export function usePickFromInstance(
  client: WinnowClient | null,
  connectionId: string | null,
  /** `"<host>/<id>"` → the Library asset id it became. */
  inLibrary: ReadonlyMap<string, string>,
  /** `activate` is false for a `bring`: the files join the pool and nothing more. */
  onPicked: (files: File[], assetId: string, activate: boolean) => void,
  onActivate: (assetId: string) => void,
): InstancePicker {
  const [fetching, setFetching] = useState<number | null>(null);
  const [problem, setProblem] = useState<RowsProblem | null>(null);
  const clearProblem = useCallback(() => setProblem(null), []);

  const fetchRow = useCallback(
    async (row: WinnowAssetRow, activate: boolean) => {
      if (!client || !connectionId) return null;
      const have = inLibrary.get(`${connectionId}/${row.id}`);
      if (have) {
        if (activate) onActivate(have);
        return have;
      }
      setFetching(row.id);
      setProblem(null);
      try {
        const files = await materialize(client, connectionId, row, { fidelity: 'proxy' });
        if (!files.length) return null;
        const assetId = fileBaseName(files[0].name).toLowerCase();
        onPicked(files, assetId, activate);
        return assetId;
      } catch (err) {
        // Cancelled from the pill: the person's own doing, nothing to report.
        if (isAbortError(err)) return null;
        setProblem(
          err instanceof WinnowError && err.kind === 'unauthenticated'
            ? { text: `Not signed in to ${connectionId}.`, login: client.loginUrl() }
            : { text: err instanceof Error ? err.message : String(err) },
        );
        return null;
      } finally {
        setFetching(null);
      }
    },
    [client, connectionId, inLibrary, onActivate, onPicked],
  );
  const pick = useCallback((row: WinnowAssetRow) => fetchRow(row, true), [fetchRow]);
  const bring = useCallback((row: WinnowAssetRow) => fetchRow(row, false), [fetchRow]);

  return { pick, bring, fetching, problem, clearProblem };
}
