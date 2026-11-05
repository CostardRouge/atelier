import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_FRAME, coverWindow, frameAt, type Frame } from '../../shared/recap/recap-frame';
import type { Drawable } from '../../shared/recap/recap-paint';
import { SliderRow } from '../../shared/ui/Inspector';

/**
 * The WHOLE source with a frame on it — Mosaic's target frame, applied to a
 * recap's background (framing lab A1, his pick): the frame has the box's
 * shape (the recap's format), a drag inside moves it, a corner grows or
 * shrinks it (the zoom), and the slider says the same. What it edits is a
 * focus and a zoom (`recap-frame.ts`), so a change of format keeps what was
 * framed.
 */
export default function FrameBox({
  source,
  boxW,
  boxH,
  frame,
  onFrame,
  version,
}: {
  /** What is framed, as it stands now (a clip's current frame); null while it loads. */
  source: () => Drawable | null;
  /** The box it fills (the page), in its own pixels — its shape is all that matters. */
  boxW: number;
  boxH: number;
  frame: Frame | undefined;
  onFrame: (frame: Frame) => void;
  /** Moves when the source's pixels do — a repaint. */
  version: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const f = frame ?? DEFAULT_FRAME;
  const src = source();
  const sw = src?.width ?? 16;
  const sh = src?.height ?? 9;
  const height = Math.round((width * sh) / sw);
  const k = width / sw;
  const win = coverWindow(sw, sh, boxW, boxH, f);
  const rect = { x: win.sx * k, y: win.sy * k, w: win.sw * k, h: win.sh * k };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(120, Math.floor(el.getBoundingClientRect().width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    const s = source();
    if (!c || !s) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.drawImage(s.image, 0, 0, s.width, s.height, 0, 0, c.width, c.height);
    // What the page does not show, dimmed — drawn here, not as a shadow, so the handles may overhang the box.
    g.fillStyle = 'rgba(10,8,6,0.55)';
    g.beginPath();
    g.rect(0, 0, c.width, c.height);
    g.rect(rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr);
    g.fill('evenodd');
  }, [source, width, height, version, rect.x, rect.y, rect.w, rect.h]);

  const drag = useRef<{ corner: string | null; x: number; y: number; f: Frame; rect: typeof rect; id: number } | null>(null);
  const down = (corner: string | null) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { corner, x: e.clientX, y: e.clientY, f, rect, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !src) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.corner) {
      const cx = (d.rect.x + d.rect.w / 2 + dx) / k;
      const cy = (d.rect.y + d.rect.h / 2 + dy) / k;
      onFrame(frameAt(cx, cy, d.f.zoom, sw, sh));
      return;
    }
    // A corner: the frame grows away from the opposite corner, its shape held; the zoom is how much smaller it is than at 1.
    const sx = d.corner.includes('e') ? 1 : -1;
    const sy = d.corner.includes('s') ? 1 : -1;
    const grow = Math.max(sx * dx, (sy * dy * d.rect.w) / d.rect.h);
    const w = Math.max(24, d.rect.w + grow);
    const zoom = (d.f.zoom * d.rect.w) / w;
    const anchorX = sx > 0 ? d.rect.x : d.rect.x + d.rect.w;
    const anchorY = sy > 0 ? d.rect.y : d.rect.y + d.rect.h;
    const h = (w * d.rect.h) / d.rect.w;
    const cx = (anchorX + (sx * w) / 2) / k;
    const cy = (anchorY + (sy * h) / 2) / k;
    onFrame(frameAt(cx, cy, zoom, sw, sh));
  };
  const up = () => {
    drag.current = null;
  };

  const handle = 'absolute w-[18px] h-[18px] rounded-full bg-accent border-2 border-on-media touch-none';
  return (
    <div className="flex flex-col gap-2">
      <div ref={wrap} className="relative w-full rounded-control bg-frame select-none my-[10px]" style={{ height: src ? height : 120 }}>
        {src ? (
          <>
            <canvas ref={canvas} style={{ width, height }} className="block rounded-control" aria-hidden="true" />
            <div
              role="slider"
              aria-label="The part of the background the page shows — drag to move"
              aria-valuetext={`centre ${Math.round(f.x * 100)} %, ${Math.round(f.y * 100)} %, zoom ${Math.round(f.zoom * 100)} %`}
              tabIndex={0}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.05 : 0.01;
                const m: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
                const by = m[e.key];
                if (!by) return;
                e.preventDefault();
                onFrame(frameAt((f.x + by[0]) * sw, (f.y + by[1]) * sh, f.zoom, sw, sh));
              }}
              onPointerDown={down(null)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              className="absolute border-2 border-accent cursor-move touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            >
              {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
                <span
                  key={c}
                  onPointerDown={down(c)}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                  className={`${handle} ${c[0] === 'n' ? '-top-[10px]' : '-bottom-[10px]'} ${c[1] === 'w' ? '-left-[10px]' : '-right-[10px]'} ${c === 'nw' || c === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'}`}
                />
              ))}
            </div>
          </>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center font-mono text-2xs text-on-media/70">the background is on its way…</span>
        )}
      </div>
      <SliderRow label="Zoom" value={Math.round(f.zoom * 100)} min={100} max={400} step={1} reset={100} format={(v) => `${v} %`} onChange={(v) => onFrame({ ...f, zoom: v / 100 })} />
    </div>
  );
}
