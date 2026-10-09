import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLand, type LandCollection } from './land';
import { hopTerrain, landAt, landIndex, stepKm, stopLand, type RouteSample } from './terrain';

const SHIPPED = landIndex(
  parseLand(JSON.parse(readFileSync(fileURLToPath(new URL('../../../public/geo/land.json', import.meta.url)), 'utf8'))),
);
const RULE = { bridgeKm: 2, shoreKm: 5 };

type Place = [lon: number, lat: number];
const PLACES: Record<string, Place> = {
  melbourne: [144.96, -37.81],
  devonport: [146.36, -41.18],
  hobart: [147.33, -42.88],
  esperance: [121.89, -33.86],
  adelaide: [138.6, -34.93],
  bremerBay: [119.38, -34.39],
  bremerCanyon: [119.75, -34.85],
  airlie: [148.72, -20.27],
  whitehaven: [149.04, -20.28],
  daintreeVillage: [145.32, -16.25],
  daintreeRiver: [145.4, -16.29],
  herveyBay: [152.85, -25.29],
  algeciras: [-5.45, 36.13],
  tangerMed: [-5.5, 35.89],
  sete: [3.7, 43.4],
  barcelona: [2.17, 41.38],
};

/** A straight hop, sampled every ~2 km — `s` is the sample's share of the hop. */
function hop(a: Place, b: Place): RouteSample[] {
  const n = Math.max(2, Math.ceil(stepKm({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] }) / 2));
  const out: RouteSample[] = [];
  let km = 0;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = { lon: a[0] + (b[0] - a[0]) * u, lat: a[1] + (b[1] - a[1]) * u };
    if (i) km += stepKm(out[i - 1], p);
    out.push({ ...p, s: u, km });
  }
  return out;
}

describe('the shipped coastline', () => {
  it('knows Tasmania from the mainland, and the Whitsundays from both', () => {
    const mainland = landAt(SHIPPED, ...PLACES.melbourne);
    expect(mainland).toBeGreaterThanOrEqual(0);
    expect(landAt(SHIPPED, ...PLACES.devonport)).not.toBe(mainland);
    expect(landAt(SHIPPED, ...PLACES.whitehaven)).not.toBe(mainland);
    expect(landAt(SHIPPED, ...PLACES.bremerCanyon)).toBe(-1);
  });

  it('puts a harbour town that falls in its sea back ashore, within the shore distance', () => {
    expect(landAt(SHIPPED, ...PLACES.hobart)).toBe(-1);
    expect(stopLand(SHIPPED, ...PLACES.hobart, 5)).toBe(landAt(SHIPPED, ...PLACES.devonport));
    expect(stopLand(SHIPPED, ...PLACES.hobart, 0)).toBe(-1);
  });
});

describe('a hop’s terrain', () => {
  it('sails Bass Strait: two lands, the water from the last of one to the first of the other', () => {
    const t = hopTerrain(SHIPPED, hop(PLACES.melbourne, PLACES.devonport), RULE);
    expect(t.why).toBe('strait');
    expect(t.water).not.toBeNull();
    expect(t.waterKm).toBeGreaterThan(200);
    expect(t.water!.s0).toBeGreaterThan(0);
    expect(t.water!.s1).toBeLessThan(1);
  });

  it('drives round the Great Australian Bight: the same land at both ends is a shortcut, not a crossing', () => {
    const t = hopTerrain(SHIPPED, hop(PLACES.esperance, PLACES.adelaide), RULE);
    expect(t.water).toBeNull();
    expect(t.why).toBe('shortcut');
    expect(t.shortcutKm).toBeGreaterThan(500);
  });

  it('sails Gibraltar though Africa and Eurasia are one land on the map: a strait, not a bay', () => {
    expect(stopLand(SHIPPED, ...PLACES.algeciras, 5)).toBe(stopLand(SHIPPED, ...PLACES.tangerMed, 5));
    const t = hopTerrain(SHIPPED, hop(PLACES.algeciras, PLACES.tangerMed), RULE);
    expect(t.why).toBe('strait');
    expect(t.waterKm).toBeGreaterThan(5);
  });

  it('drives along a coast whose curve cuts a gulf: Sète to Barcelona is a shortcut', () => {
    expect(hopTerrain(SHIPPED, hop(PLACES.sete, PLACES.barcelona), RULE).water).toBeNull();
  });

  it('sails out to the orcas: an end at sea is water to the end', () => {
    const t = hopTerrain(SHIPPED, hop(PLACES.bremerBay, PLACES.bremerCanyon), RULE);
    expect(t.why).toBe('sea');
    expect(t.water!.s1).toBe(1);
  });

  it('sails to Whitehaven, and back', () => {
    expect(hopTerrain(SHIPPED, hop(PLACES.airlie, PLACES.whitehaven), RULE).why).toBe('strait');
    expect(hopTerrain(SHIPPED, hop(PLACES.whitehaven, PLACES.airlie), RULE).why).toBe('strait');
  });

  it('cannot see the Daintree: a river is land at 1:50m, so it is picked by hand', () => {
    const t = hopTerrain(SHIPPED, hop(PLACES.daintreeVillage, PLACES.daintreeRiver), RULE);
    expect(t.water).toBeNull();
    expect(t.why).toBe('land');
  });

  it('keeps a stop just off its coast ashore: Hervey Bay to Melbourne is driven', () => {
    expect(hopTerrain(SHIPPED, hop(PLACES.herveyBay, PLACES.melbourne), RULE).water).toBeNull();
  });
});

describe('a bridge', () => {
  /** Two square islands 1.8 km apart at the equator. */
  const islands: LandCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [[[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]]],
            [[[0.1162, 0], [0.2162, 0], [0.2162, 0.1], [0.1162, 0.1], [0.1162, 0]]],
          ],
        },
      },
    ],
  };
  const index = landIndex(islands);
  const across = hop([0.05, 0.05], [0.166, 0.05]);

  it('is driven when the water is shorter than the bridge length, and sailed when it is not', () => {
    expect(hopTerrain(index, across, { bridgeKm: 2, shoreKm: 0 }).why).toBe('bridge');
    expect(hopTerrain(index, across, { bridgeKm: 1, shoreKm: 0 }).why).toBe('strait');
  });
});
