import { useEffect, useMemo, useState } from 'react';
import { WinnowClient, type WinnowCalendarDay } from '../../shared/sources/winnow/client';
import type { WinnowConnection } from '../../shared/sources/winnow/store';
import type { CountedSpan } from '../../shared/story/sources';
import { counts, wallPicks } from '../../shared/story/story-facts';
import type { ScriptSources } from '../../shared/story/story-script';
import Button from '../../shared/ui/Button';
import useDialogKeys from '../../shared/ui/use-dialog-keys';

type Wall = NonNullable<ScriptSources['wall']>;

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * The wall's pictures, chosen by hand (his ask, 2026-10-31): one picture per
 * counted day — its cover on the Winnow, or one he picked — shown as it will
 * be on the wall. A click hides a picture (its day leaves the wall); « Other »
 * opens that day's pictures to pick another. Apply keeps the choice in the
 * script and freezes the wall at once, without counting again.
 */
export default function WallModal({
  span,
  current,
  tiles,
  connection,
  onCancel,
  onApply,
}: {
  span: CountedSpan;
  current: Wall | undefined;
  /** How many tiles the wall has. */
  tiles: number;
  connection: WinnowConnection;
  onCancel: () => void;
  onApply: (wall: Wall | null, picks: number[]) => void;
}) {
  const client = useMemo(() => new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth }), [connection]);
  const [days, setDays] = useState<WinnowCalendarDay[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [skip, setSkip] = useState<Set<number>>(() => new Set(current?.skip ?? []));
  const [pick, setPick] = useState<Record<string, number>>(() => ({ ...(current?.pick ?? {}) }));
  const [open, setOpen] = useState<string | null>(null);
  const [others, setOthers] = useState<number[] | null>(null);

  // The span arrives as a new object on every render of the panel: its days are the key.
  const spanKey = JSON.stringify(span);
  useEffect(() => {
    let alive = true;
    const span = JSON.parse(spanKey) as CountedSpan;
    client
      .calendar(span.from, span.to)
      .then((cal) => {
        if (alive) setDays(cal.days.filter((d) => counts(d.date, span) && d.count > 0).sort((a, b) => a.date.localeCompare(b.date)));
      })
      .catch((err) => {
        if (alive) setFailed(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [client, spanKey]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setOthers(null);
    client
      .allAssets({ dateFrom: open, dateTo: open }, 60)
      .then((rows) => {
        if (alive) setOthers(rows.map((r) => r.id));
      })
      .catch(() => {
        if (alive) setOthers([]);
      });
    return () => {
      alive = false;
    };
  }, [client, open]);

  const shown = days ? days.filter((d) => !skip.has(pick[d.date] ?? d.cover_id)).length : 0;
  const apply = () => {
    if (!days) return;
    const keptPick = Object.fromEntries(Object.entries(pick).filter(([d, id]) => days.some((x) => x.date === d && x.cover_id !== id)));
    const wall: Wall = { ...(skip.size ? { skip: [...skip] } : {}), ...(Object.keys(keptPick).length ? { pick: keptPick } : {}) };
    const picks = wallPicks({ days, bounds: null }, span, tiles, wall);
    onApply(wall.skip || wall.pick ? wall : null, picks);
  };
  useDialogKeys({ onCancel, onConfirm: days ? apply : null });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center max-[560px]:items-end p-4 max-[560px]:p-0 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="story-wall-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[44rem] max-[560px]:max-w-none max-h-[calc(var(--app-h,100%)-2rem)] max-[560px]:max-h-[90%] flex flex-col gap-4 bg-surface border border-line rounded-paper-lg max-[560px]:rounded-b-none shadow-paper p-6 max-[560px]:pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <div>
          <h2 id="story-wall-title" className="m-0 font-serif text-2xl">
            The wall&apos;s pictures
          </h2>
          <p className="m-0 mt-1 text-sm text-muted">One picture a day. Click to hide it; Other picks another of that day.</p>
        </div>
        <div className="min-h-0 overflow-y-auto">
          {failed ? (
            <p className="m-0 text-sm text-danger">{failed}</p>
          ) : days === null ? (
            <p className="m-0 text-sm text-muted">Reading the days…</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
              {days.map((d) => {
                const id = pick[d.date] ?? d.cover_id;
                const hidden = skip.has(id);
                return (
                  <div key={d.date} className="flex flex-col gap-1 min-w-0">
                    <button
                      type="button"
                      aria-pressed={!hidden}
                      aria-label={`${d.date}: ${hidden ? 'hidden' : 'shown'}`}
                      onClick={() =>
                        setSkip((s) => {
                          const next = new Set(s);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                      className={`relative aspect-square rounded-[8px] overflow-hidden border cursor-pointer bg-paper-2 ${
                        hidden ? 'border-line opacity-30 grayscale' : pick[d.date] ? 'border-accent' : 'border-line-strong'
                      }`}
                    >
                      <img src={client.thumbUrl(id)} alt="" loading="lazy" className="block w-full h-full object-cover" />
                    </button>
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="min-w-0 truncate font-mono text-3xs text-muted tabular-nums">{dayLabel(d.date)}</span>
                      <button
                        type="button"
                        className="ml-auto text-3xs text-accent-ink font-semibold cursor-pointer"
                        onClick={() => setOpen(open === d.date ? null : d.date)}
                      >
                        {open === d.date ? 'Close' : 'Other'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {open ? (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <span className="font-mono text-2xs tracking-[0.14em] uppercase text-muted">{dayLabel(open)} — pick its picture</span>
            {others === null ? (
              <p className="m-0 text-xs text-muted">Reading the day…</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {others.map((id) => {
                  const day = days?.find((x) => x.date === open);
                  const chosen = (pick[open] ?? day?.cover_id) === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-label={`Use picture ${id} for ${open}`}
                      aria-pressed={chosen}
                      onClick={() => setPick((p) => ({ ...p, [open]: id }))}
                      className={`shrink-0 w-20 h-20 rounded-[8px] overflow-hidden border-2 cursor-pointer bg-paper-2 ${chosen ? 'border-accent' : 'border-transparent'}`}
                    >
                      <img src={client.thumbUrl(id)} alt="" loading="lazy" className="block w-full h-full object-cover" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted tabular-nums" role="status">
            {days ? `${Math.min(shown, tiles)} pictures on the wall${shown > tiles ? ` (of ${shown} days, thinned)` : ''}` : ''}
          </span>
          <span className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSkip(new Set());
              setPick({});
            }}
          >
            Reset
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={apply} disabled={!days}>
            Use these pictures
          </Button>
        </div>
      </div>
    </div>
  );
}
