import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLand } from '../map/land';
import { landIndex } from '../map/terrain';
import { seaHops, shouldAskToSail } from './sea-hops';
import type { TripPlace, TripStage } from './trip-types';
import { DEFAULT_CROSSINGS } from './vehicle-fleet';

const SHIPPED = landIndex(
  parseLand(JSON.parse(readFileSync(fileURLToPath(new URL('../../../public/geo/land.json', import.meta.url)), 'utf8'))),
);
const RULE = { bridgeKm: 2, shoreKm: 5 };

function place(name: string, lat: number, lon: number, extra: Partial<TripPlace> = {}): TripPlace {
  return { id: name, name, state: '', coords: { lat, lon }, ...extra };
}

function stage(id: string, startDate: string, places: TripPlace[]): TripStage {
  return { id, name: '', region: '', startDate, endDate: startDate, places };
}

const GEELONG = place('Geelong', -38.15, 144.36);
const MELBOURNE = place('Melbourne', -37.81, 144.96);
const DEVONPORT = place('Devonport', -41.18, 146.36);
const HOBART = place('Hobart', -42.88, 147.33);

describe('the hops of a trip that cross the sea', () => {
  it('finds Bass Strait between two stages and drives the rest', () => {
    const hops = seaHops(
      [stage('tas', '2026-03-06', [DEVONPORT, HOBART]), stage('vic', '2026-03-01', [GEELONG, MELBOURNE])],
      SHIPPED,
      RULE,
    );
    expect(hops.map((h) => `${h.from} → ${h.to}`)).toEqual(['Melbourne → Devonport']);
    expect(hops[0].waterKm).toBeGreaterThan(200);
  });

  it('leaves out a hop whose destination says how it was reached', () => {
    const byHand = { ...DEVONPORT, arriveBy: { borrow: 'spirit-of-tasmania' as const } };
    expect(seaHops([stage('a', '2026-03-01', [MELBOURNE, byHand, HOBART])], SHIPPED, RULE)).toEqual([]);
  });

  it('skips a place with no position and a place met twice in a row', () => {
    const lost: TripPlace = { ...place('Somewhere', 0, 0), coords: null };
    const hops = seaHops([stage('a', '2026-03-01', [MELBOURNE, lost, MELBOURNE, DEVONPORT])], SHIPPED, RULE);
    expect(hops).toHaveLength(1);
  });
});

describe('whether the overview asks', () => {
  it('asks a trip whose rule is off and never answered, and nobody else', () => {
    expect(shouldAskToSail({ ...DEFAULT_CROSSINGS, auto: false })).toBe(true);
    expect(shouldAskToSail({ ...DEFAULT_CROSSINGS, auto: false, asked: true })).toBe(false);
    expect(shouldAskToSail({ ...DEFAULT_CROSSINGS })).toBe(false);
    expect(shouldAskToSail(undefined)).toBe(false);
  });
});
