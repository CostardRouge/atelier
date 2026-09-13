/**
 * The route trace — the trip's own shape over the picture.
 *
 * The legs' located places joined in the order they were lived: the trip so
 * far solid, this day's leg in the accent, the legs still ahead faint. It can
 * draw itself, the pen travelling to the end of the current leg before the rest
 * of the trip appears. A LAYER over the picture; no stop list, no pictures to
 * fetch, no text to rewrite, no sound.
 *
 * It is the engine's second real variant and deliberately unlike the first:
 * it needed ONE optional field added to the context the shell fills
 * (`HookContext.stages`), and nothing else in the contract, the resolver, the
 * picker, the renderer or either export. Arithmetic: `route-plan.ts`; drawing:
 * `route-paint.ts`.
 */

import type { ReactNode } from 'react';
import type { HookPanelProps, HookVariant } from './hook-variant';
import { paintRoute, type RoutePosition } from './route-paint';
import { locatedSpots, routeShape, type RouteScope } from './route-plan';

interface RouteOptions {
  scope: RouteScope;
  position: RoutePosition;
  size: number;
  draw: boolean;
  drawSeconds: number;
}

const ROUTE_DEFAULTS: RouteOptions = {
  scope: 'trip',
  position: 'top',
  size: 1,
  draw: true,
  drawSeconds: 1.6,
};

const LIMITS = {
  size: { min: 0.5, max: 1.2 },
  drawSeconds: { min: 0.6, max: 4 },
} as const;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
}

/** A stored options record, read through the defaults and clamped. */
export function routeOptions(raw: Readonly<Record<string, unknown>>): RouteOptions {
  const o = { ...ROUTE_DEFAULTS, ...raw } as RouteOptions;
  return {
    scope: o.scope === 'leg' ? 'leg' : 'trip',
    position: o.position === 'middle' || o.position === 'bottom' ? o.position : 'top',
    size: clamp(Number(o.size), LIMITS.size.min, LIMITS.size.max),
    draw: o.draw !== false,
    drawSeconds: clamp(Number(o.drawSeconds), LIMITS.drawSeconds.min, LIMITS.drawSeconds.max),
  };
}

function RouteSketch() {
  return (
    <svg viewBox="0 0 58 22" width="58" height="22" aria-hidden="true" fill="none">
      <path d="M4 17 C 12 14, 13 7, 21 6 S 33 12, 38 9" stroke="rgba(255,255,255,0.85)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M38 9 C 42 7, 45 4, 49 6" stroke="#d9442a" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M49 6 C 52 8, 53 13, 55 15" stroke="rgba(255,255,255,0.5)" strokeWidth="1" strokeDasharray="2 2" strokeLinecap="round" />
      <circle cx="4" cy="17" r="1.5" fill="#fff" />
      <circle cx="49" cy="6" r="1.8" fill="#d9442a" />
    </svg>
  );
}

const chip = (on: boolean) =>
  `px-2 py-1.5 rounded-paper border text-center cursor-pointer text-xs transition-colors ${
    on
      ? 'border-accent bg-accent-wash text-accent-ink font-semibold'
      : 'border-line bg-paper text-ink-soft hover:border-line-strong'
  }`;
const label = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={label}>{title}</span>
      {children}
    </div>
  );
}

function RoutePanel({ options, onChange, ctx }: HookPanelProps) {
  const o = routeOptions(options);
  const set = (patch: Partial<RouteOptions>) => onChange({ ...o, ...patch });
  const stages = ctx.stages ?? [];
  const shape = routeShape(stages, ctx.date, o.scope);

  // What the line will really show for THIS piece, or why it shows less.
  const summary =
    shape.points.length < 2
      ? o.scope === 'leg'
        ? 'This day’s leg has fewer than two places with coordinates, so there is no line to draw for it alone.'
        : null
      : `${shape.points.length} located places across ${
          o.scope === 'leg' ? 'this leg' : `${stages.length} ${stages.length === 1 ? 'leg' : 'legs'}`
        } · ${
          shape.currentLeg === null
            ? 'no leg covers this day, so none is marked'
            : `this day is on leg ${shape.currentLeg}${
                stages[shape.currentLeg - 1]?.label ? ` — ${stages[shape.currentLeg - 1].label}` : ''
              }`
        }`;
  const unlocated = stages.length > 0 && stages.some((stage) => stage.places.length === 0);

  return (
    <div className="flex flex-col gap-3 pl-3 border-l-2 border-line">
      {summary && <p className="m-0 text-xs text-ink-soft">{summary}</p>}
      {unlocated && (
        <p className="m-0 text-xs text-faint">
          A leg with no located place is not on the line. Places get coordinates when you
          look them up in the trip’s legs.
        </p>
      )}

      <Row title="Route">
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className={chip(o.scope === 'trip')} aria-pressed={o.scope === 'trip'} onClick={() => set({ scope: 'trip' })}>
            The whole trip
          </button>
          <button type="button" className={chip(o.scope === 'leg')} aria-pressed={o.scope === 'leg'} onClick={() => set({ scope: 'leg' })}>
            This day’s leg
          </button>
        </div>
      </Row>

      <Row title="Where">
        <div className="grid grid-cols-3 gap-1.5">
          {(['top', 'middle', 'bottom'] as const).map((position) => (
            <button key={position} type="button" className={chip(o.position === position)} aria-pressed={o.position === position} onClick={() => set({ position })}>
              {position === 'top' ? 'Top' : position === 'middle' ? 'Middle' : 'Bottom'}
            </button>
          ))}
        </div>
      </Row>

      <Row title={`Size · ${Math.round(o.size * 100)}%`}>
        <input
          type="range"
          min={LIMITS.size.min}
          max={LIMITS.size.max}
          step={0.05}
          value={o.size}
          onChange={(e) => set({ size: Number(e.target.value) })}
          className="accent-accent"
        />
      </Row>

      <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer">
        <input type="checkbox" checked={o.draw} onChange={(e) => set({ draw: e.target.checked })} className="accent-accent" />
        Draw the trip so far, then show what is still ahead
      </label>

      {o.draw && (
        <Row title={`Drawing · ${o.drawSeconds.toFixed(1)}s`}>
          <input
            type="range"
            min={LIMITS.drawSeconds.min}
            max={LIMITS.drawSeconds.max}
            step={0.1}
            value={o.drawSeconds}
            onChange={(e) => set({ drawSeconds: Number(e.target.value) })}
            className="accent-accent"
          />
        </Row>
      )}
    </div>
  );
}

export const routeVariant: HookVariant = {
  id: 'route',
  name: 'Route',
  tagline: 'The trip’s own shape, this day’s leg marked',
  defaults: { ...ROUTE_DEFAULTS },
  needs: { stages: true, places: true },
  owns: 'layer',
  unmet(ctx) {
    // No legs resolved means the shell has not filled them — not a refusal.
    if (!ctx.stages) return null;
    return locatedSpots(ctx.stages) < 2 ? 'Needs two places with coordinates' : null;
  },
  prepare(options, ctx) {
    const o = routeOptions(options);
    const shape = routeShape(ctx.stages ?? [], ctx.date, o.scope);
    if (shape.points.length < 2) return { seconds: 0 };
    // The pen plays for its own length, and the future legs' fade-in after it.
    const seconds = o.draw ? o.drawSeconds * 1.15 : 0;
    return {
      seconds,
      paint: (g, t, frame) => paintRoute(g, shape, o, t, frame),
    };
  },
  Sketch: RouteSketch,
  Panel: RoutePanel,
};
