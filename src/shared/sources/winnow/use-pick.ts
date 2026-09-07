import { useCallback, useState } from 'react';
import { WinnowError, type WinnowAssetRow, type WinnowClient } from './client';
import { materialize } from './materialize';
import { fileBaseName } from '../../library/assets';
import type { RowsProblem } from './use-scope-rows';

export interface InstancePicker {
  /** Fetch this row into the pool, or re-activate it when it is already there. */
  pick: (row: WinnowAssetRow) => Promise<void>;
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
  onPicked: (files: File[], assetId: string) => void,
  onActivate: (assetId: string) => void,
): InstancePicker {
  const [fetching, setFetching] = useState<number | null>(null);
  const [problem, setProblem] = useState<RowsProblem | null>(null);
  const clearProblem = useCallback(() => setProblem(null), []);

  const pick = useCallback(
    async (row: WinnowAssetRow) => {
      if (!client || !connectionId) return;
      const have = inLibrary.get(`${connectionId}/${row.id}`);
      if (have) {
        onActivate(have);
        return;
      }
      setFetching(row.id);
      setProblem(null);
      try {
        const files = await materialize(client, connectionId, row, { fidelity: 'proxy' });
        if (files.length) onPicked(files, fileBaseName(files[0].name).toLowerCase());
      } catch (err) {
        setProblem(
          err instanceof WinnowError && err.kind === 'unauthenticated'
            ? { text: `Not signed in to ${connectionId}.`, login: client.loginUrl() }
            : { text: err instanceof Error ? err.message : String(err) },
        );
      } finally {
        setFetching(null);
      }
    },
    [client, connectionId, inLibrary, onActivate, onPicked],
  );

  return { pick, fetching, problem, clearProblem };
}
