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
import type { CubeLut } from '../../shared/lib/cube-parser';
import { createLutRenderer, type LutRenderer } from '../lut/lut-gl';
import {
  boxForId,
  drawOverlays,
  hitTest,
  measureOverlays,
} from './draw-overlays';
import type { Anchor, OverlayElement } from './overlay-types';

interface StageParams {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cues: Cue[];
  elements: OverlayElement[];
  selectedId: string | null;
  /** Optional LUT to grade the preview through (matches the export). */
  lut: CubeLut | null;
  /** Source key (object URL); resets the loop and canvas when it swaps. */
  resetKey: unknown;
  /** Bump to force a repaint after async work (e.g. fonts finished loading). */
  redrawSignal?: unknown;
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

/** Pick the anchor closest to a normalized position, for clean edge pinning. */
function anchorFor(x: number, y: number): Anchor {
  const h = x <= 0.04 ? 'left' : x >= 0.96 ? 'right' : 'center';
  const v = y <= 0.04 ? 'top' : y >= 0.96 ? 'bottom' : 'center';
  if (v === 'center' && h === 'center') return 'center';
  return `${v}-${h}` as Anchor;
}

export function useOverlayStage(params: StageParams): StageHandlers {
  const { videoRef, canvasRef, onSelect, onMove } = params;

  // Live refs so the rAF loop and pointer handlers read fresh values without
  // re-subscribing every render.
  const cuesRef = useRef(params.cues);
  const elementsRef = useRef(params.elements);
  const selectedRef = useRef(params.selectedId);
  const lutRef = useRef(params.lut);
  cuesRef.current = params.cues;
  elementsRef.current = params.elements;
  selectedRef.current = params.selectedId;
  lutRef.current = params.lut;

  const needsRedraw = useRef(true);

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

  // Upload the LUT when it changes (not per frame), and repaint.
  useEffect(() => {
    if (params.lut) ensureGrader()?.renderer.setLut(params.lut);
    needsRedraw.current = true;
  }, [params.lut, ensureGrader]);

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
  // finished loading) should trigger a repaint, even while paused.
  useEffect(() => {
    needsRedraw.current = true;
  }, [params.elements, params.selectedId, params.redrawSignal]);

  // Composite + (optional) selection outline. Returns false if not ready.
  const drawFrame = useCallback((): boolean => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return false;
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    const vw = canvas.width;
    const vh = canvas.height;
    const cue = findCue(cuesRef.current, video.currentTime);

    // Grade through the LUT first (if any), so the preview matches the export;
    // the <video> frame is already display-oriented, like the export's output.
    const lut = lutRef.current;
    let source: CanvasImageSource = video;
    if (lut) {
      let g = graderRef.current;
      if (!g) {
        g = ensureGrader();
        g?.renderer.setLut(lut);
      }
      if (g) {
        g.renderer.resize(vw, vh);
        g.renderer.draw(video);
        source = g.canvas;
      }
    }
    ctx.drawImage(source, 0, 0, vw, vh);
    drawOverlays(ctx, elementsRef.current, cue, vw, vh);

    const sel = selectedRef.current;
    if (sel) {
      const boxes = measureOverlays(ctx, elementsRef.current, cue, vw, vh);
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
  }, [videoRef, canvasRef, ensureGrader]);

  // The render loop. rAF (not rVFC) so paused edits repaint too; it skips the
  // 4K composite when idle and clean.
  useEffect(() => {
    const video = videoRef.current;
    needsRedraw.current = true;

    let raf = 0;
    const loop = () => {
      const v = videoRef.current;
      const playing = !!v && !v.paused && !v.ended;
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
      const video = videoRef.current;
      const pt = toVideoPixels(e);
      if (!canvas || !video || !pt) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const cue = findCue(cuesRef.current, video.currentTime);
      const boxes = measureOverlays(ctx, elementsRef.current, cue, canvas.width, canvas.height);
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
    [canvasRef, videoRef, toVideoPixels, onSelect],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      const canvas = canvasRef.current;
      const pt = toVideoPixels(e);
      if (!d || !canvas || !pt) return;
      const nx = snap(
        Math.min(1, Math.max(0, d.startX + (pt.px - d.startPx) / canvas.width)),
      );
      const ny = snap(
        Math.min(1, Math.max(0, d.startY + (pt.py - d.startPy) / canvas.height)),
      );
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

/** Re-anchor an element to the nearest edge/corner of its current position. */
export function reanchor(el: OverlayElement): Anchor {
  return anchorFor(el.x, el.y);
}
