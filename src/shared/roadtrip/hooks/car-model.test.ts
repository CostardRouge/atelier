import { describe, expect, it } from 'vitest';
import { CAR_LENGTH, CAR_WIDTH, WHEEL_IDS, WHEEL_RADIUS, buildCar, carPalette } from './car-model';
import { centroid, dot, faceNormal, renderOrder, sub, type Part } from './mesh3d';

/** Every face of a convex part must point away from the part's centre. */
function outwardEverywhere(part: Part): boolean {
  return part.faces.every((face) => dot(faceNormal(face.verts), sub(centroid(face.verts), part.centre)) > -1e-9);
}

describe('buildCar', () => {
  const car = buildCar();

  it('is a few hundred faces at most, every part convex and wound outward', () => {
    const faces = car.reduce((n, part) => n + part.faces.length, 0);
    expect(faces).toBeGreaterThan(120);
    expect(faces).toBeLessThan(320);
    for (const part of car) {
      if (part.faces.length > 1) expect(outwardEverywhere(part), part.id).toBe(true);
    }
  });

  it('fits its stated footprint, wheels on the ground, roof at a Prado’s height', () => {
    const verts = car.flatMap((part) => part.faces.flatMap((f) => [...f.verts]));
    const xs = verts.map((v) => v[0]);
    const ys = verts.map((v) => v[1]);
    const zs = verts.map((v) => v[2]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(CAR_LENGTH);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(CAR_LENGTH + 0.6);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(CAR_WIDTH);
    // A 14-gon tyre rests on a flat, a hair above its exact radius.
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...zs)).toBeLessThan(0.03);
    expect(Math.max(...zs)).toBeGreaterThan(1.9);
    expect(Math.max(...zs)).toBeLessThan(2.2);
  });

  it('has four spinning wheels of the stated radius', () => {
    const wheels = car.filter((part) => (WHEEL_IDS as readonly string[]).includes(part.id));
    expect(wheels).toHaveLength(4);
    for (const w of wheels) {
      expect(w.spin?.axis).toBe('x');
      expect(w.centre[2]).toBeCloseTo(WHEEL_RADIUS, 6);
    }
  });

  it('adds and removes the spare, the rack and the mirrors on request', () => {
    const ids = (parts: Part[]) => new Set(parts.map((p) => p.id));
    const bare = ids(buildCar({ spare: false, rack: false, mirrors: false }));
    const full = ids(buildCar({ spare: true, rack: true, mirrors: true }));
    expect(bare.has('spare')).toBe(false);
    expect(full.has('spare')).toBe(true);
    expect([...bare].some((id) => id.startsWith('rack-'))).toBe(false);
    expect([...full].filter((id) => id.startsWith('rack-'))).toHaveLength(3);
    expect(bare.has('mirror-l')).toBe(false);
    expect(full.has('mirror-r')).toBe(true);
  });

  it('shows its roof from above and its nose only when heading toward the camera', () => {
    const pose = { fx: 0, fy: 1, tilt: Math.PI / 3, scale: 20, x: 0, y: 0 };
    const north = renderOrder(car, pose);
    expect(north.some((f) => f.role === 'roof')).toBe(true);
    expect(north.some((f) => f.role === 'tail')).toBe(true);
    expect(north.some((f) => f.role === 'light')).toBe(false);
    const south = renderOrder(car, { ...pose, fx: 0, fy: -1 });
    expect(south.some((f) => f.role === 'light')).toBe(true);
    expect(south.some((f) => f.role === 'tail')).toBe(false);
  });

  it('paints the body in the author’s colour and everything else in its own', () => {
    const palette = carPalette('#123456');
    expect(palette.body).toBe('#123456');
    expect(palette.roof).toBe('#123456');
    expect(palette.tyre).not.toBe('#123456');
    for (const part of car) for (const face of part.faces) expect(palette[face.role], face.role).toBeDefined();
  });
});
