import { describe, expect, it } from 'vitest';
import { KADJAR_RIM, arc, cappedRim, clipX, level, lifted, makeBody, meet, rimFor, roadWheel, spokedRim, through, type P2 } from './car-parts';
import { faceNormal } from './mesh3d';

const BODY = makeBody({
  halfLength: 2,
  halfWidth: 0.9,
  outline: [...arc(0.7, -1.8, 0.2, -90, 0, 2), ...arc(0.6, 1.7, 0.3, 0, 90, 3)],
  cuts: [0.4, 0.8],
});

describe('the plane arithmetic', () => {
  it('passes a plane through two points and lifts it', () => {
    const p = through(0, 1, 2, 2);
    expect(p.z).toBe(1);
    expect(p.dy).toBe(0.5);
    expect(lifted(p, 0.25).z).toBe(1.25);
    expect(meet([0, 0], [1, 1], level(1))).toEqual([1, 1]);
  });

  it('clips a convex plan to a band of x, exactly on the edges', () => {
    const square: P2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const cut = clipX(square, -0.5, 0.5);
    expect(cut.every(([x]) => x >= -0.5 && x <= 0.5)).toBe(true);
    expect(cut.some(([x]) => x === 0.5) && cut.some(([x]) => x === -0.5)).toBe(true);
    expect(clipX(square, -Infinity, Infinity)).toEqual(square);
  });
});

describe('a body', () => {
  it('reads its half width off the outline, straight between the corners', () => {
    expect(BODY.halfWidthAt(0)).toBeCloseTo(0.9, 9);
    expect(BODY.halfWidthAt(2)).toBeCloseTo(0.6, 9);
    expect(BODY.halfWidthAt(-2)).toBeCloseTo(0.7, 9);
  });

  it('cuts a decal at every hull cut it crosses and nowhere else', () => {
    expect(BODY.bands(0.2, 0.6)).toEqual([[0.2, 0.4], [0.4, 0.6]]);
    expect(BODY.bands(0.5, 0.7)).toEqual([[0.5, 0.7]]);
    expect(BODY.bands(0.2, 1)).toHaveLength(3);
    // The nose band crossing the shoulder is two decals on the nose face.
    const parts = BODY.acrossFace('g', 'grille', 2, 0.3, 0.6, 0.9, 0.004);
    expect(parts.map((p) => p.id)).toEqual(['g', 'g-1']);
    for (const p of parts) expect(faceNormal(p.faces[0].verts)[1]).toBeGreaterThan(0.99);
  });

  it('builds a hull slice with no bottom and no buried end, its top in the role asked', () => {
    const slice = BODY.hull('s', -1, 0, level(0.4), level(0.8), 'body', { top: true, topRole: 'roof', buried: { front: true } });
    expect(slice.faces.some((f) => f.role === 'roof')).toBe(true);
    expect(slice.faces.some((f) => faceNormal(f.verts)[2] < -0.9)).toBe(false);
    expect(slice.faces.some((f) => faceNormal(f.verts)[1] > 0.9)).toBe(false);
    expect(slice.faces.some((f) => faceNormal(f.verts)[1] < -0.9)).toBe(true);
  });

  it('mirrors a wall decal and a side decal on both sides, pushed off the surface', () => {
    const wall = BODY.wallDecal('lamp', 'light', [0, 2], [0.6, 2], 0.3, 1, 0.5, 0.7);
    expect(wall.map((p) => p.id)).toEqual(['lamp-r', 'lamp-l']);
    expect(wall[0].centre[0]).toBeGreaterThan(0);
    expect(wall[1].centre[0]).toBeLessThan(0);
    expect(wall[0].centre[1]).toBeCloseTo(2.004, 9);
    const side = BODY.sideDecal('h', 'chrome', -0.5, -0.3, level(0.9), level(1));
    expect(Math.abs(side[0].centre[0])).toBeCloseTo(0.904, 9);
    expect(BODY.diamond('d', -2, 1, 0.1, 0.004).faces[0].role).toBe('chrome');
    expect(BODY.diamond('d', -2, 1, 0.1, 0.004, 'badge').faces[0].role).toBe('badge');
  });
});

describe('the wheels', () => {
  const spec = { radius: 0.35, half: 0.12 };

  it('stand on the ground and spin about their axle', () => {
    const wheel = roadWheel('w', 0.8, 1, spec);
    expect(wheel.spin?.axis).toBe('x');
    expect(wheel.centre[2]).toBeCloseTo(0.35, 6);
    expect(Math.min(...wheel.faces.flatMap((f) => f.verts.map((v) => v[2])))).toBeGreaterThanOrEqual(0);
  });

  it('scale the Kadjar’s rim to another wheel', () => {
    expect(rimFor(0.39)).toEqual(KADJAR_RIM);
    expect(rimFor(0.78).disc).toBeCloseTo(0.54, 9);
  });

  it('draw spokes or vents that turn with the wheel, on its outer face', () => {
    for (const parts of [spokedRim('w', 0.8, 1, 1, spec, rimFor(0.35)), cappedRim('w', 0.8, 1, 1, spec)]) {
      const turning = parts.filter((p) => p.spin);
      expect(turning.length).toBeGreaterThanOrEqual(5);
      for (const p of parts) {
        expect(faceNormal(p.faces[0].verts)[0]).toBeGreaterThan(0.99);
        expect(p.centre[0]).toBeGreaterThan(0.8 + 0.12);
      }
    }
    expect(cappedRim('w', -0.8, 1, -1, spec, 8).filter((p) => p.spin)).toHaveLength(8);
  });
});
