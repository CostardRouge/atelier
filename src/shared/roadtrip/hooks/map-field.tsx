/**
 * The picking map — where the author chooses the stops.
 *
 * It is the SAME projection the hook paints with (`fitProjection`), run
 * backwards: a click comes back as a coordinate pair, so a stop can be dropped
 * where there is nothing to click on. That is the whole reason the field is
 * drawn here rather than by a map library — what you point at is exactly what
 * the export will draw, at the same scale, with the same bow on every hop.
 *
 * **No tiles, and nothing asked of anyone but our own origin.** The suite's
 * network exceptions are opt-in; a third one hidden inside an options panel
 * is how a local-first promise stops being checkable. So the backdrop is the
 * coastline the app SHIPS (`public/geo/land.json`, the big map's and the
 * overview's own, 2026-10-09 — the field used to be a black box with a grid)
 * under a graticule, the trip's own located places are the landmarks, and a
 * place the author cannot see is found by NAME, through the same opt-in
 * search the trip's legs use.
 *
 * Every gesture here has a keyboard twin in the panel beside it: the trip's
 * places are chips, a searched place is a field, a stop's position is two
 * number fields, and the order is buttons. The map is the quick way, never the
 * only way.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LandCollection } from '../../map/land';
import { landPath } from '../../map/land-path';
import { loadLand } from '../../map/load-land';
import { arcControl, fitProjection, type LatLon, type MapStop } from './map-plan';
import { DROP_ON_LINE_PX, DROP_ON_STOP_PX, dropLine, resolveDrop, type ScreenPoint, type StopDrop } from './stop-drop';
import { numeralScale } from './stops';

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
  /** A stop dragged to a new position — dropped off every line and every other stop. */
  onMove: (id: string, at: LatLon) => void;
  /**
   * A stop dropped ON another stop (`swap`) or ON a line (`insert`)
   * (`stop-drop.ts`). Without it every drop is a move, as before.
   */
  onReorder?: (id: string, drop: Exclude<StopDrop, { kind: 'move' }>) => void;
}

/** A hop's bowed arc as the field draws it, sampled — what a drop is read against. */
function arcPath(from: ScreenPoint, to: ScreenPoint, curve: number): ScreenPoint[] {
  const c = arcControl(from, to, curve);
  const out: ScreenPoint[] = [];
  for (let k = 0; k <= 12; k += 1) {
    const t = k / 12;
    const u = 1 - t;
    out.push({ x: u * u * from.x + 2 * u * t * c.x + t * t * to.x, y: u * u * from.y + 2 * u * t * c.y + t * t * to.y });
  }
  return out;
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
  onReorder,
}: MapFieldProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /** Where the held stop is, in the field's units, while it is held — written on the drop. */
  const [ghost, setGhost] = useState<ScreenPoint | null>(null);
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
  const land = useLand();
  // The coast under the field, projected once per framing — not per pointer move.
  const framing = fitted.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(';');
  const coast = useMemo(() => {
    if (!land) return '';
    const nw = unproject({ x: 0, y: 0 });
    const se = unproject({ x: VIEW.width, y: VIEW.height });
    return landPath(land, project, { west: nw.lon, east: se.lon, north: nw.lat, south: se.lat });
    // `project` and `unproject` are rebuilt every render from `fitted`; `framing` is what they depend on.
  }, [land, framing]);

  /** A pointer in the field's own units, and how many of them make a CSS pixel. */
  const fieldAt = (event: { clientX: number; clientY: number }): { p: ScreenPoint; scale: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    // `preserveAspectRatio` is the default meet, and the container carries the
    // viewBox's own aspect, so one uniform scale maps the two spaces.
    const scale = VIEW.width / rect.width;
    return { p: { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale }, scale };
  };
  const pointAt = (event: { clientX: number; clientY: number }): LatLon | null => {
    const at = fieldAt(event);
    return at ? unproject(at.p) : null;
  };

  const projected = stops.map((stop) => ({ stop, at: project(stop) }));
  const paths = projected.slice(1).map(({ at }, i) => arcPath(projected[i].at, at, curve));
  const arcs = projected.slice(1).map(({ at }, i) => {
    const from = projected[i].at;
    const control = arcControl(from, at, curve);
    return `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${at.x} ${at.y}`;
  });
  /** What letting the held stop go at `p` does, read against the field as drawn. */
  const landing = (p: ScreenPoint, scale: number): { index: number; drop: StopDrop } | null => {
    const index = stops.findIndex((stop) => stop.id === dragging);
    if (index < 0) return null;
    if (!onReorder) return { index, drop: { kind: 'move' } };
    const drop = resolveDrop(
      projected.map(({ at }) => at),
      index,
      p,
      { stopPx: DROP_ON_STOP_PX * scale, linePx: DROP_ON_LINE_PX * scale, paths },
    );
    return { index, drop };
  };
  const heldIndex = stops.findIndex((stop) => stop.id === dragging);
  const heldDrop = ghost && dragging ? (() => {
    const rect = svgRef.current?.getBoundingClientRect();
    return landing(ghost, rect && rect.width > 0 ? VIEW.width / rect.width : 1)?.drop ?? null;
  })() : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      className="w-full rounded-paper border border-line bg-frame touch-none select-none"
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
        const at = fieldAt(e);
        if (at) setGhost(at.p);
      }}
      onPointerUp={(e) => {
        const id = dragging;
        const held = ghost;
        setDragging(null);
        setGhost(null);
        if (id && held) {
          // The drop decides: another stop → swap, a line → insert, else move.
          const rect = svgRef.current?.getBoundingClientRect();
          const land = landing(held, rect && rect.width > 0 ? VIEW.width / rect.width : 1);
          if (land && land.drop.kind !== 'move') onReorder?.(id, land.drop);
          else onMove(id, unproject(held));
        }
        const from = press.current;
        press.current = null;
        if (!from || Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;
        const at = pointAt(e);
        if (at) onDrop(at);
      }}
      onPointerLeave={() => {
        setDragging(null);
        setGhost(null);
        press.current = null;
      }}
    >
      {coast && (
        <path d={coast} fillRule="evenodd" className="fill-on-media stroke-on-media" fillOpacity={0.13} strokeOpacity={0.32} strokeWidth={0.6} />
      )}
      <Graticule />
      {heldDrop && heldIndex >= 0 && (
        <text x={VIEW.width / 2} y={VIEW.height - 6} textAnchor="middle" fontSize={8} className="fill-on-media">
          {dropLine(heldDrop, (i) => stops[i]?.name ?? '', heldIndex)}
        </text>
      )}

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
          className={heldDrop?.kind === 'insert' && heldDrop.hop === i ? 'stroke-[var(--color-accent)]' : 'stroke-on-media'}
          strokeWidth={heldDrop?.kind === 'insert' && heldDrop.hop === i ? 3.2 : 1.6}
          strokeLinecap="round"
          opacity={0.9}
        />
      ))}

      {projected.map(({ stop, at: placed }, index) => {
        const selected = stop.id === selectedId;
        // The held stop follows the hand; the one it would swap with is ringed.
        const at = stop.id === dragging && ghost ? ghost : placed;
        const target = heldDrop?.kind === 'swap' && heldDrop.index === index;
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
            style={{ cursor: 'grab' }}
          >
            <title>{`${index + 1}. ${stop.name || 'Unnamed stop'} — drag to move, onto another stop to swap, onto a line to insert`}</title>
            {target && (
              <circle cx={at.x} cy={at.y} r={10} fill="none" className="stroke-ink" strokeWidth={1.8} />
            )}
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
              y={at.y + 2.4 * numeralScale(index + 1)}
              textAnchor="middle"
              fontSize={6.4 * numeralScale(index + 1)}
              fontWeight={600}
              className="fill-frame font-mono"
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
                className="fill-on-media stroke-frame"
                strokeWidth={0.8}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** The shipped coastline, read once for every field on the page; null until it lands, or where it cannot be read. */
function useLand(): LandCollection | null {
  const [land, setLand] = useState<LandCollection | null>(null);
  useEffect(() => {
    let alive = true;
    loadLand().then(
      (value) => {
        if (alive) setLand(value);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);
  return land;
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
    <g className="stroke-on-media" strokeWidth={0.5} opacity={0.12}>
      {lines}
    </g>
  );
}
