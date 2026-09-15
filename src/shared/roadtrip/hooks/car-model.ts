/**
 * The car — a cartoon Toyota Land Cruiser Prado, as parts for `mesh3d.ts`.
 *
 * A miniature, not a model: the proportions are a Prado's (a tall, upright
 * SUV, a long hood, roof rails, the spare on the tailgate) pushed the way a
 * toy pushes them — wheels a size up, the greenhouse a touch narrower than
 * the body, everything else a flat plane meeting the next at an inked edge.
 * Around 180 faces, every part convex, so the painter's algorithm in
 * `mesh3d.ts` draws it right from any heading.
 *
 * Model units are about metres: 4.6 long, 1.9 wide, 1.95 to the roof, the
 * ground at z = 0, the nose toward +y. Colours are ROLES, resolved through
 * `carPalette` — the body colour is the author's, the rest is the car's.
 *
 * Pure and DOM-free.
 */

import { box, cylinder, decal, extrude, solid, type Face, type Part, type Vec3 } from './mesh3d';

export interface CarOptions {
  /** The spare wheel on the tailgate. */
  spare: boolean;
  /** A rack on the roof rails. */
  rack: boolean;
  /** Door mirrors. */
  mirrors: boolean;
}

export const CAR_DEFAULTS: CarOptions = { spare: true, rack: false, mirrors: true };

/** The car's footprint, for its shadow and its scale on the map. */
export const CAR_LENGTH = 4.6;
export const CAR_WIDTH = 1.9;
export const WHEEL_RADIUS = 0.44;

/** The ids the pose spins — the four road wheels. */
export const WHEEL_IDS = ['wheel-fl', 'wheel-fr', 'wheel-rl', 'wheel-rr'] as const;

/** The car's colours by role, given the author's body colour. */
export function carPalette(bodyColor: string): Record<string, string> {
  return {
    body: bodyColor,
    cladding: '#2a2a2d',
    glass: '#33465a',
    roof: bodyColor,
    tyre: '#1b1b1c',
    tread: '#262628',
    rim: '#a7a9ad',
    hub: '#6d6f73',
    trim: '#141416',
    light: '#f7efc9',
    tail: '#c8301f',
    rail: '#1f1f22',
  };
}

/** A rectangle's corners in the plan, the corners cut by `chamfer`. */
function chamfered(x0: number, x1: number, y0: number, y1: number, chamfer: number): [number, number][] {
  const c = chamfer;
  return [
    [x0 + c, y0],
    [x1 - c, y0],
    [x1, y0 + c],
    [x1, y1 - c],
    [x1 - c, y1],
    [x0 + c, y1],
    [x0, y1 - c],
    [x0, y0 + c],
  ];
}

/**
 * The greenhouse: a trapezoid in section (narrower at the roof), the
 * windshield raked, the tailgate upright. Its sides are split into pillars
 * and windows along the same plane, so the glass reads as glass and the
 * pillars keep the body colour.
 */
function cabin(): Part[] {
  const xb = 0.86; // half width at the beltline
  const xt = 0.74; // half width at the roof
  const zb = 1.15;
  const zt = 1.95;
  const rearB = -2.12;
  const rearT = -2.02;
  const frontB = 0.95;
  const frontT = 0.35;

  // A point on a side plane at a share `u` of the way from the beltline to the roof.
  const side = (sign: 1 | -1, y: number, u: number): Vec3 => [
    sign * (xb + (xt - xb) * u),
    y,
    zb + (zt - zb) * u,
  ];
  const bands: { role: string; b0: number; b1: number; t0: number; t1: number }[] = [
    { role: 'body', b0: frontB, b1: 0.72, t0: frontT, t1: 0.14 }, // A pillar
    { role: 'glass', b0: 0.72, b1: -0.5, t0: 0.14, t1: -0.5 }, // front door glass
    { role: 'body', b0: -0.5, b1: -0.62, t0: -0.5, t1: -0.62 }, // B pillar
    { role: 'glass', b0: -0.62, b1: -1.72, t0: -0.62, t1: -1.72 }, // rear door glass
    { role: 'body', b0: -1.72, b1: rearB, t0: -1.72, t1: rearT }, // C pillar and quarter
  ];
  const faces: Face[] = [];
  for (const sign of [1, -1] as const) {
    for (const band of bands) {
      faces.push({
        role: band.role,
        verts: [side(sign, band.b0, 0), side(sign, band.b1, 0), side(sign, band.t1, 1), side(sign, band.t0, 1)],
      });
    }
  }
  // The roof.
  faces.push({
    role: 'roof',
    verts: [side(1, frontT, 1), side(1, rearT, 1), side(-1, rearT, 1), side(-1, frontT, 1)],
  });
  // The windshield, raked.
  faces.push({
    role: 'glass',
    verts: [side(1, frontB, 0), side(-1, frontB, 0), side(-1, frontT, 1), side(1, frontT, 1)],
  });
  // The tailgate: metal below, glass above, one plane.
  const split = 0.38;
  faces.push({
    role: 'body',
    verts: [side(1, rearB, 0), side(-1, rearB, 0), side(-1, rearB + (rearT - rearB) * split, split), side(1, rearB + (rearT - rearB) * split, split)],
  });
  faces.push({
    role: 'glass',
    verts: [
      side(1, rearB + (rearT - rearB) * split, split),
      side(-1, rearB + (rearT - rearB) * split, split),
      side(-1, rearT, 1),
      side(1, rearT, 1),
    ],
  });
  // The floor closes the solid (never visible from above; it keeps `outward` honest).
  faces.push({
    role: 'body',
    verts: [side(1, frontB, 0), side(1, rearB, 0), side(-1, rearB, 0), side(-1, frontB, 0)],
  });
  return [solid('cabin', faces)];
}

function wheel(id: string, x: number, y: number): Part {
  return cylinder(id, [x, y, WHEEL_RADIUS], 'x', WHEEL_RADIUS, 0.16, 14, { side: 'tyre', sideAlt: 'tread', cap: 'tyre' }, false, true);
}

/** The rim and its spokes, on the outer face of a wheel, turning with it. */
function rimParts(id: string, x: number, y: number, outerSign: 1 | -1): Part[] {
  const pivot: Vec3 = [x, y, WHEEL_RADIUS];
  const px = x + outerSign * 0.165;
  const ring = (r: number, count: number, phase = 0): Vec3[] =>
    Array.from({ length: count }, (_, i) => {
      const a = phase + (i / count) * Math.PI * 2;
      return [px, y + r * Math.cos(a), WHEEL_RADIUS + r * Math.sin(a)];
    });
  const normal: Vec3 = [outerSign, 0, 0];
  const rim = decal(`${id}-rim`, ring(0.27, 14), 'rim', normal);
  // Five spokes as slim quads from the hub to the rim.
  const spokes: Part[] = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2;
    const b = a + 0.16;
    const c = a - 0.16;
    const verts: Vec3[] = [
      [px + outerSign * 0.006, y + 0.06 * Math.cos(c), WHEEL_RADIUS + 0.06 * Math.sin(c)],
      [px + outerSign * 0.006, y + 0.06 * Math.cos(b), WHEEL_RADIUS + 0.06 * Math.sin(b)],
      [px + outerSign * 0.006, y + 0.25 * Math.cos(a + 0.05), WHEEL_RADIUS + 0.25 * Math.sin(a + 0.05)],
      [px + outerSign * 0.006, y + 0.25 * Math.cos(a - 0.05), WHEEL_RADIUS + 0.25 * Math.sin(a - 0.05)],
    ];
    const part = decal(`${id}-spoke-${i}`, verts, 'hub', normal);
    return { ...part, spin: { pivot, axis: 'x' as const } };
  });
  const hub = decal(`${id}-hub`, ring(0.07, 8).map(([hx, hy, hz]) => [hx + outerSign * 0.012, hy, hz] as Vec3), 'rim', normal);
  return [rim, ...spokes, hub];
}

/** Build the car. */
export function buildCar(options: Partial<CarOptions> = {}): Part[] {
  const o = { ...CAR_DEFAULTS, ...options };
  const parts: Part[] = [];

  // Bumpers and sills: the charcoal band the body sits on.
  parts.push(extrude('cladding', chamfered(-0.9, 0.9, -2.36, 2.36, 0.22), 0.34, 0.52, { side: 'cladding', top: 'cladding', bottom: 'cladding' }));
  // The body up to the beltline.
  parts.push(extrude('body', chamfered(-0.95, 0.95, -2.3, 2.3, 0.2), 0.5, 1.15, { side: 'body', top: 'body', bottom: 'body' }));
  parts.push(...cabin());

  // Wheels, with the outer rim on the outside of each.
  const wheelAt: [string, number, number, 1 | -1][] = [
    ['wheel-fl', -0.84, 1.45, -1],
    ['wheel-fr', 0.84, 1.45, 1],
    ['wheel-rl', -0.84, -1.45, -1],
    ['wheel-rr', 0.84, -1.45, 1],
  ];
  for (const [id, x, y, sign] of wheelAt) {
    parts.push(wheel(id, x, y));
    parts.push(...rimParts(id, x, y, sign));
  }

  // Flares over the wheels, in the cladding's charcoal.
  for (const [x0, x1] of [
    [-1.03, -0.95],
    [0.95, 1.03],
  ] as const) {
    for (const y of [1.45, -1.45]) {
      parts.push(box(`flare-${x0 < 0 ? 'l' : 'r'}-${y > 0 ? 'f' : 'r'}`, [x0, y - 0.6, 0.55], [x1, y + 0.6, 0.98], 'cladding'));
    }
  }

  // Roof rails, and the rack across them when asked.
  for (const x of [-0.62, 0.62]) {
    parts.push(box(`rail-${x < 0 ? 'l' : 'r'}`, [x - 0.04, -1.85, 1.95], [x + 0.04, 0.2, 2.06], 'rail'));
  }
  if (o.rack) {
    for (const y of [-1.55, -0.85, -0.15]) {
      parts.push(box(`rack-${y}`, [-0.66, y - 0.035, 2.04], [0.66, y + 0.035, 2.1], 'rail'));
    }
  }

  // Door mirrors, on stalks the outline draws for us.
  if (o.mirrors) {
    for (const sign of [-1, 1] as const) {
      parts.push(box(`mirror-${sign < 0 ? 'l' : 'r'}`, [sign * 0.88, 0.62, 1.26], [sign * 1.06, 0.74, 1.4], 'body'));
    }
  }

  // The spare on the tailgate, a little right of centre as on the real car.
  if (o.spare) {
    parts.push(cylinder('spare', [0.28, -2.44, 1.02], 'y', 0.36, 0.12, 12, { side: 'tyre', sideAlt: 'tread', cap: 'tyre' }, false, false));
    parts.push(
      decal(
        'spare-rim',
        Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return [0.28 + 0.22 * Math.cos(a), -2.565, 1.02 + 0.22 * Math.sin(a)] as Vec3;
        }),
        'rim',
        [0, -1, 0],
      ),
    );
  }

  // Lights and grille on the nose, tail lights on the back — decals a hair
  // off the body's faces.
  const nose = 2.304;
  parts.push(decal('grille', [[-0.4, nose, 0.76], [0.4, nose, 0.76], [0.4, nose, 1.0], [-0.4, nose, 1.0]], 'trim', [0, 1, 0]));
  for (const sign of [-1, 1] as const) {
    parts.push(
      decal(`headlight-${sign < 0 ? 'l' : 'r'}`, [[sign * 0.46, nose, 0.8], [sign * 0.78, nose, 0.8], [sign * 0.78, nose, 1.02], [sign * 0.46, nose, 1.02]], 'light', [0, 1, 0]),
    );
    parts.push(
      decal(`taillight-${sign < 0 ? 'l' : 'r'}`, [[sign * 0.56, -2.304, 0.74], [sign * 0.86, -2.304, 0.74], [sign * 0.86, -2.304, 1.06], [sign * 0.56, -2.304, 1.06]], 'tail', [0, -1, 0]),
    );
  }

  return parts;
}
