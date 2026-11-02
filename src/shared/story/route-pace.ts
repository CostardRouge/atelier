/**
 * How the route is drawn over its scene (road lab C4, his « je valide »): at
 * the pace of the DISTANCE (the old way: a long straight eats the seconds),
 * of the DAYS lived (Trips' `pace`: a week in one town takes its share even
 * when the road barely moves), or anything between; with a PAUSE at each
 * stop it reaches; and with a HEAD at its tip — none (before), a dot, or an
 * arrow along the road. The scene's easing (`sineInOut`) is kept: this warps
 * the eased progress `x` into a fraction of the route's length. (pure)
 */

export interface RoutePace {
  /** 0 = by distance (before), 1 = by the days lived. */
  days?: number;
  /** The share of the drawing held at the stops, 0–0.4 (0: no pause). */
  dwell?: number;
  head?: 'none' | 'dot' | 'arrow';
}

export const ROUTE_PACE_DEFAULTS: Required<RoutePace> = { days: 0, dwell: 0, head: 'none' };

export function readRoutePace(raw: unknown): RoutePace | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: RoutePace = {};
  if (typeof r.days === 'number' && Number.isFinite(r.days)) out.days = Math.min(1, Math.max(0, r.days));
  if (typeof r.dwell === 'number' && Number.isFinite(r.dwell)) out.dwell = Math.min(0.4, Math.max(0, r.dwell));
  if (r.head === 'none' || r.head === 'dot' || r.head === 'arrow') out.head = r.head;
  return Object.keys(out).length ? out : undefined;
}

const N = 512;

/** Where along `xs` (non-decreasing) `v` falls, as an interpolated index in 0..xs.length-1. */
function indexOf(xs: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  if (v <= xs[0]) return 0;
  if (v >= xs[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= v) lo = mid;
    else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  return lo + (span > 0 ? (v - xs[lo]) / span : 0);
}

const at = (ys: ArrayLike<number>, i: number) => {
  const a = Math.floor(i);
  const b = Math.min(ys.length - 1, a + 1);
  return ys[a] + (ys[b] - ys[a]) * (i - a);
};

/**
 * The table `paced` reads: the route fraction at `N + 1` even steps of the
 * eased progress. `cum` is the route's arc length at each point, `times` the
 * Unix seconds of each point when the road is timed (else null: by distance
 * only), `reach` the fraction where each stop is reached.
 */
export function paceTable(cum: readonly number[], times: readonly number[] | null, reach: readonly number[], pace: RoutePace | null | undefined): Float64Array {
  const p = { ...ROUTE_PACE_DEFAULTS, ...(pace ?? {}) };
  const L = cum[cum.length - 1] || 1;
  const lengthFrac = cum.map((d) => d / L);
  // P(u): the route fraction reached at a share u of the drawing, by distance and by time, mixed.
  let timeFrac: number[] | null = null;
  if (p.days > 0 && times && times.length === cum.length) {
    const t0 = times[0];
    const span = times[times.length - 1] - t0;
    if (span > 0) {
      let most = 0;
      // A fix recorded out of order never takes time back.
      timeFrac = times.map((t) => (most = Math.max(most, (t - t0) / span)));
    }
  }
  const P = new Float64Array(N + 1);
  for (let k = 0; k <= N; k++) {
    const u = k / N;
    const byTime = timeFrac ? at(lengthFrac, indexOf(timeFrac, u)) : u;
    P[k] = (1 - (timeFrac ? p.days : 0)) * u + (timeFrac ? p.days : 0) * byTime;
  }
  // The pauses: each inner stop holds an equal share of `dwell`, the travel shares the rest.
  const inner = reach.slice(1, -1).filter((r) => r > 0 && r < 1);
  const stopsU = inner.map((r) => indexOf(P, r) / N).sort((a, b) => a - b);
  const hold = p.dwell > 0 && stopsU.length ? p.dwell / stopsU.length : 0;
  const travel = 1 - hold * stopsU.length;
  const out = new Float64Array(N + 1);
  for (let k = 0; k <= N; k++) {
    const x = k / N;
    let u: number;
    if (!hold) u = x;
    else {
      // Walk the drawing: travel to each stop, hold, travel on.
      let clock = 0;
      let from = 0;
      u = 1;
      for (const s of [...stopsU, 1]) {
        const leg = (s - from) * travel;
        if (x <= clock + leg) {
          u = from + (leg > 0 ? (x - clock) / travel : 0);
          break;
        }
        clock += leg;
        if (s < 1) {
          if (x <= clock + hold) {
            u = s;
            break;
          }
          clock += hold;
        }
        from = s;
      }
    }
    out[k] = at(P, Math.max(0, Math.min(1, u)) * N);
  }
  return out;
}

/** The route fraction at eased progress `x` (0–1). (pure) */
export function pacedAt(table: Float64Array, x: number): number {
  return at(table, Math.max(0, Math.min(1, x)) * N);
}
