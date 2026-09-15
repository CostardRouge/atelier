import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import { holdGrades, type HeldGrader } from '../lut/held-grader';
import { stageFrameSize } from '../overlay/stage-size';
import { boundSource, loadBadgeSource, type BadgeSource } from '../roadtrip/badge-render';
import { usePictureZoom, type PictureZoom } from '../ui/use-picture-zoom';

/** How close to the frame's side the divider's handle may be held, in px. */
const HANDLE_INSET = 14;
/** How far a finger travels before it moves the divider, in px. */
const TOUCH_SLOP = 6;

/**
 * Whether a press on the picture places the divider rather than panning:
 * always at the fitted size, where there is nothing to pan; once zoomed, only
 * on the divider's own handle. A control over the picture keeps its press.
 */
function wipeClaims(target: EventTarget | null, zoomed: boolean): boolean {
  const el = target as Element | null;
  if (el?.closest?.('button')) return false;
  return !zoomed || Boolean(el?.closest?.('[data-wipe-handle]'));
}

export interface DevelopPicture {
  /** The decoded picture, within the stage budget; null while decoding. */
  source: BadgeSource | null;
  /** Why it could not be decoded, in the decoder's words. */
  problem: string | null;
  canvasRef: RefObject<HTMLCanvasElement>;
  /** The cube it is painted through: develop → look → output. */
  cube: CubeLut | null;
  view: PictureZoom;
  /** Share of the picture, from the left, painted graded; 1 = no split. */
  wipe: number;
  holding: boolean;
  setHolding: (on: boolean) => void;
  /** Something to compare: a picture, and a cube that changes it. */
  comparing: boolean;
  /** Where the divider and its handle are drawn, in viewport pixels. */
  divider: { x: number; top: number; bottom: number };
  /** The wipe gesture, for the viewport element. */
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  };
}

/**
 * ONE picture being developed: decoded to the stage budget, graded through the
 * host's cube, painted with the before/after split, zoomed and panned.
 *
 * State only; `DevelopViewport` draws it. Kept apart so the modal and the
 * Develop tool lay the same picture out differently (a sheet column, a
 * filmstrip) without a second copy of the grader's lifetime rules:
 *
 * - **A develop is judged on a screen, never at 48 megapixels**: the source is
 *   bounded (`boundSource`) and the export decodes the file again.
 * - **One grader**, re-made only when the cube or the source's size changes —
 *   a WebGL2 context per repaint is never reclaimed — and it HOLDS its grade,
 *   so dragging the wipe or holding "before" does not grade again per step.
 * - **Fitted, a drag places the divider; zoomed, the drag pans** and the
 *   divider keeps a handle. A finger does not move the divider until it has
 *   travelled (or lifts as a tap), and a second finger is the pinch's.
 */
export function useDevelopPicture({
  file,
  videoTimeSeconds = 0,
  cube,
}: {
  file: File | null;
  videoTimeSeconds?: number;
  cube: CubeLut | null;
}): DevelopPicture {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<BadgeSource | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [wipe, setWipe] = useState(1);
  const [holding, setHolding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setProblem(null);
    if (!file) return;
    let loaded: BadgeSource | null = null;
    void loadBadgeSource(file, videoTimeSeconds)
      .then((s) => boundSource(s))
      .then((s) => {
        if (cancelled) {
          s.release();
          return;
        }
        loaded = s;
        setSource(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setProblem(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      loaded?.release();
    };
  }, [file, videoTimeSeconds]);

  const graderRef = useRef<{ lut: CubeLut; w: number; h: number; grader: HeldGrader } | null>(null);
  const graderFor = useCallback((lut: CubeLut | null, s: BadgeSource): HeldGrader | null => {
    const cur = graderRef.current;
    if (!lut) {
      cur?.grader.dispose();
      graderRef.current = null;
      return null;
    }
    if (cur && cur.lut === lut && cur.w === s.width && cur.h === s.height) return cur.grader;
    cur?.grader.dispose();
    const grader = holdGrades(makeFrameGrader(lut, s.width, s.height));
    graderRef.current = { lut, w: s.width, h: s.height, grader };
    return grader;
  }, []);
  useEffect(
    () => () => {
      graderRef.current?.grader.dispose();
      graderRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source || source.width <= 0) return;
    const { w, h } = stageFrameSize(source.width, source.height);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const grader = holding ? null : graderFor(cube, source);
    const graded = grader ? grader.render(source.image) : source.image;
    ctx.drawImage(graded, 0, 0, source.width, source.height, 0, 0, w, h);
    // The wipe: the untouched picture to the RIGHT of the divider, the way the
    // shader's own split works — graded on the left. The divider itself is
    // drawn over the canvas, in the page, so it stays a hairline at any zoom.
    if (grader && wipe < 1) {
      const x = Math.round(wipe * w);
      const sx = Math.round(wipe * source.width);
      ctx.drawImage(source.image, sx, 0, source.width - sx, source.height, x, 0, w - x, h);
    }
  }, [source, cube, wipe, holding, graderFor]);

  const dragging = useRef<{ startX: number; live: boolean } | null>(null);
  const fingers = useRef(0);
  const zoomedRef = useRef(false);
  const natural = useMemo(() => (source ? { width: source.width, height: source.height } : null), [source]);
  const view = usePictureZoom({
    natural,
    resetKey: source,
    claim: (e) => wipeClaims(e.target, zoomedRef.current),
    onTakeover: () => {
      dragging.current = null;
    },
  });
  zoomedRef.current = view.zoomed;

  const wipeFrom = (e: ReactPointerEvent<HTMLElement>) => {
    const f = view.fractionAt(e.clientX, e.clientY).x;
    setWipe(Math.min(1, Math.max(0, f)));
  };
  const handlers: DevelopPicture['handlers'] = {
    onPointerDown: (e) => {
      const touch = e.pointerType === 'touch';
      if (touch) fingers.current += 1;
      // A second finger is the pinch's (`onTakeover`), never a wipe.
      if (dragging.current || (touch && fingers.current > 1)) return;
      if (!wipeClaims(e.target, view.zoomed)) return;
      dragging.current = { startX: e.clientX, live: !touch };
      e.currentTarget.setPointerCapture(e.pointerId);
      if (!touch) wipeFrom(e);
    },
    onPointerMove: (e) => {
      const d = dragging.current;
      if (!d) return;
      if (!d.live && Math.abs(e.clientX - d.startX) > TOUCH_SLOP) d.live = true;
      if (d.live) wipeFrom(e);
    },
    onPointerUp: (e) => {
      if (e.pointerType === 'touch') fingers.current = Math.max(0, fingers.current - 1);
      // A finger that never travelled was a tap: it places the divider.
      if (dragging.current && !dragging.current.live) wipeFrom(e);
      dragging.current = null;
    },
    onPointerCancel: (e) => {
      if (e.pointerType === 'touch') fingers.current = Math.max(0, fingers.current - 1);
      dragging.current = null;
    },
  };

  // The divider, where the picture is — held inside the frame so its handle
  // can always be reached, even when the line itself is panned out of view.
  const { rect, viewport } = view;
  const divider = {
    x: Math.min(Math.max(rect.x + wipe * rect.width, HANDLE_INSET), Math.max(HANDLE_INSET, viewport.width - HANDLE_INSET)),
    top: Math.max(0, rect.y),
    bottom: Math.min(viewport.height, rect.y + rect.height),
  };

  return {
    source,
    problem,
    canvasRef,
    cube,
    view,
    wipe,
    holding,
    setHolding,
    comparing: Boolean(source && cube && !holding),
    divider,
    handlers,
  };
}
