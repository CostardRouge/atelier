import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LandCollection } from '../../../shared/map/land';
import {
  clampW,
  easeInOutCubic,
  fitView,
  flight,
  mercator,
  panView,
  zoomViewAbout,
  type MapView,
  type WorldPoint,
} from '../../../shared/map/map-view';
import type { DayPoint } from '../../../shared/roadtrip/day-track';
import { haltName, haltPlace, haltText, type DeduceDraft, type Proposal } from '../../../shared/roadtrip/deduce-draft';
import { deduceMapContent } from '../../../shared/roadtrip/deduce-map';
import { haversineKm } from '../../../shared/roadtrip/hooks/geo';
import { ODD_KM } from '../../../shared/roadtrip/place-oddity';
import type { PlaceWritingTrip } from '../../../shared/roadtrip/place-style';
import { enumerateDays } from '../../../shared/roadtrip/trip-days';
import IconButton from '../../../shared/ui/IconButton';
import { Icons } from '../../../shared/ui/icons';
import { prefersReducedMotion } from '../../../shared/ui/reduced-motion';
import { useZoomGestures } from '../../../shared/ui/use-zoom-gestures';
import { proposalColour } from './pieces';

/**
 * The deduction on a map: the days' route, a ring per halt where its
 * pictures were, the proposals in their colours, and the coastline behind —
 * an SVG drawn here, not MapLibre.
 *
 * It is a SURFACE since 2026-10-06 (the maintainer's ask; it used to be a
 * still picture): dragged, pinched, wheeled and trackpad-pinched with the
 * suite's one reading of the hand (`use-zoom-gestures.ts`), and it FLIES —
 * van Wijk's curve, `map-view.ts` — to whatever the author now looks at:
 * the stage being edited, the paquet's card, a place just chosen. Between
 * two such moments the author's own pan and zoom stay put.
 *
 * It frames REALITY, his rule: every place of the stage, even one a search
 * put on another continent — a map zoomed out to the world is how a wrong
 * town shows itself. Such a place is drawn where it claims to be, in
 * orange, tied to its halt's pictures by a dashed hairline. But only the
 * reality the draft would WRITE (`deduce-map.ts`, 2026-10-07): a stage he
 * skipped, a place he left out and the positions the deduction ignored are
 * neither drawn nor framed — «une carte finale».
 *
 * `fill`: the map takes its box's whole height at the box's own aspect (a
 * column beside the cards on a wide screen); without it, a 4:3 picture.
 *
 * `hot` is the chapter under the hand in whichever window: everything else
 * fades and that chapter's halts are named.
 */

export const MAP_W = 400;
export const MAP_H = 300;

interface DeduceMapProps {
  proposals: readonly Proposal[];
  /** How the trip writes its places — the labels read it. */
  trip: PlaceWritingTrip;
  draft: DeduceDraft;
  /** The days the deduction ran over, in calendar order. */
  points: readonly DayPoint[];
  land: LandCollection | null;
  hot?: string | null;
  /** The proposal the map flies to and frames — the one edited, the paquet's card. */
  focus?: Proposal | null;
  /** A short line under the map, inside its frame. */
  caption?: string;
  /** What the colours mean — the map's tooltip, never a standing sentence. */
  legend?: string;
  /** Fill the parent's height, at the box's aspect. */
  fill?: boolean;
  className?: string;
}

/**
 * The coastline in world units, once per land: rings as one path, a point
 * dropped when it is within ~400 m of the last one kept. Drawn under a
 * transform, so a pan or a zoom never rebuilds it.
 */
function coastPath(land: LandCollection): string {
  const parts: string[] = [];
  for (const feature of land.features) {
    for (const polygon of feature.geometry.coordinates) {
      for (const ring of polygon) {
        let d = '';
        let last: WorldPoint | null = null;
        for (const [lon, lat] of ring) {
          const q = mercator({ lat, lon });
          if (last && Math.abs(q[0] - last[0]) < 1e-5 && Math.abs(q[1] - last[1]) < 1e-5) continue;
          d += `${last ? 'L' : 'M'}${q[0].toFixed(5)},${q[1].toFixed(5)}`;
          last = q;
        }
        if (d) parts.push(d + 'Z');
      }
    }
  }
  return parts.join('');
}

/** Two views the eye cannot tell apart: no flight between them. */
function sameView(a: MapView, b: MapView): boolean {
  const eps = Math.min(a.w, b.w) * 1e-3;
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.w - b.w) < eps;
}

export default function DeduceMap({
  proposals,
  trip,
  draft,
  points,
  land,
  hot = null,
  focus = null,
  caption,
  legend,
  fill = false,
  className = '',
}: DeduceMapProps) {
  // The box, measured in `fill` mode: the viewBox takes its aspect, 400 wide.
  const surface = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = surface.current;
    if (!fill || !el) return;
    const measure = () => setBox((cur) => (cur && cur.w === el.clientWidth && cur.h === el.clientHeight ? cur : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill]);
  const mapH = fill && box && box.w > 0 && box.h > 0 ? Math.round((MAP_W * box.h) / box.w) : MAP_H;

  // What is on the map: the itinerary the draft would write, the proposal
  // looked at kept whatever its answer — and, to DRAW only, the one under the hand.
  const framed = useMemo(() => deduceMapContent(proposals, draft, points, new Set(focus ? [focus.key] : [])), [proposals, draft, points, focus]);
  const drawn = useMemo(
    () => (hot && !framed.proposals.some((p) => p.key === hot) ? deduceMapContent(proposals, draft, points, new Set([hot, ...(focus ? [focus.key] : [])])) : framed),
    [hot, framed, proposals, draft, points, focus],
  );

  // What the frame holds: the focused proposal's halts and the places
  // chosen for them, else the whole kept route — every chosen place
  // included. Reality, wherever it is, of what will be written.
  const world = useMemo<WorldPoint[]>(() => {
    const out: WorldPoint[] = [];
    const halts = focus ? focus.halts : framed.proposals.flatMap((p) => p.halts);
    for (const h of halts) {
      out.push(mercator(h.leg.centroid));
      const place = haltPlace(h, draft);
      if (place?.coords) out.push(mercator(place.coords));
    }
    if (!focus) for (const p of framed.route) out.push(mercator(p));
    return out;
  }, [focus, framed, draft]);
  // A wider margin than a point needs: the names are written to the right of their ring.
  const target = useMemo<MapView | null>(() => fitView(world, MAP_W / mapH, { pad: 1.5, minW: focus ? 0.012 : 0.02 }), [world, mapH, focus]);

  const [view, setView] = useState<MapView>(() => target ?? { x: 0.5, y: 0.5, w: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const raf = useRef<number | null>(null);
  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const flyTo = useCallback(
    (to: MapView) => {
      stop();
      const from = viewRef.current;
      if (sameView(from, to)) return;
      if (prefersReducedMotion()) {
        setView(to);
        return;
      }
      const f = flight(from, to);
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / f.ms);
        setView(f.at(easeInOutCubic(t)));
        raf.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      raf.current = requestAnimationFrame(step);
    },
    [stop],
  );

  // A new thing looked at: fly to it. The author's pan and zoom in between
  // are left alone — only a change of what is framed moves the map. The box
  // changing shape alone (the first measure, a resized window) re-places the
  // frame without a flight, and only while the hand has not moved it.
  const lastTarget = useRef<MapView | null>(target);
  const lastWorld = useRef(world);
  const handMoved = useRef(false);
  useEffect(() => {
    if (!target) return;
    const last = lastTarget.current;
    const sameContent = lastWorld.current === world;
    lastTarget.current = target;
    lastWorld.current = world;
    if (!last) {
      // The first frame there is anything to frame: placed, not flown from nowhere.
      setView(target);
      return;
    }
    if (sameContent) {
      if (!handMoved.current) setView(target);
      return;
    }
    handMoved.current = false;
    if (sameView(last, target)) return;
    flyTo(target);
  }, [target, world, flyTo]);

  // --- the hand: one reading for every surface -------------------------------
  const svgRef = useRef<SVGSVGElement | null>(null);
  /** The SVG's scale and offset inside its box (`meet`), measured at the event. */
  const frame = () => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    const s = Math.min(r.width / MAP_W, r.height / mapH);
    return { s, left: r.left + (r.width - MAP_W * s) / 2, top: r.top + (r.height - mapH * s) / 2 };
  };
  useZoomGestures({
    ref: surface,
    wheel: 'any',
    target: {
      scaleAt: () => 1 / viewRef.current.w,
      zoomTo: (scale, anchor) => {
        const f = frame();
        if (!f) return;
        const fx = (anchor.x - f.left) / f.s - MAP_W / 2;
        const fy = (anchor.y - f.top) / f.s - mapH / 2;
        const current = viewRef.current;
        setView(zoomViewAbout(current, current.w * scale, fx, fy, MAP_W));
      },
      panBy: (dx, dy) => {
        const f = frame();
        if (!f) return;
        setView((v) => panView(v, dx / f.s, dy / f.s, MAP_W));
      },
      drag: () => 'pan',
      onGesture: () => {
        stop();
        handMoved.current = true;
      },
    },
  });

  const zoomBy = (factor: number) => {
    handMoved.current = true;
    flyTo({ ...viewRef.current, w: clampW(viewRef.current.w / factor) });
  };

  // --- drawing ----------------------------------------------------------------
  const coast = useMemo(() => (land ? coastPath(land) : ''), [land]);
  const k = MAP_W / view.w;
  const at = (p: { lat: number; lon: number }) => {
    const [x, y] = mercator(p);
    return { x: (x - view.x) * k + MAP_W / 2, y: (y - view.y) * k + mapH / 2 };
  };

  const byDay = useMemo(() => {
    const map = new Map<string, Proposal>();
    for (const p of drawn.proposals) {
      // A proposal claims the days of its halts, which is what the route is coloured by.
      for (const h of p.halts) {
        for (const d of enumerateDays(h.leg.startDate, h.leg.endDate)) map.set(d, p);
      }
    }
    return map;
  }, [drawn]);
  const route = drawn.route;

  const dim = (key: string | null) => (hot && key !== hot ? 'opacity-25' : '');
  const named = new Set([hot, focus?.key].filter(Boolean));

  return (
    <div className={`relative rounded-paper border border-line bg-paper-2 overflow-hidden ${fill ? 'flex flex-col' : ''} ${className}`} title={legend}>
      <div ref={surface} className={`touch-none cursor-grab active:cursor-grabbing select-none ${fill ? 'flex-1 min-h-0' : ''}`} data-deduce-map>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${MAP_W} ${mapH}`}
          className={`block w-full ${fill ? 'h-full' : 'h-auto'}`}
          role="img"
          aria-label={focus ? `Where ${focus.label} is` : 'The route, as the days say it'}
        >
          {coast && (
            <path
              d={coast}
              transform={`matrix(${k} 0 0 ${k} ${MAP_W / 2 - view.x * k} ${mapH / 2 - view.y * k})`}
              fill="var(--color-paper)"
              stroke="var(--color-line-strong)"
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
              fillRule="evenodd"
            />
          )}
          {/* the route, a stroke per day in the colour of the proposal that claims
              BOTH its ends. A stroke from one stage into the next is the travel
              between them, not part of either (2026-10-07: China → Albany was
              drawn in Albany's colour and read as the stage's own first line):
              faint and dotted on the whole route, left out when one stage is
              framed — that stage starts at its first place. */}
          {route.map((p, i) => {
            if (i === 0) return null;
            const from = byDay.get(route[i - 1].date) ?? null;
            const to = byDay.get(p.date) ?? null;
            const between = from !== to;
            if (between && focus) return null;
            const a = at(route[i - 1]);
            const b = at(p);
            const owner = between ? null : to;
            const colour = owner ? proposalColour(owner) : 'var(--color-faint)';
            const gap = Date.parse(p.date) - Date.parse(route[i - 1].date) > 86_400_000;
            const aside = focus && owner && owner.key !== focus.key ? 'opacity-40' : '';
            return (
              <line
                key={p.date}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={colour}
                strokeWidth={owner && owner.verb !== 'skip' ? 2.2 : 1}
                strokeDasharray={between ? '1 3' : gap ? '2 3' : undefined}
                strokeLinecap="round"
                className={`transition-opacity ${dim(owner?.key ?? null)} ${aside}`}
              />
            );
          })}
          {/* a ring per halt where its pictures were, sized by its days — and, when
              the place chosen for it lies far from them, that place too, in orange */}
          {drawn.proposals.map((p) =>
            p.halts.map((h) => {
              const q = at(h.leg.centroid);
              const r = 1.6 + Math.sqrt(h.leg.dayCount) * 1.1;
              const place = haltPlace(h, draft);
              const far = place?.coords && haversineKm(h.leg.centroid, place.coords) > ODD_KM ? at(place.coords) : null;
              return (
                <g key={h.leg.startDate} className={`transition-opacity ${dim(p.key)}`}>
                  {far && (
                    <>
                      <line x1={q.x} y1={q.y} x2={far.x} y2={far.y} stroke="var(--color-warn)" strokeWidth={1} strokeDasharray="3 4" />
                      <circle cx={far.x} cy={far.y} r={4.5} fill="var(--color-warn-wash)" stroke="var(--color-warn)" strokeWidth={1.6} />
                    </>
                  )}
                  <circle
                    cx={q.x}
                    cy={q.y}
                    r={r}
                    fill={p.verb === 'skip' ? 'var(--color-paper-2)' : 'var(--color-surface)'}
                    stroke={proposalColour(p)}
                    strokeWidth={1.3}
                    strokeDasharray={haltName(h, draft) ? undefined : '2 1.5'}
                  />
                </g>
              );
            }),
          )}
          {/* the halts' names, for the chapter under the hand or the one in focus, at the PLACE */}
          {drawn.proposals
            .filter((p) => named.has(p.key))
            .map((p) =>
              p.halts.map((h) => {
                const place = haltPlace(h, draft);
                const name = haltText(h, draft, trip);
                if (!name) return null;
                const far = !!place?.coords && haversineKm(h.leg.centroid, place.coords) > ODD_KM;
                const q = at(far && place?.coords ? place.coords : h.leg.centroid);
                return (
                  <text
                    key={h.leg.startDate}
                    x={q.x + 6}
                    y={q.y + 3.5}
                    fontSize={9.5}
                    fontFamily="var(--font-sans)"
                    fill={far ? 'var(--color-warn)' : 'var(--color-ink)'}
                    stroke="var(--color-paper-2)"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {far ? `${name} · ${place?.countryCode ?? ''}` : name}
                  </text>
                );
              }),
            )}
        </svg>
      </div>
      {/* Zoom and fit — drawn at every width: a pinch can be taken away (`frontend.md`). */}
      <div className="absolute right-1.5 top-1.5 flex flex-col p-[2px] rounded-paper border border-line bg-surface shadow-paper">
        <IconButton size="sm" variant="ghost" label="Zoom in" onClick={() => zoomBy(2)}>
          {Icons.plus}
        </IconButton>
        <IconButton size="sm" variant="ghost" label="Zoom out" onClick={() => zoomBy(0.5)}>
          {Icons.minus}
        </IconButton>
        <span className="h-px mx-1 my-0.5 bg-line" aria-hidden="true" />
        <IconButton size="sm" variant="ghost" label={focus ? `Frame ${focus.label}` : 'Frame the whole route'} onClick={() => target && flyTo(target)}>
          {Icons.reset}
        </IconButton>
      </div>
      {caption !== undefined && (
        <span className="absolute left-2 bottom-1.5 max-w-[calc(100%-3.5rem)] px-1.5 rounded font-mono text-2xs text-muted bg-paper-2/80 truncate pointer-events-none">
          {caption}
        </span>
      )}
    </div>
  );
}
