/**
 * The picking map — where the author chooses the stops.
 *
 * It is the SAME projection the hook paints with (`fitProjection`), run
 * backwards: a click comes back as a coordinate pair, so a stop can be dropped
 * where there is nothing to click on. That is the whole reason the field is
 * drawn here rather than by a map library — what you point at is exactly what
 * the export will draw, at the same scale, with the same bow on every hop.
 *
 * **No tiles, and no request of any kind.** The suite's two network exceptions
 * are the Flight Map's opt-in OSM layer and the opt-in place lookup; a third
 * one hidden inside an options panel is how a local-first promise stops being
 * checkable. So the backdrop is a graticule, the trip's own located places are
 * the landmarks, and a place the author cannot see is found by NAME, through
 * the same opt-in search the trip's legs use.
 *
 * Every gesture here has a keyboard twin in the panel beside it: the trip's
 * places are chips, a searched place is a field, a stop's position is two
 * number fields, and the order is buttons. The map is the quick way, never the
 * only way.
 */

import { useRef, useState } from 'react';
import { arcControl, fitProjection, type LatLon, type MapStop } from './map-plan';

/** The field's own coordinate space. The container keeps the same aspect. */
const VIEW = { width: 320, height: 200 };
const PAD = 18;

export interface MapFieldProps {
  stops: readonly MapStop[];
  /** The trip's located places — landmarks, and one click each to adopt. */
  places: readonly { name: string; lat: number; lon: number }[];
  selectedId: string | null;
  curve: number;
  onSelect: (id: string) => void;
  /** A pin dropped where there was nothing. */
  onDrop: (at: LatLon) => void;
  /** One of the trip's own places adopted as a stop. */
  onAdopt: (place: { name: string; lat: number; lon: number }) => void;
  /** A stop dragged to a new position. */
  onMove: (id: string, at: LatLon) => void;
}

export default function MapField({
  stops,
  places,
  selectedId,
  curve,
  onSelect,
  onDrop,
  onAdopt,
  onMove,
}: MapFieldProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /**
   * Where a press on EMPTY ground started. A pin is dropped on the way up and
   * only if the pointer stayed put: dropping on the way down would put a stop
   * under every stray click, and a drag over the field would leave a trail.
   */
  const press = useRef<{ x: number; y: number } | null>(null);

  const box = { x: 0, y: 0, width: VIEW.width, height: VIEW.height };
  // Both sets are fitted, so adopting a landmark never makes the map jump.
  const fitted: LatLon[] = [...stops, ...places];
  const { project, unproject } = fitProjection(fitted, box, PAD);

  const pointAt = (event: { clientX: number; clientY: number }): LatLon | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    // `preserveAspectRatio` is the default meet, and the container carries the
    // viewBox's own aspect, so one uniform scale maps the two spaces.
    const scale = VIEW.width / rect.width;
    return unproject({ x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale });
  };

  const projected = stops.map((stop) => ({ stop, at: project(stop) }));
  const arcs = projected.slice(1).map(({ at }, i) => {
    const from = projected[i].at;
    const control = arcControl(from, at, curve);
    return `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${at.x} ${at.y}`;
  });

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      className="w-full rounded-paper border border-line bg-[var(--color-frame)] touch-none select-none"
      // `height: auto` is load-bearing: an inline `<svg>` with no height
      // attribute defaults to `height: 100%`, which in an auto-height column
      // collapses it to a strip and leaves `aspect-ratio` with nothing to
      // govern. Measured — the field drew as a 25px band.
      style={{
        height: 'auto',
        aspectRatio: `${VIEW.width} / ${VIEW.height}`,
        cursor: dragging ? 'grabbing' : 'crosshair',
      }}
      role="img"
      aria-label={`The itinerary on a map: ${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}. Click to add one; the places below add the same stops from the keyboard.`}
      onPointerDown={(e) => {
        // A press on a marker is handled by the marker, which stops this one.
        press.current = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        press.current = null;
        const at = pointAt(e);
        if (at) onMove(dragging, at);
      }}
      onPointerUp={(e) => {
        setDragging(null);
        const from = press.current;
        press.current = null;
        if (!from || Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;
        const at = pointAt(e);
        if (at) onDrop(at);
      }}
      onPointerLeave={() => {
        setDragging(null);
        press.current = null;
      }}
    >
      <Graticule />

      {/* The trip's own places, as landmarks to adopt. */}
      {places.map((place) => {
        const at = project(place);
        return (
          <g
            key={`${place.lat},${place.lon},${place.name}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onAdopt(place);
            }}
            style={{ cursor: 'copy' }}
          >
            <title>{`Add ${place.name || 'this place'} as a stop`}</title>
            <circle cx={at.x} cy={at.y} r={6} fill="transparent" />
            <circle
              cx={at.x}
              cy={at.y}
              r={2.6}
              className="fill-transparent stroke-[var(--color-faint)]"
              strokeWidth={1}
            />
          </g>
        );
      })}

      {arcs.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          className="stroke-[var(--color-paper)]"
          strokeWidth={1.6}
          strokeLinecap="round"
          opacity={0.9}
        />
      ))}

      {projected.map(({ stop, at }, index) => {
        const selected = stop.id === selectedId;
        return (
          <g
            key={stop.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.button !== 0) return;
              onSelect(stop.id);
              setDragging(stop.id);
              (e.target as Element).setPointerCapture?.(e.pointerId);
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              setDragging(null);
            }}
            style={{ cursor: 'grab' }}
          >
            <title>{`${index + 1}. ${stop.name || 'Unnamed stop'} — drag to move`}</title>
            {selected && (
              <circle
                cx={at.x}
                cy={at.y}
                r={9}
                fill="none"
                className="stroke-[var(--color-accent)]"
                strokeWidth={1.4}
              />
            )}
            <circle cx={at.x} cy={at.y} r={5.4} className="fill-[var(--color-accent)]" />
            <text
              x={at.x}
              y={at.y + 2.4}
              textAnchor="middle"
              fontSize={6.4}
              fontWeight={600}
              className="fill-[var(--color-frame)] font-mono"
            >
              {index + 1}
            </text>
            {stop.picture && (
              // A corner mark, not a thumbnail: the tile would need a decode
              // per stop in a panel that re-renders on every slider step.
              <rect
                x={at.x + 4}
                y={at.y - 10}
                width={6}
                height={6}
                rx={1}
                className="fill-[var(--color-paper)] stroke-[var(--color-frame)]"
                strokeWidth={0.8}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** A faint grid, so an empty field still reads as a projection of the world. */
function Graticule() {
  const lines = [];
  for (let x = 40; x < VIEW.width; x += 40) {
    lines.push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={VIEW.height} />);
  }
  for (let y = 40; y < VIEW.height; y += 40) {
    lines.push(<line key={`y${y}`} x1={0} y1={y} x2={VIEW.width} y2={y} />);
  }
  return (
    <g className="stroke-[var(--color-paper)]" strokeWidth={0.5} opacity={0.12}>
      {lines}
    </g>
  );
}
