import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CubeLut } from '../../shared/lib/cube-parser';
import { makeFrameGrader, type FrameGrader } from '../../shared/lut/frame-grader';
import {
  DEFAULT_FRAMING,
  MAX_FRAMING_SCALE,
  canPan,
  panBy,
  type Framing,
} from '../../shared/media/framing';
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
import { TRIM_EPSILON, type TrimRange } from '../../shared/media/trim';
import { clampPlaybackRate } from '../../shared/media/use-video-transport';
import { useIsCompact } from '../../shared/ui/use-layout-mode';

/**
 * Playing the open clip on the stage. The stage owns the `<video>` behind the
 * picture (it is the decoded source), so it is the only place playback can
 * be driven from; the caller owns the CLOCK — it receives the playhead every
 * animation frame and hands the badge's own time back down as `timeSeconds`.
 */
export interface StagePlayback {
  playing: boolean;
  /** The clip's speed, which is also the preview's rate. */
  rate: number;
  /** The stretch played: playback starts at `start` and stops on `end`. */
  range: TrimRange;
  /** Jump back to `start` on the out point instead of stopping there. */
  loop: boolean;
  /** The playhead, in source seconds, once per frame while playing. */
  onTime: (seconds: number) => void;
  /** Playback stopped on the out point. */
  onEnded: () => void;
}

interface BadgeStageProps {
  file: File | null;
  /**
   * Frame of a clip to sit on — the playhead, in source seconds; ignored for
   * photos. While `playback.playing` the element advances on its own and this
   * is only what the caller was last told, so it is not seeked to.
   */
  videoTimeSeconds: number;
  /** Play the clip; absent, the stage shows the one frame it was asked for. */
  playback?: StagePlayback | null;
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
  /** How the picture sits in the frame. */
  framing?: Framing | null;
  /**
   * Reframing the picture: dragging where no element sits pans it, the wheel
   * zooms. Absent, the picture is fixed and only the badge moves.
   */
  onFraming?: (framing: Framing) => void;
  /** The element outlined on the stage, and kept visible past its window. */
  selectedId?: string | null;
  /** A click on the stage: the element under the pointer, or null for the picture. */
  onSelect?: (id: string | null) => void;
  /**
   * A press on an element that never became a drag — a TAP, which is a request
   * to EDIT it. Selection happens on pointer down, since a block drag starts
   * from it, so it cannot be what raises a phone's inspector sheet: the sheet
   * would rise over the picture the moment a drag began.
   */
  onActivate?: (id: string) => void;
  /**
   * The badge block's anchor, when this slide has one to move. Dragging any
   * element moves the whole block; absent (a caption, the closing card) a
   * click selects and nothing moves.
   */
  blockAnchor?: { x: number; y: number } | null;
  onMoveBlock?: (x: number, y: number) => void;
  onSourceLoaded?: (info: { width: number; height: number; duration: number }) => void;
  /**
   * The width the picture wants from the height it was given (height ×
   * aspect), reported on every measure. The editor caps the stage column with
   * it so a portrait frame on a wide screen does not leave the slide rail
   * stranded a third of a screen away. Height-derived on purpose: the column's
   * height does not depend on its width, so capping the width cannot feed
   * back into the measurement.
   */
  onFit?: (widthPx: number) => void;
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
  playback = null,
  aspect,
  elements,
  theme,
  timeSeconds,
  shades,
  block,
  background,
  qr,
  lut = null,
  framing = null,
  onFraming,
  selectedId = null,
  onSelect,
  onActivate,
  blockAnchor = null,
  onMoveBlock,
  onSourceLoaded,
  onRendered,
  onFit,
}: BadgeStageProps) {
  // Whether anything else is competing for this screen's height — see the
  // wrapper's comment below.
  const compactShell = useIsCompact();
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
  // The playback callbacks through a ref: the loop below must not be torn
  // down and restarted because the caller passed a fresh closure.
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const playing = Boolean(playback?.playing);
  useEffect(() => {
    const source = sourceRef.current;
    if (!source?.seek || loading) return;
    // While the clip plays, `videoTimeSeconds` is the playhead the loop
    // itself reported a frame ago: seeking to it would drag the element
    // backwards a few milliseconds on every frame and stutter the picture.
    if (playbackRef.current?.playing) return;
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

  // Play the clip. The element advances by itself; a rAF loop reports the
  // playhead to the caller and bumps `frameSeq` so the paint below draws
  // every frame — the caller's `timeSeconds` alone would not, since a
  // content slide's badge time never moves. The out point is watched on the
  // same loop rather than on `timeupdate`, which fires ~4×/s and would let
  // playback run a quarter of a second past the handle.
  useEffect(() => {
    const source = sourceRef.current;
    const v = source?.image;
    const pb = playbackRef.current;
    if (!pb?.playing || loading || !(v instanceof HTMLVideoElement)) return;
    const { start, end } = pb.range;
    v.playbackRate = clampPlaybackRate(pb.rate);
    // Pressing play on (or outside) the out point means replay the stretch.
    if (v.currentTime < start || v.currentTime >= end - TRIM_EPSILON) v.currentTime = start;
    // Muted and started by the author's own press, so the browser allows it;
    // a refusal leaves the frame where it is.
    void v.play().catch(() => {});
    let raf = 0;
    const tick = () => {
      const now = playbackRef.current;
      if (v.currentTime >= end - TRIM_EPSILON) {
        if (now?.loop) {
          v.currentTime = start;
        } else {
          v.pause();
          // Land exactly on the handle, so the next press is unambiguously
          // "at the out point" and replays from the in point.
          v.currentTime = end;
          now?.onTime(end);
          setFrameSeq((n) => n + 1);
          now?.onEnded();
          return;
        }
      }
      now?.onTime(v.currentTime);
      setFrameSeq((n) => n + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      v.pause();
    };
    // The loop restarts when the stretch, the rate or the loop flag change
    // under it; the callbacks are read through the ref.
  }, [
    playing,
    playback?.rate,
    playback?.range.start,
    playback?.range.end,
    playback?.loop,
    loading,
  ]);

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
  // Read through a ref: the fit callback must not re-run the observer.
  const onFitRef = useRef(onFit);
  onFitRef.current = onFit;
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [longEdge, setLongEdge] = useState(PREVIEW_LONG_EDGE);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const box = boxRef.current;
    if (!frame || !box) return;
    const fit = () => {
      // The wrapper's client size, not its bounding rect: the content box is
      // the room the picture really has.
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      if (width <= 0 || height <= 0) return;
      onFitRef.current?.(height * aspect);
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
      framing,
      grader: graderFor(sourceRef.current),
      ghostId: selectedId,
    };
    void renderBadge(canvas, opts).then(() => {
      // The thumbnail is taken from the paint alone — the outline lives on
      // the other canvas, so the order here is not what keeps it out.
      onRenderedRef.current?.(canvas);
      const ctx = canvas.getContext('2d');
      boxesRef.current = ctx ? measureBadge(ctx, canvas.width, canvas.height, opts) : [];
      const src = sourceRef.current;
      setPannable(
        !!src &&
          canPan(src.width, src.height, canvas.width, canvas.height, framing ?? DEFAULT_FRAMING),
      );
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
    framing,
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
  /** Whether the picture has any room to be dragged at its current framing. */
  const [pannable, setPannable] = useState(false);
  const framingRef = useRef(framing);
  framingRef.current = framing;
  const onFramingRef = useRef(onFraming);
  onFramingRef.current = onFraming;

  /**
   * Zooming the picture INSIDE its frame with the wheel. Attached natively and
   * NOT passively: React's own wheel handler is passive, so `preventDefault`
   * there is ignored and the page scrolls away under the picture you are
   * trying to frame.
   *
   * A ctrl/⌘-wheel — which is also what a trackpad pinch sends — frames the
   * picture too. The stage has no view zoom to hand it to: the preview simply
   * fills the room it is given, so every zoom gesture over it means the one
   * thing the document remembers.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onFraming) return;
    const onWheel = (e: WheelEvent) => {
      const source = sourceRef.current;
      if (!source) return;
      e.preventDefault();
      const f = framingRef.current ?? DEFAULT_FRAMING;
      const scale = Math.min(
        MAX_FRAMING_SCALE,
        Math.max(1, f.scale * Math.exp(-e.deltaY / 400)),
      );
      if (scale === f.scale) return;
      onFramingRef.current?.({ ...f, scale });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [onFraming]);
  // Where a press landed, in CSS pixels, and on what — so a release can tell
  // a tap from a drag.
  const press = useRef<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<
    | {
        kind: 'block';
        startPx: number;
        startPy: number;
        start: { x: number; y: number };
        moved: boolean;
      }
    | { kind: 'picture'; lastPx: number; lastPy: number }
    | null
  >(null);

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
      press.current = id ? { id, x: e.clientX, y: e.clientY } : null;
      if (id && blockAnchor && onMoveBlock) {
        drag.current = {
          kind: 'block',
          startPx: pt.px,
          startPy: pt.py,
          start: blockAnchor,
          moved: false,
        };
        canvasRef.current?.setPointerCapture(e.pointerId);
        return;
      }
      // Nothing under the pointer: the gesture is about the PICTURE. The
      // badge keeps first claim on a press — a hook is composed far more
      // often than it is reframed — so this only ever runs on bare picture.
      if (!id && onFraming) {
        drag.current = { kind: 'picture', lastPx: pt.px, lastPy: pt.py };
        canvasRef.current?.setPointerCapture(e.pointerId);
      }
    },
    [onSelect, blockAnchor, onMoveBlock, onFraming, toPixels],
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
      if (d.kind === 'picture') {
        const source = sourceRef.current;
        if (!source || !onFraming) return;
        // Deltas are in the canvas's own pixels, which IS the output frame —
        // `panBy` turns them into the picture's axes and clamps them, so no
        // drag can ever open a gap at the edge.
        onFraming(
          panBy(
            framing ?? DEFAULT_FRAMING,
            source.width,
            source.height,
            canvas.width,
            canvas.height,
            pt.px - d.lastPx,
            pt.py - d.lastPy,
          ),
        );
        d.lastPx = pt.px;
        d.lastPy = pt.py;
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
    [onSelect, onMoveBlock, onFraming, framing, toPixels],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const p = press.current;
    press.current = null;
    // 4px, the threshold every other press-or-drag surface in the suite uses.
    if (p && Math.abs(e.clientX - p.x) <= 4 && Math.abs(e.clientY - p.y) <= 4) {
      onActivate?.(p.id);
    }
    if (drag.current) {
      try {
        canvasRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // capture may already be gone; ignore
      }
    }
    drag.current = null;
  }, [onActivate]);

  const cursor = !onSelect
    ? ''
    : hovering
      ? blockAnchor
        ? 'cursor-grab active:cursor-grabbing'
        : 'cursor-pointer'
      : onFraming && pannable
        ? 'cursor-grab active:cursor-grabbing'
        : 'cursor-default';

  return (
    // The wrapper decides how much room there is; the box inside takes the
    // largest aspect-fitting slice of it (measured above). Wide: the wrapper
    // grows to the column's whole height.
    //
    // Stacked, it depends on the shell's height model. On a compact shell the
    // wrapper HUGS the picture: it is an aspect box the width of the column,
    // free to shrink when the column is shorter than that, so its height is
    // the picture's own height in both cases. That is what puts the transport
    // under the frame it drives instead of at the foot of the screen — a
    // `flex-1` wrapper is taller than a width-bound picture, and the slack it
    // swallowed read as a gap above the controls and no gap at all below them.
    // The leftover now falls under the whole group, where it is breathing
    // room. Everywhere else stacked (a tablet, where the inspector is still in
    // this column and the column scrolls) it states its own height: as tall as
    // a full-width picture, capped so it never pushes the controls off screen.
    // `cqw` is the section's width, the editor's container.
    //
    // A VIEWPORT question, not the container one the layout splits on: what
    // changes is the shell's height model, which no container can see.
    <div
      style={{ '--aspect': aspect } as React.CSSProperties}
      className={`flex flex-col items-center gap-2 min-h-0 w-full @min-[860px]:flex-1 ${
        compactShell ? 'aspect-[var(--aspect)]' : ''
      }`}
    >
      <div
        ref={frameRef}
        className={`relative flex items-center justify-center min-h-0 w-full @min-[860px]:h-auto @min-[860px]:flex-1 ${
          compactShell ? 'flex-1' : 'h-[min(62vh,calc(100cqw/var(--aspect)))]'
        }`}
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
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[0.7rem] text-paper bg-[rgba(20,18,15,0.7)] px-3 py-1.5 rounded-full">
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
