/**
 * The pieces a boat is built from, for the boat models over `mesh3d.ts` —
 * the Whitsundays catamaran, the Viper, the Alison Maree.
 *
 * The cars' rules hold (`roadtrip.md`): every part CONVEX, no face buried
 * against a neighbour, a decal inside the one face it is pushed off. Boats
 * make two of them easier and one harder. Easier: nothing stands UNDER a deck
 * the way a wheel stands under a bonnet, and a hull is convex by nature, so it
 * is stated as its corners — the waterline narrower than the deck, the bow
 * raked past the forefoot — and `hullSolid` finds the faces. Harder: a boat is
 * long, so a deck is cut where a real one changes (the cabin's front, its
 * back), for the same reason the cars' hulls are sliced.
 *
 * Units are metres, the waterline at z = 0 (what is under it is never drawn:
 * the map is the sea), the bow toward +y, x to the right.
 *
 * Pure and DOM-free.
 */

import { decal, hullSolid, prism, type Part, type Vec3, type ZPlane } from './mesh3d';

export type P2 = readonly [number, number];

/** How far a decal stands off its face, in metres — nearer than the oracle's millimetre. */
export const LIFT = 0.02;

/** A face's role from its normal: the top is `top`, the sides the author's colour, the waterline nothing. */
export function hullRoles(top: string, side = 'body'): (n: Vec3) => string | null {
  return (n) => (n[2] > 0.9 ? top : n[2] < -0.9 ? null : side);
}

export interface HullShape {
  /** The centre line. */
  cx: number;
  /** The transom, and the stem at deck level and at the water. */
  stern: number;
  bow: number;
  forefoot: number;
  /** Where the deck starts to narrow toward the stem. */
  taper: number;
  /** Half the beam at the deck and at the waterline. */
  deckHalf: number;
  waterHalf: number;
  /** The deck's height above the water. */
  freeboard: number;
}

/**
 * Where the waterline starts to narrow, so that each bow face is FLAT: its
 * bottom edge parallel to its top one. Any other point and the hull finder
 * would make the face two triangles, and the ink would draw the diagonal.
 */
function waterTaper(h: HullShape): number {
  return h.forefoot - (h.waterHalf * (h.bow - h.taper)) / h.deckHalf;
}

/**
 * A hull above the water — a catamaran's demihull or a monohull — from its
 * corners: a pointed deck plan over a narrower, shorter waterline plan. Six
 * flat faces: the deck, two flared sides, two bow faces meeting at the stem,
 * an upright transom. No sheer: a deck rising toward the bow would bend each
 * side out of its plane, and a bent side is two faces with an inked seam.
 */
export function hullPart(id: string, h: HullShape, top = 'deck'): Part {
  const { deck, water } = hullPlans(h);
  return hullSolid(id, [...lift(deck, h.freeboard), ...lift(water, 0)], hullRoles(top));
}

const lift = (plan: readonly P2[], z: number): Vec3[] => plan.map(([x, y]) => [x, y, z] as Vec3);

/** The two plans a hull is the hull of: its deck and its waterline. */
function hullPlans(h: HullShape): { deck: P2[]; water: P2[] } {
  const wT = waterTaper(h);
  const deck: P2[] = [
    [h.cx - h.deckHalf, h.stern],
    [h.cx + h.deckHalf, h.stern],
    [h.cx + h.deckHalf, h.taper],
    [h.cx, h.bow],
    [h.cx - h.deckHalf, h.taper],
  ];
  const water: P2[] = [
    [h.cx - h.waterHalf, h.stern],
    [h.cx + h.waterHalf, h.stern],
    [h.cx + h.waterHalf, wT],
    [h.cx, h.forefoot],
    [h.cx - h.waterHalf, wT],
  ];
  return { deck, water };
}

/** The part of a convex plan on one side of `y = at` — still convex, the cut exactly on `at`. */
function clipY(plan: readonly P2[], at: number, keep: 'aft' | 'fore'): P2[] {
  const inside = (p: P2) => (keep === 'aft' ? p[1] <= at : p[1] >= at);
  const out: P2[] = [];
  for (let i = 0; i < plan.length; i++) {
    const a = plan[i];
    const b = plan[(i + 1) % plan.length];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) out.push([a[0] + ((b[0] - a[0]) * (at - a[1])) / (b[1] - a[1]), at]);
  }
  return out;
}

/**
 * A catamaran's demihull cut where the bridge deck ends, as two parts. The
 * part UNDER the bridge deck builds no deck: it is buried under the bridge
 * from end to end, and a buried face 24 m long is one the paint order places
 * over what stands in front of it (the bridge's own rear deck). The bow keeps
 * its deck; the cut between the two is inside the hull and not built.
 */
export function demihullParts(id: string, h: HullShape, cutAt: number, top = 'deck'): Part[] {
  const { deck, water } = hullPlans(h);
  const aft = [...lift(clipY(deck, cutAt, 'aft'), h.freeboard), ...lift(clipY(water, cutAt, 'aft'), 0)];
  const fore = [...lift(clipY(deck, cutAt, 'fore'), h.freeboard), ...lift(clipY(water, cutAt, 'fore'), 0)];
  const side = hullRoles(top);
  return [
    hullSolid(`${id}-aft`, aft, (n) => (n[2] > 0.9 || n[1] > 0.9 ? null : side(n))),
    hullSolid(`${id}-bow`, fore, (n) => (n[1] < -0.9 ? null : side(n))),
  ];
}

/**
 * A long monohull — a ship — cut across at the given y's into slices, each
 * its own convex part, for the reason the catamarans' hulls are cut: one side
 * face the length of a ship is keyed by its far end. A cut face is inside the
 * hull and never built; only the first slice keeps its transom, and a slice
 * whose top is buried under a superstructure (`topless`) builds no deck.
 */
export function hullSlices(id: string, h: HullShape, cuts: readonly number[], topless: (index: number) => boolean): Part[] {
  const { deck, water } = hullPlans(h);
  const ends = [h.stern, ...cuts, h.bow];
  const parts: Part[] = [];
  for (let i = 0; i < ends.length - 1; i++) {
    let d: P2[] = [...deck];
    let w: P2[] = [...water];
    if (i > 0) {
      d = clipY(d, ends[i], 'fore');
      w = clipY(w, ends[i], 'fore');
    }
    if (i < ends.length - 2) {
      d = clipY(d, ends[i + 1], 'aft');
      w = clipY(w, ends[i + 1], 'aft');
    }
    const first = i === 0;
    const last = i === ends.length - 2;
    const side = hullRoles(topless(i) ? '' : 'deck');
    parts.push(
      hullSolid(`${id}-${i}`, [...lift(d, h.freeboard), ...lift(w, 0)], (n) => {
        if (n[1] < -0.9) return first ? 'body' : null;
        if (n[1] > 0.9) return last ? 'body' : null;
        const role = side(n);
        return role === '' ? null : role;
      }),
    );
  }
  return parts;
}

const level = (z: number): ZPlane => ({ z });

/** An axis-aligned box, its bottom and any named wall left out where it is pressed against something. */
export function slab(
  id: string,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  role: string,
  opts: { top?: string | null; bottom?: boolean; open?: { left?: boolean; right?: boolean; front?: boolean; back?: boolean } } = {},
): Part {
  const open = opts.open ?? {};
  const plan: P2[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  return prism(
    id,
    plan,
    level(z0),
    level(z1),
    { side: role, top: opts.top === undefined ? role : opts.top, bottom: opts.bottom ? role : null },
    {
      open: (a, b) =>
        (open.left === true && a[0] === x0 && b[0] === x0) ||
        (open.right === true && a[0] === x1 && b[0] === x1) ||
        (open.back === true && a[1] === y0 && b[1] === y0) ||
        (open.front === true && a[1] === y1 && b[1] === y1),
    },
  );
}

/**
 * A thin upright wall along a straight run — a bulwark, a glass balustrade, a
 * rail read as one band. A wall is convex where a rail and its posts are not,
 * and at a boat's size on a map it is what a rail looks like anyway. An end
 * that butts against the next wall of a run (`butt`) is not built.
 */
export function wall(
  id: string,
  a: P2,
  b: P2,
  z0: number,
  height: number,
  role: string,
  thick = 0.06,
  butt: { start?: boolean; end?: boolean } = {},
): Part {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (thick / 2);
  const ny = (dx / len) * (thick / 2);
  const plan: P2[] = [
    [a[0] - nx, a[1] - ny],
    [b[0] - nx, b[1] - ny],
    [b[0] + nx, b[1] + ny],
    [a[0] + nx, a[1] + ny],
  ];
  const [p0, p1, p2, p3] = plan;
  const same = (u: P2, v: P2) => u[0] === v[0] && u[1] === v[1];
  return prism(id, plan, level(z0), level(z0 + height), { side: role, top: role, bottom: null }, {
    open: (u, v) => (butt.end === true && same(u, p1) && same(v, p2)) || (butt.start === true && same(u, p3) && same(v, p0)),
  });
}

/**
 * A long wall cut at the given y's into a run of walls butting end to end:
 * one wall the length of a boat takes its place in the paint order from its
 * far end, and a deck in front of its near end was drawn under it (the
 * Alison Maree's aft deck, behind a 13.5 m balustrade).
 */
export function wallRun(id: string, x: number, ys: readonly number[], z0: number, height: number, role: string, thick = 0.06): Part[] {
  return ys.slice(1).map((y, i) =>
    wall(`${id}-${i}`, [x, ys[i]], [x, y], z0, height, role, thick, { start: i > 0, end: i < ys.length - 2 }),
  );
}

export interface CabinShape {
  x: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  /** How far the top of the front face is set back: a raked windscreen. */
  rake: number;
  /** The same at the back, for a cabin whose rear face leans forward too. */
  rakeBack?: number;
}

/**
 * A deckhouse — a saloon, a wheelhouse — with a raked front. The front is
 * glass, the roof its own colour, the rest the house's; the window bands on
 * the sides are `windowBand`'s.
 */
export function cabinPart(id: string, c: CabinShape, roles: { wall: string; roof: string | null; front: string; back?: string }): Part {
  const back = c.rakeBack ?? 0;
  const pts: Vec3[] = [
    [-c.x, c.y0, c.z0],
    [c.x, c.y0, c.z0],
    [c.x, c.y1, c.z0],
    [-c.x, c.y1, c.z0],
    [-c.x, c.y0 + back, c.z1],
    [c.x, c.y0 + back, c.z1],
    [c.x, c.y1 - c.rake, c.z1],
    [-c.x, c.y1 - c.rake, c.z1],
  ];
  return hullSolid(id, pts, (n) => {
    if (n[2] > 0.9) return roles.roof;
    if (n[2] < -0.9) return null;
    if (n[1] > 0.3) return roles.front;
    if (n[1] < -0.3) return roles.back ?? roles.wall;
    return roles.wall;
  });
}

/** A band of windows along both sides of a deckhouse whose walls stand at ±`x`. */
export function windowBand(id: string, x: number, y0: number, y1: number, z0: number, z1: number, role = 'glass'): Part[] {
  return ([1, -1] as const).map((s) => {
    const px = s * (x + LIFT);
    return decal(`${id}-${s < 0 ? 'l' : 'r'}`, [[px, y0, z0], [px, y1, z0], [px, y1, z1], [px, y0, z1]], role, [s, 0, 0]);
  });
}

/** A band across the front or back wall of a deckhouse standing at `y`, facing `sign`. */
export function endBand(id: string, y: number, sign: 1 | -1, x: number, z0: number, z1: number, role = 'glass'): Part {
  const py = y + sign * LIFT;
  return decal(id, [[-x, py, z0], [x, py, z0], [x, py, z1], [-x, py, z1]], role, [0, sign, 0]);
}

/**
 * A stripe along a hull's flat side (`sign` +1 its right, −1 its left) between
 * two y's and two heights — the livery's line. It follows the side's flare, so
 * it lies on the face and not through it, and it is kept aft of where the bow
 * starts to narrow at its own height, so it never crosses onto a bow face.
 */
export function hullStripe(id: string, h: HullShape, sign: 1 | -1, y0: number, y1: number, z0: number, z1: number, role: string): Part {
  const half = (z: number) => h.waterHalf + ((h.deckHalf - h.waterHalf) * z) / h.freeboard;
  const wT = waterTaper(h);
  const flatTo = (z: number) => wT + ((h.taper - wT) * z) / h.freeboard;
  const end = Math.min(y1, flatTo(z0), flatTo(z1));
  const at = (y: number, z: number): Vec3 => [h.cx + sign * (half(z) + LIFT), y, z];
  return decal(id, [at(y0, z0), at(end, z0), at(end, z1), at(y0, z1)], role, [sign, 0, 0]);
}

// --- a motor catamaran ----------------------------------------------------------

/**
 * The shape of a motor catamaran, in the numbers that tell two apart: its
 * hulls, the bridge deck across them, the saloon on it, the upper deck on the
 * saloon running aft over the rear deck on posts, and the wheelhouse on top.
 */
export interface CatamaranShape {
  hull: Omit<HullShape, 'cx'> & { offset: number };
  /** The bridge deck: where it ends fore and how thick it is. */
  bridge: { fore: number; depth: number };
  /** The saloon: half its width, its two ends, its height and the rake of its windscreen. */
  saloon: { x: number; aft: number; fore: number; height: number; rake: number; windows: [number, number] };
  /** The upper deck: how far aft it reaches over the rear deck. */
  upper: { aft: number; thick: number };
  /** The wheelhouse on the upper deck, and whether it is glass all round (a panorama) or a house with windows. */
  wheelhouse: { x: number; aft: number; fore: number; height: number; rake: number; panoramic: boolean };
  /** The livery's band along each hull, between two heights. */
  stripe: [number, number];
  /** A shade roof over the upper deck aft of the wheelhouse, on four posts — a day boat's; a whale-watcher keeps its deck open to the sky. */
  canopy?: { height: number };
}

/**
 * A motor catamaran from its shape. The bridge deck is cut where the saloon
 * begins and ends, the upper deck where the saloon's back is, so no deck face
 * runs the boat's length over whatever stands under it — the lesson of the
 * cars' long bonnet. Walls pressed against another part are not built.
 */
export function buildCatamaran(c: CatamaranShape): Part[] {
  const parts: Part[] = [];
  const { hull, bridge, saloon, upper, wheelhouse } = c;
  const outer = hull.offset + hull.deckHalf;
  const deckTop = hull.freeboard + bridge.depth;
  const shapes: HullShape[] = [-1, 1].map((s) => ({ ...hull, cx: s * hull.offset }));
  shapes.forEach((h, i) => parts.push(...demihullParts(`hull-${i ? 'r' : 'l'}`, h, bridge.fore)));

  // The bridge deck, in three: the rear deck, under the saloon, the bow deck.
  const z0 = hull.freeboard;
  parts.push(slab('bridge-aft', -outer, outer, hull.stern, saloon.aft, z0, deckTop, 'body', { top: 'deck', open: { front: true } }));
  parts.push(slab('bridge-mid', -outer, outer, saloon.aft, saloon.fore, z0, deckTop, 'body', { top: 'deck', open: { front: true, back: true } }));
  parts.push(slab('bridge-fore', -outer, outer, saloon.fore, bridge.fore, z0, deckTop, 'body', { top: 'deck', open: { back: true } }));

  // The saloon; its roof is under the upper deck, so it is not built.
  const roofZ = deckTop + saloon.height;
  const saloonFront = saloon.fore - saloon.rake;
  parts.push(
    cabinPart(
      'saloon',
      { x: saloon.x, y0: saloon.aft, y1: saloon.fore, z0: deckTop, z1: roofZ, rake: saloon.rake },
      { wall: 'cabin', roof: null, front: 'glass' },
    ),
  );
  parts.push(...windowBand('saloon-windows', saloon.x, saloon.windows[0], saloon.windows[1], deckTop + 0.55, roofZ - 0.4));
  parts.push(endBand('saloon-doors', saloon.aft, -1, Math.min(1.4, saloon.x * 0.4), deckTop + 0.1, roofZ - 0.45));

  // The upper deck: over the saloon, and on over the rear deck on two posts.
  // It stops where its balustrade starts rather than running under it: a
  // strip of deck under a wall is deck BEHIND the wall's inner face, and the
  // paint order's repair, finding it there, dragged the whole aft deck back
  // under the saloon (it kept 18% of itself). Its walls against the
  // balustrade are pressed, so they are not built.
  const t = 0.06;
  const upperTop = roofZ + upper.thick;
  const deckX = saloon.x - t;
  const enclosed = { left: true, right: true };
  parts.push(slab('upper-fore', -deckX, deckX, saloon.aft, saloonFront, roofZ, upperTop, 'cabin', { top: 'deckUpper', open: { ...enclosed, back: true } }));
  parts.push(slab('upper-aft', -deckX, deckX, upper.aft + t, saloon.aft, roofZ, upperTop, 'cabin', { top: 'deckUpper', open: { ...enclosed, front: true, back: true } }));
  for (const s of [-1, 1] as const) {
    const x = s * (saloon.x - 0.3);
    parts.push(slab(`post-${s < 0 ? 'l' : 'r'}`, x - 0.08, x + 0.08, upper.aft + 0.2, upper.aft + 0.36, deckTop, roofZ, 'cabin', { top: null }));
  }

  // Bulwarks round the rear deck and the bow deck; a balustrade round the upper
  // deck. Each stands FLUSH on its deck's edge: a wall set a few centimetres
  // in leaves a sliver of deck behind it, and the repair of the paint order,
  // finding the deck behind the wall there, moved the whole deck back under
  // the saloon (the aft upper deck kept 18% of itself). Where two meet, the
  // side one stops short of the cross one: two walls sharing a corner's volume
  // have no right order at all.
  const rim = outer - t / 2;
  const gate = 1.3;
  const clear = t + 0.02;
  const balX = saloon.x - t / 2;
  const balHeight = upper.thick + 0.95;
  for (const s of [-1, 1] as const) {
    const side = s < 0 ? 'l' : 'r';
    parts.push(...wallRun(`bulwark-aft-${side}`, s * rim, [hull.stern + clear, (hull.stern + saloon.aft) / 2, saloon.aft - 0.1], deckTop, 0.9, 'rail', t));
    parts.push(wall(`bulwark-stern-${side}`, [s * rim, hull.stern + t / 2], [s * gate, hull.stern + t / 2], deckTop, 0.9, 'rail', t));
    parts.push(wall(`bulwark-bow-${side}`, [s * rim, saloon.fore + 0.1], [s * rim, bridge.fore - clear], deckTop, 0.9, 'rail', t));
    parts.push(...wallRun(`balustrade-${side}`, s * balX, [upper.aft + t, saloon.aft, wheelhouse.aft, saloonFront], roofZ, balHeight, 'rail', t));
  }
  parts.push(wall('bulwark-bow', [-outer, bridge.fore - t / 2], [outer, bridge.fore - t / 2], deckTop, 0.9, 'rail', t));
  parts.push(wall('balustrade-aft', [-saloon.x, upper.aft + t / 2], [saloon.x, upper.aft + t / 2], roofZ, balHeight, 'rail', t));

  // The wheelhouse, and the mast and radar on its roof.
  const whTop = upperTop + wheelhouse.height;
  parts.push(
    cabinPart(
      'wheelhouse',
      { x: wheelhouse.x, y0: wheelhouse.aft, y1: wheelhouse.fore, z0: upperTop, z1: whTop, rake: wheelhouse.rake },
      wheelhouse.panoramic
        ? { wall: 'glassDark', roof: 'roof', front: 'glassDark', back: 'cabin' }
        : { wall: 'cabin', roof: 'roof', front: 'glassDark' },
    ),
  );
  if (!wheelhouse.panoramic) {
    parts.push(...windowBand('wheelhouse-windows', wheelhouse.x, wheelhouse.aft + 0.3, wheelhouse.fore - wheelhouse.rake - 0.2, upperTop + wheelhouse.height * 0.4, whTop - 0.25, 'glassDark'));
  }
  const mastY = wheelhouse.aft + 0.5;
  parts.push(slab('mast', -0.12, 0.12, mastY - 0.12, mastY + 0.12, whTop, whTop + 1.1, 'mast', { top: null }));
  parts.push(slab('radar', -0.8, 0.8, mastY - 0.18, mastY + 0.18, whTop + 1.1, whTop + 1.25, 'mast'));

  // The shade roof and its four posts, standing inside the balustrade.
  if (c.canopy) {
    const cx = saloon.x - 0.35;
    const y0 = upper.aft + 0.4;
    const y1 = wheelhouse.aft - 0.3;
    const top = upperTop + c.canopy.height;
    // In two, cut where the deck under it is cut: one roof the length of the
    // deck is keyed by its far end, and the deck under its near end, rightly
    // moved behind it, was dragged behind the saloon's doors too.
    const cut = Math.min(Math.max(saloon.aft, y0), y1);
    parts.push(slab('canopy-aft', -cx - 0.2, cx + 0.2, y0 - 0.2, cut, top, top + 0.12, 'canopy', { bottom: true, open: { front: true } }));
    parts.push(slab('canopy-fore', -cx - 0.2, cx + 0.2, cut, y1, top, top + 0.12, 'canopy', { bottom: true, open: { back: true } }));
    for (const [tag, x, y] of [
      ['al', -cx, y0],
      ['ar', cx, y0],
      ['fl', -cx, y1 - 0.2],
      ['fr', cx, y1 - 0.2],
    ] as const) {
      parts.push(slab(`canopy-post-${tag}`, x - 0.06, x + 0.06, y - 0.06, y + 0.06, upperTop, top, 'rail', { top: null }));
    }
  }

  // The livery's band along the outside of each hull.
  shapes.forEach((h, i) => {
    const sign = i ? 1 : -1;
    parts.push(hullStripe(`stripe-${i ? 'r' : 'l'}`, h, sign, h.stern + 0.2, h.taper, c.stripe[0], c.stripe[1], 'stripe'));
  });
  return parts;
}
