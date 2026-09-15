/**
 * The paint order, checked against the truth for every angle the car is seen at.
 *
 * `renderOrder` has no depth buffer: it decides, once per frame, a single
 * sequence for every visible face and `paintMesh` draws them in it. When that
 * sequence is wrong a face is painted over something in front of it and a
 * piece of the car simply is not there — silently, in a preview and in an
 * export alike, with no gate anywhere able to see it (the trap
 * `media-pipeline.md` records for the shader).
 *
 * So this is the gate, and it judges the PICTURE rather than the algorithm.
 * It rebuilds the geometry independently of `renderOrder` — its own transform,
 * its own culling, its own per-vertex depths — then walks the painted sequence
 * over a grid of screen samples keeping two things at each one: the last face
 * laid down over it, and the nearest face covering it. Where those disagree,
 * that is a point of the car showing the wrong surface. Counting samples is
 * what makes the answer readable: a vanished cabin is thousands of them, the
 * seam where two solids are modelled into each other is a handful.
 *
 * Pure geometry, no DOM, no canvas.
 */

import { describe, expect, it } from 'vitest';
import { buildCar } from './car-model';
import {
  cross,
  dot,
  faceNormal,
  project,
  rotateAbout,
  sub,
  toWorld,
  viewDirection,
  renderOrder,
  type Part,
  type Pose,
  type Vec3,
} from './mesh3d';

/** Pixels per model unit — the car lands about 280px long, as on a phone. */
const SCALE = 60;

/** The sampling grid, in pixels. Fine enough to see a 20px blemish. */
const STEP = 2;

/**
 * How much nearer a face must be to count as really in front, in model units.
 * Under the decals' own 0.004 push off their host, so a decal falling behind
 * its surface is still caught; over the noise of two surfaces that touch.
 */
const EPSILON = 1e-3;

/**
 * The least of itself a part may show where it is the nearest thing to the
 * camera. THIS is the fault the maintainer reported — a piece of the car
 * simply not being there — so this is the gate that matters.
 *
 * It is not 100%, and the reason is no longer that solids are modelled into
 * each other: the hull is cut into panels with real arches and nothing shares
 * a volume any more. What is left is that a long panel is still keyed by its
 * FARTHEST corner, so the bonnet sorts a little behind where its front half
 * really is. Measured over the sweep the worst part keeps 36%, against 20%
 * before the hull was cut and 0% under the ordering before that.
 */
const MIN_KEPT = 0.3;

/** Below this a part is a speck on screen and a share of it means nothing. */
const MIN_CLAIM = 40;

/**
 * How much of one view of the car may show a surface that is not the nearest
 * one — a canary over the whole picture, where `MIN_KEPT` watches each part.
 *
 * Measured worst pose: 7.3%. It was 13.5% while the body was one box 4.6 m
 * long with the wheels modelled inside it, and 37% under the ordering before
 * that. What remains is the long-panel keying above, not geometry sharing a
 * volume.
 */
const TOLERANCE = 0.09;

const poseAt = (headingDeg: number, tiltDeg: number): Pose => ({
  fx: Math.sin((headingDeg * Math.PI) / 180),
  fy: Math.cos((headingDeg * Math.PI) / 180),
  tilt: (tiltDeg * Math.PI) / 180,
  scale: SCALE,
  x: 0,
  y: 0,
  spins: {},
});

interface Pt {
  x: number;
  y: number;
}

/** One face as the oracle sees it: where it lands, and how deep it is there. */
interface Seen {
  partId: string;
  /** The outline, wound counter-clockwise so one sign test decides "inside". */
  ring: Pt[];
  /** Depth as an affine function of the screen point: a·x + b·y + c. */
  plane: { a: number; b: number; c: number };
  box: { x0: number; x1: number; y0: number; y1: number };
}

/** The face's projected outline, keyed so a `RenderedFace` can be matched to it. */
const keyOf = (points: readonly Pt[]) =>
  points.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join('|');

const signedArea = (poly: readonly Pt[]) => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};

/**
 * Depth over the face, as a plane in screen coordinates. The projection is
 * affine and the face is planar, so depth really is affine in (x, y) — fitted
 * from the most spread-out three of its corners, so a sliver is not fitted
 * from three points in a row.
 */
function fitPlane(points: readonly Pt[], depths: readonly number[]): { a: number; b: number; c: number } | null {
  let best: [number, number, number] | null = null;
  let bestArea = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      for (let k = j + 1; k < points.length; k++) {
        const area = Math.abs(
          (points[j].x - points[i].x) * (points[k].y - points[i].y) -
            (points[k].x - points[i].x) * (points[j].y - points[i].y),
        );
        if (area > bestArea) {
          bestArea = area;
          best = [i, j, k];
        }
      }
    }
  }
  if (!best || bestArea < 1e-9) return null;
  const [i, j, k] = best;
  const ax = points[j].x - points[i].x;
  const ay = points[j].y - points[i].y;
  const ad = depths[j] - depths[i];
  const bx = points[k].x - points[i].x;
  const by = points[k].y - points[i].y;
  const bd = depths[k] - depths[i];
  const det = ax * by - bx * ay;
  if (Math.abs(det) < 1e-9) return null;
  const a = (ad * by - bd * ay) / det;
  const b = (ax * bd - bx * ad) / det;
  return { a, b, c: depths[i] - a * points[i].x - b * points[i].y };
}

/**
 * Every face the camera can see, rebuilt from the model without asking
 * `renderOrder` anything — the same spin, the same world transform and the
 * same back-face rule, written again so the oracle and the thing it judges
 * cannot share a mistake.
 */
function seenFaces(parts: readonly Part[], pose: Pose): Map<string, Seen> {
  const view = viewDirection(pose.tilt);
  const out = new Map<string, Seen>();
  for (const part of parts) {
    const spin = part.spin ? (pose.spins?.[part.id] ?? 0) : 0;
    for (const face of part.faces) {
      const world = face.verts.map((v) => {
        const turned = part.spin && spin !== 0 ? rotateAbout(v, part.spin.pivot, part.spin.axis, spin) : v;
        return toWorld(turned, pose);
      });
      const n = faceNormal(world);
      if (dot(n, view) >= -1e-9) continue;
      const projected = world.map((w) => project(w, pose));
      const points = projected.map(({ x, y }) => ({ x, y }));
      const plane = fitPlane(
        points,
        projected.map((p) => p.depth),
      );
      if (!plane) continue;
      out.set(keyOf(points), {
        partId: part.id,
        ring: signedArea(points) < 0 ? [...points].reverse() : points,
        plane,
        box: {
          x0: Math.min(...points.map((p) => p.x)),
          x1: Math.max(...points.map((p) => p.x)),
          y0: Math.min(...points.map((p) => p.y)),
          y1: Math.max(...points.map((p) => p.y)),
        },
      });
    }
  }
  return out;
}

/** Whether a screen point is inside the CONVEX projected face. */
function inside(face: Seen, x: number, y: number): boolean {
  const poly = face.ring;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
  }
  return true;
}

interface Wrong {
  /** The part the paint left on top, and the one that is really nearest there. */
  painted: string;
  nearest: string;
  samples: number;
}

/** What one part should be showing of itself, and what it actually shows. */
interface Kept {
  id: string;
  /** Samples where this part is the nearest thing to the camera. */
  claimed: number;
  /** Of those, the ones where it is also what the paint left on top. */
  kept: number;
}

interface Verdict {
  wrong: Wrong[];
  parts: Kept[];
  /** Samples showing the wrong surface, and samples on the car at all. */
  bad: number;
  covered: number;
}

/**
 * What the paint leaves on screen, against what should be there — a depth
 * buffer, sampled. The pairwise question ("is this face over that one?") is
 * the harsher one and the wrong one: a pair in the wrong order that a third
 * face later covers shows nobody anything.
 */
function mispainted(parts: readonly Part[], pose: Pose): Verdict {
  const seen = seenFaces(parts, pose);
  const drawn = renderOrder(parts, pose);
  const faces = drawn.map((f) => seen.get(keyOf(f.points)));
  // Every face the renderer draws must be one the oracle also saw; a mismatch
  // would mean the two disagree about culling, which is its own bug.
  expect(faces.filter((f) => f === undefined)).toEqual([]);
  const order = faces as Seen[];
  if (!order.length) return { wrong: [], parts: [], bad: 0, covered: 0 };

  const x0 = Math.floor(Math.min(...order.map((f) => f.box.x0)));
  const x1 = Math.ceil(Math.max(...order.map((f) => f.box.x1)));
  const y0 = Math.floor(Math.min(...order.map((f) => f.box.y0)));
  const y1 = Math.ceil(Math.max(...order.map((f) => f.box.y1)));
  const w = Math.ceil((x1 - x0) / STEP) + 1;
  const h = Math.ceil((y1 - y0) / STEP) + 1;
  const painted = new Int32Array(w * h).fill(-1);
  const nearest = new Int32Array(w * h).fill(-1);
  const best = new Float64Array(w * h).fill(Infinity);

  order.forEach((face, index) => {
    const i0 = Math.max(0, Math.floor((face.box.x0 - x0) / STEP));
    const i1 = Math.min(w - 1, Math.ceil((face.box.x1 - x0) / STEP));
    const j0 = Math.max(0, Math.floor((face.box.y0 - y0) / STEP));
    const j1 = Math.min(h - 1, Math.ceil((face.box.y1 - y0) / STEP));
    for (let j = j0; j <= j1; j++) {
      const y = y0 + j * STEP;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + i * STEP;
        if (!inside(face, x, y)) continue;
        const k = j * w + i;
        painted[k] = index;
        const d = face.plane.a * x + face.plane.b * y + face.plane.c;
        if (d < best[k] - EPSILON) {
          best[k] = d;
          nearest[k] = index;
        }
      }
    }
  });

  const byPair = new Map<string, Wrong>();
  const byPart = new Map<string, Kept>();
  let covered = 0;
  let bad = 0;
  for (let k = 0; k < painted.length; k++) {
    if (painted[k] < 0) continue;
    covered += 1;
    const a = order[painted[k]].partId;
    const b = order[nearest[k]].partId;
    const tally = byPart.get(b) ?? { id: b, claimed: 0, kept: 0 };
    tally.claimed += 1;
    if (a === b) tally.kept += 1;
    byPart.set(b, tally);
    if (painted[k] === nearest[k]) continue;
    // Two visible faces of one convex part cannot overlap; a disagreement
    // inside one is the grid landing on the seam between them.
    if (a === b) continue;
    bad += 1;
    const key = `${a} left on top of ${b}`;
    const got = byPair.get(key) ?? { painted: a, nearest: b, samples: 0 };
    got.samples += 1;
    byPair.set(key, got);
  }
  return {
    wrong: [...byPair.values()].sort((p, q) => q.samples - p.samples),
    parts: [...byPart.values()],
    bad,
    covered,
  };
}

const GEARED = buildCar();

/** Twelve headings around the turntable; the shallow end of the tilt range,
 *  the garage's own default, and a near-overhead map view. */
const HEADINGS = Array.from({ length: 12 }, (_, i) => i * 30);
const TILTS = [35, 52, 80];

describe('the car is painted in the right order', () => {
  /**
   * The gate. Every part the camera can see must actually be SEEN: where a
   * part is the nearest thing to the eye, it has to be what the paint left on
   * top, over most of that area. A part ordered wrongly against something
   * that spans it does not look subtly off — it is gone.
   */
  it('never buries a part that should be on top', () => {
    const buried: string[] = [];
    for (const tilt of TILTS) {
      for (const heading of HEADINGS) {
        for (const part of mispainted(GEARED, poseAt(heading, tilt)).parts) {
          if (part.claimed < MIN_CLAIM) continue;
          const kept = part.kept / part.claimed;
          if (kept < MIN_KEPT) {
            buried.push(
              `heading ${heading}° tilt ${tilt}°: ${part.id} shows ${(kept * 100).toFixed(0)}% ` +
                `of the ${part.claimed} samples where it is the nearest surface`,
            );
          }
        }
      }
    }
    expect(buried, buried.join('\n')).toEqual([]);
  });

  it('shows the nearest surface over nearly all of the car, at every angle', () => {
    const lines: string[] = [];
    for (const tilt of TILTS) {
      for (const heading of HEADINGS) {
        const { wrong, bad, covered } = mispainted(GEARED, poseAt(heading, tilt));
        const share = bad / covered;
        if (share > TOLERANCE) {
          lines.push(
            `heading ${heading}° tilt ${tilt}°: ${(share * 100).toFixed(1)}% shows the wrong surface — ` +
              wrong
                .slice(0, 4)
                .map((x) => `${x.painted} over ${x.nearest} (${x.samples})`)
                .join(', '),
          );
        }
      }
    }
    expect(lines, lines.join('\n')).toEqual([]);
  });

  // The two failures measured on the part-centre ordering this replaced. They
  // are pinned so a future "simplification" back to a per-part sort fails here
  // with the angle that proves it, rather than in someone's eyes weeks later.
  it('keeps the cabin over the body’s full-length top face, nose toward the camera', () => {
    for (const heading of [150, 180, 210]) {
      const wrong = mispainted(GEARED, poseAt(heading, 35)).wrong.filter(
        (w) => w.painted === 'body' && w.nearest === 'cabin',
      );
      expect(wrong.map((w) => `heading ${heading}°: ${w.painted} over ${w.nearest} (${w.samples})`)).toEqual([]);
    }
  });

  it('keeps the wrap-around corner lights over the body that carries them', () => {
    const lines: string[] = [];
    for (const tilt of [35, 52, 58, 80]) {
      for (let heading = 40; heading <= 75; heading += 5) {
        for (const w of mispainted(GEARED, poseAt(heading, tilt)).wrong) {
          if (w.nearest.endsWith('-wrap')) {
            lines.push(`heading ${heading}° tilt ${tilt}°: ${w.painted} over ${w.nearest} (${w.samples})`);
          }
        }
      }
    }
    expect(lines, lines.join('\n')).toEqual([]);
  });

  it('paints every face in one sequence, farthest first', () => {
    const faces = renderOrder(GEARED, poseAt(56, 52));
    expect(faces.length).toBeGreaterThan(80);
    for (let i = 1; i < faces.length; i++) {
      expect(faces[i].depth).toBeLessThanOrEqual(faces[i - 1].depth);
    }
  });

  it('paints the same sequence twice for the same pose', () => {
    const roles = () => renderOrder(GEARED, poseAt(56, 52)).map((f) => `${f.role}:${f.depth.toFixed(6)}`);
    expect(roles()).toEqual(roles());
  });
});

/**
 * Sorting faces globally rests on every part being CONVEX: that is what makes
 * back-face culling alone leave exactly the faces you can see, none of them
 * overlapping another of the same part. It has always been prose in
 * `mesh3d.ts`; here it is a test, so a new fitting that is a hoop with a hole
 * in it fails the build instead of the picture.
 */
describe('every part of the car is convex', () => {
  it('puts every vertex behind every one of its own faces', () => {
    const bad = new Set<string>();
    for (const part of GEARED) {
      if (part.faces.length < 2) continue;
      const verts: Vec3[] = part.faces.flatMap((f) => [...f.verts]);
      for (const face of part.faces) {
        const n = faceNormal(face.verts);
        const d = dot(n, face.verts[0]);
        for (const v of verts) {
          if (dot(n, v) > d + 1e-6) {
            bad.add(`${part.id}: a vertex sits ${(dot(n, v) - d).toFixed(4)} outside one of its own faces`);
            break;
          }
        }
      }
    }
    expect([...bad], [...bad].join('\n')).toEqual([]);
  });

  it('gives every face a real normal and keeps it flat', () => {
    for (const part of GEARED) {
      for (const face of part.faces) {
        expect(face.verts.length, part.id).toBeGreaterThanOrEqual(3);
        // Newell's normal is a unit vector for any polygon that has area.
        const n = faceNormal(face.verts);
        expect(Math.hypot(n[0], n[1], n[2]), part.id).toBeCloseTo(1, 9);
        const d = dot(n, face.verts[0]);
        for (const v of face.verts) expect(Math.abs(dot(n, v) - d), part.id).toBeLessThan(1e-6);
      }
    }
  });

  it('drops a face with no area rather than painting a sliver', () => {
    const flat: Part = {
      id: 'flat',
      // Three points in a row: a polygon with no area, whose normal is a guess.
      faces: [{ role: 'body', verts: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] }],
      centre: [1, 0, 0],
      outline: true,
    };
    expect(renderOrder([flat], poseAt(0, 52))).toEqual([]);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(sub([3, 3, 3], [1, 2, 3])).toEqual([2, 1, 0]);
  });
});
