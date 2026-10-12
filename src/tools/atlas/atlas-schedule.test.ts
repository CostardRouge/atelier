import { describe, expect, it } from 'vitest';
import { activeAt, activityCurve, buildSchedule, flightState, orderFlights, tempoCurve, wallAt, type ChoreoSettings, type FlightMeta } from './atlas-schedule';

const base: ChoreoSettings = {
  mode: 'together',
  order: 'date',
  length: 30,
  stagger: 0.5,
  overlap: 0,
  equalize: 0,
  jitter: 0,
  seed: 1,
  tempo: 'linear',
  dayStretch: 1,
  cropNight: false,
  idleCap: 1,
  hold: 2,
};

const day = (h: number, m = 0) => Date.UTC(2026, 0, 10, h, m);

const flights: FlightMeta[] = [
  { name: 'b', duration: 100, startWall: day(9), distanceKm: 1, maxAlt: 50, lat0: 0, lon0: 10 },
  { name: 'a', duration: 300, startWall: day(7), distanceKm: 3, maxAlt: 90, lat0: 1, lon0: -5 },
  { name: 'c', duration: 200, startWall: null, distanceKm: 2, maxAlt: 20, lat0: -1, lon0: 0 },
];

describe('orderFlights', () => {
  it('orders by date with the undated last, and by the other keys', () => {
    expect(orderFlights(flights, 'date', 1)).toEqual([1, 0, 2]);
    expect(orderFlights(flights, 'duration', 1)).toEqual([0, 2, 1]);
    expect(orderFlights(flights, 'west-east', 1)).toEqual([1, 2, 0]);
    expect(orderFlights(flights, 'name', 1)).toEqual([1, 0, 2]);
  });
  it('shuffles the same way for the same seed', () => {
    expect(orderFlights(flights, 'random', 9)).toEqual(orderFlights(flights, 'random', 9));
  });
});

describe('buildSchedule', () => {
  it('fits every mode to the asked length and adds the hold', () => {
    for (const mode of ['together', 'cascade', 'relay', 'clock', 'calendar'] as const) {
      const s = buildSchedule(flights, { ...base, mode });
      const end = Math.max(...s.slots.map((x) => x.end));
      expect(end).toBeLessThanOrEqual(30 + 1e-9);
      expect(s.total).toBe(32);
      expect(s.slots).toHaveLength(3);
    }
  });

  it('together: everyone at zero, the longest filling the length', () => {
    const s = buildSchedule(flights, base);
    expect(s.slots.map((x) => x.start)).toEqual([0, 0, 0]);
    expect(s.slots[1].end).toBeCloseTo(30, 9);
    expect(s.slots[0].end).toBeCloseTo(10, 9);
  });

  it('equalize gives every flight the same slot', () => {
    const s = buildSchedule(flights, { ...base, equalize: 1 });
    const lens = s.slots.map((x) => x.end - x.start);
    expect(lens[0]).toBeCloseTo(lens[1], 9);
    expect(lens[1]).toBeCloseTo(lens[2], 9);
  });

  it('relay: each takes off as the previous lands', () => {
    const s = buildSchedule(flights, { ...base, mode: 'relay' });
    // Date order: a (1), b (0), c (2).
    expect(s.slots[1].start).toBe(0);
    expect(s.slots[0].start).toBeCloseTo(s.slots[1].end, 9);
    expect(s.slots[2].start).toBeCloseTo(s.slots[0].end, 9);
  });

  it('cascade: launches a fixed spacing apart', () => {
    const s = buildSchedule(flights, { ...base, mode: 'cascade', stagger: 0.5 });
    const gap1 = s.slots[0].start - s.slots[1].start;
    const gap2 = s.slots[2].start - s.slots[0].start;
    expect(gap1).toBeGreaterThan(0);
    expect(gap1).toBeCloseTo(gap2, 9);
  });

  it('clock: the clock reads the hour a flight took off when it takes off', () => {
    const s = buildSchedule(flights, { ...base, mode: 'clock', cropNight: true });
    const at = wallAt(s.clock, s.slots[0].start) as number;
    expect(new Date(at).getUTCHours()).toBe(9);
    expect(new Date(wallAt(s.clock, s.slots[1].start) as number).getUTCHours()).toBe(7);
  });

  it('calendar: the idle past the cap is cut, the clock racing through it', () => {
    const two: FlightMeta[] = [
      { ...flights[0], startWall: Date.UTC(2026, 0, 1, 10) },
      { ...flights[0], startWall: Date.UTC(2026, 2, 1, 10) },
    ];
    const s = buildSchedule(two, { ...base, mode: 'calendar', idleCap: 0 });
    // With no idle kept, the second starts as the first lands.
    expect(s.slots[1].start).toBeCloseTo(s.slots[0].end, 6);
    expect(new Date(wallAt(s.clock, s.slots[1].start + 1e-6) as number).getUTCMonth()).toBe(2);
  });

  it('an empty list still has a clock', () => {
    const s = buildSchedule([], base);
    expect(s.slots).toEqual([]);
    expect(s.total).toBe(32);
    expect(wallAt(s.clock, 5)).toBeNull();
  });
});

describe('flight state and activity', () => {
  it('is before, flying, then landed', () => {
    const slot = { start: 2, end: 4 };
    expect(flightState(slot, 100, 'linear', 1).phase).toBe('before');
    const mid = flightState(slot, 100, 'linear', 3);
    expect(mid.phase).toBe('flying');
    expect(mid.flightT).toBeCloseTo(50, 9);
    expect(flightState(slot, 100, 'linear', 5)).toMatchObject({ phase: 'landed', flightT: 100 });
  });

  it('tempo curves start at 0 and end at 1', () => {
    for (const t of ['linear', 'ease', 'rush', 'linger'] as const) {
      expect(tempoCurve(t, 0)).toBe(0);
      expect(tempoCurve(t, 1)).toBe(1);
    }
    expect(tempoCurve('rush', 0.5)).toBeGreaterThan(0.5);
    expect(tempoCurve('linger', 0.5)).toBeLessThan(0.5);
  });

  it('counts what is in the air', () => {
    const slots = [
      { start: 0, end: 5 },
      { start: 3, end: 8 },
    ];
    expect(activeAt(slots, 4)).toBe(2);
    expect(activeAt(slots, 6)).toBe(1);
    expect(activityCurve(slots, 10, 10)).toEqual([1, 1, 1, 2, 2, 1, 1, 1, 0, 0]);
  });
});
