/**
 * The third car — a cartoon Renault Trafic of the third generation's facelift
 * (2019–2021), the maintainer's white panel van with a solar panel on its
 * roof, as parts for `mesh3d.ts`, built from `car-parts.ts` in the Kadjar's
 * idiom and drawn by the same renderer.
 *
 * A van, and the drawing says so where the Kadjar's is a crossover: a short
 * high bonnet rising to a raked windscreen, one tall flat flank from the sill
 * to the roof with a swage at the belt, no window behind the cab (a panel
 * van), a long flat roof ribbed where it is cut, square rear corners and barn
 * doors at the back. Its trade marks are decals: the wide headlamps wrapping
 * the nose, the C of the daytime lights, three chrome strakes across the
 * grille and the diamond in it, tall tail lamps standing in the rear pillars,
 * steel wheels under plastic caps. The gear is the roof's solar panel (on by
 * default — it is why this van is here: a 430 W module, the owner's word)
 * and the big door mirrors.
 *
 * The rules are the Kadjar's (`roadtrip.md`): every part CONVEX, the hull a
 * stack of slices cut where a van has a shut line (the bonnet's edges, the
 * wings' ends, the cab's back, the sliding door's rear edge), a face buried
 * against its neighbour not built, an arch an ABSENCE, a decal inside the one
 * face it is pushed off and cut at the hull's cuts. What a van adds: above the
 * belt the flanks LEAN IN, which `prism` cannot say (its walls are vertical),
 * so the three upper slices are built by hand on a RECTANGULAR plan — a wall
 * scaled in x stays flat only where its two ends share an x or a y, which is
 * why the tail corners are square and only the nose is rounded.
 *
 * Model units are about metres: 5.4 long, 1.96 wide, 1.97 to the roof as
 * Renault gives the L2H1 — the long one, the owner's word —, a 3.50
 * wheelbase; wheels a size up as a toy has them. Everything about the cab is
 * placed from the NOSE, so the length is in the wheelbase and the sliding
 * door alone. The ground at z = 0, the nose toward +y, x to the right. Colours are
 * ROLES, resolved through `traficPalette`; the body colour is the author's.
 *
 * Pure and DOM-free.
 */

import { defaultVehicleSpec, effectiveGear, type VehicleGear } from '../vehicle-spec';
import { arc, at, box2, cappedRim, level, makeBody, meet, roadWheel, through, type P2 } from './car-parts';
import { decal, prism, solid, type Face, type Part, type Vec3 } from './mesh3d';

/** The van's footprint, for its shadow and its scale on the map. */
export const TRAFIC_LENGTH = 5.4;
export const TRAFIC_WIDTH = 1.96;
export const TRAFIC_WHEEL_RADIUS = 0.37;

/** The van's colours by role, given the author's body colour. */
export function traficPalette(bodyColor: string): Record<string, string> {
  return {
    body: bodyColor,
    roof: bodyColor,
    cladding: '#2b2c2f',
    glass: '#2f4155',
    trim: '#141518',
    tyre: '#1b1b1c',
    tread: '#262628',
    rim: '#c9ccd0',
    rimDark: '#45484e',
    light: '#f1eee2',
    drl: '#fffdf2',
    lamp: '#f4f1e0',
    tail: '#b8261c',
    chrome: '#d6d9dd',
    grille: '#1a1b1e',
    solar: '#1b2a44',
    solarFrame: '#8d9196',
  };
}

const HALF_LENGTH = TRAFIC_LENGTH / 2;
const HALF_WIDTH = TRAFIC_WIDTH / 2;

/** The heights the hull is cut at: the bumpers' black band, the painted body, the line clear of the wheels, the belt. */
const Z = {
  cladBottom: 0.26,
  bottom: 0.44,
  /** Above this the body runs its full length, clear of the wheels' tops (2 × 0.37). */
  shoulder: 0.82,
  /** The swage along the flanks, where the windscreen's base is too. */
  belt: 1.12,
  roof: 1.96,
};

/** The axles — the L2's 3.50 m wheelbase, the overhangs about equal. */
const AXLE = { front: HALF_LENGTH - 0.93, rear: HALF_LENGTH - 0.93 - 3.5 };
const ARCH_HALF = 0.42;
/** A tyre's inner face clears the sill; its outer stands a hair proud of the flank (the Kadjar's rule). */
const WHEEL = { x: HALF_WIDTH - 0.125 + 0.005, half: 0.125 };
const WHEEL_SPEC = { radius: TRAFIC_WHEEL_RADIUS, half: WHEEL.half, facets: 14 };
const SILL_HALF_WIDTH = 0.7;

/** Where the windscreen meets the bonnet, 1.2 m behind the nose. */
const SCREEN = { front: HALF_LENGTH - 1.2 };
/**
 * The other shut lines: the bonnet's edge along each wing, the wing's end at
 * the headlamp, the cab's back (the B pillar, the sliding door's front edge)
 * and the sliding door's rear edge, at the rear arch.
 */
const SHUT = { bonnet: 0.72, wing: HALF_LENGTH - 0.3, cab: SCREEN.front - 1.2, door: AXLE.rear + ARCH_HALF };
/** The bonnet, short and high, falling a little toward the nose. */
const BONNET = through(SCREEN.front, Z.belt, HALF_LENGTH, 1.0);
/** The roof's front edge, where the windscreen ends. */
const ROOF_FRONT = SCREEN.front - 0.75;

/**
 * The plan's right-hand edge, rear to nose: the tail square (see the file's
 * note on leaning walls), the nose's corners rounded in three facets.
 */
const NOSE_ROUND = 0.3;
const OUTLINE: P2[] = [[HALF_WIDTH, -HALF_LENGTH], ...arc(HALF_WIDTH - NOSE_ROUND, HALF_LENGTH - NOSE_ROUND, NOSE_ROUND, 0, 90, 3)];

const CUTS = [Z.bottom, Z.shoulder, Z.belt];
const BODY = makeBody({ halfLength: HALF_LENGTH, halfWidth: HALF_WIDTH, outline: OUTLINE, cuts: CUTS });
const { hull, wallDecal, acrossFace, sideDecal, diamond } = BODY;

// --- the upper body ---------------------------------------------------------------

/** Above the belt the flanks lean in, 6 cm by the roof. */
const LEAN = 0.06 / (Z.roof - Z.belt);
/** The flank's distance from the centre at height z. */
const sideX = (z: number) => (z <= Z.belt ? HALF_WIDTH : HALF_WIDTH - LEAN * (z - Z.belt));
const onSide = (sign: 1 | -1, [y, z]: P2): Vec3 => [sign * sideX(z), y, z];
/** A face spanning the van between two (y, z) points of the flank. */
const across = (a: P2, b: P2, role: string): Face => ({
  role,
  verts: [onSide(1, a), onSide(-1, a), onSide(-1, b), onSide(1, b)],
});

/**
 * One slice of the body behind the cab, from the shoulder to the roof: on each
 * flank a vertical panel to the belt and a leaning one above it, a roof, and
 * an end face only where the slice is not pressed against the next one.
 */
function bodySlice(id: string, y0: number, y1: number, ends: { front?: boolean; rear?: boolean }): Part {
  const faces: Face[] = [];
  for (const sign of [1, -1] as const) {
    const tile = (zA: number, zB: number): Face => ({
      role: 'body',
      verts: [onSide(sign, [y1, zA]), onSide(sign, [y0, zA]), onSide(sign, [y0, zB]), onSide(sign, [y1, zB])],
    });
    faces.push(tile(Z.shoulder, Z.belt), tile(Z.belt, Z.roof));
  }
  faces.push(across([y1, Z.roof], [y0, Z.roof], 'roof'));
  for (const [on, y] of [
    [ends.front, y1],
    [ends.rear, y0],
  ] as const) {
    if (!on) continue;
    faces.push(across([y, Z.shoulder], [y, Z.belt], 'body'), across([y, Z.belt], [y, Z.roof], 'body'));
  }
  return solid(id, faces);
}

/** The top of the door glass, a strip of body under the roof. */
const WINDOW_TOP = level(Z.roof - 0.09);
/** The windscreen's direction in (y, z), which the A pillar follows. */
const SCREEN_DIR: P2 = [ROOF_FRONT - SCREEN.front, Z.roof - Z.belt];

/**
 * The cab, from the shoulder to the roof: a body panel under the belt, and
 * over it the A pillar along the windscreen, the door glass, the black B
 * pillar and the strip under the roof; the windscreen and the roof across.
 * Its front under the belt is pressed against the bonnet and its back against
 * the sliding door's slice, so neither is built.
 */
function cab(): Part {
  const wsBase: P2 = [SCREEN.front, Z.belt];
  const roofFront: P2 = [ROOF_FRONT, Z.roof];
  const aRearBase: P2 = [SCREEN.front - 0.16, Z.belt];
  const aFrontTop = meet(wsBase, SCREEN_DIR, WINDOW_TOP);
  const aRearTop = meet(aRearBase, SCREEN_DIR, WINDOW_TOP);
  const bPillar = SHUT.cab + 0.14;
  const faces: Face[] = [];
  for (const sign of [1, -1] as const) {
    const tiles: { role: string; points: P2[] }[] = [
      { role: 'body', points: [[SCREEN.front, Z.shoulder], [SHUT.cab, Z.shoulder], [SHUT.cab, Z.belt], wsBase] },
      { role: 'body', points: [wsBase, aRearBase, aRearTop, aFrontTop] },
      { role: 'glass', points: [aRearBase, [bPillar, Z.belt], [bPillar, WINDOW_TOP.z], aRearTop] },
      { role: 'trim', points: [[bPillar, Z.belt], [SHUT.cab, Z.belt], [SHUT.cab, WINDOW_TOP.z], [bPillar, WINDOW_TOP.z]] },
      { role: 'body', points: [aFrontTop, roofFront, [SHUT.cab, Z.roof], [SHUT.cab, WINDOW_TOP.z]] },
    ];
    for (const tile of tiles) faces.push({ role: tile.role, verts: tile.points.map((p) => onSide(sign, p)) });
  }
  faces.push(across(wsBase, roofFront, 'glass'));
  faces.push(across(roofFront, [SHUT.cab, Z.roof], 'roof'));
  return solid('cab', faces);
}

// --- decals ---------------------------------------------------------------------

/** The nose's flat face and the tail's, as plan edges on the right-hand side. */
const NOSE_FACE: [P2, P2] = [[0, HALF_LENGTH], [HALF_WIDTH - NOSE_ROUND, HALF_LENGTH]];
const TAIL_FACE: [P2, P2] = [[0, -HALF_LENGTH], [HALF_WIDTH, -HALF_LENGTH]];
const NOSE_FACETS: [P2, P2][] = [
  [OUTLINE[4], OUTLINE[3]],
  [OUTLINE[3], OUTLINE[2]],
];
const shareAt = (face: [P2, P2], x: number) => x / face[1][0];

function nose(): Part[] {
  const parts: Part[] = [];
  const [f1, f2] = NOSE_FACETS;
  // The headlamps, wide under the bonnet's edge, wrapping the rounded corner;
  // the first facet is shared by the bonnet and the corner beside it, so its
  // lamp is cut where the bonnet's edge crosses it.
  const edge = (SHUT.bonnet - f1[0][0]) / (f1[1][0] - f1[0][0]);
  parts.push(...wallDecal('headlight', 'light', ...NOSE_FACE, shareAt(NOSE_FACE, 0.42), 1, 0.78, 0.96));
  parts.push(...wallDecal('headlight-wrap', 'light', ...f1, 0, edge, 0.78, 0.96));
  parts.push(...wallDecal('headlight-wrap1', 'light', ...f1, edge, 1, 0.78, 0.96));
  parts.push(...wallDecal('headlight-wrap2', 'light', ...f2, 0, 0.7, 0.79, 0.95));
  // The C of the daytime lights: under the lamp, down the corner, back in.
  parts.push(...wallDecal('drl', 'drl', ...NOSE_FACE, shareAt(NOSE_FACE, 0.46), 1, 0.755, 0.775));
  parts.push(...wallDecal('drl-wrap', 'drl', ...f1, 0, 1, 0.755, 0.775));
  parts.push(...wallDecal('drl-wrap2', 'drl', ...f2, 0, 0.72, 0.755, 0.775));
  parts.push(...wallDecal('drl-down', 'drl', ...f2, 0.6, 0.72, 0.62, 0.755));
  parts.push(...wallDecal('drl-foot', 'drl', ...f2, 0.2, 0.72, 0.6, 0.62));
  // The grille between the lamps: three chrome strakes and the diamond.
  parts.push(...acrossFace('grille', 'grille', HALF_LENGTH, 0.4, 0.7, 0.96, 0.004));
  for (const [i, z] of [0.755, 0.83, 0.905].entries()) {
    parts.push(...acrossFace(`grille-bar-${i}`, 'chrome', HALF_LENGTH, 0.39, z, z + 0.022, 0.008));
  }
  parts.push(diamond('logo', HALF_LENGTH, 0.83, 0.095, 0.012));
  // The lower bumper: a wide dark intake under the number plate, fog lamps in its corners.
  parts.push(...acrossFace('intake', 'grille', HALF_LENGTH, 0.46, 0.47, 0.6, 0.004));
  parts.push(...acrossFace('plate', 'chrome', HALF_LENGTH, 0.26, 0.62, 0.68, 0.004));
  parts.push(...wallDecal('fog', 'lamp', ...f1, 0.25, 0.75, 0.5, 0.56));
  return parts;
}

/**
 * A decal on the tail face above the belt, where the face narrows with the
 * lean: a quad kept inside it by reading the flank at each of its heights.
 */
function tailDecal(id: string, role: string, x0: number, x1: number, z0: number, z1: number, lift = 0.004): Part[] {
  const y = -(HALF_LENGTH + lift);
  return ([1, -1] as const).map((sign) => {
    const xa = (z: number) => sign * Math.min(x0, sideX(z) - 0.02);
    const xb = (z: number) => sign * Math.min(x1, sideX(z) - 0.02);
    return decal(`${id}-${sign < 0 ? 'l' : 'r'}`, [[xa(z0), y, z0], [xb(z0), y, z0], [xb(z1), y, z1], [xa(z1), y, z1]], role, [0, -1, 0]);
  });
}

function tail(): Part[] {
  const parts: Part[] = [];
  // The tall tail lamps in the rear pillars, cut at the shoulder and the belt.
  parts.push(...wallDecal('taillight', 'tail', ...TAIL_FACE, shareAt(TAIL_FACE, 0.8), shareAt(TAIL_FACE, 0.95), 0.5, Z.belt));
  parts.push(...tailDecal('taillight-2', 'tail', 0.8, 0.95, Z.belt, 1.38));
  // The barn doors' gap, the handle on the right door, the diamond, the plate.
  parts.push(...acrossFace('door-gap', 'trim', -HALF_LENGTH, 0.008, 0.5, Z.roof - 0.06, 0.004));
  parts.push(decal('handle-rear', [[0.1, -(HALF_LENGTH + 0.006), 1.0], [0.24, -(HALF_LENGTH + 0.006), 1.0], [0.24, -(HALF_LENGTH + 0.006), 1.05], [0.1, -(HALF_LENGTH + 0.006), 1.05]], 'trim', [0, -1, 0]));
  parts.push(diamond('logo-rear', -HALF_LENGTH, 1.5, 0.075, 0.004));
  parts.push(...acrossFace('plate-rear', 'chrome', -HALF_LENGTH, 0.26, 0.62, 0.69, 0.004));
  parts.push(...wallDecal('reflector', 'tail', ...TAIL_FACE, shareAt(TAIL_FACE, 0.7), shareAt(TAIL_FACE, 0.92), 0.3, 0.34));
  return parts;
}

function sides(): Part[] {
  const belt = level(Z.belt);
  return [
    // The black handles under the belt: the cab door's, the sliding door's just behind its front edge.
    ...sideDecal('handle-front', 'trim', SCREEN.front - 0.95, SCREEN.front - 0.8, level(Z.belt - 0.13), level(Z.belt - 0.08)),
    ...sideDecal('handle-slide', 'trim', SHUT.cab - 0.2, SHUT.cab - 0.05, level(Z.belt - 0.13), level(Z.belt - 0.08)),
    // The sliding door's rail along the flank, under the belt, from the handle to the door's rear edge.
    ...sideDecal('slide-rail', 'trim', SHUT.door + 0.02, SHUT.cab - 0.25, level(Z.belt - 0.03), belt),
  ];
}

// --- wheels, mirrors, the roof -------------------------------------------------------

function mirrors(): Part[] {
  return ([1, -1] as const).map((sign) => {
    const x0 = sign * (HALF_WIDTH + 0.02);
    const x1 = sign * (HALF_WIDTH + 0.2);
    const y = SCREEN.front - 0.22;
    const plan: P2[] = [
      [x0, y - 0.12],
      [x1, y - 0.11],
      [x1, y],
      [x0, y + 0.02],
    ];
    return prism(`mirror-${sign < 0 ? 'l' : 'r'}`, plan, level(1.22), level(1.46), { side: 'trim', top: 'trim', bottom: 'trim' });
  });
}

/**
 * The solar panel: a frame standing on the roof's front half, the panel a
 * decal on its top. The frame crosses the roof's cut at the cab's back, and
 * a solid lying over two roof faces is keyed by its far end exactly as a
 * long bonnet is — with the nose toward the camera the cab's roof was laid
 * over the panel (it kept 79% of itself). So the frame is cut where the roof
 * is, each piece a solid over ONE roof face with the wall at the cut not
 * built, and the panel two decals meeting at the cut: the frame's ink runs
 * under them, so nothing shows.
 */
/** A 430 W module is about 1.72 × 1.13 m; it starts a hand behind the roof's front edge. */
const SOLAR = { x: 0.565, y0: ROOF_FRONT - 0.1 - 1.72, y1: ROOF_FRONT - 0.1, frame: 0.045, inset: 0.02 };

function solarPanel(): Part[] {
  const top = Z.roof + SOLAR.frame;
  const z = top + 0.004;
  const cuts = [SHUT.cab, SHUT.door].filter((y) => y > SOLAR.y0 + 1e-9 && y < SOLAR.y1 - 1e-9).sort((a, b) => b - a);
  const edges = [SOLAR.y1, ...cuts, SOLAR.y0];
  const parts: Part[] = [];
  edges.slice(1).forEach((y0, i) => {
    const y1 = edges[i];
    const tag = i ? `-${i}` : '';
    parts.push(
      prism(`solar-frame${tag}`, box2(-SOLAR.x, SOLAR.x, y0, y1), level(Z.roof), level(top), { side: 'solarFrame', top: 'solarFrame', bottom: null }, {
        open: (a, b) => a[1] === b[1] && cuts.includes(a[1]),
      }),
    );
    // Inset from the frame's own edges, flush where it meets the next piece.
    const ya = y0 + (cuts.includes(y0) ? 0 : SOLAR.inset);
    const yb = y1 - (cuts.includes(y1) ? 0 : SOLAR.inset);
    const xi = SOLAR.x - SOLAR.inset;
    parts.push(decal(`solar-panel${tag}`, [[-xi, ya, z], [xi, ya, z], [xi, yb, z], [-xi, yb, z]], 'solar', [0, 0, 1]));
  });
  return parts;
}

// --- the van --------------------------------------------------------------------

/** Build the Trafic, with the gear asked for — the solar panel and the mirrors, by default. */
export function buildTrafic(gear: VehicleGear = defaultVehicleSpec('trafic-ph2').gear): Part[] {
  const g = effectiveGear(gear);
  const L = HALF_LENGTH;
  const archFront = { a: AXLE.front - ARCH_HALF, b: AXLE.front + ARCH_HALF };
  const archRear = { a: AXLE.rear - ARCH_HALF, b: AXLE.rear + ARCH_HALF };
  const parts: Part[] = [];

  // The black band the body stands on: the bumpers, and a narrow sill between
  // the arches that clears the wheels, its ends inside the bumpers.
  const clad = level(Z.cladBottom);
  const cladTop = level(Z.bottom);
  parts.push(hull('clad-front', archFront.b, L, clad, cladTop, 'cladding'));
  parts.push(hull('clad-sill', archRear.a, archFront.b, clad, cladTop, 'cladding', { cap: SILL_HALF_WIDTH, buried: { front: true, rear: true } }));
  parts.push(hull('clad-rear', -L, archRear.a, clad, cladTop, 'cladding'));

  // The painted skirt, simply absent across each axle. Its tops are buried
  // under the slices above, so none is built.
  const shoulder = level(Z.shoulder);
  const bottom = level(Z.bottom);
  parts.push(hull('body-skirt-nose', archFront.b, L, bottom, shoulder, 'body'));
  parts.push(hull('body-skirt-cab', SHUT.cab, archFront.a, bottom, shoulder, 'body', { buried: { rear: true } }));
  parts.push(hull('body-skirt-slide', SHUT.door, SHUT.cab, bottom, shoulder, 'body', { buried: { front: true } }));
  parts.push(hull('body-skirt-tail', -L, archRear.a, bottom, shoulder, 'body'));

  // The bonnet between its two wings, the corners carrying the lamps.
  parts.push(hull('body-bonnet', SCREEN.front, L, shoulder, BONNET, 'body', { x: [-SHUT.bonnet, SHUT.bonnet], top: true, buried: { rear: true } }));
  for (const [s, x] of [
    ['l', [-Infinity, -SHUT.bonnet]],
    ['r', [SHUT.bonnet, Infinity]],
  ] as const) {
    parts.push(hull(`body-wing-${s}`, SCREEN.front, SHUT.wing, shoulder, BONNET, 'body', { x: [...x], top: true, buried: { front: true, rear: true } }));
    parts.push(hull(`body-corner-${s}`, SHUT.wing, L, shoulder, BONNET, 'body', { x: [...x], top: true, buried: { rear: true } }));
  }

  // The cab and the two slices of the cargo body behind it: the sliding
  // door's, and the tail's with the barn doors.
  parts.push(cab());
  parts.push(bodySlice('cargo-slide', SHUT.door, SHUT.cab, {}));
  parts.push(bodySlice('cargo-tail', -L, SHUT.door, { rear: true }));

  const wheelAt: [string, number, number, 1 | -1][] = [
    ['wheel-fl', -WHEEL.x, AXLE.front, -1],
    ['wheel-fr', WHEEL.x, AXLE.front, 1],
    ['wheel-rl', -WHEEL.x, AXLE.rear, -1],
    ['wheel-rr', WHEEL.x, AXLE.rear, 1],
  ];
  for (const [id, x, y, sign] of wheelAt) {
    parts.push(roadWheel(id, x, y, WHEEL_SPEC));
    parts.push(...cappedRim(id, x, y, sign, WHEEL_SPEC));
  }

  parts.push(...nose(), ...tail(), ...sides());

  if (g.roofSolar) parts.push(...solarPanel());
  if (g.mirrors) parts.push(...mirrors());
  return parts;
}

/** The bonnet's height at the nose, for a test to read. */
export const TRAFIC_BONNET_NOSE = at(BONNET, HALF_LENGTH);
