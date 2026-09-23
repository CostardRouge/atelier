import { useEffect, useMemo, useState } from 'react';
import type { SavedMediaRef } from '../../shared/projects/project-types';
import { sameMediaRef } from '../../shared/develop/roll-types';
import { addDays, formatIsoDate, isIsoDate } from '../../shared/roadtrip/trip-days';
import { rowMediaRef } from '../../shared/sources/winnow/materialize';
import { useWinnowConnection } from '../../shared/sources/winnow/use-connection';
import { useScopeRows } from '../../shared/sources/winnow/use-scope-rows';
import WinnowThumb from '../../shared/sources/winnow/WinnowThumb';
import Button from '../../shared/ui/Button';
import { DateField } from '../../shared/ui/DateField';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import LoadingState from '../../shared/ui/LoadingState';
import useDialogKeys from '../../shared/ui/use-dialog-keys';

/**
 * One day of the connected Winnow, picked from INSIDE a roll (F3 of
 * `docs/develop-tool.md` §9) — the Library is no longer the way in.
 *
 * What it hands back is REFERENCES, made from the instance's rows
 * (`rowMediaRef`): nothing is fetched here but the list and the tiles'
 * thumbnails, and the roll fetches each picture when it is opened
 * (`use-roll-media.ts`). Photos only — a roll develops stills. Everything the
 * roll does not hold starts ticked (the hook chooser's rule: a person came for
 * the day), and what it holds is shown and cannot be ticked twice.
 */
export default function WinnowDaySheet({
  initialDay,
  held,
  onCancel,
  onAdd,
}: {
  initialDay: string;
  /** The refs already on the roll. */
  held: readonly SavedMediaRef[];
  onCancel: () => void;
  onAdd: (refs: SavedMediaRef[], sourceId: string) => void;
}) {
  const { connection, client } = useWinnowConnection();
  const [day, setDay] = useState(initialDay);
  const { rows, problem, reload } = useScopeRows(client, connection?.id ?? null, day, day, Boolean(connection));

  const photos = useMemo(() => {
    if (!rows || !connection) return [];
    return rows
      .filter((r) => r.media_type === 'photo')
      .map((row) => {
        const ref = rowMediaRef(connection.id, row);
        return { row, ref, onRoll: held.some((h) => sameMediaRef(h, ref)) };
      });
  }, [rows, connection, held]);

  // A new day starts with everything the roll does not hold ticked.
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    setTicked(new Set(photos.filter((p) => !p.onRoll).map((p) => p.row.id)));
    // Re-seeded when the day's answer arrives, never on a tick.
  }, [rows]);

  const chosen = photos.filter((p) => !p.onRoll && ticked.has(p.row.id));
  const add = () => {
    if (!connection || chosen.length === 0) return;
    onAdd(
      chosen.map((p) => p.ref),
      connection.id,
    );
  };
  useDialogKeys({ onCancel, onConfirm: chosen.length > 0 ? add : null });

  const step = (by: number) => {
    const next = addDays(day, by);
    if (next) setDay(next);
  };
  const onRollCount = photos.filter((p) => p.onRoll).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={`Add a day from ${connection?.id ?? 'your Winnow'}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[44rem] h-[min(80dvh,40rem)] flex flex-col gap-3 bg-surface border border-line rounded-paper-lg shadow-paper p-5 max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:p-3 max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex-none flex items-center gap-2 flex-wrap">
          <h2 className="m-0 font-serif text-2xl leading-tight flex-1 min-w-0 truncate">
            Add from {connection?.id ?? 'your Winnow'}
          </h2>
          <IconButton label="The day before" onClick={() => step(-1)}>
            {Icons.back}
          </IconButton>
          <DateField
            value={day}
            onChange={(v) => {
              if (isIsoDate(v)) setDay(v);
            }}
            label="Day"
            format={formatIsoDate}
          />
          <IconButton label="The day after" onClick={() => step(1)}>
            {Icons.forward}
          </IconButton>
        </div>

        <p className="m-0 flex-none font-mono text-2xs text-muted tabular-nums">
          {!connection
            ? 'No Winnow is connected — connect one in Sources.'
            : rows === null
              ? 'asking…'
              : photos.length === 0
                ? 'no photographs on this day'
                : `${photos.length} photograph${photos.length === 1 ? '' : 's'}${
                    onRollCount ? ` · ${onRollCount} already on the roll` : ''
                  } · ${chosen.length} ticked`}
          {problem && (
            <span className="text-danger">
              {' '}
              · {problem.text}{' '}
              {problem.login && (
                <a href={problem.login} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  Sign in
                </a>
              )}{' '}
              <button type="button" onClick={reload} className="underline underline-offset-2 cursor-pointer">
                Try again
              </button>
            </span>
          )}
        </p>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {connection && rows === null ? (
            <LoadingState label="Asking the instance…" />
          ) : (
            // Rows pinned in pixels: an `auto` row in a scrolling tile grid is
            // clipped to a sliver (`frontend.md`).
            <ul className="m-0 p-0 list-none grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] auto-rows-[6.5rem] gap-2">
              {client &&
                photos.map(({ row, onRoll }) => {
                  const on = ticked.has(row.id);
                  return (
                    <li key={row.id} className="relative min-w-0">
                      <button
                        type="button"
                        disabled={onRoll}
                        aria-pressed={onRoll ? undefined : on}
                        aria-label={`${row.filename}${onRoll ? ', already on the roll' : on ? ', ticked' : ''}`}
                        title={row.filename}
                        onClick={() =>
                          setTicked((s) => {
                            const next = new Set(s);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          })
                        }
                        className={`relative block w-full h-full p-0 rounded-paper overflow-hidden bg-frame border-2 cursor-pointer disabled:cursor-default ${
                          onRoll ? 'border-transparent opacity-45' : on ? 'border-accent' : 'border-transparent opacity-70 hover:opacity-100'
                        }`}
                      >
                        <WinnowThumb client={client} id={row.id} label={row.ext} box="w-full h-full" />
                        {!onRoll && (
                          <span
                            className={`absolute left-1.5 top-1.5 w-5 h-5 grid place-items-center rounded-full border text-3xs ${
                              on ? 'bg-accent border-accent text-paper' : 'bg-surface/80 border-line-strong text-transparent'
                            }`}
                            aria-hidden="true"
                          >
                            {Icons.check}
                          </span>
                        )}
                        {onRoll && (
                          <span className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-[rgba(13,12,10,0.7)] font-mono text-3xs text-on-media text-left">
                            on the roll
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>

        <div className="flex-none flex items-center justify-end gap-2 pt-3 border-t border-line flex-wrap">
          {photos.some((p) => !p.onRoll) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setTicked(
                  chosen.length === photos.filter((p) => !p.onRoll).length
                    ? new Set()
                    : new Set(photos.filter((p) => !p.onRoll).map((p) => p.row.id)),
                )
              }
              className="mr-auto"
            >
              {chosen.length === photos.filter((p) => !p.onRoll).length ? 'Tick none' : 'Tick all'}
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" icon={Icons.plus} onClick={add} disabled={chosen.length === 0}>
            {chosen.length === 0 ? 'Add' : `Add ${chosen.length} to the roll`}
          </Button>
        </div>
      </div>
    </div>
  );
}
