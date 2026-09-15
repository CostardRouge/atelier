import { describe, expect, it } from 'vitest';
import { DEFAULT_GEAR, GEAR_KEYS, type CarGear } from '../car-spec';
import { CAR_LENGTH, CAR_WIDTH, WHEEL_IDS, WHEEL_RADIUS, buildCar, carLight, carPalette } from './car-model';
import { DEFAULT_LIGHT, centroid, dot, faceNormal, renderOrder, sub, type Part } from './mesh3d';

/** Every face of a convex part must point away from the part's centre. */
function outwardEverywhere(part: Part): boolean {
  return part.faces.every((face) => dot(faceNormal(face.verts), sub(centroid(face.verts), part.centre)) > -1e-9);
}

const BARE: CarGear = Object.fromEntries(GEAR_KEYS.map((key) => [key, false])) as unknown as CarGear;
const faceCount = (parts: Part[]) => parts.reduce((n, part) => n + part.faces.length, 0);

describe('buildCar', () => {
  const geared = buildCar();
  const bare = buildCar(BARE);

  it('is a few hundred faces at most, every part convex and wound outward, bare or fully geared', () => {
    expect(faceCount(bare)).toBeGreaterThan(120);
    expect(faceCount(bare)).toBeLessThan(320);
    expect(faceCount(geared)).toBeGreaterThan(faceCount(bare));
    expect(faceCount(geared)).toBeLessThan(480);
    for (const part of geared) {
      if (part.faces.length > 1) expect(outwardEverywhere(part), part.id).toBe(true);
    }
  });

  it('fits its stated footprint, wheels on the ground, roof at a Prado’s height', () => {
    const verts = bare.flatMap((part) => part.faces.flatMap((f) => [...f.verts]));
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
    const wheels = geared.filter((part) => (WHEEL_IDS as readonly string[]).includes(part.id));
    expect(wheels).toHaveLength(4);
    for (const w of wheels) {
      expect(w.spin?.axis).toBe('x');
      expect(w.centre[2]).toBeCloseTo(WHEEL_RADIUS, 6);
    }
  });

  it('bolts each piece of gear on and off by its toggle', () => {
    const ids = (parts: Part[]) => new Set(parts.map((p) => p.id));
    const has = (parts: Part[], prefix: string) => [...ids(parts)].some((id) => id.startsWith(prefix));
    const all = ids(geared);
    expect(has(bare, 'bullbar-')).toBe(false);
    expect(has(geared, 'bullbar-hoop-l-in')).toBe(true);
    expect(has(geared, 'spot-r-lamp')).toBe(true);
    expect(has(geared, 'basket-')).toBe(true);
    expect(all.has('solar-panel')).toBe(true);
    expect(all.has('storage-box')).toBe(true);
    expect(all.has('jerry-fuel')).toBe(true);
    expect(all.has('jerry-water-l-handle')).toBe(true);
    expect(all.has('awning-bag')).toBe(true);
    expect(has(geared, 'flap-')).toBe(true);
    expect(has(geared, 'visor-')).toBe(true);
    expect(all.has('spare')).toBe(true);
    expect(all.has('mirror-r')).toBe(true);
    for (const key of GEAR_KEYS) expect(has(bare, key === 'bullBar' ? 'bullbar' : key === 'jerryCans' ? 'jerry' : key === 'mudFlaps' ? 'flap' : key === 'rack' ? 'basket' : key === 'spotLights' ? 'spot' : key === 'awning' ? 'awning' : key === 'box' ? 'storage' : key), key).toBe(false);
  });

  it('draws no spot light without the bar and no load without the basket', () => {
    const noBar = buildCar({ ...DEFAULT_GEAR, bullBar: false });
    expect(noBar.some((p) => p.id.startsWith('spot-'))).toBe(false);
    const noRack = buildCar({ ...DEFAULT_GEAR, rack: false });
    expect(noRack.some((p) => p.id.startsWith('jerry') || p.id === 'solar-panel' || p.id === 'awning-bag' || p.id === 'storage-box')).toBe(false);
  });

  it('puts the load where the photographs have it: the panel left, the box right, the cans across the rear', () => {
    const at = (id: string) => geared.find((p) => p.id === id)!.centre;
    expect(at('solar-frame')[0]).toBeLessThan(0);
    expect(at('storage-box')[0]).toBeGreaterThan(0);
    expect(at('jerry-water-l')[0]).toBeLessThan(at('jerry-fuel')[0]);
    expect(at('jerry-fuel')[0]).toBeLessThan(at('jerry-water-r')[0]);
    expect(at('jerry-fuel')[1]).toBeLessThan(at('solar-frame')[1]);
    expect(at('awning-bag')[0]).toBeLessThan(at('solar-frame')[0]);
    // The spare sits right of centre, which is the LEFT of the tailgate seen from behind.
    expect(at('spare')[0]).toBeGreaterThan(0);
  });

  it('faces its lamps forward and its visors outward', () => {
    const lamp = geared.find((p) => p.id === 'spot-l-lamp')!;
    expect(faceNormal(lamp.faces[0].verts)[1]).toBeGreaterThan(0.99);
    const visor = geared.find((p) => p.id === 'visor-r-0')!;
    expect(faceNormal(visor.faces[0].verts)[0]).toBeGreaterThan(0.9);
    const wrap = geared.find((p) => p.id === 'taillight-r-wrap')!;
    const n = faceNormal(wrap.faces[0].verts);
    expect(n[0]).toBeGreaterThan(0.5);
    expect(n[1]).toBeLessThan(-0.5);
  });

  it('shows its roof from above and its nose only when heading toward the camera', () => {
    const pose = { fx: 0, fy: 1, tilt: Math.PI / 3, scale: 20, x: 0, y: 0 };
    const north = renderOrder(geared, pose);
    expect(north.some((f) => f.role === 'roof')).toBe(true);
    expect(north.some((f) => f.role === 'tail')).toBe(true);
    expect(north.some((f) => f.role === 'light')).toBe(false);
    const south = renderOrder(geared, { ...pose, fx: 0, fy: -1 });
    expect(south.some((f) => f.role === 'light')).toBe(true);
    expect(south.some((f) => f.role === 'lamp')).toBe(true);
    expect(south.some((f) => f.role === 'tail')).toBe(false);
  });

  it('paints the body in the author’s colour and everything else in its own', () => {
    const palette = carPalette('#123456');
    expect(palette.body).toBe('#123456');
    expect(palette.roof).toBe('#123456');
    expect(palette.tyre).not.toBe('#123456');
    for (const part of geared) for (const face of part.faces) expect(palette[face.role], face.role).toBeDefined();
  });
});

describe('carLight', () => {
  it('keeps the factory highlight for gloss and trades it for a broad sheen on matte', () => {
    expect(carLight('gloss')).toBe(DEFAULT_LIGHT);
    const matte = carLight('matte');
    expect(matte.gloss).toBeLessThan(DEFAULT_LIGHT.gloss);
    expect(matte.sheen ?? 0).toBeGreaterThan(0);
    expect(matte.ambient).toBeGreaterThan(DEFAULT_LIGHT.ambient);
  });
});
