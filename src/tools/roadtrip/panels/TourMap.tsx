import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { MAX_TOUR_STOPS, type TourStop } from '../../../shared/media/framing-motion';
import { useObjectUrl } from '../../../shared/media/use-object-url';

interface TourMapProps {
  /** The picture the tour is over — the selected cell's own file. */
  file: File | null;
  isVideo: boolean;
  /** Where a clip's frame is taken for the map. */
  videoSeconds: number;
  /** The picture's width over its height. */
  aspect: number;
  stops: readonly TourStop[];
  /** What each stop shows, four corners in 0..1 of the picture. */
  windows: readonly (readonly [number, number][])[];
  selected: number;
  onSelect: (index: number) => void;
  onChange: (stops: TourStop[]) => void;
}

/** The map's own units: 1000 across, whatever the picture's size. */
const UNIT = 1000;
const DOT = 30;
/** The least a stop's grab reaches, in screen pixels, whatever the map's width. */
const MIN_REACH_PX = 12;

/**
 * The whole picture, with the window each stop shows and the stops in order —
 * the one place a tour is drawn, since the stage only ever shows the frame.
 * A tap on the picture adds a stop, a drag moves one, a tap on one selects
 * it. Everything it writes goes through `onChange`, which rewrites the tour.
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
  onChange,
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

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isVideo) return;
    const seek = () => {
      v.currentTime = Math.max(0, videoSeconds);
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener('loadedmetadata', seek, { once: true });
  }, [isVideo, videoSeconds, url]);

  const toPicture = (e: ReactPointerEvent): TourStop | null => {
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
    if (latest.current.length >= MAX_TOUR_STOPS) return;
    const next = [...latest.current, p];
    onChange(next);
    onSelect(next.length - 1);
    setDrag(next.length - 1);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag === null) return;
    const p = toPicture(e);
    if (!p) return;
    const next = latest.current.map((s, i) => (i === drag ? p : s));
    latest.current = next;
    onChange(next);
  };

  const onPointerUp = () => setDrag(null);

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
        aria-label="The whole picture: tap to add a stop, drag a stop to move it"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* The path the view travels, stop to stop. */}
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
