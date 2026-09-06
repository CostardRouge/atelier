import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CubeLut } from '../../shared/lib/cube-parser';
import { makeFrameGrader, type FrameGrader } from '../../shared/lut/frame-grader';
import { boxForId, hitTest, type ElementBox } from '../../shared/overlay/draw-overlays';
import type { OverlayElement } from '../../shared/overlay/overlay-types';
import type { StyleTheme } from '../../shared/overlay/title-styles';
import { moveBlock } from '../../shared/roadtrip/badge-layout';
import {
  MAX_PREVIEW_LONG_EDGE,
  PREVIEW_LONG_EDGE,
  frameSize,
  loadBadgeSource,
  measureBadge,
  renderBadge,
  type BadgeSource,
  type QrDraw,
  type RenderBadgeOptions,
} from '../../shared/roadtrip/badge-render';
import type { HookBlock, Shade } from '../../shared/roadtrip/shades';

interface BadgeStageProps {
  file: File | null;
  /** Frame of a clip to sit on; ignored for photos. */
  videoTimeSeconds: number;
  aspect: number;
  elements: OverlayElement[];
  theme: StyleTheme | null;
  /** Where the badge's own animations are up to, in seconds. */
  timeSeconds: number;
  /** Darkening over the picture, under the badge. */
  shades?: readonly Shade[];
  /** The badge block's extent, for a shade that follows the hook. */
  block?: HookBlock | null;
  /** Painted where no picture covers the frame — the closing card's ground. */
  background?: string;
  /** A QR square under the text. */
  qr?: QrDraw | null;
  /** The composed grade the picture goes through, or null for the picture as shot. */
  lut?: CubeLut | null;
  /** The element outlined on the stage, and kept visible past its window. */
  selectedId?: string | null;
  /** A click on the stage: the element under the pointer, or null for the picture. */
  onSelect?: (id: string | null) => void;
  /**
   * The badge block's anchor, when this slide has one to move. Dragging any
   * element moves the whole block; absent (a caption, the closing card) a
   * click selects and nothing moves.
   */
  blockAnchor?: { x: number; y: number } | null;
  onMoveBlock?: (x: number, y: number) => void;
  onSourceLoaded?: (info: { width: number; height: number; duration: number }) => void;
  /**
   * Fired after each successful paint, with the canvas that was just drawn.
   * Used to keep a thumbnail of the hook — the picture has to be taken here,
   * because this is the only place it already exists.
   */
  onRendered?: (canvas: HTMLCanvasElement) => void;
}

/**
 * The badge over its picture, drawn through exactly the code the PNG export
 * uses — only the canvas is smaller. Anything that made the preview a separate
 * approximation would put the author's eye and the delivered file at odds.
 *
 * Pointing at a piece selects it and dragging moves the block. The selection
 * outline is drawn on a SECOND canvas laid over the first: the paint below
 * stays the export's own, so neither the thumbnail taken from it nor any
 * future consumer can grow a dashed rectangle.
 */
export default function BadgeStage({
  file,
  videoTimeSeconds,
  aspect,
  elements,
  theme,
  timeSeconds,
  shades,
  block,
  background,
  qr,
  lut = null,
  selectedId = null,
  onSelect,
  blockAnchor = null,
  onMoveBlock,
  onSourceLoaded,
  onRendered,
}: BadgeStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chromeRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<BadgeSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Held in a ref so a caller passing a fresh closure cannot re-run the paint.
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

  // Decode the picture. ONLY when the file changes: moving a clip's frame
  // seeks the element that is already open (below). Re-decoding per nudge —
  // a new element and a new object URL each time — is what made choosing a
  // hook frame stutter and flash "decoding…" the whole way across.
  useEffect(() => {
    let cancelled = false;
    sourceRef.current?.release();
    sourceRef.current = null;
    setError(null);

    // No picture: the paint effect below already draws the empty frame with
    // its badge, at the right size. This branch used to paint too — into a
    // canvas it never sized — and its font wait landed AFTER the resize, so a
    // miniature badge stayed burnt into the corner of the stage.
    if (!file) return;

    setLoading(true);
    void loadBadgeSource(file, videoTimeSeconds)
      .then((source) => {
        if (cancelled) {
          source.release();
          return;
        }
        sourceRef.current = source;
        onSourceLoaded?.({
          width: source.width,
          height: source.height,
          duration: 'duration' in source.image ? (source.image.duration ?? 0) : 0,
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `elements`/`theme` deliberately absent: they drive the paint below, not
    // the decode. `videoTimeSeconds` likewise — see the seek effect.
  }, [file]);

  // Move the open clip to the asked-for moment, then repaint. `frameSeq` is
  // what makes the paint wait for the frame: painting on `videoTimeSeconds`
  // alone would draw the OLD frame, since the seek has not landed yet.
  const [frameSeq, setFrameSeq] = useState(0);
  useEffect(() => {
    const source = sourceRef.current;
    if (!source?.seek || loading) return;
    let cancelled = false;
    void source
      .seek(videoTimeSeconds)
      .then(() => {
        if (!cancelled) setFrameSeq((n) => n + 1);
      })
      .catch(() => {
        /* a seek that fails leaves the last good frame on screen */
      });
    return () => {
      cancelled = true;
    };
  }, [videoTimeSeconds, loading]);

  // The hit boxes of the last paint, measured with the very options it used.
  // Read by the pointer handlers and by the outline; refreshed by every paint.
  const boxesRef = useRef<ElementBox[]>([]);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  /** The dashed outline around the selected element, on the chrome canvas. */
  const drawChrome = useCallback(() => {
    const chrome = chromeRef.current;
    const canvas = canvasRef.current;
    if (!chrome || !canvas) return;
    if (chrome.width !== canvas.width || chrome.height !== canvas.height) {
      chrome.width = canvas.width;
      chrome.height = canvas.height;
    }
    const ctx = chrome.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = chrome;
    ctx.clearRect(0, 0, w, h);
    const sel = selectedRef.current;
    const box = sel ? boxForId(boxesRef.current, sel) : null;
    if (!box) return;
    ctx.save();
    ctx.strokeStyle = '#d9442a';
    ctx.lineWidth = Math.max(1.5, h * 0.003);
    ctx.setLineDash([h * 0.012, h * 0.012]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }, []);

  // One grader, kept across repaints and re-made only when the LUT or the
  // source's pixel size changes. A grader is a WebGL2 context; making one per
  // paint would build and lose a context on every frame of the transport, and
  // contexts are only reclaimed on GC or a forced loss.
  const graderRef = useRef<{ lut: CubeLut; w: number; h: number; grader: FrameGrader } | null>(
    null,
  );
  const graderFor = useCallback((source: BadgeSource | null): FrameGrader | null => {
    const cur = graderRef.current;
    if (!lut || !source || source.width <= 0) {
      cur?.grader.dispose();
      graderRef.current = null;
      return null;
    }
    if (cur && cur.lut === lut && cur.w === source.width && cur.h === source.height) {
      return cur.grader;
    }
    cur?.grader.dispose();
    const grader = makeFrameGrader(lut, source.width, source.height);
    graderRef.current = { lut, w: source.width, h: source.height, grader };
    return grader;
  }, [lut]);
  useEffect(
    () => () => {
      graderRef.current?.grader.dispose();
      graderRef.current = null;
    },
    [],
  );

  // The picture's box is measured, not styled: the largest box of the
  // frame's aspect that fits the wrapper, set in CSS pixels on the box that
  // holds both canvases. A canvas is a replaced element and never displays
  // past its bitmap, and CSS aspect-ratio cannot transfer a max-constraint
  // back onto a definite axis — so neither could fill the height on its own.
  // The bitmap then follows the displayed size at the device's pixel ratio
  // (floored at PREVIEW_LONG_EDGE, capped so a 5K screen does not repaint a
  // 4K canvas per animation frame), so a bigger preview is sharp, not scaled.
  const frameRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [longEdge, setLongEdge] = useState(PREVIEW_LONG_EDGE);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const box = boxRef.current;
    if (!frame || !box) return;
    const fit = () => {
      const { width, height } = frame.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const w = Math.min(width, height * aspect);
      const h = w / aspect;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
      const dpr = window.devicePixelRatio || 1;
      setLongEdge(
        Math.min(MAX_PREVIEW_LONG_EDGE, Math.max(PREVIEW_LONG_EDGE, Math.round(Math.max(w, h) * dpr))),
      );
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [aspect]);

  // Paint. Runs on every change of anything drawn, including after a decode.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = frameSize(aspect, longEdge);
    canvas.width = w;
    canvas.height = h;
    const opts: RenderBadgeOptions = {
      source: sourceRef.current,
      elements,
      theme,
      timeSeconds,
      shades,
      block,
      background,
      qr,
      grader: graderFor(sourceRef.current),
      ghostId: selectedId,
    };
    void renderBadge(canvas, opts).then(() => {
      // The thumbnail is taken from the paint alone — the outline lives on
      // the other canvas, so the order here is not what keeps it out.
      onRenderedRef.current?.(canvas);
      const ctx = canvas.getContext('2d');
      boxesRef.current = ctx ? measureBadge(ctx, canvas.width, canvas.height, opts) : [];
      drawChrome();
    });
  }, [
    aspect,
    elements,
    theme,
    timeSeconds,
    shades,
    block,
    background,
    qr,
    selectedId,
    loading,
    file,
    frameSeq,
    longEdge,
    drawChrome,
    graderFor,
  ]);

  useEffect(() => () => sourceRef.current?.release(), []);

  // --- pointing at the badge -------------------------------------------------
  const [hovering, setHovering] = useState(false);
  const drag = useRef<{
    startPx: number;
    startPy: number;
    start: { x: number; y: number };
    moved: boolean;
  } | null>(null);

  /** A pointer event in the canvas's own pixel space. */
  const toPixels = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      px: (e.clientX - rect.left) * (canvas.width / rect.width),
      py: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!onSelect || e.button !== 0) return;
      const pt = toPixels(e);
      if (!pt) return;
      // Cancelling the pointerdown cancels the mousedown behind it, whose
      // default action is to move focus — onto the body, away from the field
      // the selection is about to focus.
      e.preventDefault();
      const id = hitTest(boxesRef.current, pt.px, pt.py);
      onSelect(id);
      if (id && blockAnchor && onMoveBlock) {
        drag.current = { startPx: pt.px, startPy: pt.py, start: blockAnchor, moved: false };
        canvasRef.current?.setPointerCapture(e.pointerId);
      }
    },
    [onSelect, blockAnchor, onMoveBlock, toPixels],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      const pt = toPixels(e);
      if (!canvas || !pt) return;
      const d = drag.current;
      if (!d) {
        if (onSelect) setHovering(hitTest(boxesRef.current, pt.px, pt.py) !== null);
        return;
      }
      d.moved = true;
      const next = moveBlock(
        d.start,
        (pt.px - d.startPx) / canvas.width,
        (pt.py - d.startPy) / canvas.height,
        !e.altKey,
      );
      onMoveBlock?.(next.x, next.y);
    },
    [onSelect, onMoveBlock, toPixels],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (drag.current) {
      try {
        canvasRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // capture may already be gone; ignore
      }
    }
    drag.current = null;
  }, []);

  const cursor = !onSelect
    ? ''
    : hovering
      ? blockAnchor
        ? 'cursor-grab active:cursor-grabbing'
        : 'cursor-pointer'
      : 'cursor-default';

  return (
    // The wrapper decides how much room there is; the box inside takes the
    // largest aspect-fitting slice of it (measured above). Wide: the wrapper
    // grows to the column's whole height. Stacked: it is as tall as a
    // full-width picture, capped at 62vh so it never pushes the controls off
    // a phone screen — `cqw` is the section's width, the editor's container.
    <div className="flex flex-col items-center gap-2 min-h-0 w-full @min-[860px]:flex-1">
      <div
        ref={frameRef}
        style={{ '--aspect': aspect } as React.CSSProperties}
        className="relative flex items-center justify-center min-h-0 w-full h-[min(62vh,calc(100cqw/var(--aspect)))] @min-[860px]:h-auto @min-[860px]:flex-1"
      >
        <div
          ref={boxRef}
          className="relative rounded-paper border border-line-strong bg-frame overflow-hidden"
        >
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setHovering(false)}
            className={`absolute inset-0 w-full h-full touch-none ${cursor}`}
          />
          <canvas
            ref={chromeRef}
            aria-hidden="true"
            className="absolute inset-0 w-full h-full pointer-events-none"
          />
        </div>
        {loading && (
          <span className="absolute font-mono text-[0.7rem] text-paper bg-[rgba(20,18,15,0.7)] px-3 py-1.5 rounded-full">
            decoding…
          </span>
        )}
      </div>
      {error && (
        <p className="m-0 max-w-[46ch] text-center text-[0.78rem] text-[#9a3a23]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
