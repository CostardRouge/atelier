import { describe, expect, it } from 'vitest';
import {
  CLIP_SPEEDS,
  MAX_HOOK_SECONDS,
  MIN_HOOK_SECONDS,
  clipSlice,
  clipSpeed,
  defaultHookSeconds,
  hookRange,
  hookSecondsWithin,
  hookSourceProblem,
  hookVariant,
  hookVideoName,
  retimedScreenSeconds,
  screenSecondsCeiling,
  screenSecondsOf,
  screenSecondsWithin,
} from './hook-video';

describe('clipSpeed', () => {
  it('offers the Studio’s own steps, with 1 among them', () => {
    expect(CLIP_SPEEDS).toContain(1);
    for (const s of CLIP_SPEEDS) expect(clipSpeed(s)).toBe(s);
  });

  it('reads anything odd as “as shot”', () => {
    for (const s of [0, -2, NaN, Infinity, undefined, null, 1000]) {
      expect(clipSpeed(s)).toBe(1);
    }
  });
});

describe('clipSlice', () => {
  it('is the in point plus the screen time, as shot', () => {
    expect(clipSlice(3, 5, 1, 60)).toEqual({ start: 3, end: 8 });
  });

  it('reaches twice as far into the source at 2× and half as far at 0.5×', () => {
    expect(clipSlice(3, 5, 2, 60)).toEqual({ start: 3, end: 13 });
    expect(clipSlice(3, 5, 0.5, 60)).toEqual({ start: 3, end: 5.5 });
  });

  it('never reaches past the end of the clip', () => {
    expect(clipSlice(8, 5, 2, 10)).toEqual({ start: 8, end: 10 });
  });

  it('assumes the clip is long enough while its duration is unknown', () => {
    expect(clipSlice(3, 5, 2, 0)).toEqual({ start: 3, end: 13 });
    expect(clipSlice(3, 5, 1, NaN)).toEqual({ start: 3, end: 8 });
  });

  it('never returns an empty or inverted slice', () => {
    for (const [start, length, speed, duration] of [
      [100, 5, 1, 10],
      [9.99, 5, 4, 10],
      [-4, 5, 0.25, 10],
      [3, -5, 2, 10],
      [3, 0, 1, 10],
    ] as const) {
      const r = clipSlice(start, length, speed, duration);
      expect(r.end).toBeGreaterThan(r.start);
      expect(r.start).toBeGreaterThanOrEqual(0);
      expect(r.end).toBeLessThanOrEqual(duration);
    }
  });
});

describe('screenSecondsOf', () => {
  it('is the source stretch divided by the speed', () => {
    expect(screenSecondsOf({ start: 3, end: 13 }, 2)).toBe(5);
    expect(screenSecondsOf({ start: 3, end: 5.5 }, 0.5)).toBe(5);
    expect(screenSecondsOf({ start: 3, end: 8 }, 1)).toBe(5);
  });

  it('round-trips with clipSlice', () => {
    for (const speed of CLIP_SPEEDS) {
      expect(screenSecondsOf(clipSlice(2, 4, speed, 120), speed)).toBeCloseTo(4);
    }
  });
});

describe('screenSecondsCeiling', () => {
  it('is what is left of the clip after the in point, at the speed', () => {
    expect(screenSecondsCeiling(4, 1, 10)).toBe(6);
    expect(screenSecondsCeiling(4, 2, 10)).toBe(3);
    expect(screenSecondsCeiling(4, 0.5, 10)).toBe(12);
  });

  it('stays inside the control’s own bounds', () => {
    expect(screenSecondsCeiling(0, 0.25, 600)).toBe(MAX_HOOK_SECONDS);
    expect(screenSecondsCeiling(9.9, 4, 10)).toBe(MIN_HOOK_SECONDS);
    expect(screenSecondsCeiling(0, 1, 0)).toBe(MAX_HOOK_SECONDS);
  });
});

describe('screenSecondsWithin', () => {
  it('keeps the ask when the clip holds it, and clamps when it does not', () => {
    expect(screenSecondsWithin(5, 0, 1, 60)).toBe(5);
    expect(screenSecondsWithin(9, 4, 1, 10)).toBe(6);
    // Half speed: 6 s of footage is 12 s on screen, so 9 s fits.
    expect(screenSecondsWithin(9, 4, 0.5, 10)).toBe(9);
    expect(screenSecondsWithin(9, 4, 2, 10)).toBe(3);
  });
});

describe('retimedScreenSeconds', () => {
  it('keeps the footage and moves the screen time', () => {
    // 6 s on screen as shot is 6 s of footage: 3 s at 2×, 12 s at 0.5×.
    expect(retimedScreenSeconds(6, 1, 2)).toBe(3);
    expect(retimedScreenSeconds(6, 1, 0.5)).toBe(12);
    // And back again.
    expect(retimedScreenSeconds(3, 2, 1)).toBe(6);
  });

  it('never claims more than the control offers', () => {
    expect(retimedScreenSeconds(20, 1, 0.25)).toBe(MAX_HOOK_SECONDS);
  });
});

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

  it('reads the length as SCREEN time, so a speed reaches further into the source', () => {
    expect(hookRange(3, 5, 60, 2)).toEqual({ start: 3, end: 13 });
    expect(hookRange(3, 5, 60, 0.5)).toEqual({ start: 3, end: 5.5 });
    // 10 s of a 10 s clip at 2× is the whole clip: no trim.
    expect(hookRange(0, 5, 10, 2)).toBeNull();
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

  it('carries the slide’s speed into the pipeline, clamped like the Studio’s', () => {
    expect(hookVariant('9:16', 1080, 2).speed).toBe(2);
    expect(hookVariant('9:16', 1080, 0.5).speed).toBe(0.5);
    expect(hookVariant('9:16', 1080, NaN).speed).toBe(1);
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

  it('leaves the speed out of the name — it is composition, not a second cut', () => {
    expect(hookVideoName('Australia', 'day 27', hookVariant('9:16', 1080, 2))).toBe(
      'australia-day-27-hook-9x16-1080p.mp4',
    );
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

  it('counts from the in point, at the speed', () => {
    // 10 s clip, in at 4 s: 6 s of footage — 3 s on screen at 2×, 12 at 0.5×.
    expect(hookSecondsWithin(9, 4, 10, 4, 1)).toBe(6);
    expect(hookSecondsWithin(9, 4, 10, 4, 2)).toBe(3);
    expect(hookSecondsWithin(9, 4, 10, 4, 0.5)).toBe(9);
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
