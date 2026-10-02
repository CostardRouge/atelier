import { useMemo } from 'react';
import type { LandCollection } from '../../../shared/map/land';
import type { DayPoint } from '../../../shared/roadtrip/day-track';
import { haltName, type DeduceDraft, type Proposal } from '../../../shared/roadtrip/deduce-draft';
import { fitProjection, type GeoPoint } from '../../../shared/roadtrip/hooks/geo';
import { enumerateDays } from '../../../shared/roadtrip/trip-days';
import { proposalColour } from './pieces';

/**
 * The deduction on a map: the days' route, a ring per halt, the proposals
 * in their colours, and the coastline behind — a still SVG, not MapLibre.
 * It is a picture to read beside a list, never a surface to pan: the
 * overview's map view is where a trip is explored.
 *
 * `hot` is the chapter under the hand in whichever window: everything else
 * fades and that chapter's halts are named. `focus` fits the view on one
 * proposal's halts instead of the whole trip — the paquet's card.
 */

export const MAP_W = 400;
export const MAP_H = 300;

interface DeduceMapProps {
  proposals: readonly Proposal[];
  draft: DeduceDraft;
  /** The days the deduction ran over, in calendar order. */
  points: readonly DayPoint[];
  /** Days left out as outliers — drawn as a cross where the picture claims to be. */
  ignored: readonly DayPoint[];
  land: LandCollection | null;
  hot?: string | null;
  focus?: Proposal | null;
  /** A short line under the map, inside its frame. */
  caption?: string;
  /** What the colours mean — the map's tooltip, never a standing sentence. */
  legend?: string;
  className?: string;
}

const PAD = 28;

/** Where a point falls on the map, or null when it is nowhere near the view. */
type Project = (p: GeoPoint) => { x: number; y: number };

/**
 * The coastline inside the view, as one path. Rings whose box misses the
 * view are skipped, and a point less than a pixel from the last one kept
 * is dropped — Natural Earth at 1:50m is ten thousand points for a
 * continent, and the modal draws a few hundred.
 */
function coastPath(land: LandCollection, project: Project): string {
  const parts: string[] = [];
  const minX = -MAP_W;
  const maxX = MAP_W * 2;
  const minY = -MAP_H;
  const maxY = MAP_H * 2;
  for (const feature of land.features) {
    for (const polygon of feature.geometry.coordinates) {
      for (const ring of polygon) {
        let lo = Infinity;
        let hi = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;
        const pts = ring.map(([lon, lat]) => {
          const q = project({ lat, lon });
          if (q.x < lo) lo = q.x;
          if (q.x > hi) hi = q.x;
          if (q.y < top) top = q.y;
          if (q.y > bottom) bottom = q.y;
          return q;
        });
        if (hi < minX || lo > maxX || bottom < minY || top > maxY) continue;
        let d = '';
        let last: { x: number; y: number } | null = null;
        for (const q of pts) {
          if (last && Math.abs(q.x - last.x) < 0.8 && Math.abs(q.y - last.y) < 0.8) continue;
          d += `${last ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
          last = q;
        }
        if (d) parts.push(d + 'Z');
      }
    }
  }
  return parts.join('');
}

export default function DeduceMap({
  proposals,
  draft,
  points,
  ignored,
  land,
  hot = null,
  focus = null,
  caption,
  legend,
  className = '',
}: DeduceMapProps) {
  // The view fits the whole route, or one proposal's halts — with room
  // around a single halt so it is seen somewhere rather than filling the box.
  const project = useMemo<Project>(() => {
    const centres: GeoPoint[] = focus
      ? focus.halts.map((h) => h.leg.centroid)
      : [...points.map((p) => ({ lat: p.lat, lon: p.lon })), ...ignored.map((p) => ({ lat: p.lat, lon: p.lon }))];
    const seeds = centres.length ? centres : [{ lat: 0, lon: 0 }];
    const lat = seeds.reduce((s, p) => s + p.lat, 0) / seeds.length;
    const lon = seeds.reduce((s, p) => s + p.lon, 0) / seeds.length;
    const reach = focus ? 1.2 : 0.4;
    const fitted = [...seeds, { lat: lat + reach, lon }, { lat: lat - reach, lon }, { lat, lon: lon + reach }, { lat, lon: lon - reach }];
    return fitProjection(fitted, { x: PAD, y: PAD, width: MAP_W - 2 * PAD, height: MAP_H - 2 * PAD });
  }, [points, ignored, focus]);

  const coast = useMemo(() => (land ? coastPath(land, project) : ''), [land, project]);

  const byDay = useMemo(() => {
    const map = new Map<string, Proposal>();
    for (const p of proposals) {
      // A proposal claims the days of its halts, which is what the route is coloured by.
      for (const h of p.chapter.halts) {
        for (const d of enumerateDays(h.leg.startDate, h.leg.endDate)) map.set(d, p);
      }
    }
    return map;
  }, [proposals]);

  const dim = (key: string | null) => (hot && key !== hot ? 'opacity-25' : '');

  return (
    <div className={`relative rounded-paper border border-line bg-paper-2 overflow-hidden ${className}`} title={legend}>
      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        className="block w-full h-auto"
        role="img"
        aria-label={focus ? `Where ${focus.label} is` : 'The route, as the days say it'}
      >
        {coast && (
          <path d={coast} fill="var(--color-paper)" stroke="var(--color-line-strong)" strokeWidth={0.8} fillRule="evenodd" />
        )}
        {/* the route, a stroke per day in the colour of the proposal that claims it */}
        {points.map((p, i) => {
          if (i === 0) return null;
          const a = project(points[i - 1]);
          const b = project(p);
          const owner = byDay.get(p.date) ?? null;
          const colour = owner ? proposalColour(owner) : 'var(--color-faint)';
          const gap = Date.parse(p.date) - Date.parse(points[i - 1].date) > 86_400_000;
          return (
            <line
              key={p.date}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={colour}
              strokeWidth={owner && owner.verb !== 'skip' ? 2.2 : 1}
              strokeDasharray={gap ? '2 3' : undefined}
              strokeLinecap="round"
              className={`transition-opacity ${dim(owner?.key ?? null)}`}
            />
          );
        })}
        {/* a ring per halt, sized by its days */}
        {proposals.map((p) =>
          p.chapter.halts.map((h) => {
            const q = project(h.leg.centroid);
            const r = 1.6 + Math.sqrt(h.leg.dayCount) * 1.1;
            const named = !!haltName(h, draft);
            return (
              <circle
                key={h.leg.startDate}
                cx={q.x}
                cy={q.y}
                r={r}
                fill={p.verb === 'skip' ? 'var(--color-paper-2)' : 'var(--color-surface)'}
                stroke={proposalColour(p)}
                strokeWidth={1.3}
                strokeDasharray={named ? undefined : '2 1.5'}
                className={`transition-opacity ${dim(p.key)}`}
              />
            );
          }),
        )}
        {/* an ignored position: a cross where the picture claims to be */}
        {ignored.map((p) => {
          const q = project(p);
          return (
            <path
              key={p.date}
              d={`M${q.x - 3},${q.y - 3}L${q.x + 3},${q.y + 3}M${q.x - 3},${q.y + 3}L${q.x + 3},${q.y - 3}`}
              stroke="var(--color-warn)"
              strokeWidth={1.3}
            />
          );
        })}
        {/* the halts' names, for the chapter under the hand or the one in focus */}
        {proposals
          .filter((p) => p.key === hot || (focus && p.key === focus.key))
          .map((p) =>
            p.halts.map((h) => {
              const q = project(h.leg.centroid);
              const name = haltName(h, draft);
              if (!name) return null;
              return (
                <text
                  key={h.leg.startDate}
                  x={q.x + 6}
                  y={q.y + 3.5}
                  fontSize={9.5}
                  fontFamily="var(--font-sans)"
                  fill="var(--color-ink)"
                  stroke="var(--color-paper-2)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {name}
                </text>
              );
            }),
          )}
      </svg>
      {caption !== undefined && (
        <span className="absolute left-2 bottom-1.5 max-w-[calc(100%-1rem)] px-1.5 rounded font-mono text-2xs text-muted bg-paper-2/80 truncate">
          {caption}
        </span>
      )}
    </div>
  );
}
