import { useEffect, useRef, useState } from 'react';
import type { SignCorner, SignPlace } from './signature';
import { signatureFonts } from './signature-fonts';
import { paintSignature, type SignatureBox, type SignaturePaint } from './signature-paint';

/** Around where each corner's mark sits, as fractions of the frame — where its ink is read. */
const CORNER_AT: Record<SignCorner, SignPlace> = { tl: { x: 0.2, y: 0.15 }, tr: { x: 0.8, y: 0.15 }, bl: { x: 0.2, y: 0.85 }, bc: { x: 0.5, y: 0.85 }, br: { x: 0.8, y: 0.85 } };

/** Whether `source` is dark around a point of the frame: read small, off the stage's own canvas. */
function darkAround(source: HTMLCanvasElement, at: SignPlace): boolean {
  try {
    const w = source.width;
    const h = source.height;
    if (!w || !h) return true;
    const sw = w * 0.4;
    const sh = h * 0.3;
    const sx = Math.max(0, Math.min(w - sw, at.x * w - sw / 2));
    const sy = Math.max(0, Math.min(h - sh, at.y * h - sh / 2));
    const probe = Object.assign(document.createElement('canvas'), { width: 16, height: 12 });
    const g = probe.getContext('2d', { willReadFrequently: true });
    if (!g) return true;
    g.drawImage(source, sx, sy, sw, sh, 0, 0, 16, 12);
    const data = g.getImageData(0, 0, 16, 12).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    return sum / (data.length / 4) < 140;
  } catch {
    return true;
  }
}

/** A press that moved less than this is a press, not a move: nothing is written. */
const DRAG_PX = 3;

/**
 * A stage's PREVIEW of the signature, and the hand on it: a canvas of its own
 * laid over the frame, painted by the export's painter at the frame's size —
 * so a stage's own loop learns nothing about marks. It fills its positioned
 * parent, which must be the frame itself. `source` is the stage's canvas: the
 * ink of a face with no ground of its own is read from under the mark, as the
 * export reads it from the file.
 *
 * With `onPlace` the mark is MOVED BY HAND (his ask of 2026-11-21): the one
 * part of the overlay that takes a pointer is a handle over the mark itself,
 * so everything else on the stage keeps its own gestures. A drag paints here
 * and writes ONCE, on release — one undo step —, as the centre of where the
 * mark was actually drawn (kept whole inside the frame). The arrows nudge it
 * a hundredth of the frame, a twentieth with Shift.
 */
export default function SignatureOverlay({
  mark,
  source,
  onPlace,
}: {
  mark: SignaturePaint | null;
  source?: () => HTMLCanvasElement | null;
  /** The mark was dropped at `at` (its centre, as fractions of the frame). Absent: the mark cannot be moved here. */
  onPlace?: (at: SignPlace) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fonts, setFonts] = useState(false);
  /** Where the hand holds it, between the press and the release. */
  const [live, setLive] = useState<SignPlace | null>(null);
  /** Where the mark was last drawn, in the overlay's CSS pixels. */
  const [box, setBox] = useState<SignatureBox | null>(null);
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
  // What the host hands changed — the drop was written, another slide is shown, a corner was picked: the hand lets go.
  useEffect(() => setLive(null), [mark]);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g || !size.w || !size.h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    g.clearRect(0, 0, c.width, c.height);
    if (!mark) {
      setBox(null);
      return;
    }
    const at = live ?? mark.at ?? null;
    const under = source?.() ?? null;
    const drawn = paintSignature(g, c.width, c.height, { ...mark, at, ink: mark.ink ?? (under ? (darkAround(under, at ?? CORNER_AT[mark.corner]) ? 'light' : 'dark') : 'light') });
    setBox({ x: drawn.x / dpr, y: drawn.y / dpr, w: drawn.w / dpr, h: drawn.h / dpr });
  }, [mark, size, fonts, source, live]);

  // The handle's gestures are bound NATIVELY, and stop there: a stage under it listens on its own elements (Mosaic's
  // click retargets, the atlas's drag moves its camera), below React's root — a synthetic stopPropagation would be
  // heard too late, and a mark dragged would also have moved or retargeted what is under it.
  const handleRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ box, size, onPlace });
  latest.current = { box, size, onPlace };
  const shown = Boolean(onPlace && mark && box);
  useEffect(() => {
    const el = handleRef.current;
    if (!el) return;
    const centre = (): SignPlace | null => {
      const { box: b, size: z } = latest.current;
      return b && z.w && z.h ? { x: (b.x + b.w / 2) / z.w, y: (b.y + b.h / 2) / z.h } : null;
    };
    let drag: { id: number; x: number; y: number; from: SignPlace; moved: boolean } | null = null;
    const stop = (e: Event) => e.stopPropagation();
    const down = (e: PointerEvent) => {
      e.stopPropagation();
      const from = centre();
      if (!from || e.button > 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.focus({ preventScroll: true });
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from, moved: false };
    };
    const move = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      e.stopPropagation();
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_PX) return;
      drag.moved = true;
      const { size: z } = latest.current;
      setLive({ x: drag.from.x + (e.clientX - drag.x) / z.w, y: drag.from.y + (e.clientY - drag.y) / z.h });
    };
    const up = (e: PointerEvent) => {
      const d = drag;
      drag = null;
      if (!d || d.id !== e.pointerId) return;
      e.stopPropagation();
      if (!d.moved) return;
      // Where it was DRAWN, not where the pointer went: a mark pushed past an edge stopped at it.
      const at = centre();
      if (at) latest.current.onPlace?.(at);
    };
    const cancel = () => {
      drag = null;
      setLive(null);
    };
    const key = (e: KeyboardEvent) => {
      const by: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const step = by[e.key];
      const from = centre();
      if (!step || !from) return;
      e.preventDefault();
      e.stopPropagation();
      const k = e.shiftKey ? 0.05 : 0.01;
      latest.current.onPlace?.({ x: from.x + step[0] * k, y: from.y + step[1] * k });
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('keydown', key);
    for (const type of ['mousedown', 'click', 'dblclick', 'touchstart']) el.addEventListener(type, stop);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('keydown', key);
      for (const type of ['mousedown', 'click', 'dblclick', 'touchstart']) el.removeEventListener(type, stop);
    };
  }, [shown]);

  return (
    <>
      <canvas ref={ref} aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none" />
      {shown && box && (
        <div
          ref={handleRef}
          // A stage's zoom reads its presses in the capture phase, before this handle: it leaves a control alone.
          data-pan-ignore=""
          role="slider"
          tabIndex={0}
          aria-label="The signature — drag it, or use the arrows, to place it"
          aria-valuetext={`${Math.round(((box.x + box.w / 2) / Math.max(1, size.w)) * 100)} % across, ${Math.round(((box.y + box.h / 2) / Math.max(1, size.h)) * 100)} % down`}
          title="Drag to place the signature"
          className={`absolute pointer-events-auto touch-none select-none rounded-[6px] outline-dashed outline-1 outline-offset-2 hover:outline-accent focus-visible:outline-accent ${
            live ? 'cursor-grabbing outline-accent' : 'cursor-grab outline-transparent'
          }`}
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        />
      )}
    </>
  );
}
