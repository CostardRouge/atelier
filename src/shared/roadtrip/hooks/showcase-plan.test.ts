import { describe, expect, it } from 'vitest';
import { defaultVehicleSpec } from '../vehicle-spec';
import { centroid, dot, faceNormal, sub, type Part } from './mesh3d';
import {
  BEACH_OBSTACLES,
  ENTRIES,
  SHOWCASE_DEFAULTS,
  SHOWCASE_RECIPES,
  SHOWCASE_SECONDS,
  T_STOP,
  applyRecipe,
  carState,
  endOf,
  endsOf,
  readShowcase,
  sceneOf,
  showcaseCar,
  tileOffsets,
  trajectory,
  type EndId,
} from './showcase-plan';
import { PLACES, placeById } from './showcase-scenes';

const prado = showcaseCar(defaultVehicleSpec('prado-j120'));
const trafic = showcaseCar(defaultVehicleSpec('trafic-ph2'));

describe('readShowcase', () => {
  it('reads an empty record as the defaults, and anything unknown as its default', () => {
    expect(readShowcase({})).toEqual(SHOWCASE_DEFAULTS);
    const o = readShowcase({ place: 'moon', time: 'teatime', entry: 'teleport', look: 'sepia', end: 'fly', badge: 'maybe', variants: { beach: 'rocks', city: 3 } });
    expect(o.place).toBe('showroom');
    expect(o.time).toBe('sunset');
    expect(o.entry).toBe('explode');
    expect(o.look).toBe('colour');
    expect(o.end).toBe('auto');
    expect(o.badge).toBe('after');
    expect(o.variants).toEqual({ beach: 'rocks' });
  });

  it('keeps a recipe’s vehicle and words when another is applied', () => {
    const mine = { ...SHOWCASE_DEFAULTS, vehicle: 'trafic-ph2', vehicleColor: '#ffffff', caption: 'Algeciras → Tanger Med', variants: { lake: 'reeds' } };
    for (const r of SHOWCASE_RECIPES) {
      const o = applyRecipe(mine, r.patch);
      expect(o.vehicle).toBe('trafic-ph2');
      expect(o.caption).toBe('Algeciras → Tanger Med');
      expect(o.variants.lake).toBe('reeds');
      expect(readShowcase({ ...o })).toEqual(o);
    }
  });
});

describe('endOf', () => {
  it('never leaves a vehicle standing on a road, and gives a place with no road nothing else', () => {
    for (const place of PLACES) {
      for (const [variant] of place.variants) {
        const ends = endsOf(place, variant);
        for (const asked of ['auto', 'road', 'pullover', 'offroad', 'still'] as const) {
          const end = endOf(place, variant, asked);
          if (!ends) expect(end).toBe('still');
          else {
            expect(end).not.toBe('still');
            expect(ends[end as 'road' | 'pullover' | 'offroad']).toBeTruthy();
          }
        }
      }
    }
  });
});

describe('trajectory', () => {
  it('keeps driving on the road, at a steady pace', () => {
    const city = placeById('city');
    const xs = [0, 2, 4, 6, 8].map((t) => trajectory(city, 'towers', 'road', t)!.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(16, 6);
  });

  it('comes to rest on its stop, facing along the road, and stays there', () => {
    for (const place of PLACES) {
      for (const [variant] of place.variants) {
        const ends = endsOf(place, variant);
        for (const end of ['pullover', 'offroad'] as const) {
          const e = ends?.[end];
          if (!e) continue;
          for (const t of [T_STOP, T_STOP + 1, SHOWCASE_SECONDS]) {
            const p = trajectory(place, variant, end, t)!;
            expect(p.x).toBeCloseTo(e.stop[0], 3);
            expect(p.y).toBeCloseTo(e.stop[1], 3);
            expect(p.h).toBeCloseTo(Math.PI / 2, 3);
          }
          // It never goes backwards.
          let last = -Infinity;
          for (let t = 0; t <= SHOWCASE_SECONDS; t += 0.1) {
            const d = trajectory(place, variant, end, t)!.dist;
            expect(d).toBeGreaterThanOrEqual(last - 1e-9);
            last = d;
          }
        }
      }
    }
  });

  it('indicates on the side it turns to', () => {
    const lake = placeById('lake');
    expect(trajectory(lake, 'jetty', 'pullover', 4)!.blink!.side).toBe(-1);
    const mountain = placeById('mountain');
    expect(trajectory(mountain, 'alps', 'pullover', 4)!.blink!.side).toBe(1);
  });

  it('drives round what the tide left on the beach', () => {
    const beach = placeById('beach');
    for (const ob of BEACH_OBSTACLES) {
      for (const k of [-1, 0, 1]) {
        const x = ob.x + k * 48;
        const t = x / 8 + 5.5;
        const p = trajectory(beach, 'sand', 'road', t)!;
        expect(ob.y - p.y).toBeGreaterThan(1.5);
      }
    }
  });
});

/** Whether a vehicle at (x, y) heading `h` covers the ground point (px, py), with a margin. */
function covers(x: number, y: number, h: number, len: number, wid: number, px: number, py: number, margin: number): boolean {
  const fx = Math.sin(h);
  const fy = Math.cos(h);
  const dx = px - x;
  const dy = py - y;
  const along = dx * fx + dy * fy;
  const across = dx * fy - dy * fx;
  return Math.abs(along) < len / 2 + margin && Math.abs(across) < wid / 2 + margin;
}

describe('the paths leave room', () => {
  // Every road place, every variant, every ending — and every place a vehicle
  // drives into without a road — must never run its footprint through a prop.
  const cases: { place: string; variant: string; end: EndId }[] = [];
  for (const place of PLACES) {
    for (const [variant] of place.variants) {
      const ends = endsOf(place, variant);
      if (!ends) cases.push({ place: place.id, variant, end: 'still' });
      else for (const end of ['road', 'pullover', 'offroad'] as const) if (ends[end]) cases.push({ place: place.id, variant, end });
    }
  }

  it.each(cases)('$place / $variant / $end', ({ place: id, variant, end }) => {
    const place = placeById(id);
    const scene = sceneOf(place, variant, false);
    for (const car of [prado, trafic]) {
      for (let t = 0.5; t <= SHOWCASE_SECONDS; t += 0.25) {
        const traj = trajectory(place, variant, end, t);
        const state = carState({ car, place, variant, entry: 'drive', diorama: false, traj, t, screenX: () => 0 });
        if (state.alpha.every((a) => a === 0)) continue;
        const [x, y] = state.P;
        for (const o of scene.mids) {
          if (o.drivable) continue;
          for (const dx of tileOffsets(scene, o.about[0], o, x)) {
            const px = o.about[0] + dx;
            const py = o.about[1];
            if (covers(x, y, state.h, car.len, car.wid, px, py, 0.05)) {
              throw new Error(`${car.model.short} at t=${t.toFixed(2)} (${x.toFixed(1)}, ${y.toFixed(1)}) runs through a prop at (${px.toFixed(1)}, ${py.toFixed(1)})`);
            }
          }
        }
      }
    }
  });
});

describe('carState', () => {
  const showroom = placeById('showroom');
  it('shows every part once its entrance is over, whatever the entrance', () => {
    for (const { id } of ENTRIES) {
      const s = carState({ car: prado, place: showroom, variant: 'white', entry: id, diorama: false, traj: null, t: 7, screenX: (v) => 180 + v[0] * 30 });
      expect(s.parts.length, id).toBe(prado.parts.length);
      expect(s.shadow, id).toBeCloseTo(1, 6);
    }
  });

  it('shows nothing before it comes in, on its wheels or from the sky', () => {
    for (const entry of ['drive', 'drop'] as const) {
      const s = carState({ car: prado, place: showroom, variant: 'white', entry, diorama: false, traj: null, t: 0.2, screenX: () => 0 });
      expect(s.parts.length, entry).toBe(0);
    }
  });

  it('lands a drop on the ground, standing on the turntable’s disc where there is one', () => {
    expect(carState({ car: prado, place: showroom, variant: 'white', entry: 'drop', diorama: false, traj: null, t: 3, screenX: () => 0 }).P[2]).toBeCloseTo(0, 6);
    expect(carState({ car: prado, place: showroom, variant: 'turntable', entry: 'drop', diorama: false, traj: null, t: 3, screenX: () => 0 }).P[2]).toBeCloseTo(0.14, 6);
  });
});

/** Every face of a convex part must point away from the part's centre. */
function outward(part: Part): boolean {
  return part.faces.every((face) => dot(faceNormal(face.verts), sub(centroid(face.verts), part.centre)) > -1e-6);
}

describe('sceneOf', () => {
  it('builds every place and variant, every part convex and wound outward', () => {
    for (const place of PLACES) {
      for (const [variant] of place.variants) {
        for (const diorama of [false, true]) {
          const s = sceneOf(place, variant, diorama);
          for (const o of [...s.mids, ...s.objs]) {
            for (const p of o.parts) if (p.faces.length > 1) expect(outward(p), `${place.id}/${variant}/${p.id}`).toBe(true);
          }
        }
      }
    }
  });

  it('keeps one tile of a road place, and a unique thing once', () => {
    const station = sceneOf(placeById('station'), 'motorway', false);
    expect(station.tiled).toBe(true);
    for (const o of station.mids) {
      if (!o.unique && !o.far) expect(Math.abs(o.about[0])).toBeLessThanOrEqual(station.P / 2);
    }
    const pump = station.mids.find((o) => o.unique)!;
    expect(tileOffsets(station, pump.about[0], pump, 30)).toEqual([0]);
    expect(sceneOf(placeById('showroom'), 'white', false).tiled).toBe(false);
  });
});
