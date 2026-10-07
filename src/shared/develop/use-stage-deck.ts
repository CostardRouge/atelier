import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sweepRestarts } from '../ui/pan-zoom';
import { DECK_SETTLE_MS } from '../ui/use-media-viewer';
import { deckCommit, deckOffset, deckSweep, type DeckHands, type DeckNeighbours } from './stage-deck';

/** A wheel gesture has no end event; this much quiet is its release. */
const WHEEL_IDLE_MS = 140;
/**
 * How long a landed deck waits for the host to replace the stage before it
 * comes back by itself. The step changes the route, and the route reaches
 * React on `hashchange` — a task later, never the same one — so the deck
 * stays where it landed, the neighbour in the middle slot, until the new
 * stage is drawn in its place. Should nothing replace it (the roll changed
 * under the gesture), it must not stay displaced forever.
 */
const LANDING_GRACE_MS = 400;

export interface StageDeckOptions {
  /** Which way the roll goes on from the open picture, as the arrows would step. */
  neighbours: DeckNeighbours;
  /** The travel of one page: the viewport's width plus the paper between two slots. Read at gesture time. */
  travel: () => number;
  /** Open the picture the deck landed on — the editor's own step, so a swipe and → agree. */
  onStep: (dir: -1 | 1) => void;
}

export interface StageDeck {
  /** Pixels the deck is displaced by; 0 at rest. Positive reveals the previous picture. */
  offset: number;
  /** The deck animates to `offset` (a release); false while the hand moves it. */
  settling: boolean;
  /** Where a page in flight is going, or null at rest. */
  heading: -1 | 1 | null;
  /** What the picture hook is handed (`useDevelopPicture`'s `swipe`). */
  hands: DeckHands;
}

/**
 * The lightbox's deck under the Develop stage, without its zoom: a drag at
 * the fit — when the split is off and no tool holds the pointer — reveals the
 * next or the previous picture as the hand moves, a release pages by distance
 * or by a flick, a sideways trackpad sweep pages too and its momentum is
 * swallowed, a page in flight lands under the next gesture, and a drag past
 * either end of the roll resists (`stage-deck.ts`).
 *
 * Kept apart from `use-media-viewer.ts` on purpose, as `use-picture-zoom.ts`
 * is: that hook pages in every handler and owns the wheel whole, and the
 * Develop stage already reads the hand through the one machine
 * (`use-zoom-gestures.ts`). This hook only answers what a free drag and a
 * free sweep do; the arithmetic is the lightbox's own (`pan-zoom.ts`).
 *
 * One page = one picture switch, which REPLACES the stage (`RollEditor`
 * keys the workbench on the open picture): the deck lands by asking for the
 * step and leaving the neighbour in the middle slot, and the new stage —
 * drawn over the same still, under its own canvas until it has decoded —
 * takes its place with no seam. So this hook never outlives a page, and
 * whatever it was told mid-flight it drops.
 */
export function useStageDeck({ neighbours, travel, onStep }: StageDeckOptions): StageDeck {
  const [offset, setOffset] = useState(0);
  const [settling, setSettling] = useState(false);
  const [heading, setHeading] = useState<-1 | 1 | null>(null);

  // The hands are built once and read the world through a ref.
  const live = useRef({ neighbours, travel, onStep });
  live.current = { neighbours, travel, onStep };
  /** A page is sliding. */
  const busy = useRef(false);
  const pending = useRef<-1 | 1 | null>(null);
  /** The step was asked for: the host is replacing this stage. */
  const landed = useRef(false);
  const timer = useRef<number | null>(null);
  /** The sweep's own stream: what it has travelled, whether it already paged, its last delta, its idle timer. */
  const sweep = useRef({ swept: 0, spent: false, lastDelta: 0, idle: null as number | null });

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  /** Back to rest, animated — a drag that did not earn a page. */
  const settleBack = useCallback(() => {
    clearTimer();
    setSettling(true);
    setOffset(0);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setSettling(false);
    }, DECK_SETTLE_MS);
  }, []);

  /**
   * The end of a page, on the timer or early under a new gesture: the step
   * is asked for and the deck is LEFT where it is — the neighbour fills the
   * middle slot, and the stage the host draws next opens on that very still.
   * Snapping to rest here would show the old picture for a frame first.
   */
  const land = useCallback(() => {
    const dir = pending.current;
    clearTimer();
    pending.current = null;
    busy.current = false;
    if (dir === null) return;
    landed.current = true;
    setHeading(null);
    setSettling(false);
    live.current.onStep(dir);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      landed.current = false;
      settleBack();
    }, LANDING_GRACE_MS);
  }, [settleBack]);

  /** Slide the deck a whole slot, and let `land` finish it — on a timer, never `transitionend`. */
  const page = useCallback(
    (dir: -1 | 1) => {
      const t = live.current.travel();
      if (!(t > 0)) {
        settleBack();
        return;
      }
      clearTimer();
      busy.current = true;
      pending.current = dir;
      setHeading(dir);
      setSettling(true);
      setOffset(-dir * t);
      timer.current = window.setTimeout(land, DECK_SETTLE_MS);
    },
    [land, settleBack],
  );

  const dragTo = useCallback((distance: number) => {
    setOffset(deckOffset(distance, live.current.travel(), live.current.neighbours));
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      if (sweep.current.idle !== null) window.clearTimeout(sweep.current.idle);
    },
    [],
  );

  const hands = useMemo<DeckHands>(() => {
    const endSweep = () => {
      const s = sweep.current;
      s.idle = null;
      s.lastDelta = 0;
      if (s.spent) {
        s.spent = false;
        return;
      }
      s.swept = 0;
      if (!busy.current && !landed.current) settleBack();
    };
    const armIdle = () => {
      const s = sweep.current;
      if (s.idle !== null) window.clearTimeout(s.idle);
      s.idle = window.setTimeout(endSweep, WHEEL_IDLE_MS);
    };
    return {
      drag: (start) => {
        if (landed.current) return null;
        // The finger left after a pinch: fitted, there is nothing for it to take.
        if (start.handoff) return null;
        // A page still sliding lands under the new press, and is not dropped.
        if (busy.current) land();
        if (landed.current) return null;
        clearTimer();
        setSettling(false);
        return {
          move: (m) => {
            if (busy.current || landed.current) return;
            dragTo(m.totalX);
          },
          end: (e) => {
            if (landed.current) return;
            // A second finger landing mid-swipe: whatever it moved settles back.
            if (e.cancelled) {
              settleBack();
              return;
            }
            if (busy.current) return;
            const dir = deckCommit(e.totalX, live.current.travel(), e.speedX, live.current.neighbours);
            if (dir) page(dir);
            else settleBack();
          },
        };
      },
      sweep: (dx) => {
        if (landed.current) return;
        const s = sweep.current;
        const deltaX = -dx;
        // A sweep that already paged, still streaming momentum: eaten until
        // quiet — unless the fingers land again, which is a new sweep.
        if (s.spent && !sweepRestarts(s.lastDelta, deltaX)) {
          s.lastDelta = deltaX;
          armIdle();
          return;
        }
        s.spent = false;
        if (busy.current) land();
        if (landed.current) return;
        setSettling(false);
        s.swept += dx;
        s.lastDelta = deltaX;
        const dir = deckSweep(s.swept, live.current.travel(), live.current.neighbours);
        if (dir) {
          // Page NOW, not when the momentum runs out.
          s.swept = 0;
          s.spent = true;
          page(dir);
        } else {
          dragTo(s.swept);
        }
        armIdle();
      },
      onPinch: (active) => {
        // Two fingers take the stage: a page in flight lands rather than
        // replacing the stage under the pinch a moment later.
        if (active && busy.current) land();
      },
    };
  }, [dragTo, land, page, settleBack]);

  return { offset, settling, heading, hands };
}
