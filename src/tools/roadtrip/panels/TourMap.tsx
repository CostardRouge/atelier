import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { MAX_CARDS } from '../../../shared/media/motion-cards';
import type { TourStop } from '../../../shared/media/framing-motion';
import { useObjectUrl } from '../../../shared/media/use-object-url';

interface TourMapProps {
  /** The picture the tour is over — the selected cell's own file. */
  file: File | null;
  isVideo: boolean;
  /** Where a clip's frame is taken for the map. */
  videoSeconds: number;
  /** The picture's width over its height. */
  aspect: number;
  /** One per card: the point of the picture in the middle of its frame. */
  stops: readonly TourStop[];
  /** What each card shows, four corners in 0..1 of the picture. */
  windows: readonly (readonly [number, number][])[];
  /** The card in hand, or -1 while the needle is between two. */
  selected: number;
  onSelect: (index: number) => void;
  /** A tap on the picture: a card there, after the last, which becomes the End. */
  onAdd: (stop: TourStop) => void;
  /** A card's dot dragged: that card looks at the point, at its own zoom. */
  onMove: (index: number, stop: TourStop) => void;
  /** A pinch or a wheel on the map: the picked card's zoom, by this factor. */
  onZoom: (factor: number) => void;
}

/** The map's own units: 1000 across, whatever the picture's size. */
const UNIT = 1000;
const DOT = 30;
/** The least a stop's grab reaches, in screen pixels, whatever the map's width. */
const MIN_REACH_PX = 12;

/**
 * The whole picture, with the window each card shows and its dot in order —
 * the one place a move is drawn on the picture, since the stage only ever
 * shows the frame. A tap on the picture adds a card, a drag moves one, a tap
 * on one picks it, and a pinch (two fingers, a trackpad, the wheel) tightens
 * the picked card's window about its middle — the zoom per card the row
 * writes. Everything it writes goes through the editor's card verbs.
 */
export default function TourMap({
  file,
  isVideo,
  videoSeconds,
  aspect,
  stops,
  windows,
  selected,
  onSelect,
  onAdd,
  onMove,
  onZoom,
}: TourMapProps) {
  const url = useObjectUrl(file);
  const height = UNIT / Math.max(0.1, aspect);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  // A drag writes on every move: read the stops the hand last wrote, not the
  // ones the document still shows a render behind (`frontend.md`).
  const latest = useRef(stops);
  latest.current = stops;
  // Every pointer down on the map, for the pinch: two of them are a pinch,
  // and the one left after it starts nothing.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinching = useRef(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isVideo) return;
    const seek = () => {
      v.currentTime = Math.max(0, videoSeconds);
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener('loadedmetadata', seek, { once: true });
  }, [isVideo, videoSeconds, url]);

  // The browser's own pinch must not take the gesture: a non-passive
  // listener is the only way to refuse it (`frontend.md`).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const refuse = (e: Event) => e.preventDefault();
    el.addEventListener('touchmove', refuse, { passive: false });
    return () => el.removeEventListener('touchmove', refuse);
  }, []);

  const toPicture = (e: { clientX: number; clientY: number }): TourStop | null => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toPicture(e);
    if (!p) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser no longer tracks: the gesture still lands, it
      // simply is not captured past the map's edge.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) {
      // The second finger turns a drag into a pinch; nothing is moved by it.
      pinching.current = true;
      setDrag(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const reach = Math.max(MIN_REACH_PX, (DOT * 1.4 * r.width) / UNIT);
    const hit = latest.current.findIndex(
      (s) => Math.hypot((s.x - p.x) * r.width, (s.y - p.y) * r.height) <= reach,
    );
    if (hit >= 0) {
      onSelect(hit);
      setDrag(hit);
      return;
    }
    if (latest.current.length >= MAX_CARDS) return;
    onAdd(p);
    // The card just added is the last; the same finger goes on placing it.
    setDrag(latest.current.length);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const was = pointers.current.get(e.pointerId);
    if (!was) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, now);
    if (pinching.current) {
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (!other) return;
      const before = Math.hypot(was.x - other.x, was.y - other.y);
      const after = Math.hypot(now.x - other.x, now.y - other.y);
      if (before > 4) onZoom(after / before);
      return;
    }
    if (drag === null) return;
    const p = toPicture(e);
    if (!p) return;
    onMove(drag, p);
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) pinching.current = false;
    setDrag(null);
  };

  // A wheel notch is the desktop's pinch — the one factor every zoom in the
  // suite reads (`framing.ts`, `scaleFramingBy`).
  const onWheel = (e: ReactWheelEvent<SVGSVGElement>) => {
    onZoom(Math.exp(-e.deltaY / 400));
  };

  const poly = (w: readonly [number, number][]) => w.map(([x, y]) => `${x * UNIT},${y * height}`).join(' ');

  return (
    <div
      className="relative w-full overflow-hidden rounded-control bg-frame"
      style={{ aspectRatio: `${Math.max(0.1, aspect)}` }}
    >
      {url &&
        (isVideo ? (
          <video
            ref={videoRef}
            src={url}
            muted
            playsInline
            preload="auto"
            className="absolute inset-0 w-full h-full object-fill pointer-events-none"
          />
        ) : (
          <img src={url} alt="" draggable={false} className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none" />
        ))}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${UNIT} ${height}`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
        role="application"
        aria-label="The whole picture: tap to add a card, drag a card's dot to move it, pinch or scroll to zoom the picked card"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {/* The path the view travels, card to card. */}
        {stops.length > 1 && (
          <polyline
            points={stops.map((s) => `${s.x * UNIT},${s.y * height}`).join(' ')}
            fill="none"
            stroke="rgba(255,255,255,0.75)"
            strokeWidth={2}
            strokeDasharray="8 7"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {windows.map((w, i) => (
          <polygon
            key={`w${i}`}
            points={poly(w)}
            fill={i === selected ? 'rgba(217,68,42,0.14)' : 'none'}
            stroke={i === selected ? 'var(--color-accent)' : 'rgba(255,255,255,0.55)'}
            strokeWidth={i === selected ? 2 : 1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {stops.map((s, i) => (
          <g key={`s${i}`} transform={`translate(${s.x * UNIT} ${s.y * height})`}>
            <circle
              r={DOT}
              fill={i === selected ? 'var(--color-accent)' : 'rgba(16,15,13,0.82)'}
              stroke="#fff"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={DOT * 1.1}
              fontWeight={700}
              fill="#fff"
              style={{ pointerEvents: 'none' }}
            >
              {i + 1}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
