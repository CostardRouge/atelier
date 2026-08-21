import { describe, expect, it } from 'vitest';
import { smoothHeading } from './heading-smooth';
import type { Cue } from './srt-parser';

/** A cue list at 10 Hz; `headings[i]` of null means "no reading here". */
function track(headings: (number | null)[], hz = 10): Cue[] {
  return headings.map((h, i) => ({
    start: i / hz,
    end: (i + 1) / hz,
    frame: i + 1,
    timestamp: null,
    data: {},
    derived: h == null ? {} : { heading: h },
  }));
}

describe('smoothHeading', () => {
  it('says nothing when there is nothing to say', () => {
    expect(smoothHeading([], 1).heading).toBeNull();
    expect(smoothHeading(track([null, null, null]), 0.2).heading).toBeNull();
    // Before the first cue.
    expect(smoothHeading(track([90, 90]), -1).heading).toBeNull();
  });

  it('returns the raw newest reading when smoothing is off', () => {
    const cues = track([10, 20, 30, 40]);
    expect(smoothHeading(cues, 0.3, 0).heading).toBe(40);
    expect(smoothHeading(cues, 0.1, 0).heading).toBe(20);
  });

  it('eases a step instead of jumping to it', () => {
    // Steady 0°, then a hard turn to 90° on the last few cues.
    const cues = track([0, 0, 0, 0, 0, 0, 90, 90, 90]);
    const raw = smoothHeading(cues, 0.8, 0).heading!;
    const eased = smoothHeading(cues, 0.8, 0.6).heading!;
    expect(raw).toBe(90);
    // The eased value is on its way there, not there yet.
    expect(eased).toBeGreaterThan(0);
    expect(eased).toBeLessThan(90);
  });

  it('averages the short way round North, never through South', () => {
    const cues = track([350, 355, 0, 5, 10]);
    const h = smoothHeading(cues, 0.4, 0.6).heading!;
    // The circular mean sits near North; an arithmetic mean would give ~144.
    const fromNorth = Math.min(h, 360 - h);
    expect(fromNorth).toBeLessThan(20);
  });

  it('bridges a short gap by holding the last known bearing', () => {
    const cues = track([90, 90, 90, null, null, null, null]);
    const out = smoothHeading(cues, 0.6, 0.6, 2);
    expect(out.heading).not.toBeNull();
    expect(Math.abs(out.heading! - 90)).toBeLessThan(1);
    expect(out.age).toBeGreaterThan(0);
    // Still trusted, but visibly less than live data.
    expect(out.confidence).toBeGreaterThan(0);
    expect(out.confidence).toBeLessThan(1);
  });

  it('lets confidence run out over the hold window, then gives up', () => {
    const cues = track([90, ...Array(60).fill(null)] as (number | null)[]);
    const live = smoothHeading(cues, 0, 0.6, 2);
    expect(live.confidence).toBe(1);

    const halfway = smoothHeading(cues, 1, 0.6, 2);
    expect(halfway.confidence).toBeGreaterThan(0.3);
    expect(halfway.confidence).toBeLessThan(0.7);

    const spent = smoothHeading(cues, 2.5, 0.6, 2);
    expect(spent.confidence).toBe(0);
  });

  it('is a pure function of (cues, time) — no accumulated state', () => {
    // The same call, made in any order, must give the same answer: this is what
    // keeps the preview and the export frame-identical.
    const cues = track([0, 30, 60, 90, 120, 150]);
    const forwards = [0.1, 0.2, 0.3, 0.4].map((t) => smoothHeading(cues, t).heading);
    const backwards = [0.4, 0.3, 0.2, 0.1]
      .map((t) => smoothHeading(cues, t).heading)
      .reverse();
    expect(forwards).toEqual(backwards);
  });

  it('follows a steady turn without lagging forever', () => {
    // A constant 60°/s turn: the eased value trails, but by a bounded amount.
    const cues = track(Array.from({ length: 40 }, (_, i) => (i * 6) % 360));
    const at = smoothHeading(cues, 3.9, 0.5).heading!;
    const raw = smoothHeading(cues, 3.9, 0).heading!;
    const lag = ((raw - at + 540) % 360) - 180;
    expect(lag).toBeGreaterThan(0);
    expect(lag).toBeLessThan(45);
  });
});
