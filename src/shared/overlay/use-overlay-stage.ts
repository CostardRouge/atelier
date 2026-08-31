/**
 * Drives the overlay editor's canvas stage.
 *
 * One `requestAnimationFrame` loop composites the live video frame and the
 * overlays (via the shared `drawOverlays`) onto a canvas sized to the video's
 * intrinsic resolution; CSS scales it to fit. To avoid repainting a 4K canvas
 * when nothing changed, it only redraws while the video is playing or when a
 * `needsRedraw` flag is raised (element edits, selection, seeks).
 *
 * Pointer handlers hit-test the same boxes `drawOverlays` produces, so dragging
 * grabs exactly what's drawn. Positions update as normalized coords, clamped to
 * the frame, with light corner snapping.
 */

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { Cue } from '../telemetry/srt-parser';
import { findCue } from '../telemetry/find-cue';
import type { CubeLut } from '../lib/cube-parser';
import { createLutRenderer, type LutRenderer } from '../lut/lut-gl';
import type { Interpolation } from '../lut/interpolate';
import {
  boxForId,
  drawOverlays,
  hitTest,
  measureOverlays,
} from './draw-overlays';
import { drawGuides } from './draw-guides';
import { snapToGrid, type GuidesState } from './guides';
import type { OverlayElement } from './overlay-types';
import type { StyleTheme } from './title-styles';
import type { Scene } from './scenes';
import type { TimeShift } from '../telemetry/time-format';

interface StageParams {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /**
   * A decoded still to compose instead of the video's current frame — what a
   * photo project puts on the stage. When it is set the stage has no clock:
   * the frame never changes on its own, so the loop only repaints on an edit,
   * and every render happens at t = 0. The deck should reach here already
   * settled (see still-frame.ts); nothing else about editing changes.
   */
  still?: ImageBitmap | null;
  cues: Cue[];
  elements: OverlayElement[];
  selectedId: string | null;
  /** Editor-only composition guides (safe zones + grid); preview only. */
  guides: GuidesState;
  /** Optional LUT to grade the preview through (matches the export). */
  lut: CubeLut | null;
  /** LUT strength multiplier (0..3; 1 = 100%). */
  intensity: number;
  /** Lattice lookup for the LUT; see shared/lut/interpolate.ts. */
  interpolation?: Interpolation;
  /** Source key (object URL); resets the loop and canvas when it swaps. */
  resetKey: unknown;
  /** Bump to force a repaint after async work (e.g. fonts finished loading). */
  redrawSignal?: unknown;
  /** The project's title-style theme (null → element styles as-is). */
  theme?: StyleTheme | null;
  /** The project's capture-time correction, for clock/date/timestamp. */
  timeShift?: TimeShift | null;
  /** The project's scenes — the intro's window, scrim and solo. */
  scenes?: readonly Scene[];
  /**
   * Media time of the clip's in point: element windows are counted from the
   * first frame the export will keep, not from the media's zero.
   */
  originSeconds?: number;
  /**
   * A/B compare: when true, a draggable divider wipes between the ORIGINAL
   * frame (left) and the composed one — LUT + overlays — (right). Dragging on
   * the canvas moves the divider; element editing resumes when it's off.
   */
  compare?: boolean;
  onSelect: (id: string | null) => void;
  /** Commit a dragged element's new normalized position. */
  onMove: (id: string, x: number, y: number) => void;
}

interface StageHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

/** Snap a normalized coordinate to 0 / 0.5 / 1 when within `tol`. */
function snap(value: number, tol = 0.02): number {
  if (Math.abs(value) < tol) return 0;
  if (Math.abs(value - 1) < tol) return 1;
  if (Math.abs(value - 0.5) < tol) return 0.5;
  return value;
}

export function useOverlayStage(params: StageParams): StageHandlers {
  const { videoRef, canvasRef, onSelect, onMove } = params;

  // Live refs so the rAF loop and pointer handlers read fresh values without
  // re-subscribing every render.
  const cuesRef = useRef(params.cues);
  const elementsRef = useRef(params.elements);
  const selectedRef = useRef(params.selectedId);
  const guidesRef = useRef(params.guides);
  const lutRef = useRef(params.lut);
  const intensityRef = useRef(params.intensity);
  const interpolationRef = useRef(params.interpolation);
  const themeRef = useRef(params.theme ?? null);
  const shiftRef = useRef(params.timeShift ?? null);
  const scenesRef = useRef(params.scenes);
  const originRef = useRef(params.originSeconds ?? 0);
  const compareRef = useRef(params.compare ?? false);
  const stillRef = useRef(params.still ?? null);
  const splitRef = useRef(0.5);
  cuesRef.current = params.cues;
  elementsRef.current = params.elements;
  selectedRef.current = params.selectedId;
  guidesRef.current = params.guides;
  lutRef.current = params.lut;
  intensityRef.current = params.intensity;
  interpolationRef.current = params.interpolation;
  themeRef.current = params.theme ?? null;
  shiftRef.current = params.timeShift ?? null;
  scenesRef.current = params.scenes;
  originRef.current = params.originSeconds ?? 0;
  compareRef.current = params.compare ?? false;
  stillRef.current = params.still ?? null;

  const needsRedraw = useRef(true);

  /**
   * What the stage is composing over: a decoded still when there is one, else
   * the video's current frame. One reader, so the draw loop, the hit test and
   * the A/B wipe can never disagree about which picture (and which instant) is
   * on screen.
   */
  const readFrame = useCallback((): {
    src: CanvasImageSource;
    w: number;
    h: number;
    t: number;
  } | null => {
    const still = stillRef.current;
    if (still) return { src: still, w: still.width, h: still.height, t: 0 };
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    return {
      src: video,
      w: video.videoWidth,
      h: video.videoHeight,
      t: video.currentTime,
    };
  }, [videoRef]);

  // Lazily-created GPU grader (the same renderer LUT Studio uses). Reused across
  // frames; the LUT texture is only re-uploaded when the LUT changes.
  const graderRef = useRef<{
    renderer: LutRenderer;
    canvas: HTMLCanvasElement | OffscreenCanvas;
  } | null>(null);
  const graderTried = useRef(false);

  const ensureGrader = useCallback(() => {
    if (graderRef.current) return graderRef.current;
    if (graderTried.current) return null; // already failed (no WebGL2)
    graderTried.current = true;
    const canvas: HTMLCanvasElement | OffscreenCanvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1)
        : document.createElement('canvas');
    const renderer = createLutRenderer(canvas);
    if (!renderer) return null;
    graderRef.current = { renderer, canvas };
    return graderRef.current;
  }, []);

  // Upload the LUT / intensity / lookup when they change (not per frame), and
  // repaint. The lookup is a live uniform switch: no texture re-upload.
  useEffect(() => {
    if (params.lut) {
      const r = ensureGrader()?.renderer;
      r?.setLut(params.lut);
      r?.setIntensity(params.intensity);
      if (params.interpolation) r?.setInterpolation(params.interpolation);
    }
    needsRedraw.current = true;
  }, [params.lut, params.intensity, params.interpolation, ensureGrader]);

  // Release GL resources on unmount.
  useEffect(
    () => () => {
      graderRef.current?.renderer.dispose();
      graderRef.current = null;
    },
    [],
  );
  const drag = useRef<{
    id: string;
    startPx: number;
    startPy: number;
    startX: number;
    startY: number;
  } | null>(null);

  // Any edit to elements/selection (or an external redraw signal, e.g. fonts
  // finished loading) should trigger a repaint, even while paused. `cues`
  // belongs here too: correcting a clip's cadence hands down a re-derived cue
  // list with the same clip on screen, and without a repaint the canvas would
  // keep the old speeds while the inspector already shows the new ones — and
  // the autosaved thumbnail would bake the stale frame.
  useEffect(() => {
    needsRedraw.current = true;
  }, [
    params.elements,
    params.selectedId,
    params.redrawSignal,
    params.guides,
    params.theme,
    params.timeShift,
    params.scenes,
    params.originSeconds,
    params.compare,
    params.cues,
    // A still never announces itself the way a video's `seeked`/`loadeddata`
    // do: swapping the decoded picture IS the only signal there is.
    params.still,
  ]);

  // Composite + (optional) selection outline. Returns false if not ready.
  const drawFrame = useCallback((): boolean => {
    const canvas = canvasRef.current;
    const frame = readFrame();
    if (!canvas || !frame) return false;
    if (canvas.width !== frame.w) canvas.width = frame.w;
    if (canvas.height !== frame.h) canvas.height = frame.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    const vw = canvas.width;
    const vh = canvas.height;
    const cue = findCue(cuesRef.current, frame.t);

    // Grade through the LUT first (if any), so the preview matches the export;
    // the <video> frame (like a bitmap decoded `from-image`) is already
    // display-oriented, as the export's output is.
    const lut = lutRef.current;
    let source: CanvasImageSource = frame.src;
    if (lut) {
      let g = graderRef.current;
      if (!g) {
        g = ensureGrader();
        g?.renderer.setLut(lut);
        g?.renderer.setIntensity(intensityRef.current);
        if (interpolationRef.current) {
          g?.renderer.setInterpolation(interpolationRef.current);
        }
      }
      if (g) {
        g.renderer.resize(vw, vh);
        g.renderer.draw(frame.src as TexImageSource);
        source = g.canvas;
      }
    }
    ctx.drawImage(source, 0, 0, vw, vh);
    drawOverlays(ctx, elementsRef.current, cue, vw, vh, {
      theme: themeRef.current,
      timeShift: shiftRef.current,
      cues: cuesRef.current,
      timeSeconds: frame.t,
      scenes: scenesRef.current,
      originSeconds: originRef.current,
      // The selected element is drawn even outside its window, ghosted: a
      // title that lives in the first three seconds must stay reachable with
      // the playhead anywhere else. Editor-only — no export sets this.
      ghostId: selectedRef.current,
    });

    // A/B wipe (editor-only): the ORIGINAL frame covers the left of the
    // divider, so the composite (LUT + overlays) reads as the "after".
    if (compareRef.current) {
      const splitX = Math.round(splitRef.current * vw);
      if (splitX > 0) {
        ctx.drawImage(frame.src, 0, 0, splitX, vh, 0, 0, splitX, vh);
      }
      ctx.save();
      ctx.fillStyle = '#d9442a';
      const lw = Math.max(2, vh * 0.004);
      ctx.fillRect(splitX - lw / 2, 0, lw, vh);
      const r = Math.max(8, vh * 0.02);
      ctx.beginPath();
      ctx.arc(splitX, vh / 2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${r}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⇄', splitX, vh / 2);
      ctx.restore();
    }

    // Editor-only guides, painted over the composite (never via drawOverlays,
    // so they stay out of the export).
    drawGuides(ctx, guidesRef.current, vw, vh);

    const sel = selectedRef.current;
    if (sel) {
      const boxes = measureOverlays(ctx, elementsRef.current, cue, vw, vh, {
        theme: themeRef.current,
        timeShift: shiftRef.current,
        scenes: scenesRef.current,
        originSeconds: originRef.current,
        timeSeconds: frame.t,
        ghostId: sel,
      });
      const box = boxForId(boxes, sel);
      if (box) {
        ctx.save();
        ctx.strokeStyle = '#d9442a';
        ctx.lineWidth = Math.max(1.5, vh * 0.003);
        ctx.setLineDash([vh * 0.012, vh * 0.012]);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.restore();
      }
    }
    return true;
  }, [canvasRef, readFrame, ensureGrader]);

  // The render loop. rAF (not rVFC) so paused edits repaint too; it skips the
  // 4K composite when idle and clean.
  useEffect(() => {
    const video = videoRef.current;
    needsRedraw.current = true;

    let raf = 0;
    const loop = () => {
      const v = videoRef.current;
      // A still is never "playing": it repaints on an edit and stays put,
      // which is what keeps a 45-megapixel canvas off the rAF treadmill.
      const playing = !stillRef.current && !!v && !v.paused && !v.ended;
      if (playing || needsRedraw.current) {
        if (drawFrame()) needsRedraw.current = false;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const markDirty = () => {
      needsRedraw.current = true;
    };
    video?.addEventListener('seeked', markDirty);
    video?.addEventListener('loadeddata', markDirty);
    video?.addEventListener('timeupdate', markDirty);

    return () => {
      cancelAnimationFrame(raf);
      video?.removeEventListener('seeked', markDirty);
      video?.removeEventListener('loadeddata', markDirty);
      video?.removeEventListener('timeupdate', markDirty);
    };
  }, [videoRef, drawFrame, params.resetKey]);

  // Map a pointer event to video-pixel coordinates on the canvas.
  const toVideoPixels = useCallback(
    (e: React.PointerEvent): { px: number; py: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return {
        px: (e.clientX - rect.left) * (canvas.width / rect.width),
        py: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    },
    [canvasRef],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      const frame = readFrame();
      const pt = toVideoPixels(e);
      if (!canvas || !frame || !pt) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (compareRef.current) {
        // Compare mode: any drag moves the wipe divider.
        splitRef.current = Math.min(1, Math.max(0, pt.px / canvas.width));
        needsRedraw.current = true;
        drag.current = {
          id: '__wipe__',
          startPx: pt.px,
          startPy: pt.py,
          startX: splitRef.current,
          startY: 0,
        };
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      const cue = findCue(cuesRef.current, frame.t);
      const boxes = measureOverlays(ctx, elementsRef.current, cue, canvas.width, canvas.height, {
        theme: themeRef.current,
        timeShift: shiftRef.current,
        scenes: scenesRef.current,
        originSeconds: originRef.current,
        timeSeconds: frame.t,
        ghostId: selectedRef.current,
      });
      const id = hitTest(boxes, pt.px, pt.py);
      onSelect(id);

      if (id) {
        const el = elementsRef.current.find((x) => x.id === id);
        if (el) {
          drag.current = {
            id,
            startPx: pt.px,
            startPy: pt.py,
            startX: el.x,
            startY: el.y,
          };
          canvas.setPointerCapture(e.pointerId);
        }
      }
    },
    [canvasRef, readFrame, toVideoPixels, onSelect],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      const canvas = canvasRef.current;
      const pt = toVideoPixels(e);
      if (!d || !canvas || !pt) return;
      if (d.id === '__wipe__') {
        splitRef.current = Math.min(1, Math.max(0, pt.px / canvas.width));
        needsRedraw.current = true;
        return;
      }
      const rawX = Math.min(1, Math.max(0, d.startX + (pt.px - d.startPx) / canvas.width));
      const rawY = Math.min(1, Math.max(0, d.startY + (pt.py - d.startPy) / canvas.height));
      // Hold Alt to bypass snapping for fine placement. With grid-snap on, snap
      // the anchor to the grid lines; otherwise keep the light edge/center snap.
      const grid = guidesRef.current.grid;
      let nx = rawX;
      let ny = rawY;
      if (!e.altKey) {
        if (grid.snap) {
          nx = snapToGrid(rawX, grid.cols);
          ny = snapToGrid(rawY, grid.rows);
        } else {
          nx = snap(rawX);
          ny = snap(rawY);
        }
      }
      onMove(d.id, nx, ny);
    },
    [canvasRef, toVideoPixels, onMove],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (drag.current && canvas) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // capture may already be gone; ignore
        }
      }
      drag.current = null;
    },
    [canvasRef],
  );

  return { onPointerDown, onPointerMove, onPointerUp };
}
