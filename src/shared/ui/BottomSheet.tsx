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

  // Every fresh open starts from the declared rest, never from wherever the
  // last drag left it: a sheet that reopens 92% tall because of a gesture two
  // screens ago is a state nobody asked for.
  useEffect(() => {
    if (open) setFraction(initialSnap ?? snaps[0]);
  }, [open, initialSnap, snaps]);

  // Escape closes it, like every other sheet in the suite. No primary action:
  // this is a panel you work from, so Enter belongs to whatever is focused
  // inside it — passing `null` is what says that out loud.
  useDialogKeys({ onCancel: open ? onClose : undefined, onConfirm: null });

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
    setFraction(dragFraction(d.startFraction, e.clientY - d.startY, window.innerHeight));
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
        dragFraction(d.startFraction, e.clientY - d.startY, window.innerHeight),
        snaps,
      );
      if (next === null) onClose();
      else setFraction(next);
    },
    [onClose, snaps],
  );

  if (!open) return null;

  return (
    <>
      {/* The stage stays visible through it: a wash, not a blackout — you are
          picking FROM the library for the picture behind. */}
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-ink/25 border-0 p-0 cursor-default animate-[sheet-scrim_.24s_var(--ease-paper)]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ height: `${fraction * 100}dvh` }}
        className={`fixed inset-x-0 bottom-0 z-50 flex flex-col min-h-0 bg-surface border border-line-strong border-b-0 rounded-t-paper-lg shadow-paper outline-none animate-[sheet-rise_.28s_var(--ease-paper)] ${
          dragging ? '' : 'transition-[height] duration-200 ease-paper'
        }`}
      >
        {/* The handle is DRAGGED, so it claims the gesture — but it is a 22px
            strip and nothing else, so the body below it scrolls normally. The
            rule the ruler taught: claim only the surface you actually write. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="flex-none h-[22px] grid place-items-center cursor-grab touch-none select-none"
        >
          <span className="block w-9 h-1 rounded-full bg-line-strong" />
        </div>

        <div className="flex-none flex items-center gap-2 px-4 pb-2 border-b border-line">
          <h2
            id={titleId}
            className="m-0 font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted font-normal"
          >
            {title}
          </h2>
          {hint && (
            <span className="font-mono text-[0.62rem] text-faint truncate">{hint}</span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="ml-auto shrink-0 w-9 h-9 -mr-2 grid place-items-center border-0 bg-transparent text-muted hover:text-ink cursor-pointer text-base"
          >
            ✕
          </button>
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
