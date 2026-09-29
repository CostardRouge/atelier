/**
 * The Viper — the jet boat out of Airlie Beach that runs to the OUTER reef
 * (Bait Reef) and Whitehaven in a day: an offshore performance monohull on
 * Rolls-Royce waterjets, the fastest boat in the Whitsundays, 36 guests each
 * belted into a seat. Drawn as that: a deep, flared hull with a pointed bow,
 * six rows of benches for three either side of an aisle, the helm console
 * with its screen ahead of them, a low bulwark round the deck, and the two
 * jet nozzles at the transom — no outboards.
 *
 * Metres: 14.5 long, 4.2 wide (neither published; the seats set the size).
 * The livery — a black hull with a red line — is a guess the author can
 * repaint. Pure and DOM-free.
 */

import { LIFT, cabinPart, hullPart, hullStripe, wall, type HullShape, type P2 } from './boat-parts';
import { cylinder, decal, hullSolid, type Part, type Vec3 } from './mesh3d';

export const VIPER_LENGTH = 14.5;
export const VIPER_WIDTH = 4.2;

const HULL: HullShape = { cx: 0, stern: -7, bow: 7.5, forefoot: 5.9, taper: 2.2, deckHalf: 2.1, waterHalf: 1.5, freeboard: 1.25 };

/** The rows of benches, aft to fore: where each seat's front edge is. */
const ROWS = [-5.9, -4.75, -3.6, -2.45, -1.3, -0.15];

/** The boat's colours by role; the hull's is the author's. */
export function viperPalette(hull: string): Record<string, string> {
  return {
    body: hull,
    deck: '#a6aaaf',
    rim: '#e5e6e3',
    seat: '#2a2c31',
    console: '#eeeeea',
    glass: '#2a3c4c',
    jet: '#6f737a',
    stripe: '#d0392d',
    hatch: '#8e9297',
  };
}

export function buildViper(): Part[] {
  const parts: Part[] = [];
  const deck = HULL.freeboard;
  parts.push(hullPart('hull', HULL));
  for (const s of [-1, 1] as const) parts.push(hullStripe(`stripe-${s < 0 ? 'l' : 'r'}`, HULL, s, HULL.stern + 0.2, 2, 0.78, 0.95, 'stripe'));

  // The bulwark: along each side, then in along the bow, and across the
  // transom — each run a wall of its own, FLUSH on the deck's edge (a wall set
  // in leaves deck behind it, which the paint order's repair then drags under
  // everything), stopping short of the next.
  const t = 0.06;
  const edge = HULL.deckHalf - t / 2;
  // The bow's edge runs from where the deck narrows to the stem; the wall
  // follows it half a thickness in, and stops short of the stem and the side.
  const bowRun = [HULL.bow - HULL.taper, -HULL.deckHalf] as const;
  const runLen = Math.hypot(bowRun[0], bowRun[1]);
  const along = (d: number, s: 1 | -1): [number, number] => {
    const k = d / runLen;
    // Half a thickness toward the centre line, square to the edge.
    const inX = (-bowRun[0] / runLen) * (t / 2);
    const inY = (bowRun[1] / runLen) * (t / 2);
    return [s * (HULL.deckHalf + bowRun[1] * k - inX), HULL.taper + bowRun[0] * k + inY];
  };
  for (const s of [-1, 1] as const) {
    const side = s < 0 ? 'l' : 'r';
    parts.push(wall(`rim-${side}`, [s * edge, HULL.stern + t + 0.02], [s * edge, HULL.taper - 0.1], deck, 0.35, 'rim', t));
    parts.push(wall(`rim-bow-${side}`, along(0.12, s), along(runLen - 0.45, s), deck, 0.35, 'rim', t));
  }
  parts.push(wall('rim-stern', [-HULL.deckHalf, HULL.stern + t / 2], [HULL.deckHalf, HULL.stern + t / 2], deck, 0.35, 'rim', t));

  // Six rows of benches, three a side. Each bench is ONE convex piece, its
  // profile running from the cushion's front edge up to the top of its back:
  // a seat and a backrest as two blocks sharing a face made the paint order
  // lay the seat over its own back from behind (2.8% of a view, the worst the
  // boat had).
  const profile: P2[] = [
    [-0.12, 0],
    [0.55, 0],
    [0.55, 0.42],
    [0.02, 0.95],
    [-0.12, 0.95],
  ];
  ROWS.forEach((y, row) => {
    for (const s of [-1, 1] as const) {
      const [x0, x1] = s < 0 ? [-1.8, -0.3] : [0.3, 1.8];
      const pts: Vec3[] = [];
      for (const x of [x0, x1]) for (const [dy, dz] of profile) pts.push([x, y + dy, deck + dz]);
      parts.push(hullSolid(`seat-${row}-${s < 0 ? 'l' : 'r'}`, pts, (n) => (n[2] < -0.9 ? null : 'seat')));
    }
  });

  // The helm console ahead of the benches, and its screen.
  parts.push(cabinPart('console', { x: 0.75, y0: 0.9, y1: 1.8, z0: deck, z1: deck + 1.1, rake: 0.35 }, { wall: 'console', roof: 'console', front: 'console' }));
  parts.push(wall('screen', [-0.7, 1.35], [0.7, 1.35], deck + 1.1, 0.35, 'glass', 0.05));

  // A hatch on the foredeck.
  const hz = deck + LIFT;
  parts.push(decal('hatch', [[-0.45, 3, hz], [0.45, 3, hz], [0.45, 3.8, hz], [-0.45, 3.8, hz]], 'hatch', [0, 0, 1]));

  // The two jet nozzles, just proud of the transom.
  for (const s of [-1, 1] as const) {
    parts.push(cylinder(`jet-${s < 0 ? 'l' : 'r'}`, [s * 0.75, HULL.stern - 0.18, 0.34], 'y', 0.22, 0.18, 10, { side: 'jet', cap: 'jet' }, true, false));
  }
  return parts;
}
