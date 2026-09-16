/**
 * A panel docked UNDER the stage, sharing the column's height with it.
 *
 * The suite's fourth way of showing a panel, and it exists for one reason a
 * {@link BottomSheet} cannot serve: a sheet floats OVER the stage behind a
 * wash, and a wash over a photograph changes its colour. Everywhere else that
 * is a fair price — you are picking out of a library, adjusting a badge — but
 * in the darkroom the picture's colour IS the thing being judged, so a scrim
 * turns the panel into a lie about the file that will leave.
 *
 * So this takes a share of the column instead of covering it: the picture
 * above at its own colour, the controls below, both on screen, and the shell's
 * bottom bar still reachable under it (which is what lets a cell be MARKED
 * while its panel is up — a sheet covers the bar, so nothing there can say so).
 *
 * The cost, and it is the one that retired the old `DockedPanel` from Trips:
 * neither half gets the whole screen. That is the wrong trade when the panel
 * is a library you pick FROM, and the right one when it is a slider whose
 * effect you are watching.
 *
 * Where it rests is `sheet-snap.ts`'s arithmetic, the sheet's own — fractions,
 * never pixels — read here against the COLUMN it sits in rather than against
 * the screen: the column is what it shares.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import useDialogKeys from './use-dialog-keys';
import { dragFraction, nextSnap, snapAfterDrag, type SnapPoints } from './sheet-snap';

/**
 * The middle one is the default, and it is the point of the whole component:
 * the maintainer asked for a fifty-fifty between the picture and the panel.
 *
 * It is 0.4 and not 0.5 because the share is measured against the COLUMN, and
 * the column's other half is not all picture: the name row, the strip and the
 * roll's status line take ~136px of it whatever the screen (measured at
 * 390×844). Solving picture = drawer against that lands on 0.394 — so 0.4 is
 * the fifty-fifty as asked for, and a taller phone spends its extra height on
 * the photograph rather than on more panel, which is the right way round.
 *
 * The other two rests are there because how much panel a picture is worth
 * changes between setting six sliders and nudging a crop, and a drag says so
 * more cheaply than a preference would.
 */
export const DRAWER_SNAPS: SnapPoints = [0.28, 0.4, 0.6];

export interface DockedDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The drawer's own name, in its header and on the dialog. */
  title: string;
  snaps?: SnapPoints;
  /** Which of those it opens at. Defaults to the middle one — the fifty-fifty. */
  initialSnap?: number;
  children: ReactNode;
}

export default function DockedDrawer({
  open,
  onClose,
  title,
  snaps = DRAWER_SNAPS,
  initialSnap,
  children,
}: DockedDrawerProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const rest = initialSnap ?? snaps[Math.floor(snaps.length / 2)] ?? 0.5;
  const [fraction, setFraction] = useState(rest);
  const [dragging, setDragging] = useState(false);

  // Every fresh open starts from the declared rest, the sheet's rule: a drawer
  // that comes back at whatever a gesture two pictures ago left it is a state
  // nobody asked for.
  useEffect(() => {
    if (open) setFraction(rest);
  }, [open, rest]);

  // Escape dismisses it, as it dismisses the sheet this replaces. No primary
  // action: a panel you work FROM leaves Enter to whatever is focused inside.
  useDialogKeys({ onCancel: open ? onClose : undefined, onConfirm: null });

  const drag = useRef<{ id: number; startY: number; startFraction: number; height: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // The share is read against the COLUMN, measured now: it is definite (the
      // shell states the app's height) and it does not move when this does, so
      // there is no loop to guard against and nothing to observe.
      const height = rootRef.current?.parentElement?.clientHeight ?? 0;
      drag.current = { id: e.pointerId, startY: e.clientY, startFraction: fraction, height };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [fraction],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setFraction(dragFraction(d.startFraction, e.clientY - d.startY, d.height));
  }, []);

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      setDragging(false);
      // A press that never travelled is a TAP, and a tap cycles to the next
      // rest — the handle must answer a mouse as well as a finger.
      if (Math.abs(e.clientY - d.startY) <= 4) {
        setFraction((f) => nextSnap(f, snaps));
        return;
      }
      const next = snapAfterDrag(dragFraction(d.startFraction, e.clientY - d.startY, d.height), snaps);
      if (next === null) onClose();
      else setFraction(next);
    },
    [onClose, snaps],
  );

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      role="region"
      aria-labelledby={titleId}
      // `order-last` rather than a position in the caller's markup: a workbench
      // renders the stage and its panel together, and the strip between them
      // belongs to the screen, not to the picture.
      style={{ height: `${fraction * 100}%` }}
      className={`order-last flex-none min-h-0 flex flex-col border-t border-line-strong rounded-t-paper bg-surface ${
        dragging ? '' : 'transition-[height] duration-200 ease-paper'
      }`}
    >
      {/* Dragged, so it claims the gesture — and it is a 20px strip and nothing
          else, so the body below it scrolls normally (the ruler's rule: claim
          only the surface you actually write). */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label={`Resize ${title}`}
        className="flex-none h-5 grid place-items-center cursor-grab touch-none select-none"
      >
        <span className="block w-9 h-1 rounded-full bg-line-strong" />
      </div>

      <div className="flex-none flex items-center gap-2 px-3 pb-1.5 border-b border-line">
        <h2 id={titleId} className="m-0 font-mono text-2xs tracking-[0.14em] uppercase text-muted font-normal truncate">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="ml-auto shrink-0 w-8 h-8 -mr-1.5 grid place-items-center border-0 bg-transparent text-muted hover:text-ink cursor-pointer text-base"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-3 px-3 pt-2 pb-2 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </div>
  );
}
