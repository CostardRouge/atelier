import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { dropIndex, edgeScrollStep } from './list-reorder';
import { scrollerOf } from './reveal';

/** The row being held, and where a drop would put it now. */
export interface HeldRow {
  key: string;
  to: number;
}

interface Hold {
  key: string;
  pointerId: number;
  pointerType: string;
  from: number;
  to: number;
  y: number;
  scroller: HTMLElement | null;
  frame: number;
}

/**
 * Reordering a list by dragging a row's GRIP, for a mouse, a pen and a finger
 * alike (the arithmetic is `list-reorder.ts`).
 *
 * The caller draws its rows inside `listRef`, each marked
 * `data-reorder-row={key}`, and spreads `grip(key, index)` on a handle in each
 * row. While a row is held, `held` says where it would land: the caller draws
 * the list in THAT order (so the rows make room and the numbers read the order
 * a drop writes), and `onMove(key, to)` is called once, on the drop, with the
 * index the row ends up at. A grip that was pressed and let go in place writes
 * nothing.
 *
 * Two choices the code alone would not explain:
 * - **The grip claims the gesture whole** (`touch-action: none`), and only the
 *   grip: a list is a scroll box, and a finger anywhere else on a row still
 *   scrolls it (`frontend.md`, «Rule, learned on Road Trip's stage ruler»).
 *   A held row scrolls the box itself near its edges, so a long list is
 *   crossed without letting go.
 * - **The moves are read on the WINDOW, never through pointer capture.** The
 *   held row's node is moved in the DOM as the list is redrawn in its new
 *   order, and a capture tied to a node that leaves the tree is released by
 *   some browsers mid-drag; the window hears the pointer wherever it goes.
 */
export function useListReorder<E extends HTMLElement = HTMLElement>(onMove: (key: string, to: number) => void) {
  const listRef = useRef<E | null>(null);
  const [held, setHeld] = useState<HeldRow | null>(null);
  const hold = useRef<Hold | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  /** Removes the window listeners of the hold in progress. */
  const detach = useRef<() => void>(() => {});

  /** Where the held row lands now, measured on the rows as they are drawn. */
  const measure = useCallback(() => {
    const h = hold.current;
    const list = listRef.current;
    if (!h || !list) return;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-reorder-row]'));
    if (rows.length === 0) return;
    const mids = rows.map((row) => {
      const box = row.getBoundingClientRect();
      return (box.top + box.bottom) / 2;
    });
    const heldAt = rows.findIndex((row) => row.dataset.reorderRow === h.key);
    const to = dropIndex(mids, heldAt, h.y);
    if (to === h.to) return;
    h.to = to;
    setHeld({ key: h.key, to });
  }, []);

  const end = useCallback((commit: boolean) => {
    const h = hold.current;
    if (!h) return;
    hold.current = null;
    cancelAnimationFrame(h.frame);
    detach.current();
    detach.current = () => {};
    setHeld(null);
    if (commit && h.to !== h.from) onMoveRef.current(h.key, h.to);
  }, []);

  // A list unmounted under a held row writes nothing.
  useEffect(() => () => end(false), [end]);

  const grip = useCallback(
    (key: string, index: number) => ({
      'data-reorder-grip': '',
      style: { touchAction: 'none' as const },
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (hold.current) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        // No text selected and no field focused by a drag that starts here.
        e.preventDefault();
        const list = listRef.current;
        const h: Hold = {
          key,
          pointerId: e.pointerId,
          pointerType: e.pointerType,
          from: index,
          to: index,
          y: e.clientY,
          scroller: list ? scrollerOf(list, 'y') : null,
          frame: 0,
        };
        hold.current = h;
        setHeld({ key, to: index });

        const move = (ev: PointerEvent) => {
          if (ev.pointerId !== h.pointerId) return;
          // A mouse let go outside the window sends no `pointerup` here; the
          // next move with no button down is that release.
          if (h.pointerType === 'mouse' && ev.buttons === 0) {
            end(true);
            return;
          }
          h.y = ev.clientY;
          measure();
        };
        const up = (ev: PointerEvent) => {
          if (ev.pointerId === h.pointerId) end(true);
        };
        const cancel = (ev: PointerEvent) => {
          if (ev.pointerId === h.pointerId) end(false);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        detach.current = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', cancel);
        };

        // Near an edge of its scroll box, a held row scrolls it, every frame.
        const tick = () => {
          if (hold.current !== h) return;
          const box = h.scroller;
          if (box) {
            const rect = box.getBoundingClientRect();
            const top = rect.top + box.clientTop;
            const step = edgeScrollStep(h.y, top, top + box.clientHeight);
            if (step !== 0) {
              const before = box.scrollTop;
              box.scrollTop = before + step;
              if (box.scrollTop !== before) measure();
            }
          }
          h.frame = requestAnimationFrame(tick);
        };
        h.frame = requestAnimationFrame(tick);
      },
    }),
    [end, measure],
  );

  return { listRef, held, grip };
}
