import { describe, expect, it } from 'vitest';
import { PlayClock } from './play-clock';

describe('PlayClock', () => {
  it('holds the playhead on the first tick after Play, then moves', () => {
    const clock = new PlayClock();
    clock.setTotal(10);
    clock.setPlaying(true);
    expect(clock.starting).toBe(true);
    // However long the frame that started it took, the film starts where it stood.
    expect(clock.tick(0.1)).toBe(true);
    expect(clock.t).toBe(0);
    expect(clock.starting).toBe(false);
    clock.tick(0.05);
    expect(clock.t).toBeCloseTo(0.05, 9);
  });

  it('holds again only after a pause, not on a Play while playing', () => {
    const clock = new PlayClock();
    clock.setTotal(10);
    clock.setPlaying(true);
    clock.tick(0.1);
    clock.tick(0.5);
    clock.setPlaying(true);
    expect(clock.starting).toBe(false);
    clock.setPlaying(false);
    expect(clock.tick(0.5)).toBe(false);
    clock.setPlaying(true);
    clock.tick(0.5);
    expect(clock.t).toBeCloseTo(0.5, 9);
  });
});
