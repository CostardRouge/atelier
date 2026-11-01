import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cropOfRect, cropRect, type Crop, type Rect } from '../../shared/mosaic/frame';

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
}

/** The card's height at most, so a portrait does not push the dials off the screen. */
const MAX_H = 240;

/**
 * The TARGET in the inspector (his ask, 2026-11-01: «un input de type image
 * où on verra la miniature … sur toute la largeur de l'inspecteur»): the
 * picture rebuilt, as wide as the inspector, with the FRAME on it — the
 * part the mosaic rebuilds (`frame.ts`), dimmed around. Drag the frame to
 * move it, its corner to resize it (its shape is the aspect's, always); the
 * crop is written when the drag ends, so the scene rebuilds once. A press
 * outside the frame chooses another picture.
 */
export default function TargetFrame({ bitmap, fallbackUrl, aspect, crop, onCrop, onChoose }: TargetFrameProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [boxW, setBoxW] = useState(0);
  const [draft, setDraft] = useState<Rect | null>(null);
  const drag = useRef<{ mode: 'move' | 'size'; x: number; y: number; start: Rect } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // The picture laid in the card: as wide as it, under MAX_H.
  const W = bitmap?.width ?? 16;
  const H = bitmap?.height ?? 9;
  const k = boxW > 0 ? Math.min(boxW / W, MAX_H / H) : 0;
  const dispW = Math.round(W * k);
  const dispH = Math.round(H * k);
  const rect = draft ?? cropRect(W, H, aspect, crop);

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

  const onDown = (e: ReactPointerEvent<HTMLDivElement>, mode: 'move' | 'size') => {
    if (!bitmap) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toPicture(e);
    drag.current = { mode, x: p.x, y: p.y, start: rect };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toPicture(e);
    if (d.mode === 'move') {
      const next = { ...d.start, x: d.start.x + (p.x - d.x), y: d.start.y + (p.y - d.y) };
      setDraft(cropRect(W, H, aspect, cropOfRect(W, H, aspect, next)));
    } else {
      // The corner follows the pointer; the top-left corner stays, the shape is the aspect's.
      const w = Math.max(p.x - d.start.x, (p.y - d.start.y) * aspect);
      const sized = { x: d.start.x, y: d.start.y, w, h: w / aspect };
      const c = cropOfRect(W, H, aspect, sized);
      setDraft(cropRect(W, H, aspect, c));
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !draft) return;
    onCrop(cropOfRect(W, H, aspect, draft));
    setDraft(null);
  };

  return (
    <div ref={boxRef} className="w-full flex justify-center">
      {bitmap && dispW > 0 ? (
        <div className="relative select-none touch-none rounded-paper overflow-hidden bg-frame" style={{ width: dispW, height: dispH }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <canvas ref={canvasRef} className="block cursor-pointer" style={{ width: dispW, height: dispH }} onClick={onChoose} aria-label="The target — choose another picture" role="button" />
          <div
            className="absolute cursor-move outline outline-2 outline-accent"
            style={{ left: rect.x * k, top: rect.y * k, width: rect.w * k, height: rect.h * k, boxShadow: '0 0 0 9999px rgba(16,15,13,0.55)' }}
            onPointerDown={(e) => onDown(e, 'move')}
            aria-label="The part of the picture the mosaic rebuilds — drag to move"
          >
            <div
              className="absolute -right-2 -bottom-2 w-5 h-5 rounded-full bg-accent border-2 border-paper cursor-nwse-resize"
              onPointerDown={(e) => onDown(e, 'size')}
              aria-label="Resize the frame"
            />
          </div>
        </div>
      ) : fallbackUrl ? (
        <button type="button" onClick={onChoose} className="block w-full rounded-paper overflow-hidden bg-frame" title="Choose another picture">
          <img src={fallbackUrl} alt="The target" className="block w-full max-h-[240px] object-contain" />
        </button>
      ) : (
        <button type="button" onClick={onChoose} className="w-full aspect-video rounded-paper border border-dashed border-line-strong text-xs text-muted">
          Choose a picture
        </button>
      )}
    </div>
  );
}
