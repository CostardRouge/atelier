import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { rulerFraction, rulerIndex, rulerKey, rulerTicks } from './roll-ruler';

export interface RollRulerProps {
  /** The pictures the band shows, in its order. */
  count: number;
  /** The open picture among them, or −1. */
  at: number;
  /** What the band shows when a filter is on («Edited»), said beside the count in the accent; null for every picture. */
  filterLabel: string | null;
  /** Open the picture at this index of what the band shows. */
  onPick: (index: number) => void;
}

/**
 * The band head's middle on a phone (`roll-ruler.ts`): the count over a
 * ruler of the pictures the band shows, one tick each, the open one in the
 * accent. A finger dragged along it says which picture it is over (the count
 * and the mark follow) and opens that picture when it lifts — opening on
 * every move would decode a picture per tick. The whole 34 px block is the
 * target, so the ticks can stay a hairline. Arrows, Home and End step it.
 */
export default function RollRuler({ count, at, filterLabel, onPick }: RollRulerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState<number | null>(null);
  const shown = over ?? at;

  const indexAt = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    return box ? rulerIndex(clientX - box.left, box.width, count) : -1;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (count <= 0 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setOver(indexAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (over === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const next = indexAt(e.clientX);
    if (next !== over) setOver(next);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (over === null) return;
    const landed = indexAt(e.clientX);
    setOver(null);
    if (landed >= 0 && landed !== at) onPick(landed);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = rulerKey(e.key, at, count);
    if (next === null) return;
    // The roll's own ← / → would step a second time.
    e.preventDefault();
    e.stopPropagation();
    if (next !== at) onPick(next);
  };

  const ticks = rulerTicks(count);
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Where you are in the roll — drag to travel it"
      aria-valuemin={1}
      aria-valuemax={Math.max(1, count)}
      aria-valuenow={shown >= 0 ? shown + 1 : 1}
      aria-valuetext={`Picture ${shown >= 0 ? shown + 1 : '–'} of ${count}${filterLabel ? `, ${filterLabel}` : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setOver(null)}
      onKeyDown={onKeyDown}
      // The ruler writes X only: a vertical swipe stays the page's.
      className="flex-1 min-w-0 h-[2.125rem] flex flex-col justify-center gap-[3px] px-1 cursor-ew-resize select-none touch-pan-y rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="font-mono text-3xs tracking-[0.1em] uppercase text-muted tabular-nums whitespace-nowrap truncate" aria-hidden="true">
        <span className={over !== null ? 'text-accent-ink' : 'text-ink'}>{shown >= 0 ? String(shown + 1).padStart(2, '0') : '–'}</span>
        {' / '}
        {count}
        {filterLabel && <span className="text-accent-ink"> · {filterLabel}</span>}
      </span>
      <span className="relative flex items-end gap-[2px] h-2" aria-hidden="true">
        {ticks ? (
          Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className={`flex-1 rounded-[1px] ${i === shown ? 'h-2 bg-accent' : i % 6 === 0 ? 'h-1.5 bg-faint' : 'h-1 bg-faint'}`}
            />
          ))
        ) : (
          <>
            <span className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-faint" />
            {shown >= 0 && (
              <span
                className="absolute bottom-0 w-[3px] h-2 -ml-[1.5px] rounded-[1px] bg-accent"
                style={{ left: `${rulerFraction(shown, count) * 100}%` }}
              />
            )}
          </>
        )}
      </span>
    </div>
  );
}
