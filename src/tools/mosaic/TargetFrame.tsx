import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { HANDLES, cropOfRect, cropRect, isWhole, resizeFrame, type Crop, type Handle, type Rect } from '../../shared/mosaic/frame';

interface TargetFrameProps {
  /** The target's picture, once fetched (the scene's proxy); null while it comes. */
  bitmap: ImageBitmap | null;
  /** Its thumbnail on the instance, drawn until the bitmap is here. */
  fallbackUrl: string | null;
  /** The frame's shape (width / height). */
  aspect: number;
  crop: Crop | undefined;
  /** A drag ended: the crop to keep. */
  onCrop: (crop: Crop) => void;
  /** The card itself was pressed (not the frame): choose another picture. */
  onChoose: () => void;
  /** A run plays: nothing on the card is grabbed. */
  frozen?: boolean;
  /**
   * While a run plays, the picture whose mosaic is on screen (lab 4, L2): the card shows it whole — `bitmap` is it —
   * with no frame (a chain takes each picture whole) and says so.
   */
  showing?: number | null;
}

/** The card's height at most, so a portrait does not push the dials off the screen. */
const MAX_H = 240;
/** A frame is never narrower than this on screen (R1), whatever the picture. */
const MIN_FRAME_PX = 48;
/** A grip's zone, under a finger (`touch-targets.md`). */
const GRIP = 44;

const CURSORS: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

/**
 * The TARGET in the inspector (his asks, 2026-11-01): the picture rebuilt,
 * as wide as the inspector, with the FRAME on it — the part the mosaic
 * rebuilds (`frame.ts`). Three states and not one more: WHOLE (a thin
 * inset trace, nothing dimmed), CROPPED (the rest dimmed, the frame grabbed
 * by its inside to move and by its eight grips to resize — 44 px zones
 * drawn as corner marks, never past the card) and FROZEN while a run plays.
 * The trace is drawn INSIDE the rectangle so a frame against the picture's
 * edge keeps it; a frame is never under 48 px on screen. The crop is written
 * when the drag ends, so the scene rebuilds once. A press outside the frame
 * chooses another picture.
 */
export default function TargetFrame({ bitmap, fallbackUrl, aspect, crop, onCrop, onChoose, frozen = false, showing = null }: TargetFrameProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [boxW, setBoxW] = useState(0);
  const [draft, setDraft] = useState<Rect | null>(null);
  const drag = useRef<{ mode: 'move' | Handle; x: number; y: number; start: Rect } | null>(null);

  // Measured on the card's own box, after layout, and again when it changes (a scrollbar, a resize).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBoxW((w) => (w === el.clientWidth ? w : el.clientWidth));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // The picture laid in the card: as wide as it, under MAX_H.
  const W = bitmap?.width ?? 16;
  const H = bitmap?.height ?? 9;
  const k = boxW > 0 ? Math.min(boxW / W, MAX_H / H) : 0;
  const dispW = Math.floor(W * k);
  const dispH = Math.floor(H * k);
  const rect = draft ?? cropRect(W, H, aspect, crop);
  const whole = !draft && isWhole(crop) && Math.abs(rect.w * k - dispW) < 1 && Math.abs(rect.h * k - dispH) < 1;
  /** The minimum frame width in picture pixels — 48 px on this screen. */
  const minW = k > 0 ? MIN_FRAME_PX / k : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap || !dispW || !dispH) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(dispW * dpr);
    canvas.height = Math.round(dispH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, dispW, dispH);
  }, [bitmap, dispW, dispH]);

  const toPicture = (e: ReactPointerEvent) => {
    const b = canvasRef.current?.getBoundingClientRect();
    if (!b || !k) return { x: 0, y: 0 };
    return { x: (e.clientX - b.left) / k, y: (e.clientY - b.top) / k };
  };
  const settle = (r: Rect) => cropRect(W, H, aspect, cropOfRect(W, H, aspect, r));

  const onDown = (e: ReactPointerEvent<HTMLElement>, mode: 'move' | Handle) => {
    if (!bitmap || frozen) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toPicture(e);
    drag.current = { mode, x: p.x, y: p.y, start: rect };
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toPicture(e);
    if (d.mode === 'move') setDraft(settle({ ...d.start, x: d.start.x + (p.x - d.x), y: d.start.y + (p.y - d.y) }));
    else setDraft(settle(resizeFrame(d.start, d.mode, p.x, p.y, aspect, minW)));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !draft) return;
    onCrop(cropOfRect(W, H, aspect, draft));
    setDraft(null);
  };

  if (!bitmap || dispW <= 0) {
    return (
      <div ref={boxRef} className="w-full min-w-0">
        {fallbackUrl ? (
          <button type="button" onClick={onChoose} className="block w-full overflow-hidden bg-frame" title="Choose another picture">
            <img src={fallbackUrl} alt="The target" className="block w-full max-h-[240px] object-contain" />
          </button>
        ) : (
          <button type="button" onClick={onChoose} className="w-full aspect-video border border-dashed border-line-strong text-xs text-muted">
            Choose a picture
          </button>
        )}
      </div>
    );
  }

  const fx = rect.x * k;
  const fy = rect.y * k;
  const fw = rect.w * k;
  const fh = rect.h * k;
  return (
    <div ref={boxRef} className="w-full min-w-0 flex justify-center">
      <div
        className="relative select-none touch-none overflow-hidden bg-frame"
        style={{ width: dispW, height: dispH }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        data-frame-state={showing !== null ? 'playing' : frozen ? 'frozen' : whole ? 'whole' : 'cropped'}
      >
        <canvas
          ref={canvasRef}
          className={`block ${frozen ? '' : 'cursor-pointer'}`}
          style={{ width: dispW, height: dispH }}
          onClick={() => !frozen && onChoose()}
          aria-label={showing !== null ? `Picture ${showing}, on screen` : frozen ? 'The target' : 'The target — choose another picture'}
          role={frozen ? 'img' : 'button'}
        />
        {showing !== null && (
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1.5 px-1.5 py-[2px] rounded-[6px] bg-frame/80 text-on-media font-mono text-3xs tracking-[0.08em] uppercase" role="status">
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
            on screen · <span className="tabular-nums normal-case tracking-normal">#{showing}</span>
          </span>
        )}
        {/* The frame: its trace INSIDE the rectangle (a light line over a dark one, legible on any picture); none while a run shows another picture. */}
        <div
          hidden={showing !== null}
          className={`absolute ${frozen ? '' : 'cursor-move'}`}
          style={{
            left: fx,
            top: fy,
            width: fw,
            height: fh,
            boxShadow: `inset 0 0 0 2px #f4f0e7, inset 0 0 0 3px rgba(16,15,13,0.75)${whole ? '' : ', 0 0 0 9999px rgba(16,15,13,0.55)'}`,
            opacity: whole ? 0.55 : 1,
          }}
          onPointerDown={(e) => onDown(e, 'move')}
          aria-label="The part of the picture the mosaic rebuilds — drag to move"
        >
          {!frozen &&
            HANDLES.map((h) => {
              const atW = h.includes('w');
              const atE = h.includes('e');
              const atN = h.includes('n');
              const atS = h.includes('s');
              const corner = h.length === 2;
              // A grip never leaves the frame (it would leave the card) and leaves the middle third to the move.
              const gw = Math.min(GRIP, fw / 3);
              const gh = Math.min(GRIP, fh / 3);
              const style: React.CSSProperties = {
                position: 'absolute',
                width: corner || atE || atW ? gw : Math.max(0, fw - 2 * gw),
                height: corner || atN || atS ? gh : Math.max(0, fh - 2 * gh),
                left: atW ? 0 : atE ? undefined : gw,
                right: atE ? 0 : undefined,
                top: atN ? 0 : atS ? undefined : gh,
                bottom: atS ? 0 : undefined,
                cursor: CURSORS[h],
              };
              return (
                <div key={h} style={style} onPointerDown={(e) => onDown(e, h)} aria-label={`Resize the frame (${h})`} data-grip={h}>
                  {corner && (
                    <span
                      aria-hidden="true"
                      className="absolute w-3 h-3 border-paper"
                      style={{
                        left: atW ? 3 : undefined,
                        right: atE ? 3 : undefined,
                        top: atN ? 3 : undefined,
                        bottom: atS ? 3 : undefined,
                        borderLeftWidth: atW ? 2 : 0,
                        borderRightWidth: atE ? 2 : 0,
                        borderTopWidth: atN ? 2 : 0,
                        borderBottomWidth: atS ? 2 : 0,
                        filter: 'drop-shadow(0 0 1px rgba(16,15,13,0.9))',
                      }}
                    />
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
