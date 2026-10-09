/**
 * The second car — a cartoon Renault Kadjar of the facelift (phase 2,
 * 2018–2022), as parts for `mesh3d.ts`, in the same idiom as the Prado
 * (`car-model.ts`) and drawn by the same renderer.
 *
 * A crossover, not a 4×4, and the drawing says so where the Prado's is
 * upright: a bonnet falling toward the nose, a windscreen raked at about 60°,
 * a roof that slopes down to a raked tailgate under a small spoiler, a
 * beltline rising toward the tail, the side glass narrowing to a quarter
 * light, the nose rounded in plan. Its trade marks are drawn as decals: the
 * C of the daytime lights under each headlamp, a chrome bar across the grille
 * and the diamond in it, black cladding round the arches and along the sills,
 * satin skid plates, tail lights wrapping the rear corners, diamond-cut
 * two-tone wheels. The gear is the roof's: two bars ACROSS it (the maintainer's
 * car, on by default) and the factory rails along its edges, which the bars
 * then stand on; and the door mirrors.
 *
 * The rules are the Prado's, learned there the hard way (`roadtrip.md`):
 * every part is CONVEX; the hull is a stack of slices cut where a car has a
 * shut line, so no polygon spans the model; a face buried against its
 * neighbour is not built; an arch is an ABSENCE; a decal lies inside the one
 * face it is pushed off, cut where it would cross into another. Slopes come
 * from `prism`, whose caps are planes, so a falling bonnet is still one flat
 * face.
 *
 * Model units are about metres: 4.49 long and 1.84 wide as Renault gives
 * them (the arch mouldings drawn a touch prouder, to 1.90), the roof at about
 * 1.58, wheels a size up as a toy has them. The ground at z = 0, the nose toward +y, x to the right. Colours are
 * ROLES, resolved through `kadjarPalette`; the body colour is the author's.
 *
 * The hull slices, the decals and the wheels are `car-parts.ts`'s, given this
 * car's plan; the Trafic and the Zoé are built from the same. Pure and DOM-free.
 */

import { defaultVehicleSpec, effectiveGear, type VehicleGear } from '../vehicle-spec';
import { arc, at, box2, greenhouse, level, lifted, makeBody, meet, roadWheel, spokedRim, through, type P2 } from './car-parts';
import { prism, type Part, type ZPlane } from './mesh3d';

/** The car's footprint, for its shadow and its scale on the map. */
export const KADJAR_LENGTH = 4.49;
export const KADJAR_WIDTH = 1.84;
export const KADJAR_WHEEL_RADIUS = 0.39;

/** The car's colours by role, given the author's body colour. */
export function kadjarPalette(bodyColor: string): Record<string, string> {
  return {
    body: bodyColor,
    roof: bodyColor,
    cladding: '#232427',
    glass: '#2f4155',
    trim: '#131417',
    tyre: '#1b1b1c',
    tread: '#262628',
    rim: '#cfd2d6',
    rimDark: '#3a3d43',
    light: '#f1eee2',
    drl: '#fffdf2',
    lamp: '#f4f1e0',
    tail: '#b8261c',
    chrome: '#d6d9dd',
    skid: '#a9adb3',
    grille: '#18191c',
    rail: '#b9bcc1',
    bar: '#b6bac0',
    barFoot: '#1d1e21',
  };
}

const HALF_LENGTH = KADJAR_LENGTH / 2;
const HALF_WIDTH = 0.9;

/** The heights the hull is cut at: the cladding, the painted body, the line clear of the wheels. */
const Z = {
  cladBottom: 0.24,
  bottom: 0.44,
  /** Above this the body runs its full width, clear of the wheels' tops (2 × 0.39). */
  shoulder: 0.8,
};

/** The axles — a 2.65 m wheelbase, the front overhang a touch longer than the rear. */
const AXLE = { front: 1.315, rear: -1.335 };
/** How far each arch reaches fore and aft of its axle. */
const ARCH_HALF = 0.43;
/**
 * Where a wheel stands and how wide it is: its inner face clears the sill,
 * its outer face stands a hair proud of the flank, as a real tyre does. Both
 * that and the 14 facets (not 16) are measured, not taste: a tyre tucked
 * under the body's wall, or cut into more faces than the repair of the paint
 * order can move, lost the rear door to the wheel at a low camera
 * (`render-order.test.ts`).
 */
const WHEEL = { x: 0.78, half: 0.125 };
const SILL_HALF_WIDTH = 0.62;

/** Where the windscreen meets the body, and where the rear screen does. */
const SCREEN = { front: 0.8, rear: -2.1 };
/**
 * The other shut lines the hull is cut at, so that no panel keyed by its far
 * corner lies over a wheel it could be sorted behind: the bonnet's edge
 * along each wing, the wing's end at the headlamp, the gap between the doors
 * and the rear door's back edge, under the C pillar.
 */
const SHUT = { bonnet: 0.64, wing: HALF_LENGTH - 0.34, doors: -0.49, quarter: -1.4 };
/** The beltline, rising toward the tail. */
const BELT = through(SCREEN.front, 1.04, -HALF_LENGTH, 1.12);
/** The bonnet, falling toward the nose. */
const BONNET = through(SCREEN.front, at(BELT, SCREEN.front), HALF_LENGTH, 0.9);

/**
 * The plan's right-hand edge, rear to nose: the tail's corners rounded in two
 * facets, the nose's in three, straight between. The left is its mirror.
 */
const NOSE_ROUND = 0.34;
const TAIL_ROUND = 0.26;
const OUTLINE: P2[] = [
  ...arc(HALF_WIDTH - TAIL_ROUND, -HALF_LENGTH + TAIL_ROUND, TAIL_ROUND, -90, 0, 2),
  ...arc(HALF_WIDTH - NOSE_ROUND, HALF_LENGTH - NOSE_ROUND, NOSE_ROUND, 0, 90, 3),
];

/** Where the hull is cut in height; a decal crossing a cut is two decals. */
const CUTS = [Z.bottom, Z.shoulder];

/** The hull's plan and the tools that know it (`car-parts.ts`). */
const BODY = makeBody({ halfLength: HALF_LENGTH, halfWidth: HALF_WIDTH, outline: OUTLINE, cuts: CUTS });
const { hull, wallDecal, acrossFace, sideDecal, diamond } = BODY;

// --- the greenhouse -----------------------------------------------------------

/** Its profile in (y, z): the windscreen from the belt to the roof, the roof, the rear screen. */
const GLASS = {
  wsBase: [SCREEN.front, at(BELT, SCREEN.front)] as P2,
  roofFront: [-0.2, 1.58] as P2,
  roofRear: [-1.5, 1.49] as P2,
  rearBase: [SCREEN.rear, at(BELT, SCREEN.rear)] as P2,
};
const ROOF = through(GLASS.roofFront[0], GLASS.roofFront[1], GLASS.roofRear[0], GLASS.roofRear[1]);
/** The top of the side windows, parallel to the roof under a body-coloured strip. */
const WINDOW_TOP = lifted(ROOF, -0.07);

/** The greenhouse's sides lean in: 0.84 from the centre at the belt, 0.64 at the roof. */
const SIDE = { x: 0.84, z: GLASS.wsBase[1], lean: (0.84 - 0.64) / (GLASS.roofFront[1] - GLASS.wsBase[1]) };

const onBelt = (y: number): P2 => [y, at(BELT, y)];
const onWindowTop = (y: number): P2 => [y, at(WINDOW_TOP, y)];

/**
 * The side of the greenhouse, tiled: a body-coloured strip under the roof,
 * and under it, front to back, the A pillar (parallel to the windscreen), the
 * front door glass, the black B pillar, the rear door glass, a small quarter
 * light and the broad C pillar the glass narrows into. Every tile is convex
 * and all lie on one plane, so the cabin stays one convex part.
 */
function sideTiles(): { role: string; points: P2[] }[] {
  const windscreen: P2 = [GLASS.roofFront[0] - GLASS.wsBase[0], GLASS.roofFront[1] - GLASS.wsBase[1]];
  const rearScreen: P2 = [GLASS.roofRear[0] - GLASS.rearBase[0], GLASS.roofRear[1] - GLASS.rearBase[1]];
  const aFront = meet(GLASS.wsBase, windscreen, WINDOW_TOP);
  const aRearBase = onBelt(0.64);
  const aRearTop = meet(aRearBase, windscreen, WINDOW_TOP);
  const cTop = meet(GLASS.rearBase, rearScreen, WINDOW_TOP);
  return [
    { role: 'body', points: [aFront, GLASS.roofFront, GLASS.roofRear, cTop] },
    { role: 'body', points: [GLASS.wsBase, aRearBase, aRearTop, aFront] },
    { role: 'glass', points: [aRearBase, onBelt(-0.44), onWindowTop(-0.4), aRearTop] },
    { role: 'trim', points: [onBelt(-0.44), onBelt(-0.54), onWindowTop(-0.5), onWindowTop(-0.4)] },
    { role: 'glass', points: [onBelt(-0.54), onBelt(SHUT.quarter), onWindowTop(-1.34), onWindowTop(-0.5)] },
    { role: 'glass', points: [onBelt(SHUT.quarter), onWindowTop(-1.55), onWindowTop(-1.34)] },
    { role: 'body', points: [onBelt(SHUT.quarter), GLASS.rearBase, cTop, onWindowTop(-1.55)] },
  ];
}

const cabin = (): Part => greenhouse('cabin', SIDE, GLASS, sideTiles());

// --- decals -------------------------------------------------------------------

/** The nose's flat face and the tail's, as plan edges on the right-hand side. */
const NOSE_FACE: [P2, P2] = [[0, HALF_LENGTH], [HALF_WIDTH - NOSE_ROUND, HALF_LENGTH]];
const TAIL_FACE: [P2, P2] = [[0, -HALF_LENGTH], [HALF_WIDTH - TAIL_ROUND, -HALF_LENGTH]];
/** The corner facets, from the flat face outward. */
const NOSE_FACETS: [P2, P2][] = [
  [OUTLINE[6], OUTLINE[5]],
  [OUTLINE[5], OUTLINE[4]],
];
const TAIL_FACETS: [P2, P2][] = [
  [OUTLINE[0], OUTLINE[1]],
  [OUTLINE[1], OUTLINE[2]],
];

/** The share of the nose or tail face at `x` from the centre. */
const shareAt = (face: [P2, P2], x: number) => x / face[1][0];

function nose(): Part[] {
  const parts: Part[] = [];
  const [f1, f2] = NOSE_FACETS;
  // The headlamps under the bonnet's edge, wrapping the rounded corner.
  parts.push(...wallDecal('headlight', 'light', ...NOSE_FACE, shareAt(NOSE_FACE, 0.3), 1, 0.72, 0.87));
  // The first facet is shared by the bonnet and the corner beside it above
  // the shoulder, so its lamp is cut where the bonnet's edge crosses it.
  const edge = (SHUT.bonnet - f1[0][0]) / (f1[1][0] - f1[0][0]);
  parts.push(...wallDecal('headlight-wrap', 'light', ...f1, 0, edge, 0.72, 0.87));
  parts.push(...wallDecal('headlight-wrap1', 'light', ...f1, edge, 1, 0.72, 0.87));
  parts.push(...wallDecal('headlight-wrap2', 'light', ...f2, 0, 0.7, 0.73, 0.86));
  // The C of the daytime lights: under the lamp, down the corner, back in.
  parts.push(...wallDecal('drl', 'drl', ...NOSE_FACE, shareAt(NOSE_FACE, 0.34), 1, 0.685, 0.705));
  parts.push(...wallDecal('drl-wrap', 'drl', ...f1, 0, 1, 0.685, 0.705));
  parts.push(...wallDecal('drl-wrap2', 'drl', ...f2, 0, 0.72, 0.685, 0.705));
  parts.push(...wallDecal('drl-down', 'drl', ...f2, 0.6, 0.72, 0.55, 0.685));
  parts.push(...wallDecal('drl-foot', 'drl', ...f2, 0.2, 0.72, 0.53, 0.55));
  // The grille, the chrome bar across its top and the diamond, each a hair
  // nearer than what it lies on.
  parts.push(...acrossFace('grille', 'grille', HALF_LENGTH, 0.28, 0.6, 0.84, 0.004));
  parts.push(...acrossFace('grille-bar', 'chrome', HALF_LENGTH, 0.27, 0.805, 0.832, 0.008));
  parts.push(diamond('logo', HALF_LENGTH, 0.7, 0.075, 0.012));
  // The black lower bumper: a satin skid plate, the fog lamps in its corners.
  parts.push(...acrossFace('skid-front', 'skid', HALF_LENGTH, 0.36, 0.27, 0.32, 0.004));
  parts.push(...wallDecal('fog', 'lamp', ...f1, 0.25, 0.75, 0.34, 0.39));
  return parts;
}

function tail(): Part[] {
  const parts: Part[] = [];
  const [g1, g2] = TAIL_FACETS;
  // The tail lights along the top of the tailgate, wrapping into the wings —
  // the second facet only as far as the rear screen's base, where the slice
  // carrying it ends.
  const cut = (SCREEN.rear - g2[0][1]) / (g2[1][1] - g2[0][1]);
  parts.push(...wallDecal('taillight', 'tail', ...TAIL_FACE, shareAt(TAIL_FACE, 0.24), 1, 0.95, 1.06));
  parts.push(...wallDecal('taillight-wrap', 'tail', ...g1, 0, 1, 0.95, 1.06));
  parts.push(...wallDecal('taillight-wrap2', 'tail', ...g2, 0, cut - 0.01, 0.96, 1.05));
  parts.push(diamond('logo-rear', -HALF_LENGTH, 0.97, 0.06, 0.004));
  parts.push(...acrossFace('skid-rear', 'skid', -HALF_LENGTH, 0.34, 0.27, 0.32, 0.004));
  parts.push(...wallDecal('reflector', 'tail', ...g1, 0.2, 0.8, 0.36, 0.4));
  return parts;
}

function sides(): Part[] {
  const archFront = { a: AXLE.front - ARCH_HALF, b: AXLE.front + ARCH_HALF };
  const archRear = { a: AXLE.rear - ARCH_HALF, b: AXLE.rear + ARCH_HALF };
  return [
    // The sill's black cladding between the arches' mouldings.
    // Both run across the shut lines, where the body is cut, so each is in pieces.
    ...sideDecal('sill-rear', 'cladding', archRear.b + 0.07, SHUT.doors, level(Z.bottom), level(Z.bottom + 0.1)),
    ...sideDecal('sill-front', 'cladding', SHUT.doors, archFront.a - 0.07, level(Z.bottom), level(Z.bottom + 0.1)),
    // The chrome line under the side glass, following the belt up.
    ...sideDecal('belt-chrome-quarter', 'chrome', -1.94, SHUT.quarter, lifted(BELT, -0.035), lifted(BELT, -0.012)),
    ...sideDecal('belt-chrome-rear', 'chrome', SHUT.quarter, SHUT.doors, lifted(BELT, -0.035), lifted(BELT, -0.012)),
    ...sideDecal('belt-chrome-front', 'chrome', SHUT.doors, SCREEN.front - 0.04, lifted(BELT, -0.035), lifted(BELT, -0.012)),
    // The handles sit above the arches' eyebrows, which the rear one would
    // otherwise be inside.
    ...sideDecal('handle-front', 'chrome', 0.02, 0.15, lifted(BELT, -0.1), lifted(BELT, -0.075)),
    ...sideDecal('handle-rear', 'chrome', -0.96, -0.83, lifted(BELT, -0.1), lifted(BELT, -0.075)),
  ];
}

// --- wheels, arches, mirrors ----------------------------------------------------

const WHEEL_SPEC = { radius: KADJAR_WHEEL_RADIUS, half: WHEEL.half, facets: 14 };
const wheel = (id: string, x: number, y: number): Part => roadWheel(id, x, y, WHEEL_SPEC);
/** A diamond-cut rim: a dark disc, five pairs of bright spokes turning with the wheel, a cap. */
const rimParts = (id: string, x: number, y: number, outerSign: 1 | -1): Part[] => spokedRim(id, x, y, outerSign, WHEEL_SPEC);

/**
 * The black moulding round an arch: an eyebrow standing proud on the shoulder,
 * faceted — a crown over the wheel and a piece falling away on each side —
 * and a leg down each side of the opening: convex blocks outside the flank,
 * none of them built where it presses against the body. The eyebrow is in
 * three because in one it was a long block keyed by its far end, and a low
 * camera saw its own tyre painted over it (68% of it kept; 92% in three).
 */
function archMoulding(side: 1 | -1, axle: number, tag: string): Part[] {
  const s = side < 0 ? 'l' : 'r';
  const x0 = side * HALF_WIDTH;
  const x1 = side * (HALF_WIDTH + 0.05);
  const rect = (y0: number, y1: number): P2[] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const againstBody = (a: P2, b: P2) => a[0] === x0 && b[0] === x0;
  const block = (id: string, y0: number, y1: number, z0: number, z1: ZPlane, top: boolean) =>
    prism(id, rect(y0, y1), level(z0), z1, { side: 'cladding', top: top ? 'cladding' : null, bottom: null }, { open: againstBody });
  const crown = Z.shoulder + 0.11;
  const end = Z.shoulder + 0.07;
  return [
    block(`flare-${s}-${tag}`, axle - 0.2, axle + 0.2, Z.shoulder, level(crown), true),
    block(`flare-${s}-${tag}-fore`, axle + 0.2, axle + 0.515, Z.shoulder, through(axle + 0.2, crown, axle + 0.515, end), true),
    block(`flare-${s}-${tag}-aft`, axle - 0.515, axle - 0.2, Z.shoulder, through(axle - 0.2, crown, axle - 0.515, end), true),
    block(`arch-${s}-${tag}-fore`, axle + ARCH_HALF, axle + ARCH_HALF + 0.07, Z.bottom, level(Z.shoulder), false),
    block(`arch-${s}-${tag}-aft`, axle - ARCH_HALF - 0.07, axle - ARCH_HALF, Z.bottom, level(Z.shoulder), false),
  ];
}

function mirrors(): Part[] {
  return ([1, -1] as const).map((sign) => {
    const x0 = sign * 0.85;
    const x1 = sign * 1.01;
    const plan: P2[] = [
      [x0, 0.46],
      [x1, 0.47],
      [x1, 0.58],
      [x0, 0.6],
    ];
    return prism(`mirror-${sign < 0 ? 'l' : 'r'}`, plan, level(1.05), level(1.17), { side: 'body', top: 'body', bottom: 'body' });
  });
}

// --- the roof -------------------------------------------------------------------

/** The rails run along the roof's edges between these, on two feet each. */
const RAILS = { x0: 0.53, x1: 0.59, y0: -1.3, y1: -0.3, feet: 0.045, bar: 0.03 };
/**
 * The two roof bars, some 73 cm apart, and how they stand. Wider than a real
 * aero bar on purpose: the ink outline is a few pixels whatever the part, and
 * a bar drawn to scale was all outline — black, where it should read as
 * aluminium.
 */
const BARS = { at: [-0.45, -1.18], half: 0.055, reach: 0.72, feet: 0.06, depth: 0.045 };

function roofRails(): Part[] {
  const parts: Part[] = [];
  for (const sign of [1, -1] as const) {
    const s = sign < 0 ? 'l' : 'r';
    const xa = Math.min(sign * RAILS.x0, sign * RAILS.x1);
    const xb = Math.max(sign * RAILS.x0, sign * RAILS.x1);
    for (const [tag, y0, y1] of [
      ['aft', RAILS.y0, RAILS.y0 + 0.1],
      ['fore', RAILS.y1 - 0.1, RAILS.y1],
    ] as const) {
      parts.push(
        prism(`rail-${s}-foot-${tag}`, box2(xa, xb, y0, y1), ROOF, lifted(ROOF, RAILS.feet), { side: 'barFoot', top: null, bottom: null }),
      );
    }
    parts.push(
      prism(
        `rail-${s}`,
        box2(xa, xb, RAILS.y0, RAILS.y1),
        lifted(ROOF, RAILS.feet),
        lifted(ROOF, RAILS.feet + RAILS.bar),
        { side: 'rail', top: 'rail', bottom: null },
      ),
    );
  }
  return parts;
}

/**
 * Two bars across the roof. On the rails when the car has them, clamped to
 * the roof on feet of their own when it does not — the bar itself the same,
 * standing higher on rails.
 */
function roofBars(onRails: boolean): Part[] {
  const parts: Part[] = [];
  const base = onRails ? lifted(ROOF, RAILS.feet + RAILS.bar) : ROOF;
  const feet = onRails ? { x0: RAILS.x0, x1: RAILS.x1 } : { x0: 0.52, x1: 0.62 };
  BARS.at.forEach((yc, i) => {
    const tag = i === 0 ? 'fore' : 'aft';
    const y0 = yc - BARS.half;
    const y1 = yc + BARS.half;
    const barBottom = at(base, yc) + BARS.feet;
    for (const sign of [1, -1] as const) {
      const xa = Math.min(sign * feet.x0, sign * feet.x1);
      const xb = Math.max(sign * feet.x0, sign * feet.x1);
      parts.push(
        prism(`roofbar-${tag}-foot-${sign < 0 ? 'l' : 'r'}`, box2(xa, xb, y0, y1), base, level(barBottom), {
          side: 'barFoot',
          top: null,
          bottom: null,
        }),
      );
    }
    parts.push(
      prism(`roofbar-${tag}`, box2(-BARS.reach, BARS.reach, y0, y1), level(barBottom), level(barBottom + BARS.depth), {
        side: 'bar',
        top: 'bar',
        bottom: null,
      }),
    );
  });
  return parts;
}

/**
 * The spoiler over the rear screen: a plate lying on the roof's last few
 * centimetres and carried on past it, thicker at its trailing edge. It never
 * meets the glass, which falls away beneath it.
 */
function spoiler(): Part {
  const y0 = -1.68;
  const y1 = -1.4;
  return prism(
    'spoiler',
    box2(-0.58, 0.58, y0, y1),
    lifted(ROOF, 0.004),
    through(y1, at(ROOF, y1) + 0.014, y0, at(ROOF, y0) + 0.05),
    { side: 'body', top: 'body', bottom: null },
  );
}

// --- the car --------------------------------------------------------------------

/** Build the Kadjar, with the gear asked for — the two roof bars and the mirrors, by default. */
export function buildKadjar(gear: VehicleGear = defaultVehicleSpec('kadjar-ph2').gear): Part[] {
  const g = effectiveGear(gear);
  const L = HALF_LENGTH;
  const archFront = { a: AXLE.front - ARCH_HALF, b: AXLE.front + ARCH_HALF };
  const archRear = { a: AXLE.rear - ARCH_HALF, b: AXLE.rear + ARCH_HALF };
  const parts: Part[] = [];

  // The black band the body stands on: full width in front of the front arch
  // and behind the rear one, a narrow sill between them that clears the
  // wheels — its ends are inside the bumpers, so they are not built.
  const clad = level(Z.cladBottom);
  const cladTop = level(Z.bottom);
  parts.push(hull('clad-front', archFront.b, L, clad, cladTop, 'cladding'));
  parts.push(hull('clad-sill', archRear.a, archFront.b, clad, cladTop, 'cladding', { cap: SILL_HALF_WIDTH, buried: { front: true, rear: true } }));
  parts.push(hull('clad-rear', -L, archRear.a, clad, cladTop, 'cladding'));

  // The painted body. Below the shoulder it is simply not there across each
  // axle — that absence is the arch. Above it, it runs full length and is cut
  // only at the screens' bases, which is where a car has its shut lines.
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

  for (const side of [-1, 1] as const) {
    parts.push(...archMoulding(side, AXLE.front, 'f'));
    parts.push(...archMoulding(side, AXLE.rear, 'r'));
  }

  const wheelAt: [string, number, number, 1 | -1][] = [
    ['wheel-fl', -WHEEL.x, AXLE.front, -1],
    ['wheel-fr', WHEEL.x, AXLE.front, 1],
    ['wheel-rl', -WHEEL.x, AXLE.rear, -1],
    ['wheel-rr', WHEEL.x, AXLE.rear, 1],
  ];
  for (const [id, x, y, sign] of wheelAt) {
    parts.push(wheel(id, x, y));
    parts.push(...rimParts(id, x, y, sign));
  }

  parts.push(...nose(), ...tail(), ...sides());

  if (g.roofRails) parts.push(...roofRails());
  if (g.roofBars) parts.push(...roofBars(g.roofRails));
  if (g.mirrors) parts.push(...mirrors());
  return parts;
}
