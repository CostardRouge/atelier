import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { DevelopPicture } from '../../shared/develop/use-develop-picture';
import {
  DEFAULT_FRAMING,
  MAX_FRAMING_SCALE,
  canPan,
  drawFramed,
  panBy,
  type Framing,
} from '../../shared/media/framing';
import { frameSize } from '../../shared/roadtrip/badge-render';

/** The crop preview's own pixel budget — a stage, never the export's density. */
const CROP_LONG_EDGE = 1440;

/**
 * The Develop tool's Crop tab stage: the SAME decoded picture the Develop tab
 * grades, AS DELIVERED (`useDevelopPicture().delivered`, so a crop is judged
 * on the developed picture and never on the raw decode), drawn into the
 * chosen aspect box through `shared/media/framing.ts`'s own transform — one
 * drag pans, the wheel or a trackpad pinch zooms, exactly the gestures Trips'
 * badge stage uses over the same module, so a photographer's hand does not
 * relearn anything moving between the two.
 *
 * Kept apart from `DevelopViewport` rather than folded into it: that stage is
 * shared with the Trips and Studio modals, neither of which frames a picture
 * through it, and giving it a mode only this tool uses would be a shared file
 * carrying one host's feature. The viewport stays MOUNTED (hidden) under this
 * while the crop is open, since its paint is keyed on the picture and not on
 * the canvas element — an unmounted canvas would come back blank.
 */
export default function FramingStage({
  picture,
  aspectRatio,
  framing,
  onFraming,
  emptyText,
  className,
}: {
  picture: DevelopPicture;
  /** w / h of the box the picture frames into. */
  aspectRatio: number;
  framing: Framing;
  onFraming: (framing: Framing) => void;
  emptyText: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pannable, setPannable] = useState(false);
  const { source, cube, delivered } = picture;

  // Paint: the framed crop of the delivered picture, at the stage's own
  // pixel budget. `cube` is a dependency for what `delivered()` reads.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = frameSize(aspectRatio > 0 ? aspectRatio : 1, CROP_LONG_EDGE);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const image = delivered();
    if (!source || !image) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      setPannable(false);
      return;
    }
    drawFramed(ctx, image, source.width, source.height, w, h, framing);
    setPannable(canPan(source.width, source.height, w, h, framing));
  }, [source, cube, delivered, aspectRatio, framing]);

  // The wheel (also what a trackpad pinch sends) zooms the framing — attached
  // natively and NOT passively, exactly like the badge stage, or the page
  // scrolls away under the picture instead of the picture zooming.
  const framingRef = useRef(framing);
  framingRef.current = framing;
  const onFramingRef = useRef(onFraming);
  onFramingRef.current = onFraming;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      if (!source) return;
      e.preventDefault();
      const f = framingRef.current ?? DEFAULT_FRAMING;
      const scale = Math.min(MAX_FRAMING_SCALE, Math.max(1, f.scale * Math.exp(-e.deltaY / 400)));
      if (scale === f.scale) return;
      onFramingRef.current({ ...f, scale });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [source]);

  const sourceRef = useRef(source);
  sourceRef.current = source;
  const drag = useRef<{ lastPx: number; lastPy: number } | null>(null);
  const toPixels = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
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
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0 || !sourceRef.current) return;
      const pt = toPixels(e);
      if (!pt) return;
      drag.current = { lastPx: pt.px, lastPy: pt.py };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* not a live pointer */
      }
    },
    [toPixels],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const d = drag.current;
      const canvas = canvasRef.current;
      const src = sourceRef.current;
      if (!d || !canvas || !src) return;
      const pt = toPixels(e);
      if (!pt) return;
      // Deltas in the canvas's own pixels, which IS the output frame — `panBy`
      // turns them into the picture's axes and clamps them, so no drag can
      // ever open a gap at the edge.
      onFramingRef.current(
        panBy(framingRef.current ?? DEFAULT_FRAMING, src.width, src.height, canvas.width, canvas.height, pt.px - d.lastPx, pt.py - d.lastPy),
      );
      d.lastPx = pt.px;
      d.lastPy = pt.py;
    },
    [toPixels],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (drag.current) {
      try {
        canvasRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
    }
    drag.current = null;
  }, []);

  return (
    <div className={`relative flex items-center justify-center overflow-hidden ${className ?? ''}`}>
      {source ? (
        // `touch-none` is right here, as on the badge stage: the drag writes
        // BOTH axes and the canvas sits in a fixed-height stage, not a scroll box.
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="The picture, cropped"
          className={`max-w-full max-h-full w-auto h-auto rounded-paper bg-frame touch-none ${
            pannable ? 'cursor-grab active:cursor-grabbing' : ''
          }`}
        />
      ) : (
        <p className="m-0 max-w-xs text-center text-sm text-muted">{emptyText}</p>
      )}
    </div>
  );
}
