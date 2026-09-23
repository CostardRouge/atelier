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
  // It RISES from nothing and FALLS back to nothing: the drawer mounts at 0
  // and grows to its rest on the next frame, and a close shrinks it to 0
  // before `onClose` unmounts it — the BottomSheet's rule (`frontend.md`), in
  // the one unit a drawer has, its share of the column. A drawer that
  // appeared and vanished between two frames read as a jump cut beside a
  // sheet that travels.
  const [fraction, setFraction] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const closed = useRef(false);

  const finishClose = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onClose();
  }, [onClose]);
  const requestClose = useCallback(() => {
    setClosing(true);
    setFraction(0);
  }, []);
  useEffect(() => {
    if (!closing) return;
    // A transition that never ends (a background tab, reduced motion with no
    // transition at all) must not keep the drawer up.
    const t = window.setTimeout(finishClose, 260);
    return () => window.clearTimeout(t);
  }, [closing, finishClose]);

  // Every fresh open starts from the declared rest, the sheet's rule: a drawer
  // that comes back at whatever a gesture two pictures ago left it is a state
  // nobody asked for. Two frames, so the 0 is PAINTED before the rest is set
  // and the height has something to transition from.
  useEffect(() => {
    if (!open) {
      setFraction(0);
      return;
    }
    setClosing(false);
    closed.current = false;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setFraction(rest));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [open, rest]);

  // Escape dismisses it, as it dismisses the sheet this replaces. No primary
  // action: a panel you work FROM leaves Enter to whatever is focused inside.
  useDialogKeys({ onCancel: open && !closing ? requestClose : undefined, onConfirm: null });

  const drag = useRef<{ id: number; startY: number; startFraction: number; height: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (closing) return;
      // The share is read against the COLUMN, measured now: it is definite (the
      // shell states the app's height) and it does not move when this does, so
      // there is no loop to guard against and nothing to observe.
      const height = rootRef.current?.parentElement?.clientHeight ?? 0;
      drag.current = { id: e.pointerId, startY: e.clientY, startFraction: fraction, height };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [fraction, closing],
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
      // rest — the head must answer a mouse as well as a finger.
      if (Math.abs(e.clientY - d.startY) <= 4) {
        setFraction((f) => nextSnap(f, snaps));
        return;
      }
      const next = snapAfterDrag(dragFraction(d.startFraction, e.clientY - d.startY, d.height), snaps);
      if (next === null) requestClose();
      else setFraction(next);
    },
    [requestClose, snaps],
  );

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      role="region"
      aria-labelledby={titleId}
      data-closing={closing || undefined}
      onTransitionEnd={(e) => {
        if (closing && e.target === e.currentTarget && e.propertyName === 'height') finishClose();
      }}
      // `order-last` rather than a position in the caller's markup: a workbench
      // renders the stage and its panel together, and the strip between them
      // belongs to the screen, not to the picture.
      //
      // EDGE TO EDGE: `-mx-2` undoes the compact shell's `px-2` (`App.tsx`),
      // the only place this is ever drawn. Inset by the gutter, the drawer's
      // rounded top and its side borders stopped 8px short of the screen and
      // read as cut — the maintainer's report, the one Trips' day strip had.
      style={{ height: `${fraction * 100}%` }}
      className={`order-last flex-none min-h-0 -mx-2 flex flex-col overflow-hidden border border-b-0 border-line-strong rounded-t-paper-lg bg-surface shadow-[0_-10px_22px_-20px_rgba(43,33,18,0.55)] ${
        dragging ? '' : 'transition-[height] duration-200 ease-paper motion-reduce:transition-none'
      }`}
    >
      {/* The whole HEAD is the handle — grip and title row together, one band
          a thumb can catch instead of a 20px strip to aim at. It claims the
          gesture (`touch-none`) and the body below still scrolls: claim only
          the surface you write, and the head writes the height. The ✕ is the
          one thing in it that does not drag. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label={`Resize ${title}`}
        className="flex-none flex flex-col cursor-grab touch-none select-none border-b border-line"
      >
        <div className="flex-none h-3 grid place-items-center">
          <span className="block w-7 h-[3px] rounded-full bg-line-strong" />
        </div>
        <div className="flex-none flex items-center gap-2 px-4 pb-1">
          <h2 id={titleId} className="m-0 font-mono text-2xs tracking-[0.14em] uppercase text-muted font-normal truncate">
            {title}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Close ${title}`}
            className="ml-auto shrink-0 w-9 h-7 -mr-2 grid place-items-center border-0 bg-transparent text-muted hover:text-ink cursor-pointer text-base"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-3 px-4 pt-2 pb-2 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        {children}
      </div>
    </div>
  );
}
