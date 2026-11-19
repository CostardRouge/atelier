import { useEffect, useRef, useState } from 'react';
import { signatureFonts } from './signature-fonts';
import { paintSignature, type SignaturePaint } from './signature-paint';

/** Whether the corner of `source` a mark sits in is dark: read small, off the stage's own canvas. */
function cornerIsDark(source: HTMLCanvasElement, corner: SignaturePaint['corner']): boolean {
  try {
    const w = source.width;
    const h = source.height;
    if (!w || !h) return true;
    const sx = corner === 'tl' || corner === 'bl' ? 0 : corner === 'bc' ? w * 0.3 : w * 0.6;
    const sy = corner === 'tl' || corner === 'tr' ? 0 : h * 0.7;
    const probe = Object.assign(document.createElement('canvas'), { width: 16, height: 12 });
    const g = probe.getContext('2d', { willReadFrequently: true });
    if (!g) return true;
    g.drawImage(source, sx, sy, w * 0.4, h * 0.3, 0, 0, 16, 12);
    const data = g.getImageData(0, 0, 16, 12).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    return sum / (data.length / 4) < 140;
  } catch {
    return true;
  }
}

/**
 * A stage's PREVIEW of the signature: a canvas of its own laid over the
 * frame, painted by the export's painter at the frame's size — for a stage
 * whose own canvas is drawn by a loop that should not learn about marks
 * (Mosaic's, the atlas's). It fills its positioned parent, which must be the
 * frame itself, and never takes a pointer. `source` is the stage's canvas:
 * the ink of a face with no ground of its own is read from under the mark,
 * as the export reads it from the file.
 */
export default function SignatureOverlay({ mark, source }: { mark: SignaturePaint | null; source?: () => HTMLCanvasElement | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fonts, setFonts] = useState(false);
  useEffect(() => {
    let alive = true;
    void signatureFonts().then(() => alive && setFonts(true));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g || !size.w || !size.h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    g.clearRect(0, 0, c.width, c.height);
    if (!mark) return;
    const under = source?.() ?? null;
    paintSignature(g, c.width, c.height, { ...mark, ink: mark.ink ?? (under ? (cornerIsDark(under, mark.corner) ? 'light' : 'dark') : 'light') });
  }, [mark, size, fonts, source]);
  return <canvas ref={ref} aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none" />;
}
