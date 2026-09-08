import { useCallback, useEffect, useState } from 'react';
import {
  WinnowError,
  type LibraryHalf,
  type WinnowAssetRow,
  type WinnowClient,
} from './client';

/** One line a person can act on, and the sign-in link when that is the answer. */
export interface RowsProblem {
  text: string;
  login?: string;
}

export interface ScopeRows {
  /** Null while asking; `[]` for a span the instance holds nothing on. */
  rows: WinnowAssetRow[] | null;
  problem: RowsProblem | null;
  /** Ask again — after a sign-in, say. */
  reload: () => void;
}

/** How many rows a span is allowed to bring: a day is a few hundred at most. */
const ROW_CAP = 400;

/**
 * The instance's media for a span of days — the one read behind the Library's
 * Winnow tab and the piece editor's day strip, so both ask the same question
 * the same way (`date_from` / `date_to`, never a chapter: `roadtrip.md`).
 *
 * A change of span, half, connection or `enabled` forgets the last answer
 * before asking again, so a new day never shows the previous day's pictures
 * for a frame. Nothing is asked while `enabled` is false or the span is null:
 * a closed strip and a tab nobody is looking at cost no request.
 *
 * `half` narrows to one side of the instance's library (`incoming` / `final`),
 * null being both. It is sent to the instance rather than applied to the
 * answer: `ROW_CAP` truncates a busy span, so filtering here would quietly
 * drop rows the instance would have listed. A primitive, not a `FilterQuery`
 * object, so it can be an effect dependency without every caller having to
 * memoise one.
 */
export function useScopeRows(
  client: WinnowClient | null,
  connectionId: string | null,
  from: string | null,
  to: string | null,
  enabled: boolean,
  half: LibraryHalf | null = null,
): ScopeRows {
  const [rows, setRows] = useState<WinnowAssetRow[] | null>(null);
  const [problem, setProblem] = useState<RowsProblem | null>(null);
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    setRows(null);
    setProblem(null);
    if (!enabled || !client || !connectionId || !from || !to) return;
    let cancelled = false;
    client
      .allAssets({ dateFrom: from, dateTo: to, ...(half ? { half } : {}) }, ROW_CAP)
      .then((all) => {
        if (!cancelled) setRows(all);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRows([]);
        setProblem(
          err instanceof WinnowError && err.kind === 'unauthenticated'
            ? { text: `Not signed in to ${connectionId}.`, login: client.loginUrl() }
            : { text: err instanceof Error ? err.message : String(err) },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [client, connectionId, from, to, enabled, half, generation]);

  return { rows, problem, reload };
}
