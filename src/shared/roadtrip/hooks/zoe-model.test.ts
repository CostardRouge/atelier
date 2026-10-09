import { describe, expect, it } from 'vitest';
import { GEAR_KEYS, type VehicleGear } from '../vehicle-spec';
import { centroid, dot, faceNormal, renderOrder, sub, type Part, type Vec3 } from './mesh3d';
import { ZOE_LENGTH, ZOE_WHEEL_RADIUS, ZOE_WIDTH, buildZoe, zoePalette } from './zoe-model';

const NONE = Object.fromEntries(GEAR_KEYS.map((key) => [key, false])) as unknown as VehicleGear;
const ALL = Object.fromEntries(GEAR_KEYS.map((key) => [key, true])) as unknown as VehicleGear;

const faceCount = (parts: Part[]) => parts.reduce((n, part) => n + part.faces.length, 0);
const verts = (parts: Part[]): Vec3[] => parts.flatMap((part) => part.faces.flatMap((f) => [...f.verts]));
const byId = (parts: Part[], id: string) => parts.find((p) => p.id === id)!;
const range = (part: Part, axis: 0 | 1 | 2) => {
  const vs = part.faces.flatMap((f) => f.verts.map((v) => v[axis]));
  return [Math.min(...vs), Math.max(...vs)];
};

describe('buildZoe', () => {
  const bare = buildZoe(NONE);
  const asItComes = buildZoe();
  const geared = buildZoe(ALL);

  it('is a couple of hundred faces, every part convex and wound outward, bare or geared', () => {
    expect(faceCount(bare)).toBeGreaterThan(200);
    expect(faceCount(asItComes)).toBeGreaterThan(faceCount(bare));
    // The mirrors are all it offers; a Prado or Kadjar flag draws nothing more.
    expect(faceCount(geared)).toBe(faceCount(asItComes));
    expect(faceCount(geared)).toBeLessThan(360);
    for (const part of geared) {
      if (part.faces.length < 2) continue;
      for (const face of part.faces) {
        expect(dot(faceNormal(face.verts), sub(centroid(face.verts), part.centre)), part.id).toBeGreaterThan(-1e-9);
      }
    }
    expect(new Set(geared.map((p) => p.id)).size).toBe(geared.length);
  });

  it('fits a Zoé’s footprint: 4.09 long, 1.79 wide, wheels on the ground, the roof at 1.56', () => {
    const vs = verts(bare);
    const xs = vs.map((v) => v[0]);
    const ys = vs.map((v) => v[1]);
    const zs = vs.map((v) => v[2]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(ZOE_LENGTH);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(ZOE_LENGTH + 0.03);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(ZOE_WIDTH);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(ZOE_WIDTH + 0.05);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...zs)).toBeLessThan(0.03);
    expect(Math.max(...zs)).toBeGreaterThan(1.54);
    expect(Math.max(...zs)).toBeLessThan(1.6);
    // Smaller than the Kadjar in every direction.
    expect(ZOE_LENGTH).toBeLessThan(4.49);
    expect(ZOE_WIDTH).toBeLessThan(1.84);
  });

  it('is a hatchback: a short steep bonnet, the windscreen far forward, a near-upright hatch, no grille', () => {
    const bonnet = byId(bare, 'body-bonnet');
    const [y0, y1] = range(bonnet, 1);
    expect(y1 - y0).toBeLessThan(1.6);
    // The bonnet falls toward the nose by more than a hand.
    const top = bonnet.faces.find((f) => faceNormal(f.verts)[2] > 0.5)!;
    const front = Math.min(...top.verts.filter((v) => v[1] > y1 - 1e-6).map((v) => v[2]));
    const back = Math.max(...top.verts.filter((v) => v[1] < y0 + 1e-6).map((v) => v[2]));
    expect(back - front).toBeGreaterThan(0.15);
    // The windscreen's base sits ahead of the car's middle.
    const cabin = byId(bare, 'cabin');
    expect(range(cabin, 1)[1]).toBeGreaterThan(0.4);
    // The hatch glass is steep: it climbs more than it reaches back.
    const rear = cabin.faces.find((f) => f.role === 'glass' && faceNormal(f.verts)[1] < -0.3)!;
    const span = (axis: 1 | 2) => Math.max(...rear.verts.map((v) => v[axis])) - Math.min(...rear.verts.map((v) => v[axis]));
    expect(span(2)).toBeGreaterThan(0.8 * span(1));
    expect(bare.some((p) => p.id === 'grille' || p.id.startsWith('grille-bar'))).toBe(false);
    expect(byId(bare, 'logo').faces[0].role).toBe('chrome');
  });

  it('hides the rear handle in a black C pillar and draws one handle on the front door', () => {
    const cabin = byId(bare, 'cabin');
    expect(cabin.faces.filter((f) => f.role === 'trim')).toHaveLength(4);
    expect(bare.some((p) => p.id.startsWith('handle-rear'))).toBe(false);
    expect(byId(bare, 'handle-front-r').faces[0].role).toBe('trim');
  });

  it('has four spinning wheels of the stated radius on spoked alloys scaled to them', () => {
    const wheels = asItComes.filter((p) => /^wheel-(fl|fr|rl|rr)$/.test(p.id));
    expect(wheels).toHaveLength(4);
    for (const w of wheels) {
      expect(w.spin?.axis).toBe('x');
      expect(w.centre[2]).toBeCloseTo(ZOE_WHEEL_RADIUS, 6);
    }
    const rim = byId(asItComes, 'wheel-fr-rim');
    const discRadius = (range(rim, 2)[1] - range(rim, 2)[0]) / 2;
    expect(discRadius).toBeLessThan(ZOE_WHEEL_RADIUS);
    expect(discRadius).toBeGreaterThan(ZOE_WHEEL_RADIUS * 0.6);
    expect(asItComes.filter((p) => /^wheel-fr-spoke-/.test(p.id))).toHaveLength(10);
  });

  it('comes with its mirrors and nothing else, bolted off by their toggle, and nothing of the others’', () => {
    const has = (parts: Part[], prefix: string) => parts.some((p) => p.id.startsWith(prefix));
    expect(has(asItComes, 'mirror-')).toBe(true);
    expect(has(bare, 'mirror-')).toBe(false);
    for (const other of ['bullbar', 'spot-', 'basket-', 'solar', 'storage', 'jerry', 'awning', 'flap-', 'visor-', 'spare', 'rail-', 'roofbar-']) {
      expect(has(geared, other), other).toBe(false);
    }
  });

  it('faces its headlamps forward, its tail lights back, and keeps the wraps on the corners', () => {
    const lamp = byId(asItComes, 'headlight-r');
    expect(faceNormal(lamp.faces[0].verts)[1]).toBeGreaterThan(0.99);
    const tail = byId(asItComes, 'taillight-l');
    expect(faceNormal(tail.faces[0].verts)[1]).toBeLessThan(-0.99);
    const wrap = faceNormal(byId(asItComes, 'headlight-wrap1-r').faces[0].verts);
    expect(wrap[0]).toBeGreaterThan(0.2);
    expect(wrap[1]).toBeGreaterThan(0.2);
    const tailWrap = faceNormal(byId(asItComes, 'taillight-wrap-r').faces[0].verts);
    expect(tailWrap[0]).toBeGreaterThan(0.2);
    expect(tailWrap[1]).toBeLessThan(-0.2);
  });

  it('shows its roof from above, its nose only when heading toward the camera', () => {
    const pose = { fx: 0, fy: 1, tilt: Math.PI / 3, scale: 20, x: 0, y: 0 };
    const north = renderOrder(asItComes, pose);
    expect(north.some((f) => f.role === 'roof')).toBe(true);
    expect(north.some((f) => f.role === 'tail')).toBe(true);
    expect(north.some((f) => f.role === 'light')).toBe(false);
    const south = renderOrder(asItComes, { ...pose, fx: 0, fy: -1 });
    expect(south.some((f) => f.role === 'light')).toBe(true);
    expect(south.some((f) => f.role === 'drl')).toBe(true);
    expect(south.some((f) => f.role === 'tail')).toBe(false);
  });

  it('paints the body in the author’s colour and everything else in its own', () => {
    const palette = zoePalette('#123456');
    expect(palette.body).toBe('#123456');
    expect(palette.roof).toBe('#123456');
    expect(palette.chrome).not.toBe('#123456');
    for (const part of geared) for (const face of part.faces) expect(palette[face.role], face.role).toBeDefined();
  });
});
