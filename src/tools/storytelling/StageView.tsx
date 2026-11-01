import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { H, W } from '../../shared/story/charte';

/**
 * The post's stage: a 1080 × 1920 canvas drawn as large as its box allows,
 * at 9:16 (`frontend.md`, « A stage that must fill the height »: the box is
 * measured, a replaced element never trusted). `children` are laid over the
 * picture, in its own coordinates (0–1080 × 0–1920 mapped onto the box) —
 * the selection's outline, a drag surface.
 */
export default function StageView({
  canvasRef,
  label,
  children,
}: {
  canvasRef: RefObject<HTMLCanvasElement>;
  label: string;
  children?: (scale: number) => ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => {
      const r = box.getBoundingClientRect();
      const h = Math.max(120, Math.min(r.height, (r.width * H) / W));
      setSize({ w: Math.round((h * W) / H), h: Math.round(h) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={boxRef} className="relative w-full h-full min-h-0 grid place-items-center">
      <div className="relative" style={size ? { width: size.w, height: size.h } : { width: 0, height: 0 }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="block w-full h-full rounded-paper-lg border border-line-strong bg-paper shadow-sm"
          aria-label={label}
        />
        {size && children ? children(size.w / W) : null}
      </div>
    </div>
  );
}
