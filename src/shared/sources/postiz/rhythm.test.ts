import { describe, expect, it } from 'vitest';
import { DEFAULT_RHYTHM, localDay, nextFreeSlot, readRhythm, rhythmWarnings, slotLabel, slotsWithState, upcomingSlots, weekOf, zonedInstant } from './rhythm';

const tz = 'Europe/Paris';

describe('the publishing rhythm', () => {
  it('reads a rhythm, its default the plan’s three slots', () => {
    expect(readRhythm(undefined)).toEqual(DEFAULT_RHYTHM);
    expect(readRhythm({ timeZone: 'Mars/Base', slots: [{ day: 9, time: '25:00' }], perWeek: 0 })).toEqual(DEFAULT_RHYTHM);
    expect(readRhythm({ timeZone: 'Australia/Perth', slots: [{ day: 1, time: '07:30' }], perWeek: 2 })).toEqual({ timeZone: 'Australia/Perth', slots: [{ day: 1, time: '07:30' }], perWeek: 2 });
  });

  it('turns a wall clock into its instant, across daylight saving', () => {
    expect(zonedInstant(2026, 11, 17, 9, 0, tz).toISOString()).toBe('2026-11-17T08:00:00.000Z');
    expect(zonedInstant(2026, 7, 14, 9, 0, tz).toISOString()).toBe('2026-07-14T07:00:00.000Z');
    expect(zonedInstant(2026, 11, 17, 19, 0, 'Australia/Sydney').toISOString()).toBe('2026-11-17T08:00:00.000Z');
  });

  it('lists the week’s slots from now, Tuesday 9:00 first on a Sunday evening', () => {
    const from = new Date('2026-11-08T20:00:00Z');
    const s = upcomingSlots(DEFAULT_RHYTHM, from, 4).map((d) => slotLabel(d, tz));
    expect(s).toEqual(['Tue 10 Nov · 9:00', 'Fri 13 Nov · 19:00', 'Sun 15 Nov · 10:00', 'Tue 17 Nov · 9:00']);
  });

  it('skips a slot already planned, its day, and a full week', () => {
    const from = new Date('2026-11-08T20:00:00Z');
    const tue = zonedInstant(2026, 11, 10, 9, 0, tz);
    expect(slotsWithState(DEFAULT_RHYTHM, [tue], from, 2).map((s) => s.taken)).toEqual([true, false]);
    expect(slotLabel(nextFreeSlot(DEFAULT_RHYTHM, [tue], from)!, tz)).toBe('Fri 13 Nov · 19:00');
    // A post on Friday morning holds Friday's slot too: never two the same day.
    const friMorning = zonedInstant(2026, 11, 13, 8, 0, tz);
    expect(slotLabel(nextFreeSlot(DEFAULT_RHYTHM, [tue, friMorning], from)!, tz)).toBe('Sun 15 Nov · 10:00');
    const full = { ...DEFAULT_RHYTHM, perWeek: 2 };
    expect(slotLabel(nextFreeSlot(full, [tue, friMorning], from)!, tz)).toBe('Tue 17 Nov · 9:00');
  });

  it('warns, never forbids', () => {
    const tue = zonedInstant(2026, 11, 10, 9, 0, tz);
    const fri = zonedInstant(2026, 11, 13, 19, 0, tz);
    const sun = zonedInstant(2026, 11, 15, 10, 0, tz);
    expect(rhythmWarnings(DEFAULT_RHYTHM, [tue], zonedInstant(2026, 11, 10, 20, 0, tz))).toEqual(['Another post already goes out that day.']);
    expect(rhythmWarnings(DEFAULT_RHYTHM, [tue, fri, sun], zonedInstant(2026, 11, 12, 12, 0, tz))).toEqual(['That makes 4 this week — your rhythm says 3.']);
    expect(rhythmWarnings(DEFAULT_RHYTHM, [tue], fri)).toEqual([]);
    expect(weekOf(sun, tz)).toBe('2026-11-09');
    expect(localDay(zonedInstant(2026, 11, 10, 0, 30, tz), tz)).toBe('2026-11-10');
  });
});
