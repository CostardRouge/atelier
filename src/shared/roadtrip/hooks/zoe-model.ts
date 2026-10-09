/**
 * The fourth car — a cartoon Renault Zoé of the second phase (2019–2024),
 * the small electric hatchback, white and as it comes, as parts for
 * `mesh3d.ts`, built from `car-parts.ts` in the Kadjar's idiom and drawn by
 * the same renderer.
 *
 * A city hatchback, and the drawing says so where the Kadjar's is a
 * crossover: a short bonnet falling steeply to a nose with no grille, a
 * windscreen far forward and steeply raked, a roof arcing down to a
 * near-upright hatch, a beltline rising to the tail, the rear door's handle
 * hidden in a black C pillar, small wheels under body-coloured arches. Its
 * trade marks are decals: slim headlamps wrapping the nose with the C of the
 * daytime lights under them, a big diamond (the charging hatch) on a chrome
 * bar across a body-coloured nose, a dark lower intake, slim tail lamps at
 * the belt wrapping the rounded tail, five-spoke alloys. The only gear is
 * the door mirrors.
 *
 * The rules are the Kadjar's (`roadtrip.md`): every part CONVEX, the hull
 * a stack of slices cut where a car has a shut line, a face buried against
 * its neighbour not built, an arch an ABSENCE, a decal inside the one face
 * it is pushed off and cut at the hull's cuts.
 *
 * Model units are about metres: 4.09 long, 1.79 wide, 1.56 to the roof as
 * Renault gives it, a 2.59 wheelbase, wheels a size up as a toy has them.
 * The ground at z = 0, the nose toward +y, x to the right. Colours are
 * ROLES, resolved through `zoePalette`; the body colour is the author's.
 *
 * Pure and DOM-free.
 */

import { defaultVehicleSpec, effectiveGear, type VehicleGear } from '../vehicle-spec';
import { arc, at, box2, greenhouse, level, lifted, makeBody, meet, rimFor, roadWheel, spokedRim, through, type P2 } from './car-parts';
import { prism, type Part, type ZPlane } from './mesh3d';

/** The car's footprint, for its shadow and its scale on the map. */
export const ZOE_LENGTH = 4.09;
export const ZOE_WIDTH = 1.79;
export const ZOE_WHEEL_RADIUS = 0.34;

/** The car's colours by role, given the author's body colour. */
export function zoePalette(bodyColor: string): Record<string, string> {
  return {
    body: bodyColor,
    roof: bodyColor,
    cladding: '#26272a',
    glass: '#2f4155',
    trim: '#131417',
    tyre: '#1b1b1c',
    tread: '#262628',
    rim: '#d2d5d9',
    rimDark: '#3a3d43',
    light: '#f1eee2',
    drl: '#fffdf2',
    lamp: '#f4f1e0',
    tail: '#b8261c',
    chrome: '#d6d9dd',
    grille: '#1a1b1e',
  };
}

const HALF_LENGTH = ZOE_LENGTH / 2;
const HALF_WIDTH = ZOE_WIDTH / 2;

/** The heights the hull is cut at: the bumpers' black lip, the painted body, the line clear of the wheels. */
const Z = {
  cladBottom: 0.2,
  bottom: 0.36,
  /** Above this the body runs its full width, clear of the wheels' tops (2 × 0.34). */
  shoulder: 0.72,
};

/** The axles — a 2.59 m wheelbase, a long front overhang and a short rear one. */
const AXLE = { front: 1.205, rear: -1.383 };
const ARCH_HALF = 0.4;
/** A tyre's inner face clears the sill; its outer stands a hair proud of the flank (the Kadjar's rule). */
const WHEEL = { x: HALF_WIDTH - 0.11 + 0.005, half: 0.11 };
const WHEEL_SPEC = { radius: ZOE_WHEEL_RADIUS, half: WHEEL.half, facets: 14 };
const SILL_HALF_WIDTH = 0.64;

/** Where the windscreen meets the body — far forward — and where the hatch's glass does. */
const SCREEN = { front: 0.55, rear: -1.72 };
/**
 * The other shut lines the hull is cut at: the bonnet's edge along each
 * wing, the wing's end at the headlamp, the gap between the doors and the
 * rear door's back edge at the C pillar.
 */
const SHUT = { bonnet: 0.6, wing: HALF_LENGTH - 0.3, doors: -0.48, quarter: -1.35 };
/** The beltline, rising toward the tail. */
const BELT = through(SCREEN.front, 0.98, -HALF_LENGTH, 1.08);
/** The bonnet, short and falling steeply toward the nose. */
const BONNET = through(SCREEN.front, at(BELT, SCREEN.front), HALF_LENGTH, 0.8);

/**
 * The plan's right-hand edge, rear to nose: the tail's corners rounded in two
 * facets, the nose's in three, straight between.
 */
const NOSE_ROUND = 0.32;
const TAIL_ROUND = 0.28;
const OUTLINE: P2[] = [
  ...arc(HALF_WIDTH - TAIL_ROUND, -HALF_LENGTH + TAIL_ROUND, TAIL_ROUND, -90, 0, 2),
  ...arc(HALF_WIDTH - NOSE_ROUND, HALF_LENGTH - NOSE_ROUND, NOSE_ROUND, 0, 90, 3),
];

const CUTS = [Z.bottom, Z.shoulder];
const BODY = makeBody({ halfLength: HALF_LENGTH, halfWidth: HALF_WIDTH, outline: OUTLINE, cuts: CUTS });
const { hull, wallDecal, acrossFace, sideDecal, diamond } = BODY;

// --- the greenhouse -----------------------------------------------------------

/** Its profile in (y, z): the windscreen from the belt to the roof, the roof arcing down, the hatch's glass. */
const GLASS = {
  wsBase: [SCREEN.front, at(BELT, SCREEN.front)] as P2,
  roofFront: [-0.35, 1.56] as P2,
  roofRear: [-1.28, 1.49] as P2,
  rearBase: [SCREEN.rear, at(BELT, SCREEN.rear)] as P2,
};
const ROOF = through(GLASS.roofFront[0], GLASS.roofFront[1], GLASS.roofRear[0], GLASS.roofRear[1]);
/** The top of the side windows, parallel to the roof under a body-coloured strip. */
const WINDOW_TOP = lifted(ROOF, -0.06);

/** The greenhouse's sides lean in: 0.83 from the centre at the belt, 0.62 at the roof. */
const SIDE = { x: 0.83, z: GLASS.wsBase[1], lean: (0.83 - 0.62) / (GLASS.roofFront[1] - GLASS.wsBase[1]) };

const onBelt = (y: number): P2 => [y, at(BELT, y)];
const onWindowTop = (y: number): P2 => [y, at(WINDOW_TOP, y)];

/**
 * The side of the greenhouse, tiled: the strip under the roof, the A pillar
 * along the windscreen, the front door glass, the black B pillar, the rear
 * door glass, the black C pillar that hides the rear handle — its top corner
 * ON the hatch's glass, which is steep enough to meet the window line ahead
 * of the pillar's foot — and the body under that glass down to the belt.
 */
function sideTiles(): { role: string; points: P2[] }[] {
  const windscreen: P2 = [GLASS.roofFront[0] - GLASS.wsBase[0], GLASS.roofFront[1] - GLASS.wsBase[1]];
  const rearScreen: P2 = [GLASS.roofRear[0] - GLASS.rearBase[0], GLASS.roofRear[1] - GLASS.rearBase[1]];
  const aFront = meet(GLASS.wsBase, windscreen, WINDOW_TOP);
  const aRearBase = onBelt(0.4);
  const aRearTop = meet(aRearBase, windscreen, WINDOW_TOP);
  const cTop = meet(GLASS.rearBase, rearScreen, WINDOW_TOP);
  const cFront = onWindowTop(cTop[0] + 0.13);
  return [
    { role: 'body', points: [aFront, GLASS.roofFront, GLASS.roofRear, cTop] },
    { role: 'body', points: [GLASS.wsBase, aRearBase, aRearTop, aFront] },
    { role: 'glass', points: [aRearBase, onBelt(-0.43), onWindowTop(-0.4), aRearTop] },
    { role: 'trim', points: [onBelt(-0.43), onBelt(-0.53), onWindowTop(-0.5), onWindowTop(-0.4)] },
    { role: 'glass', points: [onBelt(-0.53), onBelt(SHUT.quarter), cFront, onWindowTop(-0.5)] },
    { role: 'trim', points: [onBelt(SHUT.quarter), onBelt(-1.52), cTop, cFront] },
    { role: 'body', points: [onBelt(-1.52), GLASS.rearBase, cTop] },
  ];
}

const cabin = (): Part => greenhouse('cabin', SIDE, GLASS, sideTiles());

// --- decals -------------------------------------------------------------------

/** The nose's flat face and the tail's, as plan edges on the right-hand side. */
const NOSE_FACE: [P2, P2] = [[0, HALF_LENGTH], [HALF_WIDTH - NOSE_ROUND, HALF_LENGTH]];
const TAIL_FACE: [P2, P2] = [[0, -HALF_LENGTH], [HALF_WIDTH - TAIL_ROUND, -HALF_LENGTH]];
const NOSE_FACETS: [P2, P2][] = [
  [OUTLINE[6], OUTLINE[5]],
  [OUTLINE[5], OUTLINE[4]],
];
const TAIL_FACETS: [P2, P2][] = [
  [OUTLINE[0], OUTLINE[1]],
  [OUTLINE[1], OUTLINE[2]],
];
const shareAt = (face: [P2, P2], x: number) => x / face[1][0];

function nose(): Part[] {
  const parts: Part[] = [];
  const [f1, f2] = NOSE_FACETS;
  // Slim headlamps under the bonnet's edge, wrapping the corner; the first
  // facet is shared by the bonnet and the corner beside it, so its lamp is
  // cut where the bonnet's edge crosses it.
  const edge = (SHUT.bonnet - f1[0][0]) / (f1[1][0] - f1[0][0]);
  parts.push(...wallDecal('headlight', 'light', ...NOSE_FACE, shareAt(NOSE_FACE, 0.3), 1, 0.69, 0.79));
  parts.push(...wallDecal('headlight-wrap', 'light', ...f1, 0, edge, 0.69, 0.79));
  parts.push(...wallDecal('headlight-wrap1', 'light', ...f1, edge, 1, 0.69, 0.79));
  parts.push(...wallDecal('headlight-wrap2', 'light', ...f2, 0, 0.7, 0.7, 0.78));
  // The C of the daytime lights: under the lamp, down the corner, back in.
  parts.push(...wallDecal('drl', 'drl', ...NOSE_FACE, shareAt(NOSE_FACE, 0.34), 1, 0.665, 0.682));
  parts.push(...wallDecal('drl-wrap', 'drl', ...f1, 0, 1, 0.665, 0.682));
  parts.push(...wallDecal('drl-wrap2', 'drl', ...f2, 0, 0.72, 0.665, 0.682));
  parts.push(...wallDecal('drl-down', 'drl', ...f2, 0.6, 0.72, 0.56, 0.665));
  parts.push(...wallDecal('drl-foot', 'drl', ...f2, 0.2, 0.72, 0.54, 0.56));
  // No grille on an electric car: a chrome bar across the body-coloured nose
  // and the big diamond that is the charging hatch.
  parts.push(...acrossFace('nose-bar', 'chrome', HALF_LENGTH, 0.3, 0.6, 0.622, 0.008));
  parts.push(diamond('logo', HALF_LENGTH, 0.61, 0.115, 0.012));
  // The lower bumper: a dark intake with the plate in it, fog lamps in its corners.
  parts.push(...acrossFace('intake', 'grille', HALF_LENGTH, 0.42, 0.38, 0.52, 0.004));
  parts.push(...acrossFace('plate', 'chrome', HALF_LENGTH, 0.26, 0.42, 0.48, 0.008));
  parts.push(...wallDecal('fog', 'lamp', ...f1, 0.25, 0.75, 0.4, 0.45));
  return parts;
}

function tail(): Part[] {
  const parts: Part[] = [];
  const [g1, g2] = TAIL_FACETS;
  // Slim tail lamps at the belt, wrapping into the quarters — the second
  // facet only as far as the hatch's base, where the slice carrying it ends.
  const cut = (SCREEN.rear - g2[0][1]) / (g2[1][1] - g2[0][1]);
  parts.push(...wallDecal('taillight', 'tail', ...TAIL_FACE, shareAt(TAIL_FACE, 0.26), 1, 0.93, 1.02));
  parts.push(...wallDecal('taillight-wrap', 'tail', ...g1, 0, 1, 0.93, 1.02));
  parts.push(...wallDecal('taillight-wrap2', 'tail', ...g2, 0, cut - 0.01, 0.94, 1.01));
  parts.push(diamond('logo-rear', -HALF_LENGTH, 0.86, 0.065, 0.004));
  parts.push(...acrossFace('plate-rear', 'chrome', -HALF_LENGTH, 0.26, 0.6, 0.66, 0.004));
  parts.push(...wallDecal('reflector', 'tail', ...g1, 0.2, 0.8, 0.28, 0.32));
  return parts;
}

function sides(): Part[] {
  // The front door's handle under the belt; the rear's hides in the C pillar.
  return sideDecal('handle-front', 'trim', -0.16, -0.03, lifted(BELT, -0.1), lifted(BELT, -0.075));
}

// --- wheels, mirrors, the spoiler -------------------------------------------------

const RIM = rimFor(ZOE_WHEEL_RADIUS);

function mirrors(): Part[] {
  return ([1, -1] as const).map((sign) => {
    const x0 = sign * (SIDE.x + 0.01);
    const x1 = sign * (HALF_WIDTH + 0.1);
    const plan: P2[] = [
      [x0, 0.2],
      [x1, 0.21],
      [x1, 0.31],
      [x0, 0.33],
    ];
    return prism(`mirror-${sign < 0 ? 'l' : 'r'}`, plan, level(1.0), level(1.11), { side: 'body', top: 'body', bottom: 'body' });
  });
}

/**
 * The small spoiler over the hatch's glass: a plate lying on the roof's last
 * few centimetres and carried on past it, thicker at its trailing edge.
 */
function spoiler(): Part {
  const y0 = -1.46;
  const y1 = -1.2;
  const roof: ZPlane = ROOF;
  return prism(
    'spoiler',
    box2(-0.56, 0.56, y0, y1),
    lifted(roof, 0.004),
    through(y1, at(roof, y1) + 0.012, y0, at(roof, y0) + 0.045),
    { side: 'body', top: 'body', bottom: null },
  );
}

// --- the car --------------------------------------------------------------------

/** Build the Zoé, with the gear asked for — its mirrors, by default. */
export function buildZoe(gear: VehicleGear = defaultVehicleSpec('zoe-ph2').gear): Part[] {
  const g = effectiveGear(gear);
  const L = HALF_LENGTH;
  const archFront = { a: AXLE.front - ARCH_HALF, b: AXLE.front + ARCH_HALF };
  const archRear = { a: AXLE.rear - ARCH_HALF, b: AXLE.rear + ARCH_HALF };
  const parts: Part[] = [];

  // The black lip under each bumper and a body-coloured sill between the
  // arches that clears the wheels, its ends inside the bumpers.
  const clad = level(Z.cladBottom);
  const cladTop = level(Z.bottom);
  parts.push(hull('clad-front', archFront.b, L, clad, cladTop, 'cladding'));
  parts.push(hull('sill', archRear.a, archFront.b, clad, cladTop, 'body', { cap: SILL_HALF_WIDTH, buried: { front: true, rear: true } }));
  parts.push(hull('clad-rear', -L, archRear.a, clad, cladTop, 'cladding'));

  // The painted body: absent across each axle below the shoulder, cut at the
  // screens' bases and the doors above it.
  const shoulder = level(Z.shoulder);
  const bottom = level(Z.bottom);
  parts.push(hull('body-skirt-nose', archFront.b, L, bottom, shoulder, 'body'));
  parts.push(hull('body-skirt-rear-door', archRear.b, SHUT.doors, bottom, shoulder, 'body', { buried: { front: true } }));
  parts.push(hull('body-skirt-front-door', SHUT.doors, archFront.a, bottom, shoulder, 'body', { buried: { rear: true } }));
  parts.push(hull('body-skirt-tail', -L, archRear.a, bottom, shoulder, 'body'));
  const all = { front: true, rear: true };
  parts.push(hull('body-bonnet', SCREEN.front, L, shoulder, BONNET, 'body', { x: [-SHUT.bonnet, SHUT.bonnet], top: true, buried: { rear: true } }));
  for (const [s, x] of [
    ['l', [-Infinity, -SHUT.bonnet]],
    ['r', [SHUT.bonnet, Infinity]],
  ] as const) {
    parts.push(hull(`body-wing-${s}`, SCREEN.front, SHUT.wing, shoulder, BONNET, 'body', { x: [...x], top: true, buried: all }));
    parts.push(hull(`body-corner-${s}`, SHUT.wing, L, shoulder, BONNET, 'body', { x: [...x], top: true, buried: { rear: true } }));
  }
  parts.push(hull('body-front-door', SHUT.doors, SCREEN.front, shoulder, BELT, 'body', { top: true, buried: all }));
  parts.push(hull('body-rear-door', SHUT.quarter, SHUT.doors, shoulder, BELT, 'body', { top: true, buried: all }));
  parts.push(hull('body-quarter', SCREEN.rear, SHUT.quarter, shoulder, BELT, 'body', { top: true, buried: all }));
  parts.push(hull('body-lip', -L, SCREEN.rear, shoulder, BELT, 'body', { top: true, buried: { front: true } }));
  parts.push(cabin());
  parts.push(spoiler());

  const wheelAt: [string, number, number, 1 | -1][] = [
    ['wheel-fl', -WHEEL.x, AXLE.front, -1],
    ['wheel-fr', WHEEL.x, AXLE.front, 1],
    ['wheel-rl', -WHEEL.x, AXLE.rear, -1],
    ['wheel-rr', WHEEL.x, AXLE.rear, 1],
  ];
  for (const [id, x, y, sign] of wheelAt) {
    parts.push(roadWheel(id, x, y, WHEEL_SPEC));
    parts.push(...spokedRim(id, x, y, sign, WHEEL_SPEC, RIM));
  }

  parts.push(...nose(), ...tail(), ...sides());

  if (g.mirrors) parts.push(...mirrors());
  return parts;
}
