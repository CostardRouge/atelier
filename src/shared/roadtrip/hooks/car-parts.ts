/**
 * What every CAR model over `mesh3d.ts` is built from — the Kadjar's idiom
 * (`kadjar-model.ts`), lifted out of it the day a third and a fourth car
 * were asked for, so that a Renault's hull, decals and wheels are written
 * once and each model keeps only its own numbers.
 *
 * A model hands `makeBody` its PLAN — half length, half width, the rounded
 * outline of its right-hand edge from tail to nose, and the heights its hull
 * is cut at — and gets back the tools that know that plan: a convex `hull`
 * slice between two y's and two planes, a `wallDecal` on a plan edge, a
 * `sideDecal` on the flank, an `acrossFace` band on the nose or the tail, the
 * `diamond`. The rules they keep are the ones the Prado and the Kadjar learned
 * the hard way (`roadtrip.md`): every part CONVEX, a face buried against its
 * neighbour not built, a decal INSIDE the one face it is pushed off and cut
 * where it would cross a cut of the hull (`bands`). The free functions —
 * `through`, `lifted`, `level`, `at`, `arc`, `box2`, `meet`, `clipX` — are
 * the plane and plan arithmetic every model shares.
 *
 * The Prado (`car-model.ts`) predates this and keeps its own; the boats are
 * `boat-parts.ts`. Pure and DOM-free.
 */

import { cylinder, decal, heightOn, normalise, prism, solid, type Face, type Part, type Vec3, type ZPlane } from './mesh3d';

export type P2 = readonly [number, number];

/** A plane of heights through two (y, z) points, level across. */
export function through(y0: number, z0: number, y1: number, z1: number): ZPlane {
  const dy = (z1 - z0) / (y1 - y0);
  return { z: z0 - dy * y0, dy };
}

/** A plane lifted by `dz`. */
export function lifted(plane: ZPlane, dz: number): ZPlane {
  return { ...plane, z: plane.z + dz };
}

export const level = (z: number): ZPlane => ({ z });
/** A plane's height at `y`, on the centre line. */
export const at = (plane: ZPlane, y: number) => heightOn(plane, 0, y);

/** `steps + 1` points along an arc, angles in degrees. */
export function arc(cx: number, cy: number, r: number, from: number, to: number, steps: number): P2[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as P2;
  });
}

/** An axis-aligned rectangle of the plan. */
export const box2 = (x0: number, x1: number, y0: number, y1: number): P2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Where a line through `p` along `d` (in y, z) meets a plane of heights. */
export function meet(p: P2, d: P2, plane: ZPlane): P2 {
  const dy = plane.dy ?? 0;
  const t = (plane.z + dy * p[0] - p[1]) / (d[1] - dy * d[0]);
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/** A convex plan cut to `lo ≤ x ≤ hi` — still convex, the cuts exactly on `lo` and `hi`. */
export function clipX(plan: readonly P2[], lo: number, hi: number): P2[] {
  let poly: P2[] = [...plan];
  for (const [edge, keep] of [
    [lo, (x: number) => x >= lo],
    [hi, (x: number) => x <= hi],
  ] as const) {
    if (!Number.isFinite(edge)) continue;
    const input = poly;
    poly = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i];
      const b = input[(i + 1) % input.length];
      if (keep(a[0])) poly.push(a);
      if (keep(a[0]) !== keep(b[0])) poly.push([edge, a[1] + ((b[1] - a[1]) * (edge - a[0])) / (b[0] - a[0])]);
    }
  }
  return poly;
}

export interface BodySpec {
  halfLength: number;
  /** The flank's distance from the centre line on a straight stretch. */
  halfWidth: number;
  /**
   * The plan's right-hand edge, rear to nose, on the straight stretches and
   * round the corners; the left is its mirror.
   */
  outline: readonly P2[];
  /** The heights the hull is cut at; a decal crossing one is cut with it. */
  cuts: readonly number[];
}

export interface HullOptions {
  /** Narrow the slice to this half width — only on a straight stretch. */
  cap?: number;
  /** Cut the slice to `lo ≤ x ≤ hi`, a panel beside another. */
  x?: [number, number];
  /** Build the top, in the slice's own role — or in `topRole`'s. */
  top?: boolean;
  topRole?: string;
  /** The ends pressed against the next panel, not built. */
  buried?: { front?: boolean; rear?: boolean };
}

export interface Body extends BodySpec {
  /** The plan's half width at `y`. */
  halfWidthAt(y: number): number;
  /**
   * The plan of the hull between two y's, the rounded corners carried through
   * wherever the slice reaches them, narrowed to `cap` where it is asked to be
   * (only ever on a straight stretch, so no corner point falls between).
   */
  slicePlan(y0: number, y1: number, cap?: number): P2[];
  /**
   * One convex slice of the hull, between two y's and, where it is a panel of
   * its own (a wing beside the bonnet), two x's. The ends named `buried`, and
   * any wall standing on an x cut, are pressed against the next panel —
   * surfaces nobody can see that the paint order would still have to place, so
   * they are not built. A bottom is never built: the camera is always above the
   * ground.
   */
  hull(id: string, y0: number, y1: number, bottom: ZPlane, top: ZPlane, role: string, opts?: HullOptions): Part;
  /** `z0..z1` cut at every height the hull is cut at between them. */
  bands(z0: number, z1: number): [number, number][];
  /**
   * A decal on the vertical wall standing on the plan edge `a → b` (right-hand
   * side; the left is the mirror), between shares `t0..t1` of the edge and two
   * heights, pushed `lift` off it along the wall's outward normal.
   */
  wallDecal(id: string, role: string, a: P2, b: P2, t0: number, t1: number, z0: number, z1: number, lift?: number): Part[];
  /** A centred band across the nose (`y > 0`) or tail face. */
  acrossFace(id: string, role: string, y: number, halfX: number, z0: number, z1: number, lift: number): Part[];
  /** A flat decal on the nose or tail, centred, not mirrored — the diamond. */
  diamond(id: string, y: number, z: number, half: number, lift: number, role?: string): Part;
  /** A decal on the flat of a side, between two y's and two heights (either may follow a plane). */
  sideDecal(id: string, role: string, y0: number, y1: number, z0: ZPlane, z1: ZPlane, lift?: number): Part[];
}

export function makeBody(spec: BodySpec): Body {
  const { halfLength, halfWidth, outline, cuts } = spec;

  function halfWidthAt(y: number): number {
    for (let i = 1; i < outline.length; i++) {
      const [x0, y0] = outline[i - 1];
      const [x1, y1] = outline[i];
      if (y <= y1) return y1 === y0 ? x1 : x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
    }
    return outline[outline.length - 1][0];
  }

  function slicePlan(y0: number, y1: number, cap = halfWidth): P2[] {
    const right: P2[] = [[Math.min(cap, halfWidthAt(y0)), y0]];
    for (const [x, y] of outline) if (y > y0 + 1e-9 && y < y1 - 1e-9) right.push([Math.min(cap, x), y]);
    right.push([Math.min(cap, halfWidthAt(y1)), y1]);
    const left = [...right].reverse().map(([x, y]) => [-x, y] as P2);
    return [...right, ...left];
  }

  function hull(id: string, y0: number, y1: number, bottom: ZPlane, top: ZPlane, role: string, opts: HullOptions = {}): Part {
    const buried = opts.buried ?? {};
    const [lo, hi] = opts.x ?? [-Infinity, Infinity];
    const plan = clipX(slicePlan(y0, y1, opts.cap), lo, hi);
    return prism(id, plan, bottom, top, { side: role, top: opts.top ? (opts.topRole ?? role) : null, bottom: null }, {
      open: (a, b) =>
        (a[1] === b[1] && ((buried.front === true && a[1] === y1) || (buried.rear === true && a[1] === y0))) ||
        (a[0] === b[0] && (a[0] === lo || a[0] === hi)),
    });
  }

  function bands(z0: number, z1: number): [number, number][] {
    const edges = [z0, ...cuts.filter((c) => c > z0 + 1e-9 && c < z1 - 1e-9), z1];
    return edges.slice(1).map((z, i) => [edges[i], z] as [number, number]);
  }

  function wallDecal(id: string, role: string, a: P2, b: P2, t0: number, t1: number, z0: number, z1: number, lift = 0.004): Part[] {
    const parts: Part[] = [];
    for (const sign of [1, -1] as const) {
      const pa: P2 = [sign * a[0], a[1]];
      const pb: P2 = [sign * b[0], b[1]];
      let n = normalise([pb[1] - pa[1], -(pb[0] - pa[0]), 0]);
      const mid: P2 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
      if (n[0] * mid[0] + n[1] * mid[1] < 0) n = [-n[0], -n[1], 0];
      const point = (t: number, z: number): Vec3 => [
        pa[0] + (pb[0] - pa[0]) * t + n[0] * lift,
        pa[1] + (pb[1] - pa[1]) * t + n[1] * lift,
        z,
      ];
      const side = sign < 0 ? 'l' : 'r';
      bands(z0, z1).forEach(([lo, hi], i) => {
        parts.push(decal(`${id}-${side}${i ? `-${i}` : ''}`, [point(t0, lo), point(t1, lo), point(t1, hi), point(t0, hi)], role, n));
      });
    }
    return parts;
  }

  function acrossFace(id: string, role: string, y: number, halfX: number, z0: number, z1: number, lift: number): Part[] {
    const s = Math.sign(y);
    const face = s * (halfLength + lift);
    return bands(z0, z1).map(([lo, hi], i) =>
      decal(`${id}${i ? `-${i}` : ''}`, [[-halfX, face, lo], [halfX, face, lo], [halfX, face, hi], [-halfX, face, hi]], role, [0, s, 0]),
    );
  }

  function diamond(id: string, y: number, z: number, half: number, lift: number, role = 'chrome'): Part {
    const s = Math.sign(y);
    const face = s * (halfLength + lift);
    return decal(
      id,
      [
        [0, face, z + half],
        [half * 0.68, face, z],
        [0, face, z - half],
        [-half * 0.68, face, z],
      ],
      role,
      [0, s, 0],
    );
  }

  function sideDecal(id: string, role: string, y0: number, y1: number, z0: ZPlane, z1: ZPlane, lift = 0.004): Part[] {
    return ([1, -1] as const).map((sign) => {
      const x = sign * (halfWidth + lift);
      return decal(
        `${id}-${sign < 0 ? 'l' : 'r'}`,
        [[x, y0, at(z0, y0)], [x, y1, at(z0, y1)], [x, y1, at(z1, y1)], [x, y0, at(z1, y0)]],
        role,
        [sign, 0, 0],
      );
    });
  }

  return { halfLength, halfWidth, outline, cuts, halfWidthAt, slicePlan, hull, bands, wallDecal, acrossFace, diamond, sideDecal };
}

// --- the greenhouse ---------------------------------------------------------------

/** A flank that leans in: `x` from the centre at height `z`, less by `lean` per unit of height above it. */
export interface SideLean {
  x: number;
  z: number;
  lean: number;
}

export const sideAt = (side: SideLean, z: number): number => side.x - side.lean * (z - side.z);
/** A (y, z) point of the profile, on the right (`1`) or left (`-1`) flank. */
export const onSideOf = (side: SideLean, sign: 1 | -1, [y, z]: P2): Vec3 => [sign * sideAt(side, z), y, z];

/** A car's greenhouse profile in (y, z): the windscreen's base, the roof's two ends, the rear screen's base. */
export interface GreenhouseProfile {
  wsBase: P2;
  roofFront: P2;
  roofRear: P2;
  rearBase: P2;
}

/**
 * The cabin over the belt as ONE convex part: each flank tiled (the pillars,
 * the glass, the strip under the roof — every tile convex and all on the
 * flank's one leaning plane), then the roof, the windscreen and the rear
 * screen across, and a floor lying on the body's top — never seen, it keeps
 * `outward` honest. The tiles are given for the right flank; the left is
 * the mirror.
 */
export function greenhouse(
  id: string,
  side: SideLean,
  profile: GreenhouseProfile,
  tiles: readonly { role: string; points: readonly P2[] }[],
  roles: { roof?: string; screen?: string; rear?: string; floor?: string } = {},
): Part {
  const { wsBase, roofFront, roofRear, rearBase } = profile;
  const faces: Face[] = [];
  for (const sign of [1, -1] as const) {
    for (const tile of tiles) faces.push({ role: tile.role, verts: tile.points.map((p) => onSideOf(side, sign, p)) });
  }
  const across = (a: P2, b: P2, role: string): Face => ({
    role,
    verts: [onSideOf(side, 1, a), onSideOf(side, -1, a), onSideOf(side, -1, b), onSideOf(side, 1, b)],
  });
  faces.push(across(roofFront, roofRear, roles.roof ?? 'roof'));
  faces.push(across(wsBase, roofFront, roles.screen ?? 'glass'));
  faces.push(across(roofRear, rearBase, roles.rear ?? 'glass'));
  faces.push(across(rearBase, wsBase, roles.floor ?? 'body'));
  return solid(id, faces);
}

// --- wheels -------------------------------------------------------------------

export interface WheelSpec {
  radius: number;
  /** Half the tyre's width. */
  half: number;
  /** The tyre's facets — 14 on the Kadjar, measured against its own rear door. */
  facets?: number;
}

/** A road wheel standing on the ground at (x, y), spinning about its axle. */
export function roadWheel(id: string, x: number, y: number, spec: WheelSpec): Part {
  return cylinder(
    id,
    [x, y, spec.radius],
    'x',
    spec.radius,
    spec.half,
    spec.facets ?? 14,
    { side: 'tyre', sideAlt: 'tread', cap: 'tyre' },
    false,
    true,
  );
}

/** The radii of a rim's drawing: its disc, where a spoke starts and ends, the cap. */
export interface RimRadii {
  disc: number;
  inner: number;
  outer: number;
  hub: number;
}

/** The Kadjar's 0.39 wheel, as it was drawn; another wheel scales these by its radius. */
export const KADJAR_RIM: RimRadii = { disc: 0.27, inner: 0.08, outer: 0.255, hub: 0.065 };

/** `KADJAR_RIM` scaled to a wheel of `radius`. */
export function rimFor(radius: number): RimRadii {
  const k = radius / 0.39;
  return { disc: KADJAR_RIM.disc * k, inner: KADJAR_RIM.inner * k, outer: KADJAR_RIM.outer * k, hub: KADJAR_RIM.hub * k };
}

/**
 * A diamond-cut alloy on the outer face of a wheel: a dark disc, five pairs of
 * bright spokes turning with the wheel, a cap. Roles `rimDark` and `rim`.
 */
export function spokedRim(id: string, x: number, y: number, outerSign: 1 | -1, spec: WheelSpec, rim: RimRadii = KADJAR_RIM): Part[] {
  const r = spec.radius;
  const pivot: Vec3 = [x, y, r];
  const px = x + outerSign * (spec.half + 0.005);
  const ring = (radius: number, count: number, lift: number): Vec3[] =>
    Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2;
      return [px + outerSign * lift, y + radius * Math.cos(a), r + radius * Math.sin(a)];
    });
  const normal: Vec3 = [outerSign, 0, 0];
  const parts: Part[] = [decal(`${id}-rim`, ring(rim.disc, 16, 0), 'rimDark', normal)];
  for (let i = 0; i < 10; i++) {
    const a = (Math.floor(i / 2) / 5) * Math.PI * 2 + (i % 2 ? 0.2 : -0.2);
    const point = (radius: number, da: number): Vec3 => [
      px + outerSign * 0.006,
      y + radius * Math.cos(a + da),
      r + radius * Math.sin(a + da),
    ];
    const part = decal(`${id}-spoke-${i}`, [point(rim.inner, -0.07), point(rim.inner, 0.07), point(rim.outer, 0.035), point(rim.outer, -0.035)], 'rim', normal);
    parts.push({ ...part, spin: { pivot, axis: 'x' as const } });
  }
  parts.push(decal(`${id}-hub`, ring(rim.hub, 8, 0.012), 'rim', normal));
  return parts;
}

/**
 * A steel wheel under a plastic cap, as a van or a base trim wears it: a
 * bright disc, a ring of dark vents turning with the wheel, a small cap.
 * Roles `rim` (the cap), `rimDark` (the vents).
 */
export function cappedRim(id: string, x: number, y: number, outerSign: 1 | -1, spec: WheelSpec, vents = 6): Part[] {
  const r = spec.radius;
  const pivot: Vec3 = [x, y, r];
  const px = x + outerSign * (spec.half + 0.005);
  const ring = (radius: number, count: number, lift: number): Vec3[] =>
    Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2;
      return [px + outerSign * lift, y + radius * Math.cos(a), r + radius * Math.sin(a)];
    });
  const normal: Vec3 = [outerSign, 0, 0];
  const disc = rimFor(r).disc;
  const parts: Part[] = [decal(`${id}-rim`, ring(disc, 16, 0), 'rim', normal)];
  for (let i = 0; i < vents; i++) {
    const a = (i / vents) * Math.PI * 2;
    const point = (radius: number, da: number): Vec3 => [
      px + outerSign * 0.006,
      y + radius * Math.cos(a + da),
      r + radius * Math.sin(a + da),
    ];
    const part = decal(
      `${id}-vent-${i}`,
      [point(disc * 0.55, -0.16), point(disc * 0.55, 0.16), point(disc * 0.86, 0.11), point(disc * 0.86, -0.11)],
      'rimDark',
      normal,
    );
    parts.push({ ...part, spin: { pivot, axis: 'x' as const } });
  }
  parts.push(decal(`${id}-hub`, ring(r / 6, 8, 0.012), 'rimDark', normal));
  return parts;
}
