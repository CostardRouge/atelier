import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import type { Framing } from '../media/framing';
import { borderLayout, scaleLayout, type RollBorder } from './border-layout';
import { drawDelivered, drawPictureIn } from './border-paint';
import { holdGrades, type HeldGrader } from '../lut/held-grader';
import { stageFrameSize } from '../overlay/stage-size';
import { THUMB_LONG_EDGE, THUMB_QUALITY, thumbSize } from '../roadtrip/thumbnail';
import { boundSource, frameSize, loadBadgeSource, type BadgeSource } from '../roadtrip/badge-render';
import { usePictureZoom, type PictureZoom } from '../ui/use-picture-zoom';
import { HISTOGRAM_SAMPLE_EDGE, luminanceHistogram, type Histogram } from './histogram';

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

/** The crop a host wants the viewport to show: the aspect box and the framing inside it. */
export interface DevelopFrame {
  /** w / h of the box. */
  aspectRatio: number;
  framing: Framing;
  /** The border it is delivered on, when it has one — the viewport shows the file. */
  border?: RollBorder | null;
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
  /**
   * The luminance histogram of the picture AS DELIVERED (graded, whole) —
   * never of the split or of "before", which are ways of looking, not what
   * goes out. Null until a picture has been read.
   */
  histogram: Histogram | null;
  /** Where the divider and its handle are drawn, in viewport pixels. */
  divider: { x: number; top: number; bottom: number };
  /**
   * A small JPEG of the picture AS DELIVERED — graded, whole, never the split
   * or "before" — for a filmstrip cell or a gallery card. Null while nothing is
   * decoded, or when the browser refuses the encode.
   */
  snapshot: (longEdge?: number) => Promise<Blob | null>;
  /**
   * The picture AS DELIVERED — graded whole through the one held grader — for
   * a host that draws it its own way (the Develop tool's crop stage frames
   * it into an aspect box). Null while nothing is decoded. Read at call time,
   * like `snapshot`: a caller repaints on `source` and `cube`.
   */
  delivered: () => CanvasImageSource | null;
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
  frame = null,
}: {
  file: File | null;
  videoTimeSeconds?: number;
  cube: CubeLut | null;
  /**
   * Show the picture CROPPED — the Develop tool keeps its crop visible while
   * the light is set. Only the viewport's paint and zoom read it: the
   * histogram, `delivered()` and `snapshot()` stay the whole picture.
   */
  frame?: DevelopFrame | null;
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

  const frameRatio = frame && frame.aspectRatio > 0 ? frame.aspectRatio : null;
  const framing = frame?.framing ?? null;
  const border = frame?.border ?? null;
  // The delivered canvas in the crop's own units (a crop of frameRatio × 1).
  const delivered1 = useMemo(
    () => (frameRatio ? borderLayout(frameRatio, 1, border) : null),
    [frameRatio, border],
  );
  // What the canvas holds: the whole picture, or its crop at the same density
  // (the crop's long edge is the stage budget's long edge).
  const canvasSize = useMemo(() => {
    if (!source || source.width <= 0 || source.height <= 0) return null;
    const whole = stageFrameSize(source.width, source.height);
    return delivered1 ? frameSize(delivered1.w / delivered1.h, Math.max(whole.w, whole.h)) : whole;
  }, [source, delivered1]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source || !canvasSize) return;
    const { w, h } = canvasSize;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const grader = holding ? null : graderFor(cube, source);
    const graded = grader ? grader.render(source.image) : source.image;
    const layout = delivered1 && framing ? scaleLayout(delivered1, w / delivered1.w) : null;
    if (layout && framing) {
      ctx.clearRect(0, 0, w, h);
      drawDelivered(ctx, graded, source.width, source.height, framing, layout, border);
    } else {
      ctx.drawImage(graded, 0, 0, source.width, source.height, 0, 0, w, h);
    }
    // The wipe: the untouched picture to the RIGHT of the divider, the way the
    // shader's own split works — graded on the left. The divider itself is
    // drawn over the canvas, in the page, so it stays a hairline at any zoom.
    if (grader && wipe < 1) {
      const x = Math.round(wipe * w);
      if (layout && framing) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, 0, w - x, h);
        ctx.clip();
        drawPictureIn(ctx, source.image, source.width, source.height, framing, layout);
        ctx.restore();
      } else {
        const sx = Math.round(wipe * source.width);
        ctx.drawImage(source.image, sx, 0, source.width - sx, source.height, x, 0, w - x, h);
      }
    }
  }, [source, canvasSize, delivered1, framing, border, cube, wipe, holding, graderFor]);

  // The histogram, read off a small copy of the graded picture one frame
  // after it changes — so a slider step paints first and measures second, and
  // a burst of steps measures once. Keyed on the picture and the cube only:
  // the wipe and "hold for before" do not change what is delivered.
  const [histogram, setHistogram] = useState<Histogram | null>(null);
  const sampleRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!source || source.width <= 0 || source.height <= 0) {
      setHistogram(null);
      return;
    }
    const measure = () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
      const k = Math.min(1, HISTOGRAM_SAMPLE_EDGE / Math.max(source.width, source.height));
      const w = Math.max(1, Math.round(source.width * k));
      const h = Math.max(1, Math.round(source.height * k));
      if (!sampleRef.current) sampleRef.current = document.createElement('canvas');
      const sample = sampleRef.current;
      if (sample.width !== w || sample.height !== h) {
        sample.width = w;
        sample.height = h;
      }
      const ctx = sample.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      try {
        const grader = graderFor(cube, source);
        const graded = grader ? grader.render(source.image) : source.image;
        ctx.drawImage(graded, 0, 0, source.width, source.height, 0, 0, w, h);
        setHistogram(luminanceHistogram(ctx.getImageData(0, 0, w, h).data));
      } catch {
        // A frame released under us, or a picture the canvas may not read
        // back: the strip keeps its last reading rather than breaking the sheet.
      }
    };
    // The next frame, or a moment later where frames are not being drawn (a
    // hidden pane still shows the sheet's numbers), whichever comes first.
    const raf = requestAnimationFrame(measure);
    const fallback = window.setTimeout(measure, 120);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
    };
  }, [source, cube, graderFor]);

  // Read through refs: a snapshot is asked for after a quiet delay, and must
  // take the cube of THAT moment, not the one the closure was made with.
  const latest = useRef({ source, cube });
  latest.current = { source, cube };
  const delivered = useCallback((): CanvasImageSource | null => {
    const { source: s, cube: lut } = latest.current;
    if (!s || s.width <= 0 || s.height <= 0) return null;
    const grader = graderFor(lut, s);
    return grader ? grader.render(s.image) : s.image;
  }, [graderFor]);
  const snapshot = useCallback(
    async (longEdge = THUMB_LONG_EDGE): Promise<Blob | null> => {
      const { source: s, cube: lut } = latest.current;
      if (!s || s.width <= 0 || s.height <= 0) return null;
      const { w, h } = thumbSize(s.width, s.height, longEdge);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      try {
        const grader = graderFor(lut, s);
        const graded = grader ? grader.render(s.image) : s.image;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(graded, 0, 0, s.width, s.height, 0, 0, w, h);
      } catch {
        return null;
      }
      return new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', THUMB_QUALITY));
    },
    [graderFor],
  );

  const dragging = useRef<{ startX: number; live: boolean } | null>(null);
  const fingers = useRef(0);
  const zoomedRef = useRef(false);
  const natural = useMemo(() => (canvasSize ? { width: canvasSize.w, height: canvasSize.h } : null), [canvasSize]);
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
      // A pointer the browser no longer knows (a synthetic one) throws rather
      // than answering; the wipe works without the capture either way.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* not a live pointer */
      }
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
    histogram,
    divider,
    snapshot,
    delivered,
    handlers,
  };
}
