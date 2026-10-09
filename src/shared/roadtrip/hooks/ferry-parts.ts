/**
 * A ro-pax ferry — a ship that carries cars and their passengers — for the
 * ferry models over `mesh3d.ts`: the Spirit of Tasmania across Bass Strait,
 * the Mediterranean ferry between France, Spain and Morocco.
 *
 * The boats' rules hold (`boat-parts.ts`): every part CONVEX, no face buried
 * against a neighbour, a decal inside the one face it is pushed off. A ship
 * is long, so everything long is cut where a real one changes: the hull into
 * slices (`hullSlices`), the superstructure into blocks whose roofs are built
 * only where nothing stands on them. The superstructure is as wide as the
 * hull — a ferry's sides run up from the water to the bridge — so its walls
 * continue the hull's and no strip of deck lies behind them.
 *
 * Units are metres, the waterline at z = 0, the bow toward +y, x to the right.
 * A ship is drawn bigger than a car on the map (`CarModel.mapScale`), not at
 * its true size: forty Prados long, it would leave the car a speck.
 *
 * Pure and DOM-free.
 */

import { LIFT, endBand, hullSlices, hullStripe, slab, wall, windowBand, type HullShape } from './boat-parts';
import { decal, hullSolid, type Part, type Vec3 } from './mesh3d';

export interface RopaxShape {
  hull: Omit<HullShape, 'cx'>;
  /** Where the superstructure's three tiers start aft — the lowest first — and where the two lower ones end fore. */
  tiersAft: readonly [number, number, number];
  front: number;
  /** Each tier's height; the first stands on the hull's deck. */
  heights: readonly [number, number, number];
  /** Extra cuts across the hull and the lowest tier inside the superstructure's span. */
  cuts: readonly number[];
  /** How far the bridge wings reach past the beam. */
  wings: number;
  /** The funnels: one on the centre line or two side by side, their span fore and aft, half a funnel's width, their height and how far they lean aft. */
  funnels: { count: 1 | 2; aft: number; fore: number; half: number; height: number; lean: number };
  /** The lifeboats along the middle tier: how many a side, and the span they hang in. */
  lifeboats: { count: number; aft: number; fore: number };
  /** The livery's band along the hull, between two heights. */
  stripe: readonly [number, number];
}

/** A box leaning aft — a funnel: its top slid `lean` toward the stern. */
function leanBox(id: string, cx: number, half: number, y0: number, y1: number, z0: number, z1: number, lean: number, top: string | null, side: string): Part {
  const pts: Vec3[] = [];
  for (const x of [cx - half, cx + half]) {
    pts.push([x, y0, z0], [x, y1, z0], [x, y0 - lean, z1], [x, y1 - lean, z1]);
  }
  return hullSolid(id, pts, (n) => (n[2] > 0.9 ? top : n[2] < -0.9 ? null : side));
}

/**
 * The ferry from its shape. Roles: `body` the hull (the author's colour),
 * `deck`, `cabin` the superstructure, `roof`, `glass`/`glassDark`, `stripe`,
 * `funnel`, `funnelBand`, `funnelTop`, `lifeboat`, `door`, `mast`, `winch`, `rail`.
 */
export function buildRopax(s: RopaxShape): Part[] {
  const parts: Part[] = [];
  const h: HullShape = { ...s.hull, cx: 0 };
  const half = h.deckHalf;
  const [aftA, aftB, aftC] = s.tiersAft;
  const [hA, hB, hC] = s.heights;
  const zA = h.freeboard;
  const zB = zA + hA;
  const zC = zB + hB;
  const zTop = zC + hC;

  // The hull, in slices: the aft mooring deck, the slices under the
  // superstructure (no deck: it is buried), the foredeck to the bow.
  const hullCuts = [aftA, ...s.cuts, s.front];
  parts.push(...hullSlices('hull', h, hullCuts, (i) => i > 0 && i < hullCuts.length));
  const ends = [h.stern, ...hullCuts, h.bow];
  for (let i = 0; i < ends.length - 1; i++) {
    for (const sign of [-1, 1] as const) {
      parts.push(hullStripe(`stripe-${i}-${sign < 0 ? 'l' : 'r'}`, h, sign, ends[i] + 0.3, ends[i + 1] - 0.3, s.stripe[0], s.stripe[1], 'stripe'));
    }
  }
  // The stern door, on the transom, where the cars go in.
  const doorHalf = half * 0.7;
  parts.push(decal('stern-door', [[-doorHalf, h.stern - LIFT, 1.2], [doorHalf, h.stern - LIFT, 1.2], [doorHalf, h.stern - LIFT, Math.min(zA - 1.5, 8)], [-doorHalf, h.stern - LIFT, Math.min(zA - 1.5, 8)]], 'door', [0, -1, 0]));

  // The mooring decks: a winch either side aft and forward, a foremast, a
  // rail along the stern — what the ship shows from astern and from ahead,
  // where its sides are edge-on. The rail stands FLUSH on the deck's edge
  // (the boats' rule: a wall set in leaves deck behind it).
  const winch = (id: string, cx: number, y: number) => slab(id, cx - 1.1, cx + 1.1, y - 1.3, y + 1.3, zA, zA + 1.6, 'winch');
  for (const sign of [-1, 1] as const) {
    const side = sign < 0 ? 'l' : 'r';
    parts.push(winch(`winch-aft-${side}`, sign * half * 0.45, h.stern + (aftA - h.stern) * 0.45));
    parts.push(winch(`winch-fore-${side}`, sign * half * 0.3, s.front + 9));
  }
  const mastAt = s.front + (h.taper - s.front) * 0.5 + 6;
  parts.push(slab('foremast', -0.4, 0.4, mastAt - 0.4, mastAt + 0.4, zA, zA + 9, 'mast', { top: null }));
  parts.push(wall('rail-stern', [-half, h.stern + 0.125], [half, h.stern + 0.125], zA, 1.2, 'rail', 0.25));

  // The lowest tier: its roof is the aft terrace up to where the middle tier
  // starts, then buried. It is cut where the hull is and where the middle tier
  // starts, so its blocks line up with what stands on them.
  const aEnds = [...new Set([aftA, aftB, ...s.cuts, s.front])].sort((a, b) => a - b);
  for (let i = 0; i < aEnds.length - 1; i++) {
    const y0 = aEnds[i];
    const y1 = aEnds[i + 1];
    const roofed = y1 <= aftB;
    parts.push(slab(`tier-a-${i}`, -half, half, y0, y1, zA, zB, 'cabin', { top: roofed ? 'roof' : null, open: { back: i > 0, front: i < aEnds.length - 2 } }));
    for (const [k, z0, z1] of [
      [0, zA + hA * 0.16, zA + hA * 0.36],
      [1, zA + hA * 0.56, zA + hA * 0.76],
    ] as const) {
      if (y1 - y0 > 3) parts.push(...windowBand(`windows-a-${i}-${k}`, half, y0 + 1, y1 - 1, z0, z1));
    }
  }
  parts.push(endBand('windows-a-front', s.front, 1, half - 1.5, zA + hA * 0.56, zA + hA * 0.8));
  parts.push(endBand('windows-a-aft', aftA, -1, half - 2, zA + hA * 0.3, zA + hA * 0.7));

  // The middle tier: roofed aft of the bridge, buried under it fore. Cut at
  // the funnels' fore end, so the funnels stand on a short roof of their own.
  const bEnds = [aftB, s.funnels.fore + 2, aftC, s.front];
  for (let i = 0; i < bEnds.length - 1; i++) {
    const y0 = bEnds[i];
    const y1 = bEnds[i + 1];
    parts.push(slab(`tier-b-${i}`, -half, half, y0, y1, zB, zC, 'cabin', { top: y1 <= aftC ? 'roof' : null, open: { back: i > 0, front: i < bEnds.length - 2 } }));
    parts.push(...windowBand(`windows-b-${i}`, half, y0 + 1, y1 - 1, zB + hB * 0.55, zB + hB * 0.82));
  }
  parts.push(endBand('windows-b-front', s.front, 1, half - 1.5, zB + hB * 0.45, zB + hB * 0.8));
  parts.push(endBand('windows-b-aft', aftB, -1, half - 2, zB + hB * 0.35, zB + hB * 0.75));

  // The lifeboats, an orange row along the middle tier — what tells a ship
  // from a block of flats at map size. Each sits inside the one block it hangs on.
  const { count, aft, fore } = s.lifeboats;
  const pitch = (fore - aft) / count;
  for (let i = 0; i < count; i++) {
    const y0 = aft + i * pitch + pitch * 0.12;
    const y1 = aft + (i + 1) * pitch - pitch * 0.12;
    const host = bEnds.findIndex((e, k) => k < bEnds.length - 1 && y0 >= e + 0.3 && y1 <= bEnds[k + 1] - 0.3);
    if (host < 0) continue;
    parts.push(...windowBand(`lifeboat-${i}`, half, y0, y1, zB + hB * 0.08, zB + hB * 0.42, 'lifeboat'));
  }

  // The bridge: the top tier, glass across its front, wings past the beam.
  // Its fore part is where the wings are, and the wings stand against it from
  // the tier's floor to its roof, so its side walls there are pressed and not
  // built — and the wings' undersides, over the water, are.
  const wingAft = s.front - Math.min(6, (s.front - aftC) * 0.4);
  parts.push(slab('bridge-aft', -half, half, aftC, wingAft, zC, zTop, 'cabin', { top: 'roof', open: { front: true } }));
  parts.push(slab('bridge-fore', -half, half, wingAft, s.front, zC, zTop, 'cabin', { top: 'roof', open: { back: true, left: true, right: true } }));
  parts.push(endBand('bridge-glass', s.front, 1, half - 0.6, zC + hC * 0.3, zC + hC * 0.82, 'glassDark'));
  parts.push(...windowBand('bridge-windows', half, aftC + 1, wingAft - 1, zC + hC * 0.35, zC + hC * 0.78));
  parts.push(endBand('bridge-aft-windows', aftC, -1, half - 3, zC + hC * 0.35, zC + hC * 0.75));
  for (const sign of [-1, 1] as const) {
    const [x0, x1] = sign < 0 ? [-half - s.wings, -half] : [half, half + s.wings];
    parts.push(slab(`wing-${sign < 0 ? 'l' : 'r'}`, x0, x1, wingAft, s.front, zC, zTop, 'cabin', { top: 'roof', bottom: true, open: sign < 0 ? { right: true } : { left: true } }));
  }
  // A mast and a radar on the bridge roof.
  const mastY = aftC + 3;
  parts.push(slab('mast', -0.4, 0.4, mastY - 0.4, mastY + 0.4, zTop, zTop + 6, 'mast', { top: null }));
  parts.push(slab('radar', -2.5, 2.5, mastY - 0.5, mastY + 0.5, zTop + 6, zTop + 6.6, 'mast'));

  // The funnels, on the middle tier's aft roof, leaning aft, each in three
  // bands — the funnel's colour, the livery's band, a black top.
  const f = s.funnels;
  const xs = f.count === 1 ? [0] : [-(f.half + 1.2), f.half + 1.2];
  xs.forEach((cx, i) => {
    const z1 = zC + f.height * 0.55;
    const z2 = zC + f.height * 0.78;
    const z3 = zC + f.height;
    const at = (z: number) => (f.lean * (z - zC)) / f.height;
    // A band's top is under the next band: not built.
    parts.push(leanBox(`funnel-${i}`, cx, f.half, f.aft, f.fore, zC, z1, at(z1), null, 'funnel'));
    parts.push(leanBox(`funnel-band-${i}`, cx, f.half, f.aft - at(z1), f.fore - at(z1), z1, z2, at(z2) - at(z1), null, 'funnelBand'));
    parts.push(leanBox(`funnel-top-${i}`, cx, f.half, f.aft - at(z2), f.fore - at(z2), z2, z3, at(z3) - at(z2), 'funnelTop', 'funnelTop'));
  });
  return parts;
}

/**
 * The ramps a ferry lowers while a vehicle drives on or off — drawn only then
 * (`CarModel.ramps`): the stern's, down from the car deck to the quay, and
 * the bow's, out past the stem. Thin plates, apart from the hull.
 */
export function ropaxRamps(s: RopaxShape): { stern: Part[]; bow: Part[] } {
  const half = s.hull.deckHalf * 0.7 - 0.4;
  const plate = (id: string, yNear: number, yFar: number, zNear: number): Part => {
    const pts: Vec3[] = [];
    for (const x of [-half, half]) {
      pts.push([x, yNear, zNear], [x, yNear, zNear + 0.5], [x, yFar, 0.15], [x, yFar, 0.55]);
    }
    return hullSolid(id, pts, (n) => (n[2] < -0.5 ? null : 'ramp'));
  };
  // The stem rakes from the forefoot at the water to the bow at the deck: the
  // bow ramp starts just ahead of it, at its own height, so it never enters the hull.
  const zBow = 2.2;
  const stem = s.hull.forefoot + ((s.hull.bow - s.hull.forefoot) * (zBow + 0.5)) / s.hull.freeboard;
  return {
    stern: [plate('ramp-stern', s.hull.stern - 0.05, s.hull.stern - 18, 1.6)],
    bow: [plate('ramp-bow', stem + 0.3, stem + 18, zBow)],
  };
}
