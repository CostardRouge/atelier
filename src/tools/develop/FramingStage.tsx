import { useEffect, useRef, useState } from 'react';
import { CROP_HANDLES, resizeAspectRatio, type CropHandle } from '../../shared/develop/crop-aspect';
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
 * Where each handle sits on the frame's own box, and what the cursor says it
 * will do. They are drawn ON the edge, half outside it: a handle inside the
 * picture would hide the very corner it is there to place.
 */
const HANDLE_STYLE: Record<CropHandle, string> = {
  nw: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
  n: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize',
  ne: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
  e: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
  se: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
  s: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize',
  sw: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
  w: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
};

/** The handle a pointer went down on, if it went down on one at all. */
function handleAt(target: EventTarget | null): CropHandle | null {
  const el = target instanceof Element ? target.closest('[data-crop-handle]') : null;
  const name = el?.getAttribute('data-crop-handle');
  return name ? (name as CropHandle) : null;
}

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
 * On a FREE zone the frame also wears eight handles: dragging one asks for a
 * new SHAPE (`crop-aspect.ts`), which is the other half of cropping — the
 * picture moves under the frame, and the frame is the shape the author drew.
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
  onAspectRatio,
  emptyText,
  className,
}: {
  picture: DevelopPicture;
  /** w / h of the box the picture frames into. */
  aspectRatio: number;
  framing: Framing;
  onFraming: (framing: Framing) => void;
  /**
   * Set only while the crop is a FREE zone: the frame then wears eight handles
   * and a drag on one asks for a new shape. A fixed aspect has none — its
   * shape is the point of it.
   */
  onAspectRatio?: (ratio: number) => void;
  emptyText: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [pannable, setPannable] = useState(false);
  const [moving, setMoving] = useState(false);
  const [frameBox, setFrameBox] = useState<{ w: number; h: number } | null>(null);
  const { source, cube, delivered } = picture;
  const hasSource = source !== null;

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

  // The frame's box ON SCREEN, which is what the handles are laid on. It is
  // MEASURED rather than described in CSS: the canvas takes its shape from its
  // own intrinsic size against the stage's box (`max-w-full max-h-full
  // w-auto h-auto`), and no wrapper can be told to shrink-wrap that without
  // either stretching it or losing the constraint that letterboxes it.
  const canReshape = Boolean(onAspectRatio);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canReshape) {
      setFrameBox(null);
      return;
    }
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      setFrameBox(rect.width > 0 && rect.height > 0 ? { w: rect.width, h: rect.height } : null);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    measure();
    return () => observer.disconnect();
  }, [hasSource, canReshape]);

  // Read by the native listeners, which are bound once: the framing changes on
  // every pointer move, and re-binding a gesture mid-drag loses it.
  const live = useRef({ framing, onFraming, source, onAspectRatio });
  live.current = { framing, onFraming, source, onAspectRatio };

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

    // --- pointers: one moves, two pinch, a handle reshapes ------------------
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { spread: number; scale: number } | null = null;
    let drag: { id: number; lastPx: number; lastPy: number } | null = null;
    let resize: { id: number; handle: CropHandle } | null = null;

    /**
     * A handle drag asks for a SHAPE, not a move: the ratio is read from where
     * the finger is relative to the frame's centre, measured against the frame
     * as it is drawn at this instant (`crop-aspect.ts` explains why that is
     * the stable reading). The frame's centre never moves — the canvas is
     * letterboxed in the middle of the stage whatever its shape — so there is
     * nothing to anchor and nothing to accumulate.
     */
    const reshape = (clientX: number, clientY: number) => {
      const { onAspectRatio: setRatio } = live.current;
      if (!resize || !setRatio) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setRatio(
        resizeAspectRatio(
          resize.handle,
          clientX - (rect.left + rect.width / 2),
          clientY - (rect.top + rect.height / 2),
          rect.width,
          rect.height,
        ),
      );
    };

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
      // A handle is answered before anything else, and it never becomes a
      // finger of a pinch: reshaping and moving are two gestures, not one.
      const handle = live.current.onAspectRatio ? handleAt(e.target) : null;
      if (handle) {
        if (e.pointerType !== 'touch' && e.button !== 0) return;
        e.preventDefault();
        resize = { id: e.pointerId, handle };
        endDrag();
        try {
          stage.setPointerCapture(e.pointerId);
        } catch {
          /* not a live pointer */
        }
        return;
      }
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
      if (resize) {
        if (e.pointerId !== resize.id) return;
        e.preventDefault();
        reshape(e.clientX, e.clientY);
        return;
      }
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
      if (resize && e.pointerId === resize.id) {
        resize = null;
        return;
      }
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
    // The padding is the handles' room: they straddle the frame's edge, and a
    // frame drawn flush against a stage that clips (`overflow-hidden`, which
    // it must, the picture being larger than it) loses the two handles on
    // whichever side the fit pinned — the ones a wide picture is cropped by.
    // Paid at every aspect, so nothing moves when Free is picked.
    <div
      ref={stageRef}
      className={`relative flex items-center justify-center overflow-hidden touch-none select-none p-3.5 ${
        source && pannable ? (moving ? 'cursor-grabbing' : 'cursor-grab') : ''
      } ${className ?? ''}`}
    >
      {source ? (
        <>
          <canvas
            ref={canvasRef}
            aria-label="The picture, cropped"
            className="block max-w-full max-h-full w-auto h-auto rounded-paper bg-frame"
          />
          {onAspectRatio && frameBox && (
            // Laid over the frame, centred on the stage exactly as the canvas
            // is; it passes every pointer through but its handles.
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{ width: frameBox.w, height: frameBox.h }}
            >
              {CROP_HANDLES.map((handle) => (
                // Not a button: the shape's keyboard way in is the Shape
                // slider in the panel, and eight tab stops around a picture
                // would be a trap rather than an alternative. The touch target
                // is 24px around a 10px mark.
                <span
                  key={handle}
                  data-crop-handle={handle}
                  role="presentation"
                  title="Drag to set the frame’s shape"
                  className={`absolute w-6 h-6 flex items-center justify-center pointer-events-auto ${HANDLE_STYLE[handle]}`}
                >
                  <span className="block w-2.5 h-2.5 rounded-[2px] border border-ink bg-paper shadow-[0_1px_3px_rgba(0,0,0,0.35)]" />
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="m-0 max-w-xs text-center text-sm text-muted">{emptyText}</p>
      )}
    </div>
  );
}
