import { useEffect, useMemo, useRef, useState } from 'react';
import { WinnowClient } from '../../shared/sources/winnow/client';
import type { WinnowConnection } from '../../shared/sources/winnow/store';
import type { CountedSpan } from '../../shared/story/sources';
import type { WallPick } from '../../shared/story/story-facts';
import { pickWall, rankBy, type WallCandidate, type WallRules } from '../../shared/story/wall-pick';
import Button from '../../shared/ui/Button';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import { readCandidates } from './wall-candidates';

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * The wall chosen by rules, corrected by hand (his ask, 2026-11-01): the
 * wall's pictures as the rules choose them; a click on one says why it is
 * there and offers Remove (the next under the same rules takes its place at
 * once), Pin (it stays whatever the rules or the number of places) and the
 * other pictures of its day to swap for (the old one removed, the new one
 * pinned). Apply keeps his pins and removals in the script — apart from the
 * rules, so no setting ever undoes them — and freezes the wall.
 */
export default function WallRulesModal({
  connection,
  candidatesKey,
  span,
  chosen,
  rules,
  places,
  pins: pins0,
  removed: removed0,
  onCancel,
  onApply,
}: {
  connection: WinnowConnection;
  candidatesKey: string;
  span: CountedSpan;
  chosen: readonly (readonly [number, string])[] | null;
  rules: WallRules;
  places: number;
  pins: readonly number[];
  removed: readonly number[];
  onCancel: () => void;
  onApply: (corrections: { pin: number[]; skip: number[] }, picks: WallPick[]) => void;
}) {
  const client = useMemo(() => new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth }), [connection]);
  const [cands, setCands] = useState<WallCandidate[] | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pins, setPins] = useState<Set<number>>(() => new Set(pins0));
  const [removed, setRemoved] = useState<Set<number>>(() => new Set(removed0));
  const [open, setOpen] = useState<number | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());

  useEffect(() => {
    const ask = new AbortController();
    readCandidates(client, candidatesKey, span, chosen, ask.signal, (done, total) => setProgress([done, total]))
      .then((c) => !ask.signal.aborted && setCands(c))
      .catch((err: unknown) => !ask.signal.aborted && setFailed(err instanceof Error ? err.message : String(err)));
    return () => ask.abort();
  }, [client, candidatesKey, span, chosen]);

  const outcome = useMemo(() => (cands ? pickWall(cands, rules, places, { pins: [...pins], removed: [...removed] }) : null), [cands, rules, places, pins, removed]);
  const byId = useMemo(() => new Map((cands ?? []).map((c) => [c.id, c])), [cands]);
  // What comes in after a correction is outlined, so a removal shows where its replacement went.
  const shown = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!outcome) return;
    const now = new Set(outcome.picks.map((p) => p.id));
    const before = shown.current;
    shown.current = now;
    if (before) setFresh(new Set([...now].filter((id) => !before.has(id))));
  }, [outcome]);
  const remove = (id: number) => {
    setRemoved((r) => new Set(r).add(id));
    setPins((p) => {
      const next = new Set(p);
      next.delete(id);
      return next;
    });
    setOpen(null);
  };
  const togglePin = (id: number) =>
    setPins((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const swap = (from: number, to: number) => {
    setRemoved((r) => new Set(r).add(from));
    setPins((p) => {
      const next = new Set(p);
      next.delete(from);
      next.add(to);
      return next;
    });
    setOpen(null);
  };
  const apply = () => {
    if (!outcome) return;
    onApply({ pin: [...pins], skip: [...removed] }, outcome.picks.map((p) => ({ id: p.id, day: p.day })));
  };
  useDialogKeys({ onCancel: open !== null ? () => setOpen(null) : onCancel, onConfirm: outcome ? apply : null });

  const sel = open !== null ? outcome?.picks.find((p) => p.id === open) ?? null : null;
  const selCand = sel ? byId.get(sel.id) : null;
  const sameDay = useMemo(() => {
    if (!sel || !cands) return [];
    const on = new Set(outcome?.picks.map((p) => p.id));
    return cands.filter((c) => c.day === sel.day && !on.has(c.id) && !removed.has(c.id)).sort(rankBy(rules.prefer)).slice(0, 18);
  }, [sel, cands, outcome, removed, rules.prefer]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center max-[560px]:items-end p-4 max-[560px]:p-0 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="story-wall-rules-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[52rem] max-[560px]:max-w-none max-h-[calc(var(--app-h,100%)-2rem)] max-[560px]:max-h-[92%] flex flex-col gap-3 bg-surface border border-line rounded-paper-lg max-[560px]:rounded-b-none shadow-paper p-5 max-[560px]:pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
        <div>
          <h2 id="story-wall-rules-title" className="m-0 font-serif text-2xl">
            Correct the wall
          </h2>
          <p className="m-0 mt-1 text-sm text-muted">Click a picture: Remove it and the next under your rules takes its place, Pin it so it stays, or swap it for another of its day.</p>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {failed ? (
            <p className="m-0 text-sm text-danger">{failed}</p>
          ) : !outcome ? (
            <p className="m-0 text-sm text-muted" role="status">
              Reading the pictures{progress ? ` · ${progress[0].toLocaleString('en-GB')} of about ${progress[1].toLocaleString('en-GB')}` : ''}…
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5">
              {outcome.picks.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-label={`${dayLabel(p.day)}${p.pinned ? ', pinned' : ''}: ${p.why}`}
                  aria-pressed={open === p.id}
                  onClick={() => setOpen(open === p.id ? null : p.id)}
                  className={`relative aspect-square rounded-[6px] overflow-hidden cursor-pointer bg-paper-2 border-2 ${
                    open === p.id ? 'border-accent' : p.pinned ? 'border-ok' : fresh.has(p.id) ? 'border-warn' : 'border-transparent'
                  }`}
                >
                  <img src={client.thumbUrl(p.id)} alt="" loading="lazy" className="block w-full h-full object-cover" />
                  {p.pinned ? <span className="absolute left-1 top-1 rounded-full bg-ok px-1 font-mono text-3xs text-paper">pin</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>
        {sel && selCand ? (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <p className="m-0 text-xs text-ink-soft">
              <b>{dayLabel(sel.day)}</b> — {sel.why}
              <span className="text-muted">
                {' '}
                · {[selCand.pick ? 'picked' : selCand.reject ? 'rejected' : '', selCand.stars ? `★${selCand.stars}` : '', selCand.edited ? 'edited' : '', selCand.faces ? `${selCand.faces} face${selCand.faces > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}
              </span>
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="danger" onClick={() => remove(sel.id)}>
                Remove
              </Button>
              <Button size="sm" onClick={() => togglePin(sel.id)}>
                {pins.has(sel.id) ? 'Unpin' : 'Pin'}
              </Button>
            </div>
            {sameDay.length ? (
              <>
                <span className="font-mono text-3xs uppercase tracking-[0.12em] text-muted">Or swap it for another of that day — it is then pinned</span>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {sameDay.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-label={`Swap for picture ${c.id}${c.stars ? `, ★${c.stars}` : ''}${c.pick ? ', picked' : ''}`}
                      onClick={() => swap(sel.id, c.id)}
                      className="shrink-0 w-16 h-16 rounded-[6px] overflow-hidden border border-line cursor-pointer bg-paper-2"
                    >
                      <img src={client.thumbUrl(c.id)} alt="" loading="lazy" className="block w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="m-0 text-2xs text-muted">No other picture of that day left to swap with.</p>
            )}
          </div>
        ) : null}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted tabular-nums" role="status">
            {outcome ? `${outcome.picks.length} on the wall · ${pins.size} pinned · ${removed.size} removed` : ''}
          </span>
          <span className="flex-1" />
          {pins.size || removed.size ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPins(new Set());
                setRemoved(new Set());
              }}
            >
              Undo my corrections
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={apply} disabled={!outcome}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
