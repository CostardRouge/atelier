import { describe, expect, it } from 'vitest';
import {
  atStep,
  cancelRun,
  describeTimeLeft,
  enterUnit,
  finishUnit,
  phaseIndex,
  runCounts,
  runFraction,
  runStateOf,
  startRun,
  timeLeft,
} from './run-progress';

const STILL = [
  { id: 'render', label: 'Render' },
  { id: 'write', label: 'Write' },
];
const CLIP = [
  { id: 'fetch', label: 'Fetch' },
  { id: 'encode', label: 'Encode' },
  { id: 'write', label: 'Write' },
];
const run = (...ids: string[]) => ids.map((id) => ({ id, name: `${id}.JPG`, phases: STILL }));

describe('run progress', () => {
  it('walks each unit from queued through active to done or failed', () => {
    let p = startRun(run('a', 'b', 'c'), 0);
    expect(p.states).toEqual(['queued', 'queued', 'queued']);
    expect(p.names).toEqual(['a.JPG', 'b.JPG', 'c.JPG']);
    p = enterUnit(p, 0);
    expect(runStateOf(p, 'a')).toBe('active');
    // A unit starts at its OWN first stage.
    expect(p.phase).toBe('render');
    p = atStep(p, 'write', 'Writing a.png');
    expect([p.phase, p.step, phaseIndex(p)]).toEqual(['write', 'Writing a.png', 1]);
    p = finishUnit(p, 0, true, 10_000);
    p = enterUnit(p, 1);
    p = finishUnit(p, 1, false, 20_000);
    expect(p.states).toEqual(['done', 'failed', 'queued']);
    expect(runCounts(p)).toEqual({ total: 3, done: 1, failed: 1, finished: 2 });
    expect(p.phase).toBeNull();
    expect(runStateOf(p, 'zzz')).toBeNull();
    expect(runStateOf(null, 'a')).toBeNull();
  });

  it('carries a measured ratio for a step that knows how far it is, and clamps it', () => {
    let p = enterUnit(startRun([{ id: 'c', name: 'c.MP4', phases: CLIP }], 0), 0);
    expect(p.ratio).toBeNull();
    p = atStep(p, 'encode', 'Encoding c.MP4', 0.4);
    expect(p.ratio).toBe(0.4);
    expect(atStep(p, 'encode', 'x', 1.7).ratio).toBe(1);
    // A new stage without a measure forgets the last one.
    expect(atStep(p, 'write', 'Writing').ratio).toBeNull();
  });

  it('counts the whole in stages, never in time', () => {
    const units = [
      { id: 'a', name: 'a', phases: STILL },
      { id: 'b', name: 'b', phases: CLIP },
    ];
    let p = startRun(units, 0);
    expect(runFraction(p)).toBe(0);
    p = finishUnit(enterUnit(p, 0), 0, true, 1);
    expect(runFraction(p)).toBe(0.5);
    // Half of the unit in hand is its second of three stages, half through.
    p = atStep(enterUnit(p, 1), 'encode', 'Encoding', 0.5);
    expect(runFraction(p)).toBeCloseTo((1 + 1.5 / 3) / 2);
  });

  it('measures the time left from the units already finished, never before', () => {
    let p = enterUnit(startRun(run('a', 'b', 'c', 'd'), 0), 0);
    expect(timeLeft(p, 5_000)).toBeNull();
    // Two units in 20 s: 10 s each, two to go, 4 s spent on the third.
    p = finishUnit(p, 0, true, 10_000);
    p = finishUnit(enterUnit(p, 1), 1, true, 20_000);
    p = enterUnit(p, 2);
    expect(timeLeft(p, 24_000)).toBeCloseTo(16);
    // A slow unit never makes the estimate negative.
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
