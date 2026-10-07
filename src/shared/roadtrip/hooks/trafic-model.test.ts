import { describe, expect, it } from 'vitest';
import { GEAR_KEYS, defaultCarSpec, type CarGear } from '../car-spec';
import { centroid, dot, faceNormal, renderOrder, sub, type Part, type Vec3 } from './mesh3d';
import { TRAFIC_BONNET_NOSE, TRAFIC_LENGTH, TRAFIC_WHEEL_RADIUS, TRAFIC_WIDTH, buildTrafic, traficPalette } from './trafic-model';

const NONE = Object.fromEntries(GEAR_KEYS.map((key) => [key, false])) as unknown as CarGear;
const ALL = Object.fromEntries(GEAR_KEYS.map((key) => [key, true])) as unknown as CarGear;

const faceCount = (parts: Part[]) => parts.reduce((n, part) => n + part.faces.length, 0);
const verts = (parts: Part[]): Vec3[] => parts.flatMap((part) => part.faces.flatMap((f) => [...f.verts]));
const byId = (parts: Part[], id: string) => parts.find((p) => p.id === id)!;
const range = (part: Part, axis: 0 | 1 | 2) => {
  const vs = part.faces.flatMap((f) => f.verts.map((v) => v[axis]));
  return [Math.min(...vs), Math.max(...vs)];
};

describe('buildTrafic', () => {
  const bare = buildTrafic(NONE);
  const asItComes = buildTrafic();
  const geared = buildTrafic(ALL);

  it('is a couple of hundred faces, every part convex and wound outward, bare or geared', () => {
    expect(faceCount(bare)).toBeGreaterThan(150);
    expect(faceCount(asItComes)).toBeGreaterThan(faceCount(bare));
    // Everything the Trafic offers is on as it comes; a Prado flag draws nothing more.
    expect(faceCount(geared)).toBe(faceCount(asItComes));
    expect(faceCount(geared)).toBeLessThan(320);
    for (const part of geared) {
      if (part.faces.length < 2) continue;
      for (const face of part.faces) {
        expect(dot(faceNormal(face.verts), sub(centroid(face.verts), part.centre)), part.id).toBeGreaterThan(-1e-9);
      }
    }
    expect(new Set(geared.map((p) => p.id)).size).toBe(geared.length);
  });

  it('fits a Trafic’s footprint: 5.0 long, 1.96 wide, wheels on the ground, the roof at 1.96 and the panel over it', () => {
    const vs = verts(bare);
    const xs = vs.map((v) => v[0]);
    const ys = vs.map((v) => v[1]);
    const zs = vs.map((v) => v[2]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(TRAFIC_LENGTH);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(TRAFIC_LENGTH + 0.03);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(TRAFIC_WIDTH);
    // The tyres stand a hair proud of the flanks, and the wheel caps a few millimetres off the tyres.
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(TRAFIC_WIDTH + 0.05);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...zs)).toBeLessThan(0.03);
    expect(Math.max(...zs)).toBeCloseTo(1.96, 6);
    // The panel stands a few centimetres over the roof; the mirrors reach past the flanks.
    const all = verts(asItComes);
    expect(Math.max(...all.map((v) => v[2]))).toBeGreaterThan(1.99);
    expect(Math.max(...all.map((v) => v[2]))).toBeLessThan(2.06);
    expect(Math.max(...all.map((v) => v[0]))).toBeGreaterThan(TRAFIC_WIDTH / 2 + 0.15);
  });

  it('is a van: a short high bonnet, one flat flank to the roof, no window behind the cab, square at the back', () => {
    expect(TRAFIC_BONNET_NOSE).toBeCloseTo(1.0, 9);
    const bonnet = byId(bare, 'body-bonnet');
    expect(range(bonnet, 1)[1] - range(bonnet, 1)[0]).toBeLessThan(1.3);
    // The cab's glass is the windscreen and the door windows only.
    const cab = byId(bare, 'cab');
    expect(cab.faces.filter((f) => f.role === 'glass')).toHaveLength(3);
    for (const id of ['cargo-slide', 'cargo-tail']) {
      const slice = byId(bare, id);
      expect(slice.faces.some((f) => f.role === 'glass')).toBe(false);
      expect(slice.faces.some((f) => f.role === 'roof')).toBe(true);
      expect(range(slice, 2)[1]).toBeCloseTo(1.96, 9);
    }
    // The tail is the full width at every height it is cut at, within the lean.
    const tail = byId(bare, 'cargo-tail');
    const back = tail.faces.filter((f) => faceNormal(f.verts)[1] < -0.99);
    expect(back.length).toBe(2);
    expect(Math.max(...back.flatMap((f) => f.verts.map((v) => Math.abs(v[0]))))).toBeCloseTo(TRAFIC_WIDTH / 2, 9);
  });

  it('leans its flanks in above the belt and keeps them vertical below it', () => {
    const slice = byId(bare, 'cargo-slide');
    const right = slice.faces.filter((f) => faceNormal(f.verts)[0] > 0.9);
    expect(right).toHaveLength(2);
    const [low, high] = [...right].sort((a, b) => Math.min(...a.verts.map((v) => v[2])) - Math.min(...b.verts.map((v) => v[2])));
    expect(faceNormal(low.verts)[2]).toBeCloseTo(0, 9);
    expect(faceNormal(high.verts)[2]).toBeGreaterThan(0.05);
    const roofHalf = Math.max(...slice.faces.find((f) => f.role === 'roof')!.verts.map((v) => v[0]));
    expect(roofHalf).toBeLessThan(TRAFIC_WIDTH / 2 - 0.05);
  });

  it('has four spinning wheels of the stated radius under plastic caps', () => {
    const wheels = asItComes.filter((p) => /^wheel-(fl|fr|rl|rr)$/.test(p.id));
    expect(wheels).toHaveLength(4);
    for (const w of wheels) {
      expect(w.spin?.axis).toBe('x');
      expect(w.centre[2]).toBeCloseTo(TRAFIC_WHEEL_RADIUS, 6);
    }
    expect(asItComes.filter((p) => /^wheel-fr-vent-/.test(p.id)).length).toBeGreaterThanOrEqual(5);
    expect(asItComes.some((p) => p.id.includes('-spoke-'))).toBe(false);
  });

  it('comes with the solar panel on its roof and its mirrors, each bolted off by its toggle, and nothing of the others’', () => {
    const has = (parts: Part[], prefix: string) => parts.some((p) => p.id.startsWith(prefix));
    expect(has(asItComes, 'solar-')).toBe(true);
    expect(has(asItComes, 'mirror-')).toBe(true);
    expect(has(bare, 'solar-')).toBe(false);
    expect(has(bare, 'mirror-')).toBe(false);
    expect(has(buildTrafic({ ...defaultCarSpec('trafic-ph2').gear, roofSolar: false }), 'solar-')).toBe(false);
    for (const other of ['bullbar', 'spot-', 'basket-', 'storage', 'jerry', 'awning', 'flap-', 'visor-', 'spare', 'rail-', 'roofbar-']) {
      expect(has(geared, other), other).toBe(false);
    }
  });

  it('lays the panel flat on the roof’s front half, inside the frame that carries it, cut where the roof is', () => {
    const frames = asItComes.filter((p) => p.id.startsWith('solar-frame'));
    const panels = asItComes.filter((p) => p.id.startsWith('solar-panel'));
    // Over the cab's roof and the sliding door's: two pieces meeting at the cab's back.
    expect(frames.map((p) => p.id)).toEqual(['solar-frame', 'solar-frame-1']);
    expect(panels.map((p) => p.id)).toEqual(['solar-panel', 'solar-panel-1']);
    const cab = byId(bare, 'cab');
    const cabBack = Math.min(...cab.faces.find((f) => f.role === 'roof')!.verts.map((v) => v[1]));
    expect(range(frames[0], 1)[0]).toBeCloseTo(cabBack, 9);
    expect(range(frames[1], 1)[1]).toBeCloseTo(cabBack, 9);
    expect(range(panels[0], 1)[0]).toBeCloseTo(cabBack, 9);
    expect(range(panels[1], 1)[1]).toBeCloseTo(cabBack, 9);
    const fy = [range(frames[1], 1)[0], range(frames[0], 1)[1]];
    expect(fy[1]).toBeGreaterThan(0);
    expect((fy[0] + fy[1]) / 2).toBeGreaterThan(-0.5);
    for (const [frame, panel] of [[frames[0], panels[0]], [frames[1], panels[1]]]) {
      expect(range(frame, 2)[0]).toBeCloseTo(1.96, 9);
      expect(range(panel, 2)[0]).toBeGreaterThan(range(frame, 2)[1]);
      expect(faceNormal(panel.faces[0].verts)[2]).toBeCloseTo(1, 9);
      expect(range(panel, 0)[1]).toBeLessThan(range(frame, 0)[1]);
      // Never built: the frame's bottom, pressed on the roof, nor its wall at the cut.
      expect(frame.faces.some((f) => faceNormal(f.verts)[2] < -0.9)).toBe(false);
      expect(frame.faces.filter((f) => Math.abs(faceNormal(f.verts)[1]) > 0.9)).toHaveLength(1);
    }
  });

  it('faces its headlamps forward, its tall tail lights back, and keeps the wraps on the corners', () => {
    const lamp = byId(asItComes, 'headlight-r');
    expect(faceNormal(lamp.faces[0].verts)[1]).toBeGreaterThan(0.99);
    const tail = byId(asItComes, 'taillight-l');
    expect(faceNormal(tail.faces[0].verts)[1]).toBeLessThan(-0.99);
    // Three pieces from the bumper to the pillar: cut at the shoulder and the belt, then the upper one.
    expect(asItComes.filter((p) => /^taillight(-2)?-l(-\d)?$/.test(p.id))).toHaveLength(3);
    const wrap = faceNormal(byId(asItComes, 'headlight-wrap1-r').faces[0].verts);
    expect(wrap[0]).toBeGreaterThan(0.2);
    expect(wrap[1]).toBeGreaterThan(0.2);
  });

  it('shows its roof and panel from above, its nose only when heading toward the camera', () => {
    const pose = { fx: 0, fy: 1, tilt: Math.PI / 3, scale: 20, x: 0, y: 0 };
    const north = renderOrder(asItComes, pose);
    expect(north.some((f) => f.role === 'roof')).toBe(true);
    expect(north.some((f) => f.role === 'solar')).toBe(true);
    expect(north.some((f) => f.role === 'tail')).toBe(true);
    expect(north.some((f) => f.role === 'light')).toBe(false);
    const south = renderOrder(asItComes, { ...pose, fx: 0, fy: -1 });
    expect(south.some((f) => f.role === 'light')).toBe(true);
    expect(south.some((f) => f.role === 'drl')).toBe(true);
    expect(south.some((f) => f.role === 'tail')).toBe(false);
  });

  it('paints the body in the author’s colour and everything else in its own', () => {
    const palette = traficPalette('#123456');
    expect(palette.body).toBe('#123456');
    expect(palette.roof).toBe('#123456');
    expect(palette.solar).not.toBe('#123456');
    for (const part of geared) for (const face of part.faces) expect(palette[face.role], face.role).toBeDefined();
  });
});
