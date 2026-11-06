import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { withSwap, type RecapDoc, type RecapPicture } from '../../shared/recap/recap-doc';
import { ownSlots, type RecapSlot, type ResolvedRecap } from '../../shared/recap/recap-slots';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { InspectorSection } from '../../shared/ui/Inspector';
import PictureThumb from './PictureThumb';
import type { Change } from './RecapPanels';

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';

/** The small word a place shows on its tile: a day's number, a step back, a stat's name, a place's rank. */
function shortLabel(doc: RecapDoc, s: RecapSlot, i: number): string {
  if (s.day && (doc.template === 'month' || doc.template === 'week' || doc.template === 'second')) return String(Number(s.day.slice(8, 10)));
  if (s.id.startsWith('ago:')) return s.label.replace(' ago', '');
  if (s.id.startsWith('w:')) return s.label.replace(/^The /, '');
  return String(i + 1);
}

/**
 * The template's own places as a tray (his ask, 2026-11-06: drag and drop in
 * every template, not only the carousel's): each place's picture as a tile in
 * the template's order — a calendar's days in weeks of seven — and a picture
 * dragged onto another place trades places with it (both pinned, `withSwap`);
 * dropped on an empty place it moves there. A click selects the place, the
 * stage showing it. The stage's own drag does the same on the page.
 */
export default function PlacesTray({
  doc,
  resolved,
  change,
  thumbs,
  selected,
  onSelect,
}: {
  doc: RecapDoc;
  resolved: ResolvedRecap;
  change: Change;
  thumbs: { client: WinnowClient | null; instance: string | null; files: ReadonlyMap<string, File> };
  selected: string | null;
  onSelect: (slot: string) => void;
}) {
  const places = useMemo(() => ownSlots(resolved), [resolved]);
  const [drag, setDragState] = useState<{ slot: string; x: number; y: number; sx: number; sy: number; moved: boolean; over: string | null; id: number } | null>(null);
  // The gesture lives in a ref too: a release read from the last RENDER missed the moves when the stage kept the main
  // thread busy (a Wrapped's slides), and the drop was lost.
  const live = useRef(drag);
  const setDrag = (next: typeof drag | ((d: typeof drag) => typeof drag)) => {
    live.current = typeof next === 'function' ? next(live.current) : next;
    setDragState(live.current);
  };
  const byId = useMemo(() => new Map(places.map((s) => [s.id, s])), [places]);
  if (places.length < 2) return null;
  const tile = (pic: RecapPicture) => <PictureThumb pic={pic} client={thumbs.client} instance={thumbs.instance} file={thumbs.files.get(pic.key) ?? null} className="absolute inset-0 w-full h-full" />;
  const dense = places.length > 12;

  const start = (slot: string) => (e: ReactPointerEvent) => {
    if (e.button > 0 || !byId.get(slot)?.picture) return;
    // A finger drags by the grip only, so a touch on a tile still scrolls the inspector.
    if (e.pointerType === 'touch' && !(e.target as HTMLElement).closest('[data-grip]')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ slot, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, over: null, id: e.pointerId });
  };
  const move = (e: ReactPointerEvent) =>
    setDrag((d) => {
      if (!d || d.id !== e.pointerId) return d;
      // Measured from where the press began: a slow drag moves a few pixels at a time.
      const moved = d.moved || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6;
      const under = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-place-key]')?.dataset.placeKey ?? null;
      return { ...d, x: e.clientX, y: e.clientY, moved, over: moved && under !== d.slot ? under : null };
    });
  const end = (e: ReactPointerEvent) => {
    const d = live.current;
    setDrag(null);
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) return onSelect(d.slot);
    if (!d.over) return;
    const a = d.slot;
    const b = d.over;
    const ka = byId.get(a)?.picture?.key ?? null;
    const kb = byId.get(b)?.picture?.key ?? null;
    change((x) => withSwap(x, a, ka, b, kb));
    onSelect(b);
  };
  const held = drag?.moved ? byId.get(drag.slot)?.picture : null;

  return (
    <InspectorSection id="recap-places" title="The places">
      <div className="flex flex-col gap-1.5">
        <span className={legend} title="Drag a picture onto another place to swap them, onto an empty one to move it there">
          Drag to swap · {places.filter((s) => s.picture).length}/{places.length}
        </span>
        <div role="list" aria-label="The places — drag a picture onto another to swap them" className={`grid gap-1 ${dense ? 'grid-cols-7' : 'grid-cols-4'}`}>
          {places.map((s, i) => {
            const pic = s.picture;
            const over = drag?.over === s.id;
            const on = selected === s.id;
            return (
              <div
                key={s.id}
                role="listitem"
                data-place-key={s.id}
                aria-label={`${s.label}${pic ? `, ${pic.name}` : ', empty'}`}
                onPointerDown={start(s.id)}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={() => setDrag(null)}
                onClick={(e) => {
                  // An empty place has no drag: its click selects it.
                  if (!pic && e.detail > 0) onSelect(s.id);
                }}
                className={`relative aspect-square rounded-[4px] overflow-hidden select-none ${pic ? 'bg-frame cursor-grab active:cursor-grabbing' : 'border border-dashed border-line cursor-pointer'} ${drag?.moved && drag.slot === s.id ? 'opacity-35' : ''} ${over ? 'outline outline-2 outline-dashed outline-accent outline-offset-1' : on ? 'outline outline-2 outline-accent' : ''}`}
              >
                {pic && tile(pic)}
                <span className={`absolute left-0.5 top-0.5 px-1 rounded-[3px] font-mono text-3xs tabular-nums ${pic ? 'bg-[rgba(16,15,13,0.6)] text-on-media' : 'text-muted'}`}>{shortLabel(doc, s, i)}</span>
                {pic && s.pinned && <span aria-hidden="true" title="Chosen by hand" className="absolute right-0.5 top-0.5 w-1.5 h-1.5 rounded-full bg-accent" />}
                {pic && (
                  <span data-grip aria-hidden="true" className={`absolute right-0.5 bottom-0.5 inline-flex items-center justify-center rounded-full bg-[rgba(16,15,13,0.72)] text-on-media touch-none ${dense ? 'w-4 h-4 text-3xs pointer-coarse:w-7 pointer-coarse:h-7' : 'w-5 h-5 text-3xs pointer-coarse:w-8 pointer-coarse:h-8'}`}>
                    ⠿
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {held && (
          <div aria-hidden="true" className="pointer-events-none fixed z-50 w-12 aspect-square rounded-[4px] overflow-hidden shadow-paper -translate-x-1/2 -translate-y-1/2 rotate-3" style={{ left: drag!.x, top: drag!.y }}>
            {tile(held)}
          </div>
        )}
      </div>
    </InspectorSection>
  );
}
