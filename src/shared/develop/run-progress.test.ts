import { describe, expect, it } from 'vitest';
import {
  atStep,
  cancelRun,
  describeTimeLeft,
  enterPicture,
  finishPicture,
  runCounts,
  runStateOf,
  startRun,
  timeLeft,
} from './run-progress';

const run = (...ids: string[]) => ids.map((id) => ({ id, name: `${id}.JPG` }));

describe('run progress', () => {
  it('walks each picture from queued through active to done or failed', () => {
    let p = startRun(run('a', 'b', 'c'), 0);
    expect(p.states).toEqual(['queued', 'queued', 'queued']);
    expect(p.names).toEqual(['a.JPG', 'b.JPG', 'c.JPG']);
    p = enterPicture(p, 0);
    expect(runStateOf(p, 'a')).toBe('active');
    expect(p.phase).toBe('fetch');
    p = atStep(p, 'develop', 'Rendering');
    expect([p.phase, p.step]).toEqual(['develop', 'Rendering']);
    p = finishPicture(p, 0, true, 10_000);
    p = enterPicture(p, 1);
    p = finishPicture(p, 1, false, 20_000);
    expect(p.states).toEqual(['done', 'failed', 'queued']);
    expect(runCounts(p)).toEqual({ total: 3, done: 1, failed: 1, finished: 2 });
    expect(p.phase).toBeNull();
    expect(runStateOf(p, 'zzz')).toBeNull();
    expect(runStateOf(null, 'a')).toBeNull();
  });

  it('measures the time left from the pictures already finished, never before', () => {
    let p = enterPicture(startRun(run('a', 'b', 'c', 'd'), 0), 0);
    expect(timeLeft(p, 5_000)).toBeNull();
    // Two pictures in 20 s: 10 s each, two to go, 4 s spent on the third.
    p = finishPicture(p, 0, true, 10_000);
    p = finishPicture(enterPicture(p, 1), 1, true, 20_000);
    p = enterPicture(p, 2);
    expect(timeLeft(p, 24_000)).toBeCloseTo(16);
    // A slow picture never makes the estimate negative.
    expect(timeLeft(p, 90_000)).toBe(0);
  });

  it('says the time left in words, and nothing when it is unknown', () => {
    expect(describeTimeLeft(null)).toBeNull();
    expect(describeTimeLeft(3)).toBe('almost done');
    expect(describeTimeLeft(42)).toBe('about 40 s left');
    expect(describeTimeLeft(200)).toBe('about 3 min left');
  });

  it('marks a cancel once', () => {
    const p = cancelRun(startRun(run('a'), 0));
    expect(p.cancelling).toBe(true);
    expect(cancelRun(p)).toBe(p);
  });
});
