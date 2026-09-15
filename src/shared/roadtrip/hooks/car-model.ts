/**
 * The car — a cartoon Toyota Land Cruiser Prado (J120), as parts for
 * `mesh3d.ts`, with the gear the maintainer's own wears.
 *
 * A miniature, not a model: the proportions are a Prado's (a tall, upright
 * SUV, a long hood, roof rails, the spare on the tailgate, the tall tail
 * lights wrapping the rear corners) pushed the way a toy pushes them — wheels
 * a size up, the greenhouse a touch narrower than the body, everything else
 * a flat plane meeting the next at an inked edge. Every part is CONVEX, so
 * the painter's algorithm draws it right from any heading; anything hollow —
 * a bull-bar hoop, the basket's rail, a jerry can's handle — is several boxes,
 * never one part with a hole.
 *
 * The gear (`CarGear`) is modelled from four photographs of the car: the
 * bull bar with its two round lights, the roof basket carrying a solar panel
 * on the left, the aluminium box front right and three jerry cans across the
 * rear (water · petrol · water), the awning bag along the left rail, mud
 * flaps and window visors. Model units are about metres: 4.6 long, 1.9 wide,
 * 1.95 to the roof, the ground at z = 0, the nose toward +y, x to the right.
 * Colours are ROLES, resolved through `carPalette` — the body colour is the
 * author's, the rest is the car's; the FINISH is a light (`carLight`).
 *
 * Pure and DOM-free.
 */

import { DEFAULT_GEAR, effectiveGear, type CarFinish, type CarGear } from '../car-spec';
import {
  DEFAULT_LIGHT,
  box,
  cylinder,
  decal,
  extrude,
  normalise,
  solid,
  type Face,
  type Light,
  type Part,
  type Vec3,
} from './mesh3d';

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
    steel: '#b4b8bd',
    lamp: '#f4f1e0',
    basket: '#26262a',
    solar: '#1b2a44',
    solarFrame: '#2e3339',
    alu: '#b9bcc0',
    jerryWater: '#5f6b3a',
    jerryFuel: '#b8262a',
    bag: '#1d1d1f',
    flap: '#151517',
    visor: '#1a1f26',
    badge: '#c9ccd1',
  };
}

/**
 * The light a finish is seen under. Factory paint keeps the renderer's
 * default — a highlight that lets a dark car read as a shape. A matte
 * coating throws almost no highlight; what keeps it a shape is a broad
 * sheen and a little more ambient, not a specular spot.
 */
export function carLight(finish: CarFinish): Light {
  if (finish === 'matte') return { ...DEFAULT_LIGHT, gloss: 0.04, sheen: 0.12, ambient: 0.48 };
  return DEFAULT_LIGHT;
}

/**
 * The hull's own dimensions, in one place.
 *
 * They were typed twice — once in the extrudes, once again inside
 * `cornerDecal` and the `nose` constant — so a change to the body silently
 * detached the corner lights from the corner they are supposed to lie on.
 * Everything that has to sit ON the hull reads these.
 */
const HULL = {
  halfWidth: 0.95,
  halfLength: 2.3,
  chamfer: 0.2,
  /** The beltline: the body stops here and the greenhouse starts. */
  top: 1.15,
  /** The bottom of the painted bodywork, where the charcoal band takes over. */
  bottom: 0.5,
  /**
   * Above this the body may run its full width, because it is clear of the
   * wheels (whose tops are at 2 × `WHEEL_RADIUS`). Below it, across an axle,
   * the body has to pull in to `archHalfWidth` — that gap IS the wheel arch.
   */
  shoulder: 0.88,
  /** Inboard of this a block clears a wheel, whose inner face is at 0.68. */
  archHalfWidth: 0.66,
};

/** How far each axle's arch reaches fore and aft of the wheel's centre. */
const ARCH = { y: 1.45, half: 0.44 };

/**
 * The plan of a slice of the hull between two y's, the chamfered corners
 * carried through wherever the slice reaches them.
 *
 * The hull is no longer one box: it is a stack of convex slices, because ONE
 * polygon spanning 4.6 m takes its place in the paint order from whichever
 * END is farthest, so the bonnet was being laid down as if it sat at the
 * tailgate and everything painted after it showed through. A slice is keyed
 * by its own extent.
 */
function hullSlice(
  halfWidth: number,
  halfLength: number,
  chamfer: number,
  y0: number,
  y1: number,
): [number, number][] {
  const widthAt = (y: number) => {
    const inFromEnd = halfLength - Math.abs(y);
    return inFromEnd >= chamfer ? halfWidth : Math.max(0, halfWidth - (chamfer - inFromEnd));
  };
  const ys = [y0];
  for (const corner of [-(halfLength - chamfer), halfLength - chamfer]) {
    if (corner > y0 && corner < y1) ys.push(corner);
  }
  ys.push(y1);
  ys.sort((a, b) => a - b);
  const right = ys.map((y) => [widthAt(y), y] as [number, number]);
  const left = [...right].reverse().map(([x, y]) => [-x, y] as [number, number]);
  return [...right, ...left];
}

/**
 * One convex slice of the painted body, between two y's and two heights.
 *
 * `buried` drops the faces that another slice sits directly on: a horizontal
 * surface with an opaque block resting on its whole footprint can never be
 * seen from a camera above, but it is still a face the paint order has to
 * place, and it lands on top of the bodywork often enough to look like a hole
 * in the bonnet. Not building it is the fix.
 */
function hullBlock(
  id: string,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  halfWidth = HULL.halfWidth,
  buried: { top?: boolean; bottom?: boolean } = {},
): Part {
  return extrude(id, hullSlice(halfWidth, HULL.halfLength, HULL.chamfer, y0, y1), z0, z1, {
    side: 'body',
    top: buried.top ? null : 'body',
    bottom: buried.bottom ? null : 'body',
  });
}

// The greenhouse's section: narrower at the roof than at the beltline, the
// windshield raked, the tailgate upright. Shared by the cabin and the visors,
// which sit on the same slanted plane.
const CABIN = {
  xb: 0.86, // half width at the beltline
  xt: 0.74, // half width at the roof
  zb: 1.15,
  zt: 1.95,
  rearB: -2.12,
  rearT: -2.02,
  frontB: 0.95,
  frontT: 0.35,
};

/** A point on a side plane at a share `u` of the way from the beltline to the roof. */
function sidePoint(sign: 1 | -1, y: number, u: number): Vec3 {
  return [sign * (CABIN.xb + (CABIN.xt - CABIN.xb) * u), y, CABIN.zb + (CABIN.zt - CABIN.zb) * u];
}

/** The side plane's outward normal. */
function sideNormal(sign: 1 | -1): Vec3 {
  return normalise([sign * (CABIN.zt - CABIN.zb), 0, CABIN.xb - CABIN.xt]);
}

/** The pillars and windows along the side, from the A pillar back. */
const SIDE_BANDS: { role: string; b0: number; b1: number; t0: number; t1: number }[] = [
  { role: 'body', b0: CABIN.frontB, b1: 0.72, t0: CABIN.frontT, t1: 0.14 }, // A pillar
  { role: 'glass', b0: 0.72, b1: -0.5, t0: 0.14, t1: -0.5 }, // front door glass
  { role: 'body', b0: -0.5, b1: -0.62, t0: -0.5, t1: -0.62 }, // B pillar
  { role: 'glass', b0: -0.62, b1: -1.72, t0: -0.62, t1: -1.72 }, // rear door glass
  { role: 'body', b0: -1.72, b1: CABIN.rearB, t0: -1.72, t1: CABIN.rearT }, // C pillar and quarter
];

/**
 * The greenhouse: its sides split into pillars and windows along one plane,
 * so the glass reads as glass and the pillars keep the body colour.
 */
function cabin(): Part[] {
  const { rearB, rearT, frontB, frontT } = CABIN;
  const faces: Face[] = [];
  for (const sign of [1, -1] as const) {
    for (const band of SIDE_BANDS) {
      faces.push({
        role: band.role,
        verts: [sidePoint(sign, band.b0, 0), sidePoint(sign, band.b1, 0), sidePoint(sign, band.t1, 1), sidePoint(sign, band.t0, 1)],
      });
    }
  }
  // The roof.
  faces.push({
    role: 'roof',
    verts: [sidePoint(1, frontT, 1), sidePoint(1, rearT, 1), sidePoint(-1, rearT, 1), sidePoint(-1, frontT, 1)],
  });
  // The windshield, raked.
  faces.push({
    role: 'glass',
    verts: [sidePoint(1, frontB, 0), sidePoint(-1, frontB, 0), sidePoint(-1, frontT, 1), sidePoint(1, frontT, 1)],
  });
  // The tailgate: metal below, glass above, one plane.
  const split = 0.38;
  const ySplit = rearB + (rearT - rearB) * split;
  faces.push({
    role: 'body',
    verts: [sidePoint(1, rearB, 0), sidePoint(-1, rearB, 0), sidePoint(-1, ySplit, split), sidePoint(1, ySplit, split)],
  });
  faces.push({
    role: 'glass',
    verts: [sidePoint(1, ySplit, split), sidePoint(-1, ySplit, split), sidePoint(-1, rearT, 1), sidePoint(1, rearT, 1)],
  });
  // The floor closes the solid (never visible from above; it keeps `outward` honest).
  faces.push({
    role: 'body',
    verts: [sidePoint(1, frontB, 0), sidePoint(1, rearB, 0), sidePoint(-1, rearB, 0), sidePoint(-1, frontB, 0)],
  });
  return [solid('cabin', faces)];
}

/** The tinted visors over the two door windows, a hair off the side plane. */
function visors(): Part[] {
  const parts: Part[] = [];
  const u0 = 0.8;
  for (const sign of [1, -1] as const) {
    const n = sideNormal(sign);
    const lift = (p: Vec3): Vec3 => [p[0] + n[0] * 0.012, p[1] + n[1] * 0.012, p[2] + n[2] * 0.012];
    SIDE_BANDS.filter((band) => band.role === 'glass').forEach((band, i) => {
      // The band's front edge may be raked: interpolate its y along the height.
      const yAt = (u: number) => band.b0 + (band.t0 - band.b0) * u;
      const verts: Vec3[] = [
        lift(sidePoint(sign, yAt(u0), u0)),
        lift(sidePoint(sign, band.b1, u0)),
        lift(sidePoint(sign, band.t1, 1)),
        lift(sidePoint(sign, band.t0, 1)),
      ];
      parts.push(decal(`visor-${sign < 0 ? 'l' : 'r'}-${i}`, verts, 'visor', n));
    });
  }
  return parts;
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

/**
 * The heights a decal on the hull's nose or tail must be cut at.
 *
 * A decal is ordered exactly only while it lies INSIDE the one face it is
 * pushed off (depth is linear over a plane, so the far end of a contained
 * polygon cannot be farther than its container's). The hull is split at the
 * shoulder, so a lamp that crosses that line belongs to two faces at once and
 * the upper block paints over its own lamp. Cut it instead: a decal carries
 * no ink of its own, so the seam is invisible.
 */
function bands(z0: number, z1: number): [number, number][] {
  const s = HULL.shoulder;
  return z0 < s && z1 > s ? [[z0, s], [s, z1]] : [[z0, z1]];
}

/** A quad on one of the body's chamfered corners, pushed a hair off it. */
function cornerDecal(id: string, role: string, xSign: 1 | -1, ySign: 1 | -1, z0: number, z1: number): Part[] {
  // The corner segment runs from (x1, y1 − c) to (x1 − c, y1) on the ±x, ±y corner.
  const { halfWidth: w, halfLength: l, chamfer: c } = HULL;
  const ax = xSign * w;
  const ay = ySign * (l - c);
  const bx = xSign * (w - c);
  const by = ySign * l;
  const n = normalise([xSign, ySign, 0]);
  const at = (t: number, z: number): Vec3 => [ax + (bx - ax) * t + n[0] * 0.004, ay + (by - ay) * t + n[1] * 0.004, z];
  return bands(z0, z1).map(([a, b], i) =>
    decal(i === 0 ? id : `${id}-${i}`, [at(0.15, a), at(0.85, a), at(0.85, b), at(0.15, b)], role, n),
  );
}

/** A flat lamp or bar on the hull's nose or tail, cut at the shoulder if it crosses. */
function faceDecal(id: string, role: string, x0: number, x1: number, y: number, z0: number, z1: number): Part[] {
  const n: Vec3 = y > 0 ? [0, 1, 0] : [0, -1, 0];
  return bands(z0, z1).map(([a, b], i) =>
    decal(i === 0 ? id : `${id}-${i}`, [[x0, y, a], [x1, y, a], [x1, y, b], [x0, y, b]], role, n),
  );
}

/** The bull bar: a hoop around each headlight, a bar across the top, a plate below. */
function bullBar(withLights: boolean): Part[] {
  const parts: Part[] = [];
  const y0 = 2.5;
  const y1 = 2.6;
  parts.push(box('bullbar-top', [-0.92, y0, 1.14], [0.92, y1, 1.24], 'steel'));
  parts.push(box('bullbar-low', [-0.92, y0, 0.56], [0.92, y1, 0.66], 'steel'));
  parts.push(box('bullbar-pan', [-0.92, 2.37, 0.34], [0.92, 2.56, 0.56], 'steel'));
  for (const s of [-1, 1] as const) {
    const side = s < 0 ? 'l' : 'r';
    parts.push(box(`bullbar-hoop-${side}-in`, [s * 0.4, y0, 0.66], [s * 0.5, y1, 1.14], 'steel'));
    parts.push(box(`bullbar-hoop-${side}-out`, [s * 0.84, y0, 0.66], [s * 0.94, y1, 1.14], 'steel'));
  }
  if (withLights) {
    for (const s of [-1, 1] as const) {
      const side = s < 0 ? 'l' : 'r';
      const centre: Vec3 = [s * 0.4, 2.55, 1.34];
      parts.push(cylinder(`spot-${side}`, centre, 'y', 0.1, 0.06, 10, { side: 'trim', cap: 'trim' }, false, false));
      parts.push(
        decal(
          `spot-${side}-lamp`,
          Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return [centre[0] + 0.08 * Math.cos(a), centre[1] + 0.064, centre[2] + 0.08 * Math.sin(a)] as Vec3;
          }),
          'lamp',
          [0, 1, 0],
        ),
      );
    }
  }
  return parts;
}

/** The roof basket, and what rides in it. */
function basket(gear: CarGear): Part[] {
  const parts: Part[] = [];
  // The floor sits INSIDE its four rails and on top of the roof rails, rather
  // than through them: the basket used to be modelled with every piece a few
  // centimetres into its neighbour, and two solids sharing a volume have no
  // right order at all.
  const z0 = 2.06;
  const inner = { x: 0.65, y0: -1.86, y1: 0.26 };
  parts.push(box('basket-floor', [-inner.x, inner.y0, z0], [inner.x, inner.y1, z0 + 0.03], 'basket'));
  parts.push(box('basket-front', [-0.7, inner.y1, z0], [0.7, inner.y1 + 0.05, z0 + 0.19], 'basket'));
  parts.push(box('basket-back', [-0.7, inner.y0 - 0.05, z0], [0.7, inner.y0, z0 + 0.19], 'basket'));
  parts.push(box('basket-left', [-0.7, inner.y0, z0], [-inner.x, inner.y1, z0 + 0.19], 'basket'));
  parts.push(box('basket-right', [inner.x, inner.y0, z0], [0.7, inner.y1, z0 + 0.19], 'basket'));
  const top = z0 + 0.03;
  if (gear.solar) {
    parts.push(box('solar-frame', [-0.64, -1.3, top], [-0.06, 0.22, top + 0.03], 'solarFrame'));
    parts.push(
      decal(
        'solar-panel',
        [[-0.62, -1.28, top + 0.034], [-0.08, -1.28, top + 0.034], [-0.08, 0.2, top + 0.034], [-0.62, 0.2, top + 0.034]],
        'solar',
        [0, 0, 1],
      ),
    );
  }
  if (gear.box) parts.push(box('storage-box', [0.08, -1.0, top], [0.62, 0.22, top + 0.36], 'alu'));
  if (gear.jerryCans) {
    const cans: [string, number, string][] = [
      ['jerry-water-l', -0.43, 'jerryWater'],
      ['jerry-fuel', 0, 'jerryFuel'],
      ['jerry-water-r', 0.43, 'jerryWater'],
    ];
    for (const [id, cx, role] of cans) {
      parts.push(box(id, [cx - 0.17, -1.84, top], [cx + 0.17, -1.47, top + 0.42], role));
      parts.push(box(`${id}-handle`, [cx - 0.05, -1.71, top + 0.42], [cx + 0.05, -1.6, top + 0.49], role));
    }
  }
  if (gear.awning) parts.push(box('awning-bag', [-0.82, -1.9, z0 + 0.04], [-0.7, 0.1, z0 + 0.19], 'bag'));
  return parts;
}

/** The mud flaps behind each wheel. */
function mudFlaps(): Part[] {
  const parts: Part[] = [];
  for (const [id, x, y] of [
    ['flap-fl', -0.84, 1.45],
    ['flap-fr', 0.84, 1.45],
    ['flap-rl', -0.84, -1.45],
    ['flap-rr', 0.84, -1.45],
  ] as const) {
    const s = x < 0 ? -1 : 1;
    parts.push(box(id, [s * 0.72, y - 0.66, 0.1], [s * 0.98, y - 0.62, 0.5], 'flap'));
  }
  return parts;
}

/** Build the car, with the gear asked for (the maintainer's, by default). */
export function buildCar(gear: CarGear = DEFAULT_GEAR): Part[] {
  const g = effectiveGear(gear);
  const parts: Part[] = [];

  // Bumpers and sills: the charcoal band the body sits on. Split at the axles
  // like the body above it, and pulled in to the arch width between them, so
  // no wheel is modelled inside it. Its top meets the body's bottom exactly —
  // it used to reach 0.02 INTO it, which no paint order can resolve.
  const CLAD = { halfWidth: 0.9, halfLength: 2.36, chamfer: 0.22, z0: 0.34, z1: HULL.bottom };
  const cladSlice = (id: string, y0: number, y1: number, halfWidth = CLAD.halfWidth, buriedTop = false) =>
    extrude(id, hullSlice(halfWidth, CLAD.halfLength, CLAD.chamfer, y0, y1), CLAD.z0, CLAD.z1, {
      side: 'cladding',
      top: buriedTop ? null : 'cladding',
      bottom: 'cladding',
    });
  const archF0 = ARCH.y - ARCH.half;
  const archF1 = ARCH.y + ARCH.half;
  parts.push(cladSlice('cladding-front', archF1, CLAD.halfLength));
  parts.push(cladSlice('cladding-sill', -archF1, archF1, HULL.archHalfWidth, true));
  parts.push(cladSlice('cladding-rear', -CLAD.halfLength, -archF1));

  // The painted body, to the beltline — a stack of convex slices rather than
  // one box 4.6 m long. Above the shoulder it runs full width and is split
  // only where a car really has a shut line: the base of the windscreen and
  // the top of the tailgate. Below the shoulder it is split at the arches and
  // pulled inboard across each axle, which is what stops a wheel from living
  // inside it.
  const { bottom, top, shoulder, halfLength: L } = HULL;
  const onSkirt = { bottom: true };
  const underBody = { top: true, bottom: true };
  parts.push(hullBlock('body-bonnet', CABIN.frontB, L, shoulder, top, HULL.halfWidth, onSkirt));
  parts.push(hullBlock('body-roof', CABIN.rearB, CABIN.frontB, shoulder, top, HULL.halfWidth, onSkirt));
  parts.push(hullBlock('body-lip', -L, CABIN.rearB, shoulder, top, HULL.halfWidth, onSkirt));
  // Across each axle the skirt simply is not there — that gap IS the arch, and
  // the wheel standing in it is what you see. An inner wing modelled in the
  // gap would be hidden by the wheel from every angle the camera can take, and
  // its buried end walls, tying with the neighbouring block's, sorted on top of
  // the bonnet. The cheapest correct surface is the one not built.
  parts.push(hullBlock('body-skirt-nose', archF1, L, bottom, shoulder, HULL.halfWidth, underBody));
  parts.push(hullBlock('body-skirt-mid', -archF0, archF0, bottom, shoulder, HULL.halfWidth, underBody));
  parts.push(hullBlock('body-skirt-tail', -L, -archF1, bottom, shoulder, HULL.halfWidth, underBody));
  parts.push(...cabin());
  if (g.visors) parts.push(...visors());

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
  if (g.mudFlaps) parts.push(...mudFlaps());

  // Flares over the wheels, in the cladding's charcoal: an eyebrow standing
  // proud of the flank ABOVE the tyre, not a slab beside it. It starts where
  // the body's side ends and sits on the shoulder, so it touches the wheel and
  // the body without sharing a volume with either.
  for (const side of [-1, 1] as const) {
    for (const y of [ARCH.y, -ARCH.y]) {
      const id = `flare-${side < 0 ? 'l' : 'r'}-${y > 0 ? 'f' : 'r'}`;
      const x0 = side * HULL.halfWidth;
      const x1 = side * (HULL.halfWidth + 0.11);
      parts.push(box(id, [x0, y - 0.6, HULL.shoulder], [x1, y + 0.6, HULL.shoulder + 0.14], 'cladding'));
    }
  }

  // Roof rails, and the basket on them when asked.
  for (const x of [-0.62, 0.62]) {
    parts.push(box(`rail-${x < 0 ? 'l' : 'r'}`, [x - 0.04, -1.85, 1.95], [x + 0.04, 0.2, 2.06], 'rail'));
  }
  if (g.rack) parts.push(...basket(g));

  // Door mirrors, on stalks the outline draws for us.
  if (g.mirrors) {
    for (const sign of [-1, 1] as const) {
      parts.push(box(`mirror-${sign < 0 ? 'l' : 'r'}`, [sign * 0.88, 0.62, 1.26], [sign * 1.06, 0.74, 1.4], 'body'));
    }
  }

  // The spare on the tailgate, a little right of centre as on the real car —
  // which is the left when seen from behind.
  if (g.spare) {
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

  // The nose: wraparound headlights, a barred grille with its badge; the
  // tail: tall clusters wrapping the rear corners into the pillars — decals a
  // hair off the body's faces.
  const nose = HULL.halfLength + 0.004;
  const tail = -nose;
  // The nose face is only 1.5 wide where the chamfer starts, so a lamp is kept
  // inside it — a decal that overhangs its host is exactly what the paint
  // order cannot resolve.
  const noseHalf = HULL.halfWidth - HULL.chamfer;
  for (const z of [0.78, 0.86, 0.94]) {
    parts.push(...faceDecal(`grille-${z}`, 'trim', -0.36, 0.36, nose, z, z + 0.06));
  }
  parts.push(
    decal(
      'badge',
      Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        // Above the shoulder, so the one round decal never needs cutting.
        return [0.07 * Math.cos(a), nose + 0.003, 1.0 + 0.07 * Math.sin(a)] as Vec3;
      }),
      'badge',
      [0, 1, 0],
    ),
  );
  for (const sign of [-1, 1] as const) {
    const side = sign < 0 ? 'l' : 'r';
    parts.push(...faceDecal(`headlight-${side}`, 'light', sign * 0.4, sign * noseHalf, nose, 0.76, 1.08));
    parts.push(...cornerDecal(`headlight-${side}-wrap`, 'light', sign, 1, 0.78, 1.06));
    parts.push(...faceDecal(`taillight-${side}`, 'tail', sign * 0.5, sign * noseHalf, tail, 0.56, 1.12));
    parts.push(...cornerDecal(`taillight-${side}-wrap`, 'tail', sign, -1, 0.56, 1.12));
  }

  if (g.bullBar) parts.push(...bullBar(g.spotLights));

  return parts;
}
