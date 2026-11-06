import { useEffect, useMemo, useRef, useState } from 'react';
import { WinnowClient } from '../../shared/sources/winnow/client';
import type { WinnowConnection } from '../../shared/sources/winnow/store';
import type { CountedSpan } from '../../shared/story/sources';
import type { WallPick } from '../../shared/story/story-facts';
import { pickWall, type WallCandidate, type WallRules } from '../../shared/story/wall-pick';
import { beforeOf, laidPicks, sameOrder, wallMoved, wallRemoved, wallReplaceCandidates, wallReplaced, wallSwapped, type WallEntry } from '../../shared/story/wall-correct';
import Button from '../../shared/ui/Button';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import { readCandidates } from './wall-candidates';

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

type Zone = 'before' | 'swap' | 'after';

/**
 * The wall chosen by rules, corrected by hand (his ask, 2026-11-01; Recap's
 * gestures, his yes of 2026-11-06): the wall's pictures in the order they
 * are laid. ✕ takes one off — the wall holds one fewer, nothing comes in;
 * ⇄ offers the next best for that place (nearest in time first) to choose
 * from; a drag onto another picture trades their places, onto its edge puts
 * it before or after it. The first of them FREEZES the wall in that order
 * (`wall-correct.ts`) until «Let the rules choose again». A click says why a
 * picture is there and, while the rules choose, pins it. Apply keeps his
 * pins, removals and order in the script — apart from the rules, so no
 * setting ever undoes them.
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
  order: order0,
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
  order: readonly (readonly [number, string])[] | null;
  onCancel: () => void;
  onApply: (corrections: { pin: number[]; skip: number[]; order: WallEntry[] | null }, picks: WallPick[]) => void;
}) {
  const client = useMemo(() => new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth }), [connection]);
  const [cands, setCands] = useState<WallCandidate[] | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pins, setPins] = useState<Set<number>>(() => new Set(pins0));
  const [removed, setRemoved] = useState<Set<number>>(() => new Set(removed0));
  const [order, setOrder] = useState<WallEntry[] | null>(() => (order0?.length ? order0.map((e): WallEntry => [e[0], e[1]]) : null));
  const [open, setOpen] = useState<number | null>(null);
  const [aim, setAim] = useState<number | null>(null);
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
  const whyOf = useMemo(() => new Map((outcome?.picks ?? []).map((p) => [p.id, p])), [outcome]);
  // What the wall lays: his frozen order, else the rules' choice in day order.
  const shown = useMemo<WallEntry[] | null>(() => order ?? (outcome ? outcome.picks.map((p): WallEntry => [p.id, p.day]) : null), [order, outcome]);
  const frozen = order !== null;
  // What comes in after a correction is outlined, so a replacement shows where it went.
  const seen = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!shown) return;
    const now = new Set(shown.map((e) => e[0]));
    const before = seen.current;
    seen.current = now;
    if (before) setFresh(new Set([...now].filter((id) => !before.has(id))));
  }, [shown]);

  const unpin = (id: number) =>
    setPins((p) => {
      const next = new Set(p);
      next.delete(id);
      return next;
    });
  // ✕: one fewer on the wall, nothing comes in; it stays out when the rules choose again.
  const remove = (id: number) => {
    if (!shown) return;
    setOrder(wallRemoved(shown, id));
    setRemoved((r) => new Set(r).add(id));
    unpin(id);
    if (open === id) setOpen(null);
    if (aim === id) setAim(null);
  };
  // ⇄: the one chosen takes its place — and is pinned, so the rules keep it when they choose again.
  const replace = (id: number, by: WallCandidate) => {
    if (!shown) return;
    setOrder(wallReplaced(shown, id, [by.id, by.day]));
    setRemoved((r) => new Set(r).add(id));
    setPins((p) => {
      const next = new Set(p);
      next.delete(id);
      next.add(by.id);
      return next;
    });
    setAim(null);
    setOpen(null);
  };
  const togglePin = (id: number) =>
    setPins((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const offered = useMemo(() => (aim !== null && cands && shown ? wallReplaceCandidates(cands, rules, shown, [...removed], aim) : []), [aim, cands, shown, rules, removed]);

  // A drag in the wall: the picture held, where the pointer is, the picture under it and which part of it.
  const [drag, setDragState] = useState<{ id: number; x: number; y: number; sx: number; sy: number; moved: boolean; over: number | null; zone: Zone; pointer: number } | null>(null);
  // Read by the release from a ref, never from the last render, which may not have caught up with the moves.
  const live = useRef(drag);
  const setDrag = (next: typeof drag | ((d: typeof drag) => typeof drag)) => {
    live.current = typeof next === 'function' ? next(live.current) : next;
    setDragState(live.current);
  };
  // A drag ends with a click on the tile: that click is not a click.
  const dragged = useRef(false);
  const startDrag = (id: number) => (e: React.PointerEvent) => {
    if (e.button > 0 || (e.target as HTMLElement).closest('button:not([data-grip]):not([data-tile])')) return;
    // A finger drags by the grip only, so a touch on a picture still scrolls the wall.
    if (e.pointerType === 'touch' && !(e.target as HTMLElement).closest('[data-grip]')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragged.current = false;
    setDrag({ id, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, over: null, zone: 'swap', pointer: e.pointerId });
  };
  const moveDrag = (e: React.PointerEvent) => {
    setDrag((d) => {
      if (!d || d.pointer !== e.pointerId) return d;
      // Measured from where the press began: a slow drag moves a few pixels at a time.
      const moved = d.moved || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6;
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-wall-id]') ?? null;
      const under = el ? Number(el.dataset.wallId) : null;
      let zone: Zone = 'swap';
      if (el) {
        const r = el.getBoundingClientRect();
        const u = (e.clientX - r.left) / Math.max(1, r.width);
        zone = u < 0.28 ? 'before' : u > 0.72 ? 'after' : 'swap';
      }
      return { ...d, x: e.clientX, y: e.clientY, moved, over: moved && under !== d.id ? under : null, zone };
    });
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = live.current;
    setDrag(null);
    if (!d || d.pointer !== e.pointerId || !d.moved) return;
    dragged.current = true;
    if (d.over === null || !shown) return;
    const next = d.zone === 'swap' ? wallSwapped(shown, d.id, d.over) : wallMoved(shown, d.id, beforeOf(shown, d.id, d.over, d.zone));
    // A drop where it already was changes and freezes nothing.
    if (!sameOrder(next, shown)) setOrder(next);
  };

  const apply = () => {
    if (!shown) return;
    onApply({ pin: [...pins], skip: [...removed], order }, laidPicks(shown));
  };
  useDialogKeys({ onCancel: aim !== null ? () => setAim(null) : open !== null ? () => setOpen(null) : onCancel, onConfirm: shown ? apply : null });

  const sel = open !== null ? (shown?.find((e) => e[0] === open) ?? null) : null;
  const selCand = sel ? byId.get(sel[0]) : null;
  const selWhy = sel ? (whyOf.get(sel[0])?.why ?? 'your choice') : '';
  const chip = 'inline-flex items-center justify-center rounded-full bg-[rgba(16,15,13,0.72)] text-on-media border-0 w-6 h-6 pointer-coarse:w-9 pointer-coarse:h-9 text-xs';

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
          <p className="m-0 mt-1 text-sm text-muted">✕ takes a picture off, one fewer · ⇄ replaces it · drag onto a picture to swap, onto its edge to move · a click says why it is there.</p>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {failed ? (
            <p className="m-0 text-sm text-danger">{failed}</p>
          ) : !shown ? (
            <p className="m-0 text-sm text-muted" role="status">
              Reading the pictures{progress ? ` · ${progress[0].toLocaleString('en-GB')} of about ${progress[1].toLocaleString('en-GB')}` : ''}…
            </p>
          ) : (
            <div role="list" aria-label="The wall's pictures in their order — drag one onto another to swap them, onto its edge to move it" className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5">
              {shown.map(([id, day]) => {
                const pinned = !frozen && pins.has(id);
                const held = drag?.moved && drag.id === id;
                const under = drag?.over === id ? drag.zone : null;
                return (
                  <div
                    key={id}
                    role="listitem"
                    data-wall-id={id}
                    onPointerDown={startDrag(id)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={() => setDrag(null)}
                    className={`relative aspect-square rounded-[6px] overflow-hidden bg-paper-2 border-2 select-none cursor-grab active:cursor-grabbing ${held ? 'opacity-35' : ''} ${
                      open === id || aim === id ? 'border-accent' : pinned ? 'border-ok' : fresh.has(id) ? 'border-warn' : 'border-transparent'
                    } ${under === 'swap' ? 'outline outline-2 outline-dashed outline-accent outline-offset-1' : ''}`}
                  >
                    <button
                      type="button"
                      data-tile
                      aria-label={`${dayLabel(day)}${pinned ? ', pinned' : ''}: ${whyOf.get(id)?.why ?? 'your choice'}`}
                      aria-pressed={open === id}
                      onClick={() => {
                        if (dragged.current) {
                          dragged.current = false;
                          return;
                        }
                        setOpen(open === id ? null : id);
                      }}
                      className="absolute inset-0 p-0 border-0 bg-transparent cursor-[inherit]"
                    >
                      <img src={client.thumbUrl(id)} alt="" loading="lazy" draggable={false} className="block w-full h-full object-cover" />
                    </button>
                    {pinned ? <span className="absolute left-1 top-1 rounded-full bg-ok px-1 font-mono text-3xs text-paper pointer-events-none">pin</span> : null}
                    {under === 'before' || under === 'after' ? (
                      // Where the picture will land: a bar at the tile's edge.
                      <span aria-hidden="true" className={`absolute top-0 bottom-0 w-1 rounded-full bg-accent shadow-[0_0_0_2px_var(--color-surface)] ${under === 'before' ? 'left-0' : 'right-0'}`} />
                    ) : null}
                    <span
                      data-grip
                      aria-hidden="true"
                      title="Drag onto another picture to swap them, onto its edge to put it before or after"
                      className={`${chip} absolute right-1 bottom-1 touch-none cursor-grab`}
                    >
                      ⠿
                    </span>
                    <span className="absolute right-1 top-1 flex gap-1">
                      <button
                        type="button"
                        aria-pressed={aim === id}
                        aria-label={`Replace the picture of ${dayLabel(day)} — choose among the next best`}
                        title="Replace — choose among the next best"
                        onClick={() => {
                          setOpen(null);
                          setAim((a) => (a === id ? null : id));
                        }}
                        className={`${chip} cursor-pointer hover:bg-accent ${aim === id ? 'bg-accent' : ''}`}
                      >
                        ⇄
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove the picture of ${dayLabel(day)} — one fewer on the wall`}
                        title="Remove — one fewer on the wall"
                        onClick={() => remove(id)}
                        className={`${chip} cursor-pointer hover:bg-accent`}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {drag?.moved ? (
          <div aria-hidden="true" className="pointer-events-none fixed z-[60] w-14 aspect-square rounded-[6px] overflow-hidden shadow-paper -translate-x-1/2 -translate-y-1/2 rotate-3" style={{ left: drag.x, top: drag.y }}>
            <img src={client.thumbUrl(drag.id)} alt="" className="block w-full h-full object-cover" />
          </div>
        ) : null}
        {aim !== null ? (
          <div className="flex flex-col gap-1.5 border-t border-line pt-3">
            <span className="font-mono text-3xs uppercase tracking-[0.12em] text-muted">Replace with · nearest in time first</span>
            {!cands ? (
              <p className="m-0 text-2xs text-muted" role="status">
                Reading the pictures…
              </p>
            ) : offered.length ? (
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {offered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-label={`Use the picture ${c.id} of ${dayLabel(c.day)} instead${c.stars ? `, ★${c.stars}` : ''}${c.pick ? ', picked' : ''}`}
                    title={`${dayLabel(c.day)}${c.pick ? ' · picked' : c.stars ? ` · ★${c.stars}` : ''}`}
                    onClick={() => replace(aim, c)}
                    className="shrink-0 w-16 h-16 rounded-[6px] overflow-hidden border border-line cursor-pointer bg-paper-2 p-0 hover:opacity-80"
                  >
                    <img src={client.thumbUrl(c.id)} alt="" loading="lazy" className="block w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="m-0 text-2xs text-muted">Nothing else under these rules.</p>
            )}
          </div>
        ) : sel ? (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <p className="m-0 text-xs text-ink-soft">
              <b>{dayLabel(sel[1])}</b> — {selWhy}
              {selCand ? (
                <span className="text-muted">
                  {' '}
                  · {[selCand.pick ? 'picked' : selCand.reject ? 'rejected' : '', selCand.stars ? `★${selCand.stars}` : '', selCand.edited ? 'edited' : '', selCand.faces ? `${selCand.faces} face${selCand.faces > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </p>
            {frozen ? null : (
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={() => togglePin(sel[0])}>
                  {pins.has(sel[0]) ? 'Unpin' : 'Pin'}
                </Button>
              </div>
            )}
          </div>
        ) : null}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted tabular-nums" role="status">
            {shown ? `${shown.length} of ${places} places${frozen ? ' · your order' : ` · ${pins.size} pinned`} · ${removed.size} removed` : ''}
          </span>
          {frozen ? (
            <button
              type="button"
              onClick={() => {
                setOrder(null);
                setAim(null);
              }}
              title="The rules choose again; your pins stay and the pictures you removed stay out"
              className="text-xs text-accent-ink underline-offset-2 hover:underline"
            >
              Let the rules choose again
            </button>
          ) : null}
          <span className="flex-1" />
          {pins.size || removed.size || frozen ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPins(new Set());
                setRemoved(new Set());
                setOrder(null);
                setAim(null);
              }}
            >
              Undo my corrections
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={apply} disabled={!shown}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
