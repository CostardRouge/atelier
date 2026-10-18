import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLand } from '../map/land';
import { landIndex } from '../map/terrain';
import { tripHops, withCrossBoat, withHopChoice, withStageVehicle } from './trip-hops';
import type { TripDoc, TripPlace, TripStage } from './trip-types';
import { DEFAULT_CROSSINGS, fleetOf } from './vehicle-fleet';
import { defaultVehicleSpec } from './vehicle-spec';

const SHIPPED = landIndex(
  parseLand(JSON.parse(readFileSync(fileURLToPath(new URL('../../../public/geo/land.json', import.meta.url)), 'utf8'))),
);

function place(id: string, lat: number, lon: number, extra: Partial<TripPlace> = {}): TripPlace {
  return { id, name: id, state: '', coords: { lat, lon }, ...extra };
}

function stage(id: string, startDate: string, places: TripPlace[], extra: Partial<TripStage> = {}): TripStage {
  return { id, name: id, region: '', startDate, endDate: startDate, places, ...extra };
}

function trip(stages: TripStage[], auto = true): TripDoc {
  return {
    stages,
    vehicles: fleetOf(defaultVehicleSpec()),
    crossings: { ...DEFAULT_CROSSINGS, auto, boat: 'spirit-of-tasmania' },
  } as unknown as TripDoc;
}

const GEELONG = place('Geelong', -38.15, 144.36);
const MELBOURNE = place('Melbourne', -37.81, 144.96);
const DEVONPORT = place('Devonport', -41.18, 146.36);
const HOBART = place('Hobart', -42.88, 147.33);
const HERVEY = place('Hervey Bay', -25.29, 152.85);

describe('the trip’s hops', () => {
  const t = trip([stage('vic', '2026-03-01', [GEELONG, MELBOURNE]), stage('tas', '2026-03-06', [DEVONPORT, HOBART])]);

  it('lists each hop in the order it was lived, with what makes it and why', () => {
    const hops = tripHops(t, SHIPPED);
    expect(hops.map((h) => `${h.from}→${h.to}:${h.why}`)).toEqual([
      'Geelong→Melbourne:trip',
      'Melbourne→Devonport:water',
      'Devonport→Hobart:trip',
    ]);
    const bass = hops[1];
    expect(bass.boat).toEqual({ ref: { borrow: 'spirit-of-tasmania' }, own: false });
    expect(bass.sea!.water).toBeGreaterThan(200);
    expect(bass.sea!.before + bass.sea!.water + bass.sea!.after).toBeCloseTo(bass.km, 0);
  });

  it('says a hop drives over the sea when the rule is off', () => {
    const hops = tripHops({ ...t, crossings: { ...t.crossings, auto: false } }, SHIPPED);
    expect(hops[1]).toMatchObject({ why: 'trip', wet: true });
    expect(hops[1].boat).toBeUndefined();
  });

  it('reads no water before the coastline has arrived', () => {
    expect(tripHops(t, null).map((h) => h.why)).toEqual(['trip', 'trip', 'trip']);
  });

  it('writes a hop’s own boat, not driven, one vehicle, and gives it back to the road', () => {
    const own = tripHops(withCrossBoat(t, 'Devonport', { borrow: 'viper-jet' }), SHIPPED)[1];
    expect(own.boat).toEqual({ ref: { borrow: 'viper-jet' }, own: true });

    const flown = withHopChoice(t, 'Devonport', { kind: 'flown' });
    expect(tripHops(flown, SHIPPED)[1].why).toBe('flown');

    const placed = withHopChoice(withCrossBoat(t, 'Devonport', { borrow: 'viper-jet' }), 'Devonport', { kind: 'vehicle', ref: { borrow: 'spirit-of-tasmania' } });
    const p = placed.stages[1].places[0];
    expect(p.arriveBy).toEqual({ borrow: 'spirit-of-tasmania' });
    expect(p.crossBy).toBeUndefined();
    expect(tripHops(placed, SHIPPED)[1].why).toBe('place');

    const back = withHopChoice(placed, 'Devonport', { kind: 'auto' }).stages[1].places[0];
    expect(back.arriveBy).toBeUndefined();
    expect(back.flown).toBeUndefined();
  });

  it('drives a stage on the vehicle it names', () => {
    const vanned = withStageVehicle(t, 'tas', { borrow: 'trafic-ph2' });
    expect(tripHops(vanned, SHIPPED)[2]).toMatchObject({ why: 'stage', ref: { borrow: 'trafic-ph2' } });
    expect(withStageVehicle(vanned, 'tas', null).stages[1].vehicle).toBeUndefined();
  });

  it('counts a long flight as sea until it is marked not driven', () => {
    const far = trip([stage('tas', '2026-03-06', [HOBART]), stage('qld', '2026-03-20', [HERVEY])]);
    expect(tripHops(far, SHIPPED)[0].why).toBe('water');
    expect(tripHops(withHopChoice(far, 'Hervey Bay', { kind: 'flown' }), SHIPPED)[0]).toMatchObject({ why: 'flown', sea: null });
  });
});
