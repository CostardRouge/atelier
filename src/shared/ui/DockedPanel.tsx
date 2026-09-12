/**
 * A panel that takes a SHARE of the editor's height instead of covering it.
 *
 * The fourth way of showing a second thing, and the distinction that earns it
 * is what you are doing with that thing. A {@link BottomSheet} is for a panel
 * you ADJUST — a form, an inspector — and covering the stage while you fill it
 * in costs nothing. This is for a panel you CHOOSE from, where the whole
 * question is what the choice looks like on the thing behind it. A library
 * over the stage makes picking a guess followed by a check; a library beside
 * it makes picking a comparison.
 *
 * So there is no scrim and no overlay: it is an ordinary flex child, the stage
 * above genuinely shrinks, and both are live at once.
 *
 * **Two rest heights, and the small one is the point.** `half` is for
 * choosing; `strip` is a single row of candidates that stays out of the way
 * while you compose, one grip apart from the other. They are the same panel,
 * so nothing is re-fetched, re-ordered or re-scrolled crossing between them.
 * Dragging below the strip closes it outright.
 *
 * The arithmetic is `sheet-snap.ts`, unchanged and already tested: a height is
 * a fraction of the viewport, a drag is the finger's travel taken off it, and
 * a release lands on the nearest rest. A dock and a sheet disagree about
 * everything except the maths.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { dragFraction, nextSnap, snapAfterDrag } from './sheet-snap';
import { APP_HEIGHT } from './app-height';
import { readAppHeight } from './use-app-height';

/**
 * Choosing, and composing. `0.46` leaves a 9:16 stage about 380px on a phone —
 * small, but it is the composed piece rather than a thumbnail. `0.13` is one
 * row of candidates; the panel also carries a pixel floor, since a fraction of
 * a short screen can fall under a thumbnail's own height.
 */
export const DOCK_SNAPS: readonly number[] = [0.13, 0.46];

export type DockHeight = 'strip' | 'half';

/** The fraction a named height stands for. Pure. */
export function dockFraction(height: DockHeight): number {
  return height === 'half' ? DOCK_SNAPS[1] : DOCK_SNAPS[0];
}

/** Which named height a loose fraction is nearest. Pure. */
export function dockHeightAt(fraction: number): DockHeight {
  const mid = (DOCK_SNAPS[0] + DOCK_SNAPS[1]) / 2;
  return fraction >= mid ? 'half' : 'strip';
}

export interface DockedPanelProps {
  /** Which rest it sits at. The caller owns it, so it survives a remount. */
  height: DockHeight;
  onHeight: (height: DockHeight) => void;
  /** Dragged below the strip, or dismissed from the header. */
  onClose: () => void;
  /** The panel's own name, in its header. */
  title: string;
  /** A fact beside the title — a day, a count. */
  hint?: ReactNode;
  children: ReactNode;
}

export default function DockedPanel({
  height,
  onHeight,
  onClose,
  title,
  hint,
  children,
}: DockedPanelProps) {
  // While a finger is down the panel follows it exactly, so the transition is
  // off for the duration — a transition mid-drag lags the hand by a frame and
  // reads as a slow phone rather than as an animation.
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<{ id: number; startY: number; from: number } | null>(null);
  const fraction = live ?? dockFraction(height);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      drag.current = { id: e.pointerId, startY: e.clientY, from: dockFraction(height) };
      e.currentTarget.setPointerCapture(e.pointerId);
      setLive(dockFraction(height));
    },
    [height],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setLive(dragFraction(d.from, e.clientY - d.startY, readAppHeight()));
  }, []);

  const end = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      setLive(null);
      // A press that never travelled is a TAP, and a tap swaps the two rests —
      // otherwise the grip is a control a mouse cannot operate and a finger
      // has to know to drag.
      if (Math.abs(e.clientY - d.startY) <= 4) {
        onHeight(dockHeightAt(nextSnap(d.from, DOCK_SNAPS)));
        return;
      }
      const landed = snapAfterDrag(
        dragFraction(d.from, e.clientY - d.startY, readAppHeight()),
        DOCK_SNAPS,
      );
      if (landed === null) onClose();
      else onHeight(dockHeightAt(landed));
    },
    [onClose, onHeight],
  );

  return (
    <section
      aria-label={title}
      style={{ height: `calc(${fraction} * ${APP_HEIGHT})` }}
      // `mt-2`: the panel and the stage share the height, so without it the
      // picture's bottom edge and the panel's own rule are the same line and
      // the split reads as one surface cut in half rather than two things on
      // screen. It is paid out of the stage, like everything else the dock
      // takes, and nothing is clipped against it — the panel is a flex sibling
      // BELOW the scroller, not a gutter inside it.
      className={`flex-none mt-2 flex flex-col min-h-[6.5rem] border-t border-line-strong bg-surface ${
        live === null ? 'transition-[height] duration-300 ease-paper' : ''
      }`}
    >
      {/* Dragged vertically, so it claims the gesture — but it is a 20px strip
          and nothing else, so whatever scrolls below it still scrolls. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        role="separator"
        aria-orientation="horizontal"
        aria-label={`Resize ${title}`}
        className="flex-none h-5 grid place-items-center cursor-grab touch-none select-none"
      >
        <span className="block w-9 h-1 rounded-full bg-line-strong" />
      </div>

      {/* At the strip there is no header: 110px of screen has room for one row
          of candidates OR a title bar, and the row is the reason it is open.
          The grip goes back up, and the shell's own control closes it. */}
      {height === 'half' && (
      <div className="flex-none flex items-center gap-2 px-3 pb-1.5">
        <h2 className="m-0 font-mono text-[0.6rem] tracking-[0.14em] uppercase text-muted font-normal">
          {title}
        </h2>
        {hint}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="ml-auto shrink-0 w-8 h-8 -mr-1.5 grid place-items-center border-0 bg-transparent text-muted hover:text-ink cursor-pointer text-sm"
        >
          ✕
        </button>
      </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
    </section>
  );
}
