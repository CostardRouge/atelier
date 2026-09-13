import { describe, expect, it } from 'vitest';
import type { HookDay } from './hook-variant';
import {
  DRIFT_SPAN,
  EASINGS,
  EASING_IDS,
  KIT_IDS,
  SCRUB_KITS,
  SCRUB_DEFAULTS,
  driftAt,
  sampleEvenly,
  scrubOptions,
  scrubPlan,
  scrubScore,
  scrubStopDays,
  stopFraction,
  tapeFraction,
  tapeTicks,
  type ScrubOptions,
} from './scrub-plan';

/** A trip of `total` days starting 2025-03-01, told on the given day numbers. */
function calendar(total: number, told: number[] = [], legs: number[] = [1]): HookDay[] {
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(Date.UTC(2025, 2, 1 + i));
    const isTold = told.includes(i + 1);
    return {
      date: d.toISOString().slice(0, 10),
      dayNumber: i + 1,
      told: isTold,
      legStart: legs.includes(i + 1),
      pieces: isTold ? [{ id: `p${i + 1}`, title: '', published: false }] : [],
    };
  });
}

const dateOf = (cal: HookDay[], n: number) => cal[n - 1].date;
const opts = (patch: Partial<ScrubOptions> = {}): ScrubOptions => ({ ...SCRUB_DEFAULTS, ...patch });

describe('scrubOptions', () => {
  it('fills what a document never stored', () => {
    expect(scrubOptions({})).toEqual(SCRUB_DEFAULTS);
  });

  it('clamps what it did store, and refuses what it cannot read', () => {
    const o = scrubOptions({ maxStops: 400, sweepSeconds: -2, runUpDays: 'lots', mode: 'sideways', tape: 7 });
    expect(o.maxStops).toBe(16);
    expect(o.sweepSeconds).toBe(0.8);
    expect(o.runUpDays).toBe(2);
    expect(o.mode).toBe('from-start');
    expect(o.tape).toBe('bottom');
  });
});

describe('sampleEvenly', () => {
  it('keeps the first and the last', () => {
    const out = sampleEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4);
    expect(out[0]).toBe(1);
    expect(out[out.length - 1]).toBe(10);
    expect(out).toHaveLength(4);
  });

  it('never repeats an item to reach a count', () => {
    expect(sampleEvenly([1, 2, 3], 8)).toEqual([1, 2, 3]);
  });
});

describe('stopFraction', () => {
  it('starts at zero and lands at the end', () => {
    expect(stopFraction(0, 12)).toBe(0);
    expect(stopFraction(11, 12)).toBe(1);
  });

  it('decelerates: every gap between stops is longer than the one before', () => {
    const times = Array.from({ length: 12 }, (_, i) => stopFraction(i, 12));
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
  });
});

describe('EASINGS', () => {
  it('every curve runs 0 → 1 and its inverse undoes it', () => {
    for (const id of EASING_IDS) {
      const { ease, inverse } = EASINGS[id];
      expect(ease(0)).toBeCloseTo(0, 9);
      expect(ease(1)).toBeCloseTo(1, 9);
      for (let k = 0; k <= 20; k++) {
        const u = k / 20;
        expect(inverse(ease(u))).toBeCloseTo(u, 6);
      }
    }
  });

  it('every curve is monotonic — a stop is never reached before the one before it', () => {
    for (const id of EASING_IDS) {
      const { ease } = EASINGS[id];
      let last = -1;
      for (let k = 0; k <= 100; k++) {
        const v = ease(k / 100);
        expect(v).toBeGreaterThanOrEqual(last);
        last = v;
      }
    }
  });

  it('places stops the way each curve says', () => {
    // Even: equal gaps. Wind up: the gaps SHRINK. Brake: the first gap is tiny.
    const linear = Array.from({ length: 5 }, (_, i) => stopFraction(i, 5, 'linear'));
    expect(linear).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const windUp = Array.from({ length: 5 }, (_, i) => stopFraction(i, 5, 'ease-in'));
    const gaps = windUp.slice(1).map((t, i) => t - windUp[i]);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]);
    expect(stopFraction(1, 12, 'ease-out-hard')).toBeLessThan(stopFraction(1, 12, 'ease-out'));
  });
});

describe('scrubStopDays', () => {
  it('sweeps from day 1 to the hero through told days only', () => {
    const cal = calendar(30, [3, 8, 14, 20]);
    const days = scrubStopDays(cal, dateOf(cal, 27), opts())!;
    expect(days.map((d) => d.dayNumber)).toEqual([1, 3, 8, 14, 20, 27]);
    // Day 1 is visited because the sweep STARTS there, not because it was told.
    expect(days[0].told).toBe(false);
  });

  it('caps the stops, keeping the start and the hero', () => {
    const cal = calendar(100, Array.from({ length: 60 }, (_, i) => i + 2));
    const days = scrubStopDays(cal, dateOf(cal, 90), opts({ maxStops: 8 }))!;
    expect(days).toHaveLength(8);
    expect(days[0].dayNumber).toBe(1);
    expect(days[days.length - 1].dayNumber).toBe(90);
  });

  it('runs up through the last told days before the hero', () => {
    const cal = calendar(40, [2, 5, 9, 12, 15, 18, 21, 24]);
    const days = scrubStopDays(cal, dateOf(cal, 30), opts({ mode: 'run-up', runUpDays: 3 }))!;
    expect(days.map((d) => d.dayNumber)).toEqual([18, 21, 24, 30]);
  });

  it('still sweeps a trip nothing has been told from, flashing nothing', () => {
    const cal = calendar(20);
    const days = scrubStopDays(cal, dateOf(cal, 15), opts())!;
    expect(days[0].dayNumber).toBe(1);
    expect(days[days.length - 1].dayNumber).toBe(15);
    expect(days.slice(0, -1).every((d) => !d.told)).toBe(true);
    expect(days.length).toBeGreaterThan(2);
  });

  it('refuses a day that is not a day of the trip', () => {
    expect(scrubStopDays(calendar(10), '2031-01-01', opts())).toBeNull();
  });

  it('sweeps exactly the chosen days, in calendar order, whatever the mode says', () => {
    const cal = calendar(30, [3, 8, 14, 20]);
    const days = scrubStopDays(
      cal,
      dateOf(cal, 27),
      opts({ days: 'chosen', mode: 'run-up', chosenDays: [dateOf(cal, 20), dateOf(cal, 3), dateOf(cal, 14)] }),
    )!;
    expect(days.map((d) => d.dayNumber)).toEqual([3, 14, 20, 27]);
  });

  it('drops a chosen day the sweep cannot reach, and keeps a chosen day nobody told as a dark stop', () => {
    const cal = calendar(30, [3, 8]);
    const days = scrubStopDays(
      cal,
      dateOf(cal, 20),
      opts({ days: 'chosen', chosenDays: [dateOf(cal, 25), dateOf(cal, 3), dateOf(cal, 11)] }),
    )!;
    expect(days.map((d) => d.dayNumber)).toEqual([3, 11, 20]);
    expect(days[1].told).toBe(false);
  });

  it('thins a long chosen list evenly rather than truncating it', () => {
    const cal = calendar(60, Array.from({ length: 40 }, (_, i) => i + 2));
    const chosen = cal.slice(1, 41).map((d) => d.date);
    const days = scrubStopDays(cal, dateOf(cal, 50), opts({ days: 'chosen', chosenDays: chosen }))!;
    expect(days.length).toBe(16);
    expect(days[0].dayNumber).toBe(2);
    expect(days[days.length - 2].dayNumber).toBe(41);
  });
});

describe('scrubPlan', () => {
  const cal = calendar(30, [3, 8, 14, 20]);
  const plan = scrubPlan(cal, dateOf(cal, 27), opts({ sweepSeconds: 2 }))!;

  it('lands the head exactly on every stop at that stop’s time', () => {
    plan.stops.forEach((stop, i) => {
      expect(plan.stopAt(stop.at)).toBe(i);
      expect(plan.headDayAt(stop.at)).toBeCloseTo(stop.dayNumber, 6);
    });
  });

  it('rests on the hero once the sweep is over', () => {
    expect(plan.stopAt(5)).toBe(plan.stops.length - 1);
    expect(plan.headDayAt(5)).toBe(27);
  });

  it('never flashes the hero, whose picture is already on the frame', () => {
    const hero = plan.stops[plan.stops.length - 1];
    expect(hero.hero).toBe(true);
    expect(hero.told).toBe(false);
    expect(plan.stops.filter((s) => s.told).map((s) => s.dayNumber)).toEqual([3, 8, 14, 20]);
  });

  it('measures the time since the head last landed', () => {
    const second = plan.stops[1];
    expect(plan.sinceStopAt(second.at + 0.01)).toBeCloseTo(0.01, 6);
  });

  it('has nothing to sweep when the hero is the first day', () => {
    const first = scrubPlan(cal, dateOf(cal, 1), opts())!;
    expect(first.sweepSeconds).toBe(0);
    expect(first.stops).toHaveLength(1);
    expect(first.headDayAt(0)).toBe(1);
  });

  it('reads the legs off the calendar', () => {
    const legs = scrubPlan(calendar(30, [], [1, 11, 21]), dateOf(cal, 25), opts())!;
    expect(legs.legStarts).toEqual([1, 11, 21]);
  });

  it('holds on the first stop for the delay, then sweeps — every stop shifted by it', () => {
    const held = scrubPlan(cal, dateOf(cal, 27), opts({ sweepSeconds: 2, delaySeconds: 0.5 }))!;
    expect(held.delaySeconds).toBe(0.5);
    expect(held.endSeconds).toBeCloseTo(2.5, 9);
    expect(held.stops[0].at).toBe(0.5);
    expect(held.stops[held.stops.length - 1].at).toBeCloseTo(2.5, 9);
    // During the hold the head has not left: first stop, first day, nothing "since".
    expect(held.stopAt(0.3)).toBe(0);
    expect(held.headDayAt(0.3)).toBe(held.stops[0].dayNumber);
    expect(held.sinceStopAt(0.3)).toBeLessThan(0);
    // The score is shifted with the stops.
    expect(scrubScore(held)[0].at).toBe(0.5);
  });

  it('has no delay when there is nowhere to sweep from', () => {
    const first = scrubPlan(cal, dateOf(cal, 1), opts({ delaySeconds: 1 }))!;
    expect(first.endSeconds).toBe(0);
  });

  it('lands the head on every stop at that stop’s time, on every easing', () => {
    for (const easing of EASING_IDS) {
      const p = scrubPlan(cal, dateOf(cal, 27), opts({ easing, sweepSeconds: 2 }))!;
      p.stops.forEach((stop, i) => {
        expect(p.stopAt(stop.at)).toBe(i);
        expect(p.headDayAt(stop.at)).toBeCloseTo(stop.dayNumber, 6);
      });
    }
  });
});

describe('the tape', () => {
  it('places the first and the last day at its two ends', () => {
    expect(tapeFraction(1, 104)).toBe(0);
    expect(tapeFraction(104, 104)).toBe(1);
    expect(tapeFraction(1, 1)).toBe(0);
  });

  it('ticks every day while there is room', () => {
    expect(tapeTicks(10, 900, [])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('thins out a long trip but keeps its ends and every leg start', () => {
    const ticks = tapeTicks(400, 800, [137, 251]);
    expect(ticks.length).toBeLessThan(400);
    expect(ticks).toContain(1);
    expect(ticks).toContain(400);
    expect(ticks).toContain(137);
    expect(ticks).toContain(251);
  });
});

describe('scrubScore', () => {
  it('lands a sound on every stop, at that stop’s own time', () => {
    const cal = calendar(30, [3, 8, 14, 20], [1, 14]);
    const plan = scrubPlan(cal, dateOf(cal, 27), opts())!;
    const score = scrubScore(plan);
    expect(score.map((e) => e.at)).toEqual(plan.stops.map((s) => s.at));
  });

  it('marks a leg with its own voice and ends on the seat', () => {
    const cal = calendar(30, [3, 8, 14, 20], [1, 14]);
    const plan = scrubPlan(cal, dateOf(cal, 27), opts())!;
    const score = scrubScore(plan);
    const voiceOn = (day: number) => score[plan.stops.findIndex((s) => s.dayNumber === day)].voice;
    expect(voiceOn(14)).toBe('leg');
    expect(voiceOn(8)).toBe('detent');
    expect(score[score.length - 1].voice).toBe('seat');
  });

  it('gets quieter as the mechanism slows, the seat apart', () => {
    const cal = calendar(60, [4, 9, 15, 22, 30, 37], []);
    const plan = scrubPlan(cal, dateOf(cal, 44), opts())!;
    const levels = scrubScore(plan).slice(0, -1).map((e) => e.gain ?? 0);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeLessThanOrEqual(levels[i - 1]);
  });

  it('is silent when there is nowhere to sweep from', () => {
    const cal = calendar(10, [2]);
    expect(scrubScore(scrubPlan(cal, dateOf(cal, 1), opts())!)).toEqual([]);
  });

  it('scales every tick by the volume, keeping their shape', () => {
    const cal = calendar(30, [3, 8, 14, 20], [1, 14]);
    const plan = scrubPlan(cal, dateOf(cal, 27), opts())!;
    const full = scrubScore(plan, 1);
    const half = scrubScore(plan, 0.5);
    half.forEach((event, i) => {
      expect(event.at).toBe(full[i].at);
      expect(event.gain).toBeCloseTo((full[i].gain ?? 0) * 0.5, 9);
    });
  });

  it('writes no score at all at volume 0, so no silent track is made', () => {
    const cal = calendar(30, [3, 8]);
    expect(scrubScore(scrubPlan(cal, dateOf(cal, 20), opts())!, 0)).toEqual([]);
  });

  it('reads the volume through the defaults, clamped, and falls back when unreadable', () => {
    expect(scrubOptions({}).tickVolume).toBe(1);
    expect(scrubOptions({ tickVolume: 9 }).tickVolume).toBe(2);
    expect(scrubOptions({ tickVolume: -1 }).tickVolume).toBe(0);
    expect(scrubOptions({ tickVolume: 'loud' }).tickVolume).toBe(1);
  });

  it('reads the sound switch through the defaults', () => {
    expect(scrubOptions({}).sound).toBe(true);
    expect(scrubOptions({ sound: false }).sound).toBe(false);
  });
});

describe('scrubScore tuning', () => {
  const cal = calendar(30, [3, 8, 14, 20], [1, 14]);
  const plan = scrubPlan(cal, dateOf(cal, 27), opts())!;
  const legIndex = plan.stops.findIndex((s) => s.dayNumber === 14);

  it('plays every kit on its own voices, the seat staying the seat', () => {
    for (const id of KIT_IDS) {
      const kit = SCRUB_KITS[id];
      const score = scrubScore(plan, 1, { kit: id, pitch: 1, drift: 'flat' });
      expect(score[1].voice).toBe(kit.tick);
      expect(score[legIndex].voice).toBe(kit.leg.voice);
      expect(score[score.length - 1].voice).toBe(kit.seat);
    }
  });

  it('makes a leg’s landing the different one in every kit — lower, a little louder', () => {
    for (const id of KIT_IDS) {
      const score = scrubScore(plan, 1, { kit: id, pitch: 1, drift: 'flat' });
      const plain = score[legIndex - 1];
      const leg = score[legIndex];
      if (id === 'ratchet') {
        expect(leg.voice).not.toBe(plain.voice);
      } else {
        expect(leg.rate ?? 1).toBeLessThan(plain.rate ?? 1);
        expect((leg.gain ?? 0) / Math.max(0.35, 0.85 - legIndex * 0.04)).toBeGreaterThan(1);
      }
    }
  });

  it('transposes every tick by the pitch, the seat included', () => {
    const up = scrubScore(plan, 1, { kit: 'ratchet', pitch: 2, drift: 'flat' });
    expect(up.every((e) => e.rate === 2)).toBe(true);
  });

  it('climbs or falls across the landings, and leaves the seat at the pitch', () => {
    const rising = scrubScore(plan, 1, { kit: 'ratchet', pitch: 1, drift: 'rising' });
    const landings = rising.slice(0, -1).map((e) => e.rate ?? 1);
    for (let i = 1; i < landings.length; i++) expect(landings[i]).toBeGreaterThan(landings[i - 1]);
    expect(landings[0]).toBeCloseTo(DRIFT_SPAN.from, 9);
    expect(landings[landings.length - 1]).toBeCloseTo(DRIFT_SPAN.to, 9);
    expect(rising[rising.length - 1].rate).toBe(1);

    const falling = scrubScore(plan, 1, { kit: 'ratchet', pitch: 1, drift: 'falling' });
    const down = falling.slice(0, -1).map((e) => e.rate ?? 1);
    for (let i = 1; i < down.length; i++) expect(down[i]).toBeLessThan(down[i - 1]);
  });

  it('keeps a steady drift at exactly the pitch', () => {
    expect(driftAt('flat', 0)).toBe(1);
    expect(driftAt('flat', 1)).toBe(1);
    expect(driftAt('rising', 0.5)).toBeCloseTo((DRIFT_SPAN.from + DRIFT_SPAN.to) / 2, 9);
  });

  it('reads the tuning through the defaults, and refuses what it cannot', () => {
    expect(scrubOptions({}).kit).toBe('ratchet');
    expect(scrubOptions({ kit: 'kazoo' }).kit).toBe('ratchet');
    expect(scrubOptions({ kit: 'wood' }).kit).toBe('wood');
    expect(scrubOptions({ tickPitch: 9 }).tickPitch).toBe(2);
    expect(scrubOptions({ tickPitch: 'high' }).tickPitch).toBe(1);
    expect(scrubOptions({ pitchDrift: 'sideways' }).pitchDrift).toBe('flat');
    expect(scrubOptions({ pitchDrift: 'rising' }).pitchDrift).toBe('rising');
  });
});

describe('the sweep options a document may hold', () => {
  it('refuses an easing it does not know, and clamps the hold', () => {
    expect(scrubOptions({ easing: 'bouncy' }).easing).toBe('ease-out');
    expect(scrubOptions({ easing: 'linear' }).easing).toBe('linear');
    expect(scrubOptions({ delaySeconds: 9 }).delaySeconds).toBe(2);
    expect(scrubOptions({ delaySeconds: 'long' }).delaySeconds).toBe(0);
  });

  it('keeps only real days in the chosen list, once each', () => {
    expect(
      scrubOptions({ days: 'chosen', chosenDays: ['2025-03-04', 'tuesday', 7, '2025-03-04', '2025-03-09'] })
        .chosenDays,
    ).toEqual(['2025-03-04', '2025-03-09']);
    expect(scrubOptions({ chosenDays: 'all' }).chosenDays).toEqual([]);
    expect(scrubOptions({ days: 'sometimes' }).days).toBe('auto');
  });

  it('keeps only day → piece pairs it can read', () => {
    expect(
      scrubOptions({ pieceByDay: { '2025-03-04': 'p1', bad: 'p2', '2025-03-05': 3, '2025-03-06': '' } })
        .pieceByDay,
    ).toEqual({ '2025-03-04': 'p1' });
    expect(scrubOptions({ pieceByDay: ['p1'] }).pieceByDay).toEqual({});
  });
});
