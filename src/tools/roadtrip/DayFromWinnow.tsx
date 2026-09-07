import { useCallback, useEffect, useState } from 'react';
import { fileBaseName } from '../../shared/library/assets';
import { WinnowError, type WinnowAssetRow } from '../../shared/sources/winnow/client';
import { materialize } from '../../shared/sources/winnow/materialize';
import { useWinnowConnection } from '../../shared/sources/winnow/use-connection';
import { useScopeRows, type RowsProblem } from '../../shared/sources/winnow/use-scope-rows';
import { legend, section } from './panels/ui';

interface DayFromWinnowProps {
  /** The day this piece tells — the query, so nobody types a date twice. */
  day: string;
  /**
   * A picture was fetched: its files (the picture, and a `.srt` beside a clip)
   * and the Library id they will build into, so the caller can make it the
   * active asset without waiting to recognise it by name.
   */
  onPicked: (files: File[], assetId: string) => void;
  /**
   * Open without being asked. True when the slide has no picture — which is
   * the whole friction this exists for; false when it has one, so a piece
   * already composed does not fetch a strip of thumbnails nobody looked at.
   */
  defaultOpen: boolean;
  /**
   * The slide is already busy bringing its own picture back from an instance
   * (`SlideRecovery`). Picking here meanwhile would race that fetch for which
   * picture the slide ends up with, so the tiles wait — and say why.
   */
  busy?: boolean;
}

/**
 * The day's pictures, from the Winnow that holds them.
 *
 * The friction this removes, in the maintainer's words: *"i have to pick the
 * day that matches the current roadtrip element data manually"*, and picked
 * media *"pollutes the list"* once the piece moves on. A post is keyed by the
 * day it tells, and an instance can be asked for exactly that day — so the
 * date is never typed, and the strip re-points itself when another piece is
 * opened.
 *
 * What it deliberately does not do:
 *
 * - **No bulk add.** One picture crosses the wire per click, at proxy
 *   fidelity, and nothing is fetched until a person asks for it. The full
 *   browser (`WinnowBrowser`) stays the way to bring a whole day in; this is
 *   the way to dress ONE piece, and it is what keeps the pool from filling
 *   with a day the author has moved past.
 * - **No second pool.** The picture lands in the ordinary Library through
 *   `addFiles`, vouched for by `materialize` with the original's hash and id,
 *   so it grades, exports and — after a reload — comes back by itself
 *   (`resolve-media.ts`).
 * - **No request at boot, and none for a source nobody allowed.** The list is
 *   one JSON call for one day, made when this section is open, against a
 *   connection the user confirmed on `#/connect`.
 */
export default function DayFromWinnow({ day, onPicked, defaultOpen, busy }: DayFromWinnowProps) {
  // The same connection and the same read as the Library's Winnow tab
  // (`use-connection.ts`, `use-scope-rows.ts`): one place says which instance
  // and one place asks it, so the two surfaces cannot drift apart.
  const { connection, client } = useWinnowConnection();

  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    setOpen(defaultOpen);
  }, [day, defaultOpen]);

  // Asked only while open: a folded strip costs no request. The hook forgets
  // the last day's answer before asking for the new one.
  const scope = useScopeRows(client, connection?.id ?? null, day, day, open);
  const [fetching, setFetching] = useState<number | null>(null);
  const [pickProblem, setPickProblem] = useState<RowsProblem | null>(null);
  const rows = scope.rows;
  const problem = pickProblem ?? scope.problem;

  const pick = useCallback(
    async (row: WinnowAssetRow) => {
      if (!client || !connection) return;
      setFetching(row.id);
      setPickProblem(null);
      try {
        const files = await materialize(client, connection.id, row, { fidelity: 'proxy' });
        if (!files.length) return;
        onPicked(files, fileBaseName(files[0].name).toLowerCase());
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
    [client, connection, onPicked],
  );

  if (!connection || !client) return null;

  return (
    <div className={section}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={legend}>This day · on {connection.id}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="font-mono text-[0.58rem] tracking-[0.1em] uppercase text-muted hover:text-accent bg-transparent border-0 p-0 cursor-pointer"
        >
          {open ? 'hide' : 'show'}
        </button>
      </div>

      {!open ? (
        <p className="m-0 text-[0.78rem] text-muted">
          The pictures {connection.id} holds for {day}, without leaving this piece.
        </p>
      ) : rows === null ? (
        <p className="m-0 font-mono text-[0.72rem] text-muted">asking {connection.id}…</p>
      ) : rows.length === 0 && !problem ? (
        <p className="m-0 text-[0.78rem] text-muted">
          {connection.id} holds nothing shot on {day}.
        </p>
      ) : (
        <div
          className="w-full grid grid-cols-[repeat(auto-fill,minmax(74px,1fr))] gap-1.5 max-h-[13rem] overflow-auto pr-1"
          title={busy ? 'Waiting for this slide’s own picture to come back' : undefined}
        >
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => void pick(r)}
              disabled={fetching !== null || busy === true}
              title={`${r.filename}${r.has_telemetry ? ' · flight log' : ''}`}
              className="relative block rounded-md overflow-hidden border border-line bg-frame cursor-pointer p-0 disabled:cursor-wait hover:border-line-strong"
            >
              {/* Fixed height, not `aspect-square`: the calendar cells in
                  WinnowBrowser hit exactly this trap (aspect-ratio collapsing
                  a tile in an auto-fill/minmax grid once the panel's own width
                  turns indefinite — the stacked, sub-820px editor layout is
                  one such case) and were fixed the same way. A `1fr` track
                  cannot be trusted to carry a ratio; a pixel height can. */}
              <img
                src={client.thumbUrl(r.id)}
                alt={r.filename}
                crossOrigin="use-credentials"
                loading="lazy"
                className="block w-full h-[74px] object-cover"
              />
              {fetching === r.id && (
                <span className="absolute inset-0 grid place-items-center bg-[rgba(20,18,15,0.55)] font-mono text-[0.58rem] text-paper">
                  fetching…
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {problem && (
        <p className="m-0 text-[0.78rem] text-[#9a3a23]" role="alert">
          {problem.text}{' '}
          {problem.login && (
            <a
              className="font-semibold underline underline-offset-[3px]"
              href={problem.login}
              target="_blank"
              rel="noreferrer"
            >
              Sign in there
            </a>
          )}
        </p>
      )}
    </div>
  );
}
