/**
 * A panel that rises from the bottom of a phone screen.
 *
 * The suite's third way of showing something over the page, and each has its
 * own job: a MODAL is a full-screen sheet you finish and dismiss
 * (`frontend.md`, «A modal is a full-screen sheet under 820px»), a LIGHTBOX
 * shows one picture large, and this is a panel you work FROM — the library you
 * are picking out of, the inspector you are adjusting — while the stage stays
 * visible behind it. That visibility is the whole point, and it is why this is
 * not simply the modal at another size.
 *
 * Everything about where it rests is arithmetic in `sheet-snap.ts`; this turns
 * pointer events into a fraction and paints the result.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import useDialogKeys from './use-dialog-keys';
import {
  DEFAULT_SNAPS,
  dragFraction,
  nextSnap,
  snapAfterDrag,
  type SnapPoints,
} from './sheet-snap';
import { APP_HEIGHT } from './app-height';
import { readAppHeight } from './use-app-height';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** The sheet's own name, in the header and on the dialog. */
  title: string;
  /** Optional second line beside the title — a host, a count, a day. */
  hint?: string;
  /** Where it may rest, as fractions of the screen. Smallest first. */
  snaps?: SnapPoints;
  /** Which of those it opens at. Defaults to the smallest. */
  initialSnap?: number;
  /** Pinned under the scrolling body — a CTA row, a filter. */
  footer?: ReactNode;
  /**
   * Whether the sheet scrolls its own body. Pass `false` when the child is
   * already a scrolling panel (the asset library scrolls its list) — two
   * nested scroll containers give a finger two things to move and neither
   * of them reliably.
   */
  bodyScrolls?: boolean;
  children: ReactNode;
}

export default function BottomSheet({
  open,
  onClose,
  title,
  hint,
  snaps = DEFAULT_SNAPS,
  initialSnap,
  footer,
  bodyScrolls = true,
  children,
}: BottomSheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [fraction, setFraction] = useState(() => initialSnap ?? snaps[0]);
  // While a finger is down the sheet must follow it exactly, so the CSS
  // transition is off for the duration — a transition mid-drag turns the
  // panel into something that lags the hand by a frame or two, which reads as
  // a slow phone rather than as an animation.
  const [dragging, setDragging] = useState(false);

  // Leaving takes a moment: every way out (a drag under the floor, the ✕, the
  // scrim, Escape) asks for the close, the panel plays its fall and the scrim
  // fades, and `onClose` — which unmounts it — fires when the animation ends.
  // Closing by unmounting on the spot is what left the maintainer's phone with
  // an arrival animation and no departure.
  const [closing, setClosing] = useState(false);
  const closed = useRef(false);
  const finishClose = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onClose();
  }, [onClose]);
  const requestClose = useCallback(() => setClosing(true), []);
  useEffect(() => {
    if (!closing) return;
    // A guard for an animation that never ends (a tab in the background
    // throttles them): the sheet is gone within a frame of its due time.
    const t = window.setTimeout(finishClose, 300);
    return () => window.clearTimeout(t);
  }, [closing, finishClose]);

  // Every fresh open starts from the declared rest, never from wherever the
  // last drag left it: a sheet that reopens 92% tall because of a gesture two
  // screens ago is a state nobody asked for.
  useEffect(() => {
    if (open) {
      setFraction(initialSnap ?? snaps[0]);
      setClosing(false);
      closed.current = false;
    }
  }, [open, initialSnap, snaps]);

  // Escape closes it, like every other sheet in the suite. No primary action:
  // this is a panel you work from, so Enter belongs to whatever is focused
  // inside it — passing `null` is what says that out loud.
  useDialogKeys({ onCancel: open && !closing ? requestClose : undefined, onConfirm: null });

  // Focus moves in on open so the keyboard is inside the sheet, and returns to
  // whatever opened it on close.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => opener.current?.focus?.({ preventScroll: true });
  }, [open]);

  const drag = useRef<{ id: number; startY: number; startFraction: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      drag.current = { id: e.pointerId, startY: e.clientY, startFraction: fraction };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [fraction],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setFraction(dragFraction(d.startFraction, e.clientY - d.startY, readAppHeight()));
  }, []);

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      setDragging(false);
      // A press that never travelled is a TAP, and a tap cycles to the next
      // rest — otherwise the handle is a control a mouse cannot operate and a
      // finger has to know to drag.
      const moved = Math.abs(e.clientY - d.startY) > 4;
      if (!moved) {
        setFraction((f) => nextSnap(f, snaps));
        return;
      }
      const next = snapAfterDrag(
        dragFraction(d.startFraction, e.clientY - d.startY, readAppHeight()),
        snaps,
      );
      if (next === null) requestClose();
      else setFraction(next);
    },
    [requestClose, snaps],
  );

  if (!open) return null;

  return (
    <>
      {/* The stage stays visible through it: a wash, not a blackout — you are
          picking FROM the library for the picture behind. */}
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={requestClose}
        className={`fixed inset-0 z-40 bg-ink/25 border-0 p-0 cursor-default ${
          closing ? 'animate-[sheet-scrim-out_.22s_var(--ease-paper)_forwards]' : 'animate-[sheet-scrim_.24s_var(--ease-paper)]'
        }`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-closing={closing || undefined}
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) finishClose();
        }}
        style={{ height: `calc(${fraction} * ${APP_HEIGHT})` }}
        className={`fixed inset-x-0 bottom-0 z-50 flex flex-col min-h-0 bg-surface border border-line-strong border-b-0 rounded-t-paper-lg shadow-paper outline-none ${
          closing ? 'animate-[sheet-fall_.22s_var(--ease-paper)_forwards]' : 'animate-[sheet-rise_.28s_var(--ease-paper)]'
        } ${dragging ? '' : 'transition-[height] duration-200 ease-paper'}`}
      >
        {/* The whole HEAD is dragged — the grip and the title row together —
            so a thumb has a 44px band to catch rather than a 3px bar to aim
            at; it claims the gesture (`touch-none`) and nothing below it does,
            so the body still scrolls. The rule the ruler taught, claim only
            the surface you write, still holds: the head writes the height. A
            tap on it cycles the rests; the ✕ is the one thing in it that does
            not drag. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="flex-none flex flex-col cursor-grab touch-none select-none border-b border-line"
        >
          <div className="flex-none h-[12px] grid place-items-center">
            <span className="block w-7 h-[3px] rounded-full bg-line-strong" />
          </div>
          <div className="flex-none flex items-center gap-2 px-4 pb-1">
            <h2
              id={titleId}
              className="m-0 font-mono text-2xs tracking-[0.14em] uppercase text-muted font-normal"
            >
              {title}
            </h2>
            {hint && (
              <span className="font-mono text-2xs text-faint truncate">{hint}</span>
            )}
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

        <div
          className={`flex-1 min-h-0 flex flex-col ${
            bodyScrolls ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden'
          }`}
        >
          {children}
        </div>

        {footer && (
          <div className="flex-none border-t border-line px-4 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
        {/* No footer, but the home indicator still needs clearing. */}
        {!footer && <div className="flex-none h-[max(0.5rem,env(safe-area-inset-bottom))]" />}
      </div>
    </>
  );
}
