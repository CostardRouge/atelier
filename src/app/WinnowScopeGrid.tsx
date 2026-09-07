import { useCallback, useState } from 'react';
import type { WinnowAssetRow, WinnowClient } from '../shared/sources/winnow/client';
import { WinnowError } from '../shared/sources/winnow/client';
import { materialize } from '../shared/sources/winnow/materialize';
import type { WinnowConnection } from '../shared/sources/winnow/store';
import type { ScopeRows } from '../shared/sources/winnow/use-scope-rows';
import type { RowsProblem } from '../shared/sources/winnow/use-scope-rows';
import { fileBaseName } from '../shared/library/assets';

interface WinnowScopeGridProps {
  connection: WinnowConnection;
  client: WinnowClient;
  /** Inclusive span the tiles were asked for — for the empty-state sentence. */
  from: string;
  to: string;
  /** The instance's answer for that span, owned by the sidebar (it subtracts it from the pool list). */
  scope: ScopeRows;
  /** Filter typed in the sidebar's box — matched against the file name. */
  query: string;
  /**
   * The remote ids (`"<host>/<id>"`) already in the pool, mapped to the
   * Library asset id they became — so a tile that is already here activates
   * it instead of fetching it twice, and is drawn as such.
   */
  inLibrary: ReadonlyMap<string, string>;
  /** The Library's active asset id, so its tile is the one with the ring. */
  activeId: string | null;
  /** A fetched picture: its files, and the Library id they build into. */
  onPicked: (files: File[], assetId: string) => void;
  /** A tile already in the pool was clicked: make it the active asset. */
  onActivate: (assetId: string) => void;
}

/**
 * The tiles of the Library's Winnow tab: what the instance holds for the span
 * the active tool is on, fetched one picture per click.
 *
 * It is a VIEW of the instance, never a pool of its own — the maintainer's
 * design: *"en mode sidebar winnow ça change automatiquement les médias
 * affichés en fonction de la date range"*, so nothing accumulates when the
 * day changes and nothing needs cleaning. What a click fetches lands in the
 * ordinary Library through `addFiles`, vouched for by `materialize`, and
 * from then on it is an ordinary asset: it grades, exports and comes back by
 * itself after a reload (`resolve-media.ts`). A tile whose picture is already
 * in the pool is marked and only re-activates it.
 *
 * Fixed-height tiles, not `aspect-square` — the trap `frontend.md` records
 * for exactly this kind of grid.
 */
export default function WinnowScopeGrid({
  connection,
  client,
  from,
  to,
  scope,
  query,
  inLibrary,
  activeId,
  onPicked,
  onActivate,
}: WinnowScopeGridProps) {
  const { rows, problem, reload } = scope;
  const [fetching, setFetching] = useState<number | null>(null);
  const [pickProblem, setPickProblem] = useState<RowsProblem | null>(null);

  const pick = useCallback(
    async (row: WinnowAssetRow) => {
      const have = inLibrary.get(`${connection.id}/${row.id}`);
      if (have) {
        onActivate(have);
        return;
      }
      setFetching(row.id);
      setPickProblem(null);
      try {
        const files = await materialize(client, connection.id, row, { fidelity: 'proxy' });
        if (files.length) onPicked(files, fileBaseName(files[0].name).toLowerCase());
      } catch (err) {
        setPickProblem(
          err instanceof WinnowError && err.kind === 'unauthenticated'
            ? { text: `Not signed in to ${connection.id}.`, login: client.loginUrl() }
            : { text: err instanceof Error ? err.message : String(err) },
        );
      } finally {
        setFetching(null);
      }
    },
    [client, connection.id, inLibrary, onActivate, onPicked],
  );

  const shown = (rows ?? []).filter(
    (r) => !query || r.filename.toLowerCase().includes(query),
  );
  const shownProblem = pickProblem ?? problem;

  return (
    <div className="flex flex-col gap-2">
      {rows === null && !problem ? (
        <p className="m-0 font-mono text-[0.68rem] text-muted">asking {connection.id}…</p>
      ) : rows !== null && rows.length === 0 && !problem ? (
        <p className="m-0 text-[0.78rem] text-muted">
          {connection.id} holds nothing shot {from === to ? `on ${from}` : `from ${from} to ${to}`}.
        </p>
      ) : shown.length === 0 && rows && rows.length > 0 ? (
        <p className="m-0 text-[0.78rem] text-muted">Nothing here matches the filter.</p>
      ) : (
        <div className="w-full grid grid-cols-[repeat(auto-fill,minmax(74px,1fr))] gap-1.5">
          {shown.map((r) => {
            const have = inLibrary.get(`${connection.id}/${r.id}`);
            const active = have !== undefined && have === activeId;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => void pick(r)}
                disabled={fetching !== null}
                aria-pressed={active}
                title={`${r.filename}${r.has_telemetry ? ' · flight log' : ''}${
                  have ? ' · in the library' : ''
                }`}
                className={`relative block rounded-md overflow-hidden border bg-frame cursor-pointer p-0 disabled:cursor-wait transition-colors ${
                  active
                    ? 'border-accent shadow-[inset_0_0_0_2px_var(--color-accent)]'
                    : have
                      ? 'border-line-strong'
                      : 'border-line hover:border-line-strong'
                }`}
              >
                <img
                  src={client.thumbUrl(r.id)}
                  alt={r.filename}
                  crossOrigin="use-credentials"
                  loading="lazy"
                  className="block w-full h-[74px] object-cover"
                />
                {r.media_type === 'video' && (
                  <span
                    className="absolute top-1 left-1 font-mono text-[0.55rem] text-paper bg-[rgba(20,18,15,0.62)] px-1 rounded-[3px] leading-[1.4]"
                    aria-hidden="true"
                  >
                    ▶{r.has_telemetry ? ' srt' : ''}
                  </span>
                )}
                {have && !active && (
                  <span
                    className="absolute bottom-1 right-1 w-[14px] h-[14px] grid place-items-center rounded-full bg-paper text-ink text-[0.6rem] leading-none border border-line-strong"
                    aria-hidden="true"
                    title="In the library"
                  >
                    ✓
                  </span>
                )}
                {fetching === r.id && (
                  <span className="absolute inset-0 grid place-items-center bg-[rgba(20,18,15,0.55)] font-mono text-[0.58rem] text-paper">
                    fetching…
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {shownProblem && (
        <p className="m-0 text-[0.78rem] text-[#9a3a23]" role="alert">
          {shownProblem.text}{' '}
          {shownProblem.login && (
            <a
              className="font-semibold underline underline-offset-[3px]"
              href={shownProblem.login}
              target="_blank"
              rel="noreferrer"
            >
              Sign in there
            </a>
          )}{' '}
          <button
            type="button"
            onClick={() => {
              setPickProblem(null);
              reload();
            }}
            className="p-0 border-0 bg-transparent text-[0.74rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-ink"
          >
            ask again
          </button>
        </p>
      )}
    </div>
  );
}
