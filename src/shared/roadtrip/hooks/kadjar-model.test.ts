import { describe, expect, it } from 'vitest';
import { GEAR_KEYS, defaultCarSpec, type CarGear } from '../car-spec';
import { KADJAR_LENGTH, KADJAR_WHEEL_RADIUS, KADJAR_WIDTH, buildKadjar, kadjarPalette } from './kadjar-model';
import { centroid, dot, faceNormal, renderOrder, sub, type Part, type Vec3 } from './mesh3d';

const NONE = Object.fromEntries(GEAR_KEYS.map((key) => [key, false])) as unknown as CarGear;
const ALL = Object.fromEntries(GEAR_KEYS.map((key) => [key, true])) as unknown as CarGear;
const AS_IT_COMES = defaultCarSpec('kadjar-ph2').gear;

const faceCount = (parts: Part[]) => parts.reduce((n, part) => n + part.faces.length, 0);
const verts = (parts: Part[]): Vec3[] => parts.flatMap((part) => part.faces.flatMap((f) => [...f.verts]));
const byId = (parts: Part[], id: string) => parts.find((p) => p.id === id)!;
const zRange = (part: Part) => {
  const zs = part.faces.flatMap((f) => f.verts.map((v) => v[2]));
  return [Math.min(...zs), Math.max(...zs)];
};
const xRange = (part: Part) => {
  const xs = part.faces.flatMap((f) => f.verts.map((v) => v[0]));
  return [Math.min(...xs), Math.max(...xs)];
};

describe('buildKadjar', () => {
  const bare = buildKadjar(NONE);
  const asItComes = buildKadjar();
  const geared = buildKadjar(ALL);

  it('is a few hundred faces, every part convex and wound outward, bare or geared', () => {
    expect(faceCount(bare)).toBeGreaterThan(200);
    expect(faceCount(geared)).toBeGreaterThan(faceCount(asItComes));
    expect(faceCount(asItComes)).toBeGreaterThan(faceCount(bare));
    expect(faceCount(geared)).toBeLessThan(480);
    for (const part of geared) {
      if (part.faces.length < 2) continue;
      for (const face of part.faces) {
        expect(dot(faceNormal(face.verts), sub(centroid(face.verts), part.centre)), part.id).toBeGreaterThan(-1e-9);
      }
    }
    expect(new Set(geared.map((p) => p.id)).size).toBe(geared.length);
  });

  it('fits a Kadjar’s footprint: 4.49 long, 1.84 over the arches, wheels on the ground, the roof at 1.58', () => {
    const vs = verts(bare);
    const xs = vs.map((v) => v[0]);
    const ys = vs.map((v) => v[1]);
    const zs = vs.map((v) => v[2]);
    // The badges and lamps stand a few millimetres proud of the nose and tail.
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(KADJAR_LENGTH);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(KADJAR_LENGTH + 0.03);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(KADJAR_WIDTH);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(KADJAR_WIDTH + 0.1);
    // A 14-gon tyre rests on a flat, a hair above its exact radius.
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...zs)).toBeLessThan(0.03);
    expect(Math.max(...zs)).toBeGreaterThan(1.55);
    expect(Math.max(...zs)).toBeLessThan(1.62);
    // Lower than the Prado's 1.95 even with the bars on the rails.
    expect(Math.max(...verts(geared).map((v) => v[2]))).toBeLessThan(1.8);
  });

  it('has four spinning wheels of the stated radius', () => {
    const wheels = asItComes.filter((p) => /^wheel-(fl|fr|rl|rr)$/.test(p.id));
    expect(wheels).toHaveLength(4);
    for (const w of wheels) {
      expect(w.spin?.axis).toBe('x');
      expect(w.centre[2]).toBeCloseTo(KADJAR_WHEEL_RADIUS, 6);
    }
  });

  it('comes with two bars across the roof and its mirrors, and no rails', () => {
    const ids = new Set(asItComes.map((p) => p.id));
    expect(ids.has('roofbar-fore')).toBe(true);
    expect(ids.has('roofbar-aft')).toBe(true);
    expect(ids.has('mirror-l') && ids.has('mirror-r')).toBe(true);
    expect([...ids].some((id) => id.startsWith('rail-'))).toBe(false);
  });

  it('bolts the bars, the rails and the mirrors on and off by their toggles, and nothing of the Prado’s', () => {
    const has = (parts: Part[], prefix: string) => parts.some((p) => p.id.startsWith(prefix));
    expect(has(bare, 'roofbar-')).toBe(false);
    expect(has(bare, 'rail-')).toBe(false);
    expect(has(bare, 'mirror-')).toBe(false);
    expect(has(geared, 'rail-l')).toBe(true);
    for (const prado of ['bullbar', 'spot-', 'basket-', 'solar', 'storage', 'jerry', 'awning', 'flap-', 'visor-', 'spare']) {
      expect(has(geared, prado), prado).toBe(false);
    }
  });

  it('lays each bar ACROSS the roof, wider than it, a little above it — and higher on the rails', () => {
    const bar = byId(asItComes, 'roofbar-fore');
    const [x0, x1] = xRange(bar);
    expect(x0).toBeCloseTo(-x1, 9);
    const roof = byId(bare, 'cabin').faces.find((f) => f.role === 'roof')!;
    const roofHalf = Math.max(...roof.verts.map((v) => v[0]));
    const roofTop = Math.max(...roof.verts.map((v) => v[2]));
    expect(x1).toBeGreaterThan(roofHalf);
    const [bottom] = zRange(bar);
    expect(bottom).toBeGreaterThan(roofTop);
    // Two of them, one behind the other.
    expect(byId(asItComes, 'roofbar-aft').centre[1]).toBeLessThan(bar.centre[1] - 0.5);
    // On the rails the same bar stands higher, its feet on the rail.
    const onRails = buildKadjar({ ...AS_IT_COMES, roofRails: true });
    expect(zRange(byId(onRails, 'roofbar-fore'))[0]).toBeGreaterThan(bottom + 0.05);
    const rail = byId(onRails, 'rail-r');
    const foot = byId(onRails, 'roofbar-fore-foot-r');
    expect(xRange(foot)).toEqual(xRange(rail));
    // The rail's top follows the sloping roof: read its height under the foot.
    const railTop = [...rail.faces.find((f) => faceNormal(f.verts)[2] > 0.9)!.verts].sort((a, b) => b[1] - a[1]);
    const [front, back] = [railTop[0], railTop[railTop.length - 1]];
    const railAt = (y: number) => back[2] + ((front[2] - back[2]) * (y - back[1])) / (front[1] - back[1]);
    for (const y of new Set(foot.faces.flatMap((f) => f.verts.map((v) => v[1])))) {
      const lowest = Math.min(...foot.faces.flatMap((f) => f.verts.filter((v) => v[1] === y).map((v) => v[2])));
      expect(lowest).toBeCloseTo(railAt(y), 9);
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
  });

  it('shows its roof from above, its nose only when heading toward the camera', () => {
    const pose = { fx: 0, fy: 1, tilt: Math.PI / 3, scale: 20, x: 0, y: 0 };
    const north = renderOrder(asItComes, pose);
    expect(north.some((f) => f.role === 'roof')).toBe(true);
    expect(north.some((f) => f.role === 'bar')).toBe(true);
    expect(north.some((f) => f.role === 'tail')).toBe(true);
    expect(north.some((f) => f.role === 'light')).toBe(false);
    const south = renderOrder(asItComes, { ...pose, fx: 0, fy: -1 });
    expect(south.some((f) => f.role === 'light')).toBe(true);
    expect(south.some((f) => f.role === 'drl')).toBe(true);
    expect(south.some((f) => f.role === 'tail')).toBe(false);
  });

  it('paints the body in the author’s colour and everything else in its own', () => {
    const palette = kadjarPalette('#123456');
    expect(palette.body).toBe('#123456');
    expect(palette.roof).toBe('#123456');
    expect(palette.bar).not.toBe('#123456');
    for (const part of geared) for (const face of part.faces) expect(palette[face.role], face.role).toBeDefined();
  });
});
