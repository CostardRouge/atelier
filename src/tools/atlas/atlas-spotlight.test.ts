import { describe, expect, it } from 'vitest';
import { episodeAt, spanForKm, spotlightEpisodes, spotlightStrength, type SpotlightSettings } from './atlas-spotlight';

const on: SpotlightSettings = { on: true, pick: 'random', every: 2, hold: 3, closeness: 1, dim: 0.5, seed: 1 };
const flights = [
  { id: 'a', distanceKm: 1 },
  { id: 'b', distanceKm: 5 },
  { id: 'c', distanceKm: 2 },
];
const slots = [
  { start: 0, end: 10 },
  { start: 2, end: 20 },
  { start: 5, end: 30 },
];

describe('spotlight', () => {
  it('lays episodes out, never overlapping, each on a flight in the air', () => {
    const eps = spotlightEpisodes(flights, slots, 30, on, []);
    expect(eps.length).toBeGreaterThan(2);
    for (let i = 0; i < eps.length; i++) {
      const e = eps[i];
      expect(slots[e.flight].start).toBeLessThanOrEqual(e.start);
      expect(e.end).toBeLessThanOrEqual(slots[e.flight].end);
      if (i) expect(e.start).toBeGreaterThanOrEqual(eps[i - 1].end + on.every - 1e-9);
    }
    expect(spotlightEpisodes(flights, slots, 30, { ...on, on: false }, [])).toEqual([]);
  });

  it('picks the farthest, or the picked ones in turn', () => {
    expect(spotlightEpisodes(flights, slots, 30, { ...on, pick: 'farthest' }, []).every((e) => e.flight === 1 || slots[1].end <= e.start)).toBe(true);
    const picked = spotlightEpisodes(flights, slots, 30, { ...on, pick: 'picked' }, ['c']);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((e) => e.flight === 2)).toBe(true);
  });

  it('finds a flight even in a tight cascade of short slots', () => {
    const short = Array.from({ length: 20 }, (_, i) => ({ start: i * 1.4, end: i * 1.4 + 2.2 }));
    const eps = spotlightEpisodes(short.map((_, i) => ({ id: String(i), distanceKm: 1 })), short, 30, { ...on, every: 4, hold: 5 }, []);
    expect(eps.length).toBeGreaterThan(2);
  });

  it('eases in and out, and spans the asked distance', () => {
    const eps = [{ flight: 0, start: 5, end: 10 }];
    expect(episodeAt(eps, 7)?.flight).toBe(0);
    expect(spotlightStrength(eps, 7.5)?.strength).toBe(1);
    expect(spotlightStrength(eps, 5)?.strength ?? 0).toBe(0);
    expect(spotlightStrength(eps, 2)).toBeNull();
    expect(spanForKm(40.075017, 0)).toBeCloseTo(0.001, 9);
    expect(spanForKm(1, 60)).toBeCloseTo(2 * spanForKm(1, 0), 6);
  });
});
