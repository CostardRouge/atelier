/**
 * The Solar Whisper — the electric boat that takes you up the Daintree River
 * to the crocodiles, silently: the only zero-emission boat on the river, a
 * 9 m fibreglass "Goodwin" longboat, long and narrow so its electric
 * outboards push it efficiently, solar panels on its roof charging its
 * batteries, the seats along both edges so every guest (24 at most) has a
 * window, and a "croc cam" to show the ones hiding in the mangroves.
 *
 * Drawn as that: a long narrow hull, a bench along each gunwale in bays
 * between the roof posts — backs to the water, faces to the middle, every
 * bench FLUSH on the edge so no deck lies behind it (`boat-parts.ts`) — a
 * flat roof tiled with panels, cut into three between its posts as a long
 * deck is, the croc cam's screen hanging under the roof's front edge, the
 * skipper's console at the stern and two slim electric outboards on the
 * transom. It leaves the faintest of wakes: it glides.
 *
 * Metres: 9 long, 2.6 wide, the roof no wider than the deck. The beam, the motors' number and the
 * livery — a white hull with a rainforest-green line, a white roof — are
 * guesses the author can repaint; the operator's pages say none of them.
 * Pure and DOM-free.
 */

import { LIFT, hullPart, hullStripe, slab, type HullShape, type P2 } from './boat-parts';
import { decal, hullSolid, type Part, type Vec3 } from './mesh3d';

export const WHISPER_LENGTH = 9;
export const WHISPER_WIDTH = 2.6;

const HULL: HullShape = { cx: 0, stern: -4.5, bow: 4.5, forefoot: 3.9, taper: 2.4, deckHalf: 1.3, waterHalf: 1.08, freeboard: 0.8 };

/**
 * Where the roof's posts stand along each side; the benches fill the bays
 * between. The foremost stays aft of where the bow narrows, or it would stand
 * off the deck's edge.
 */
const POSTS = [-3.3, -1.4, 0.5, 2.3];
const POST = 0.12;
/**
 * The roof sits FLUSH on its corner posts — no overhang past them. An
 * overhanging roof covers the top of the post under it, the paint order's
 * repair rightly moves the post behind the roof there, and in doing so lays
 * it under the bench beside it (the aft post kept 44% of itself).
 */
const ROOF = { aft: POSTS[0] - POST / 2, fore: POSTS[3] + POST / 2, half: HULL.deckHalf, bottom: 2.75, top: 2.85 };

/** The boat's colours by role; the hull's is the author's. */
export function whisperPalette(hull: string): Record<string, string> {
  return {
    body: hull,
    deck: '#b8b3a5',
    bench: '#a2744a',
    post: '#ecece8',
    roof: '#f1f1ee',
    solar: '#1c2f4f',
    screen: '#101317',
    console: '#e9e9e5',
    motor: '#2a2c30',
    stripe: '#2e7a4d',
  };
}

export function buildSolarWhisper(): Part[] {
  const parts: Part[] = [];
  const deck = HULL.freeboard;
  parts.push(hullPart('hull', HULL));
  for (const s of [-1, 1] as const) parts.push(hullStripe(`stripe-${s < 0 ? 'l' : 'r'}`, HULL, s, HULL.stern + 0.15, HULL.taper, 0.38, 0.55, 'stripe'));

  // The posts, flush on each gunwale, and the benches in the bays between —
  // each bench one convex piece from its seat to its back, the back on the
  // edge, a hair short of the posts either end so no two share a face.
  const edge = HULL.deckHalf;
  const bench: P2[] = [
    [edge - 0.5, 0],
    [edge, 0],
    [edge, 0.9],
    [edge - 0.12, 0.9],
    [edge - 0.5, 0.45],
  ];
  for (const s of [-1, 1] as const) {
    const side = s < 0 ? 'l' : 'r';
    POSTS.forEach((y, i) => {
      const [x0, x1] = s < 0 ? [-edge, -edge + POST] : [edge - POST, edge];
      parts.push(slab(`post-${side}-${i}`, x0, x1, y - POST / 2, y + POST / 2, deck, ROOF.bottom, 'post', { top: null }));
    });
    POSTS.slice(1).forEach((y, i) => {
      const y0 = POSTS[i] + POST / 2 + 0.02;
      const y1 = y - POST / 2 - 0.02;
      const pts: Vec3[] = [];
      for (const yy of [y0, y1]) for (const [x, z] of bench) pts.push([s * x, yy, deck + z]);
      parts.push(hullSolid(`bench-${side}-${i}`, pts, (n) => (n[2] < -0.9 ? null : 'bench')));
    });
  }

  // The roof, cut into three where its middle posts stand, each piece tiled
  // with two columns of panels.
  const cuts = [ROOF.aft, POSTS[1], POSTS[2], ROOF.fore];
  cuts.slice(1).forEach((y1, i) => {
    const y0 = cuts[i];
    parts.push(
      slab(`roof-${i}`, -ROOF.half, ROOF.half, y0, y1, ROOF.bottom, ROOF.top, 'roof', {
        open: { back: i > 0, front: i < cuts.length - 2 },
      }),
    );
    const z = ROOF.top + LIFT;
    const rows = 2;
    const pitch = (y1 - y0 - 0.16) / rows;
    for (let r = 0; r < rows; r++) {
      const ya = y0 + 0.08 + r * pitch + 0.03;
      const yb = ya + pitch - 0.06;
      for (const [c, xa, xb] of [
        [0, -ROOF.half + 0.1, -0.04],
        [1, 0.04, ROOF.half - 0.1],
      ] as const) {
        parts.push(decal(`solar-${i}-${r}-${c}`, [[xa, ya, z], [xb, ya, z], [xb, yb, z], [xa, yb, z]], 'solar', [0, 0, 1]));
      }
    }
  });

  // The croc cam's screen, hanging under the roof's front edge, facing aft.
  parts.push(slab('croc-cam', -0.32, 0.32, ROOF.fore - 0.3, ROOF.fore - 0.24, ROOF.bottom - 0.4, ROOF.bottom, 'screen', { top: null }));

  // The skipper's console at the stern.
  parts.push(slab('console', -0.35, 0.35, HULL.stern + 0.25, HULL.stern + 0.7, deck, deck + 1.05, 'console'));

  // Two slim electric outboards on the transom: a leg into the water, a
  // cowling on top.
  for (const s of [-1, 1] as const) {
    const side = s < 0 ? 'l' : 'r';
    const x = s * 0.55;
    parts.push(slab(`outboard-${side}-leg`, x - 0.05, x + 0.05, HULL.stern - 0.2, HULL.stern - 0.1, 0.08, 0.7, 'motor', { top: null }));
    parts.push(slab(`outboard-${side}`, x - 0.16, x + 0.16, HULL.stern - 0.3, HULL.stern - 0.02, 0.7, 1.15, 'motor'));
  }
  return parts;
}
