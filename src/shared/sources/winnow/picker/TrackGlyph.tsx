import { useEffect, useRef } from 'react';
import { trackBox, type FlightTrack } from './flight-track';

/**
 * A flight's track drawn small — the Logbook's thumbnail and the grid's
 * overlay. The line takes the element's own text colour (a class sets it, so
 * it follows the theme), the take-off is a dot, and the shape keeps its
 * proportions inside the box.
 */
export default function TrackGlyph({
  track,
  className = '',
  line = 1.6,
}: {
  track: FlightTrack;
  className?: string;
  /** Stroke width in CSS pixels. */
  line?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const p = track.points;
      if (p.length < 2) return;
      const [x0, y0, x1, y1] = trackBox(p);
      const pad = Math.max(3, line * 2);
      const s = Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0));
      const ox = (w - (x1 - x0) * s) / 2 - x0 * s;
      const oy = (h - (y1 - y0) * s) / 2 - y0 * s;
      const colour = getComputedStyle(canvas).color;
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = line;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i + 1 < p.length; i += 2) {
        const x = p[i] * s + ox;
        const y = p[i + 1] * s + oy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p[0] * s + ox, p[1] * s + oy, line * 1.6, 0, Math.PI * 2);
      ctx.fill();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [track, line]);
  return <canvas ref={ref} aria-hidden="true" className={`block ${className}`} />;
}
