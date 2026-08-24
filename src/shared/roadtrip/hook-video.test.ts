import { describe, expect, it } from 'vitest';
import {
  MAX_HOOK_SECONDS,
  MIN_HOOK_SECONDS,
  defaultHookSeconds,
  hookRange,
  hookSecondsWithin,
  hookSourceProblem,
  hookVariant,
  hookVideoName,
} from './hook-video';

describe('defaultHookSeconds', () => {
  it('gives the badge its hold plus a beat of picture', () => {
    expect(defaultHookSeconds(4)).toBe(5);
  });

  it('stays inside what the control offers, whatever it is handed', () => {
    for (const d of [-10, 0, 0.2, 4, 120, NaN, Infinity]) {
      const v = defaultHookSeconds(d);
      expect(v).toBeGreaterThanOrEqual(MIN_HOOK_SECONDS);
      expect(v).toBeLessThanOrEqual(MAX_HOOK_SECONDS);
    }
  });
});

describe('hookRange', () => {
  it('starts on the frame the author picked', () => {
    expect(hookRange(3, 5, 60)).toEqual({ start: 3, end: 8 });
  });

  it('stops at the end of the clip rather than past it', () => {
    expect(hookRange(8, 5, 10)).toEqual({ start: 8, end: 10 });
  });

  it('is null when the whole clip already goes out', () => {
    expect(hookRange(0, 30, 6)).toBeNull();
  });

  it('is null when the duration is not known yet', () => {
    expect(hookRange(0, 5, 0)).toBeNull();
    expect(hookRange(2, 5, NaN)).toBeNull();
  });

  it('never returns an empty or inverted slice', () => {
    for (const [start, length, duration] of [
      [100, 5, 10],
      [9.99, 5, 10],
      [-4, 5, 10],
      [3, -5, 10],
    ] as const) {
      const r = hookRange(start, length, duration);
      if (!r) continue;
      expect(r.end).toBeGreaterThan(r.start);
      expect(r.start).toBeGreaterThanOrEqual(0);
      expect(r.end).toBeLessThanOrEqual(duration);
    }
  });
});

describe('hookVariant', () => {
  it('burns the overlays in — a clean hook is not a hook', () => {
    expect(hookVariant('9:16').overlays).toBe(true);
  });

  it('keeps the clip’s own cadence and speed', () => {
    const v = hookVariant('9:16');
    expect(v.frameRate).toBe('source');
    expect(v.speed).toBe(1);
  });

  it('carries the post’s frame', () => {
    expect(hookVariant('4:5').aspectId).toBe('4:5');
  });
});

describe('hookVideoName', () => {
  it('says the trip, the piece and that it is the hook', () => {
    const name = hookVideoName('Australia', 'day 27', hookVariant('9:16'));
    expect(name).toBe('australia-day-27-hook-9x16-1080p.mp4');
  });

  it('survives a nameless trip and a nameless piece', () => {
    expect(hookVideoName('', '', hookVariant('source', 'source'))).toBe('hook.mp4');
  });

  it('is a legal file name whatever was typed', () => {
    const name = hookVideoName('Australie / 2025', 'Jour 27 — départ!', hookVariant('9:16'));
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
    expect(name.endsWith('.mp4')).toBe(true);
  });
});

describe('hookSecondsWithin', () => {
  it('follows the badge until the author says otherwise', () => {
    expect(hookSecondsWithin(null, 4, 60)).toBe(5);
    expect(hookSecondsWithin(9, 4, 60)).toBe(9);
  });

  it('never claims more than the clip holds', () => {
    expect(hookSecondsWithin(9, 4, 3)).toBe(3);
    expect(hookSecondsWithin(null, 20, 2.5)).toBe(2.5);
  });

  it('falls back to the full range while the duration is unknown', () => {
    expect(hookSecondsWithin(12, 4, 0)).toBe(12);
  });

  it('stays at least the minimum, however short the clip', () => {
    expect(hookSecondsWithin(null, 4, 0.2)).toBe(MIN_HOOK_SECONDS);
  });
});

describe('hookSourceProblem', () => {
  it('passes what the pipeline can actually demux', () => {
    expect(hookSourceProblem('DJI_0042.MP4')).toBeNull();
    expect(hookSourceProblem('clip.mov')).toBeNull();
    expect(hookSourceProblem('clip', 'video/mp4')).toBeNull();
  });

  it('names the file and says the still still works', () => {
    const said = hookSourceProblem('clip.webm', 'video/webm');
    expect(said).toContain('clip.webm');
    expect(said).toMatch(/PNG/);
  });
});
