import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { describeCar, type CarSpec } from '../../shared/roadtrip/car-spec';
import { carLight, carPalette } from '../../shared/roadtrip/hooks/car-model';
import { carModel } from '../../shared/roadtrip/hooks/car-registry';
import { paintGroundShadow, paintMesh, renderOrder, type Pose } from '../../shared/roadtrip/hooks/mesh3d';
import { prefersReducedMotion } from '../../shared/ui/reduced-motion';

interface CarTurntableProps {
  spec: CarSpec;
  /** The box's size — a height class; the canvas fills it. */
  className?: string;
}

/** Radians per second the turntable turns on its own: a lap in ~25 s. */
const TURN_RATE = 0.25;
/** How long after a gesture the turntable starts turning again. */
const RESUME_AFTER_MS = 1500;
const MIN_TILT = (35 * Math.PI) / 180;
const MAX_TILT = Math.PI / 2;
const KEY_TURN = (15 * Math.PI) / 180;
const KEY_TILT = (5 * Math.PI) / 180;

/** A design token, read off the element so the dark theme paints its own paper. */
function token(el: Element, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * The car on a turntable: the garage's own view of it, turning on its own and
 * turnable by hand, drawn by the same renderer the Virée opener drives it with.
 *
 * The same `renderOrder` + `paintMesh` as the drive, the same light for the
 * finish and the same palette for the colour, so what the garage shows is
 * what the map will get — never a second drawing of the car. The angle here
 * is a LOOK and nothing more: it is never stored and never seeds the piece's
 * own camera row.
 *
 * It turns by itself while nobody touches it, unless the system asked for
 * less motion, and a gesture pauses it for a moment rather than stopping it
 * for good: the loop only runs while `spinning`, so an idle turntable costs
 * nothing and a reduced-motion one repaints only when the car changes. The
 * gesture writes the view through refs and repaints directly — no state per
 * pointer move, no restart of the loop.
 *
 * `touch-pan-y`, never `touch-none`: a finger turns the car, the sheet the
 * turntable sits in still scrolls (`frontend.md`). A finger turns only; the
 * tilt is a mouse or a pen's, and the keyboard's.
 */
export default function CarTurntable({ spec, className = '' }: CarTurntableProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const model = carModel(spec.model);
  const parts = useMemo(() => model.build(spec.gear), [model, spec.gear]);

  // The view, written by gestures and read by every paint.
  const view = useRef({ heading: Math.PI * 0.82, tilt: (52 * Math.PI) / 180 });
  const specRef = useRef(spec);
  specRef.current = spec;
  const partsRef = useRef(parts);
  partsRef.current = parts;
  const drag = useRef<{ x: number; y: number; touch: boolean } | null>(null);
  const resumeTimer = useRef(0);
  const [spinning, setSpinning] = useState(() => !prefersReducedMotion());
  const [size, setSize] = useState({ width: 0, height: 0 });

  const paint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const { width: w, height: h } = canvas;
    if (w === 0 || h === 0) return;
    const current = specRef.current;
    const carOf = carModel(current.model);
    const { heading, tilt } = view.current;
    const paper = token(canvas, '--color-paper', '#f4f0e7');
    const ring = token(canvas, '--color-line-strong', '#d2c8b3');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = paper;
    g.fillRect(0, 0, w, h);

    const scale = Math.min(w, h) / (carOf.length * 1.35);
    const pose: Pose = {
      fx: Math.sin(heading),
      fy: Math.cos(heading),
      tilt,
      scale,
      x: w / 2,
      y: h * 0.56,
      spins: {},
    };

    // The turntable: a disc the tilt foreshortens like the ground it stands for.
    const radius = carOf.length * 0.64 * scale;
    g.save();
    g.translate(pose.x, pose.y);
    g.scale(1, Math.sin(tilt));
    g.beginPath();
    g.arc(0, 0, radius, 0, Math.PI * 2);
    g.fillStyle = 'rgba(20,16,12,0.045)';
    g.fill();
    g.strokeStyle = ring;
    g.lineWidth = Math.max(1, scale / 60);
    g.stroke();
    g.restore();

    paintGroundShadow(g, pose, carOf.length / 2, carOf.width / 2, 0.3);
    paintMesh(g, renderOrder(partsRef.current, pose, carLight(current.finish)), {
      palette: carPalette(current.color),
      ink: 'rgba(20,16,12,0.85)',
      outlineWidth: Math.max(0.9, (scale * carOf.length) / 78),
    });
  };
  const paintRef = useRef(paint);
  paintRef.current = paint;

  // Fit: the bitmap follows the box (× the pixel ratio, capped at 2), and a box
  // with no size — a settings pane hidden behind its rail on a phone — paints
  // nothing; the observer fires again when it is shown.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const fit = () => {
      const width = box.clientWidth;
      const height = box.clientHeight;
      if (width <= 0 || height <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(width * dpr);
      const h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      setSize((s) => (s.width === w && s.height === h ? s : { width: w, height: h }));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // A repaint whenever the car or the room changes; the loop below covers the
  // rest while it turns.
  useEffect(() => {
    paintRef.current();
  }, [spec, parts, size]);

  useEffect(() => {
    if (!spinning) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      view.current.heading = (view.current.heading + dt * TURN_RATE) % (Math.PI * 2);
      paintRef.current();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spinning]);

  useEffect(() => () => window.clearTimeout(resumeTimer.current), []);

  /** A gesture pauses the turning; it resumes a moment after the last one. */
  const pause = () => {
    window.clearTimeout(resumeTimer.current);
    setSpinning(false);
  };
  const resumeLater = () => {
    window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      if (!drag.current) setSpinning(!prefersReducedMotion());
    }, RESUME_AFTER_MS);
  };

  const turn = (dHeading: number, dTilt: number) => {
    const v = view.current;
    v.heading = (v.heading + dHeading + Math.PI * 2) % (Math.PI * 2);
    v.tilt = Math.min(MAX_TILT, Math.max(MIN_TILT, v.tilt + dTilt));
    paintRef.current();
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' };
    pause();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    // Dragging the near side of the car to the right turns the platter that
    // way — a full width is one lap; pulling down raises the camera.
    turn(-(dx / rect.width) * Math.PI * 2, d.touch ? 0 : (dy / rect.height) * (MAX_TILT - MIN_TILT));
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    resumeLater();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let dh = 0;
    let dt = 0;
    if (e.key === 'ArrowLeft') dh = -KEY_TURN;
    else if (e.key === 'ArrowRight') dh = KEY_TURN;
    else if (e.key === 'ArrowUp') dt = KEY_TILT;
    else if (e.key === 'ArrowDown') dt = -KEY_TILT;
    else return;
    e.preventDefault();
    pause();
    turn(dh, dt);
    resumeLater();
  };

  return (
    <div
      ref={boxRef}
      role="img"
      aria-label={describeCar(spec, model.name)}
      tabIndex={0}
      title="Drag to turn the car; the arrow keys turn and tilt it"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className={`relative overflow-hidden rounded-paper border border-line bg-paper touch-pan-y select-none cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full" />
    </div>
  );
}
