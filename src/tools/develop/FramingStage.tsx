import { useEffect, useRef, useState } from 'react';
import type { DevelopPicture } from '../../shared/develop/use-develop-picture';
import {
  DEFAULT_FRAMING,
  canPan,
  drawFramed,
  panBy,
  scaleFramingBy,
  type Framing,
} from '../../shared/media/framing';
import { frameSize } from '../../shared/roadtrip/badge-render';
import { blockNativeZoom } from '../../shared/ui/native-gestures';

/** The crop preview's own pixel budget — a stage, never the export's density. */
const CROP_LONG_EDGE = 1440;

/**
 * The Develop tool's Crop tab stage: the SAME decoded picture the Develop tab
 * grades, AS DELIVERED (`useDevelopPicture().delivered`, so a crop is judged
 * on the developed picture and never on the raw decode), drawn into the
 * chosen aspect box through `shared/media/framing.ts`'s own transform.
 *
 * **Every gesture lands here, a finger's as well as a mouse's.** One pointer
 * moves the picture; a wheel (which is also what a trackpad pinch sends)
 * zooms about nothing in particular; and TWO fingers pinch to zoom while
 * moving the picture by their centre, the develop viewport's own grammar
 * (`use-picture-zoom.ts`) applied to a framing instead of a view. The pinch
 * was missing until 2026-09-16 and there is no wheel on a phone, so the crop
 * simply could not be zoomed there — while the caption promised it could.
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
  const stageRef = useRef<HTMLDivElement>(null);
  const [pannable, setPannable] = useState(false);
  const [moving, setMoving] = useState(false);
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

  // Read by the native listeners, which are bound once: the framing changes on
  // every pointer move, and re-binding a gesture mid-drag loses it.
  const live = useRef({ framing, onFraming, source });
  live.current = { framing, onFraming, source };
  const hasSource = source !== null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    /** A client point in the canvas's OWN pixels — which are the output frame's. */
    const toPixels = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return {
        px: (clientX - rect.left) * (canvas.width / rect.width),
        py: (clientY - rect.top) * (canvas.height / rect.height),
      };
    };

    /**
     * ONE write per event, zoom then move: a pinch does both, and two writes
     * in one event would each read the render's copy of the framing — so the
     * second would silently throw the first away. The zoom is applied before
     * the move because `panBy` clamps against the transform at the scale it is
     * given, and the scale the fingers just asked for is the one that counts.
     */
    const step = (factor: number, dpx: number, dpy: number) => {
      const { source: src, framing: f0, onFraming: write } = live.current;
      if (!src) return;
      const f = f0 ?? DEFAULT_FRAMING;
      const scale = scaleFramingBy(f.scale, factor);
      if (scale === f.scale && dpx === 0 && dpy === 0) return;
      const zoomed = scale === f.scale ? f : { ...f, scale };
      write(
        dpx === 0 && dpy === 0
          ? zoomed
          : panBy(zoomed, src.width, src.height, canvas.width, canvas.height, dpx, dpy),
      );
    };
    const pan = (dpx: number, dpy: number) => step(1, dpx, dpy);
    const zoom = (factor: number) => step(factor, 0, 0);

    // The wheel, and the ⌘-wheel a trackpad pinch sends — non-passive, or the
    // page scrolls away under the picture instead of the picture zooming.
    const onWheel = (e: WheelEvent) => {
      if (!live.current.source) return;
      e.preventDefault();
      zoom(Math.exp(-e.deltaY / 400));
    };

    // --- pointers: one moves, two pinch ------------------------------------
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { spread: number; scale: number } | null = null;
    let drag: { id: number; lastPx: number; lastPy: number } | null = null;

    const centre = () => {
      const pts = [...touches.values()];
      return {
        x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
        y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
      };
    };
    const spread = () => {
      const [a, b] = [...touches.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const startDrag = (id: number, clientX: number, clientY: number) => {
      const pt = toPixels(clientX, clientY);
      if (!pt) return;
      drag = { id, lastPx: pt.px, lastPy: pt.py };
      setMoving(true);
    };
    const endDrag = () => {
      drag = null;
      setMoving(false);
    };

    const onDown = (e: PointerEvent) => {
      if (!live.current.source) return;
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          // A second finger turns the move into a pinch, and the move it was
          // making is abandoned rather than fighting the fingers' centre.
          pinch = { spread: spread(), scale: (live.current.framing ?? DEFAULT_FRAMING).scale };
          endDrag();
          return;
        }
        if (touches.size > 2) return;
      } else if (e.button !== 0) {
        return;
      }
      if (pinch) return;
      startDrag(e.pointerId, e.clientX, e.clientY);
      // A touch pointer is captured implicitly; a mouse leaving the canvas
      // mid-drag is not, and a picture that stops moving at the frame's edge
      // reads as a stuck drag.
      if (e.pointerType !== 'touch') {
        try {
          stage.setPointerCapture(e.pointerId);
        } catch {
          /* not a live pointer */
        }
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        const before = touches.size === 2 ? centre() : null;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2 && pinch && before) {
          e.preventDefault();
          const after = centre();
          const from = toPixels(before.x, before.y);
          const to = toPixels(after.x, after.y);
          // The scale the FINGERS ask for, measured from where the pinch
          // started rather than from the last frame: a per-frame ratio
          // compounds its own rounding and the picture drifts under the hand.
          const wanted = pinch.spread > 0 ? scaleFramingBy(pinch.scale, spread() / pinch.spread) : null;
          const have = (live.current.framing ?? DEFAULT_FRAMING).scale;
          step(
            wanted === null || have <= 0 ? 1 : wanted / have,
            from && to ? to.px - from.px : 0,
            from && to ? to.py - from.py : 0,
          );
          return;
        }
      }
      if (!drag || e.pointerId !== drag.id) return;
      const pt = toPixels(e.clientX, e.clientY);
      if (!pt) return;
      e.preventDefault();
      pan(pt.px - drag.lastPx, pt.py - drag.lastPy);
      drag.lastPx = pt.px;
      drag.lastPy = pt.py;
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (pinch && touches.size < 2) {
          pinch = null;
          // The finger still down takes the move over, instead of being inert
          // until it is lifted and put back.
          const [id] = [...touches.keys()];
          const at = id === undefined ? undefined : touches.get(id);
          if (id !== undefined && at) startDrag(id, at.x, at.y);
        }
      }
      if (drag && e.pointerId === drag.id) endDrag();
    };

    // WebKit's own pinch zooms the whole app and CANCELS these pointers
    // (`native-gestures.ts`) — which is what "the pinch does nothing" was.
    const unblock = blockNativeZoom(stage);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    return () => {
      unblock();
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
    };
    // Bound once per mounted canvas — the element only exists while there is a
    // picture: everything that moves is read off `live`.
  }, [hasSource]);

  return (
    // The gestures are heard on the STAGE, not on the canvas: a phone gives the
    // crop a small letterboxed picture inside a wide box, so a pinch whose
    // fingers land either side of it — the ordinary way to pinch something
    // small — would reach no listener at all (measured at 390px: a 147px
    // canvas in a 374px stage). `touch-none` comes with them, and is right
    // here as on the badge stage: they write BOTH axes inside a fixed-height
    // stage, which is not a scroll box.
    <div
      ref={stageRef}
      className={`relative flex items-center justify-center overflow-hidden touch-none select-none ${
        source && pannable ? (moving ? 'cursor-grabbing' : 'cursor-grab') : ''
      } ${className ?? ''}`}
    >
      {source ? (
        <canvas
          ref={canvasRef}
          aria-label="The picture, cropped"
          className="max-w-full max-h-full w-auto h-auto rounded-paper bg-frame"
        />
      ) : (
        <p className="m-0 max-w-xs text-center text-sm text-muted">{emptyText}</p>
      )}
    </div>
  );
}
