import { describe, expect, it } from 'vitest';
import type { Cue } from './srt-parser';
import {
  AUTO_TIME_SCALE,
  describeTimeScale,
  formatCadence,
  isRealtime,
  measureMediaFps,
  overrideApplies,
  measureTimeScale,
  REALTIME,
  resolveTimeScale,
  slowFactor,
  snapRate,
  timeScaleTag,
  withScale,
} from './time-scale';

const EPOCH = Date.UTC(2026, 4, 30, 5, 49, 34, 609);

/** The DJI timestamp line for an epoch reading, milliseconds included. */
function stamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * A conformed clip: `frames` cues laid on the file's timeline at `mediaFps`,
 * each carrying the wall-clock reading of the moment it was actually shot
 * (`captureFps`). Equal rates = ordinary footage.
 */
function clip(
  frames: number,
  mediaFps: number,
  captureFps: number,
  options: { timestamps?: boolean; diffTime?: boolean; jitterMs?: number } = {},
): Cue[] {
  const { timestamps = true, diffTime = true, jitterMs = 0 } = options;
  const cues: Cue[] = [];
  for (let i = 0; i < frames; i++) {
    // Media timings are quantised to the millisecond, exactly as an SRT is.
    const start = Math.round((i / mediaFps) * 1000) / 1000;
    const captured = EPOCH + (i / captureFps) * 1000;
    const drift = jitterMs ? ((i % 3) - 1) * jitterMs : 0;
    cues.push({
      start,
      end: Math.round(((i + 1) / mediaFps) * 1000) / 1000,
      frame: i + 1,
      timestamp: timestamps ? stamp(Math.round(captured + drift)) : null,
      diffTime: diffTime ? 1 / captureFps : undefined,
      data: {},
    });
  }
  return cues;
}

describe('snapRate', () => {
  it('pulls a jittery measurement onto the rate the camera really shoots', () => {
    expect(snapRate(120.4)).toEqual({ fps: 120, snapped: true });
    expect(snapRate(24.2)).toEqual({ fps: 24, snapped: true });
  });

  it('picks the nearest candidate, not the first — 29.97 and 30 both exist', () => {
    expect(snapRate(30)).toEqual({ fps: 30, snapped: true });
    expect(snapRate(29.972)).toEqual({ fps: 29.97, snapped: true });
    expect(snapRate(59.88)).toEqual({ fps: 59.94, snapped: true });
  });

  it('leaves a rate that is nothing standard alone', () => {
    expect(snapRate(37)).toEqual({ fps: 37, snapped: false });
  });
});

describe('measureMediaFps', () => {
  it('reads the file cadence through millisecond quantisation', () => {
    // 60 fps writes 16/17 ms steps: no single interval is right, the span is.
    expect(measureMediaFps(clip(600, 60, 60))).toBe(60);
    expect(measureMediaFps(clip(300, 30, 120))).toBe(30);
  });

  it('survives a hole, because the library only reads the head and the tail', () => {
    const head = clip(200, 30, 30);
    const tail = clip(200, 30, 30).map((c) => ({ ...c, start: c.start + 900, end: c.end + 900 }));
    expect(measureMediaFps([...head, ...tail])).toBe(30);
  });

  it('says nothing rather than guessing from two cues', () => {
    expect(measureMediaFps(clip(2, 30, 30))).toBeNull();
    expect(measureMediaFps([])).toBeNull();
  });
});

describe('measureTimeScale', () => {
  it('reads ordinary footage as real time', () => {
    const r = measureTimeScale(clip(600, 60, 60));
    expect(r.scale).toBe(1);
    expect(r.basis).toBe('timestamps');
    expect(r.mediaFps).toBe(60);
    expect(isRealtime(r.scale)).toBe(true);
  });

  it('measures a 4× slow-motion conform exactly', () => {
    const r = measureTimeScale(clip(600, 30, 120));
    expect(r.scale).toBeCloseTo(0.25, 6);
    expect(r.mediaFps).toBe(30);
    expect(r.captureFps).toBe(120);
    expect(r.snapped).toBe(true);
    expect(slowFactor(r.scale)).toBeCloseTo(4, 6);
  });

  it('measures a time-lapse the same way, in the other direction', () => {
    // One frame every two real seconds, played back at 30 fps: 60× life.
    const r = measureTimeScale(clip(300, 30, 0.5));
    expect(r.scale).toBeCloseTo(60, 1);
    expect(timeScaleTag(r.scale)).toBe('60× fast');
  });

  it('shrugs off a clock that had not been set on the first cues', () => {
    const cues = clip(600, 30, 120);
    for (let i = 0; i < 5; i++) cues[i].timestamp = stamp(0);
    expect(measureTimeScale(cues).scale).toBeCloseTo(0.25, 2);
  });

  it('falls back to DiffTime when no cue carries a timestamp', () => {
    const r = measureTimeScale(clip(600, 30, 120, { timestamps: false }));
    expect(r.basis).toBe('diff-time');
    expect(r.scale).toBeCloseTo(0.25, 6);
  });

  it('reports nothing measurable rather than a fabricated cadence', () => {
    const blind = clip(600, 30, 120, { timestamps: false, diffTime: false });
    const r = measureTimeScale(blind);
    expect(r.basis).toBe('none');
    expect(r.scale).toBe(1);
    // The file's own cadence is still knowable — only the conform is not.
    expect(r.mediaFps).toBe(30);
    expect(measureTimeScale([])).toEqual(REALTIME);
  });

  it('does not call millisecond jitter a slow motion', () => {
    const r = measureTimeScale(clip(600, 60, 60, { jitterMs: 2 }));
    expect(r.scale).toBe(1);
  });

  it('ignores a clock that runs backwards instead of inverting the clip', () => {
    const cues = clip(600, 60, 60).map((c, i) => ({
      ...c,
      timestamp: stamp(EPOCH - (i / 60) * 1000),
    }));
    expect(measureTimeScale(cues).scale).toBe(1);
  });

  it('is not fooled by a firmware that writes whole seconds', () => {
    // No milliseconds: neighbouring cues read the same second or jump a whole
    // one. A neighbour-ratio estimator would call this ordinary clip a 3× lapse.
    const coarse = clip(1200, 60, 60).map((c) => ({
      ...c,
      timestamp: c.timestamp ? c.timestamp.replace(/\.\d+$/, '') : null,
    }));
    expect(measureTimeScale(coarse).scale).toBe(1);

    const coarseSlow = clip(1200, 30, 120).map((c) => ({
      ...c,
      timestamp: c.timestamp ? c.timestamp.replace(/\.\d+$/, '') : null,
    }));
    expect(measureTimeScale(coarseSlow).scale).toBeCloseTo(0.25, 2);
  });

  it('refuses rather than guesses when the clock is too coarse for the clip', () => {
    // Whole-second timestamps over five seconds cannot resolve a cadence: the
    // rounding is a fifth of everything it has to divide. Measured against
    // synthetic clips, an estimate here lands 5-20 % out — so there is none.
    const short = clip(150, 30, 30, { diffTime: false }).map((c) => ({
      ...c,
      timestamp: c.timestamp ? c.timestamp.replace(/\.\d+$/, '') : null,
    }));
    const r = measureTimeScale(short);
    expect(r.basis).toBe('none');
    expect(r.scale).toBe(1);

    // With DiffTime in the file, the same clip is answerable after all.
    const withDiff = clip(150, 30, 120).map((c) => ({
      ...c,
      timestamp: c.timestamp ? c.timestamp.replace(/\.\d+$/, '') : null,
    }));
    const d = measureTimeScale(withDiff);
    expect(d.basis).toBe('diff-time');
    expect(d.scale).toBeCloseTo(0.25, 6);
  });

  it('says nothing about a file that is subtitles, not a flight log', () => {
    // SDH captions carry square brackets, so the parser's format sniff accepts
    // them; their cue spacing read as a frame interval would announce a film as
    // "0.40 fps" in the library.
    const captions: Cue[] = [
      [1, 3.5],
      [4, 6.2],
      [6.5, 9],
      [9.4, 12],
      [12.5, 15],
      [16, 18],
    ].map(([start, end]) => ({ start, end, frame: null, timestamp: null, data: {} }));
    const r = measureTimeScale(captions);
    expect(r).toEqual(REALTIME);
    expect(r.mediaFps).toBeNull();
  });

  it('refuses a clock that stalled across most of the clip', () => {
    // Not quantisation — a genuine freeze: one reading held for 70 % of the
    // clip. The zero-slope pairs would otherwise carry the median.
    const cues = clip(600, 30, 30, { diffTime: false });
    const held = cues[120].timestamp;
    for (let i = 120; i < 540; i++) cues[i].timestamp = held;
    expect(measureTimeScale(cues).basis).toBe('none');
  });

  it('measures from a head-and-tail sample as well as from the whole log', () => {
    const whole = clip(3600, 30, 120);
    const sampled = [...whole.slice(0, 400), ...whole.slice(-400)];
    expect(measureTimeScale(sampled).scale).toBeCloseTo(
      measureTimeScale(whole).scale,
      6,
    );
  });
});

describe('presentation', () => {
  it('says nothing at all about ordinary footage', () => {
    expect(timeScaleTag(1)).toBeNull();
    expect(describeTimeScale(1)).toBeNull();
    expect(describeTimeScale(1.005)).toBeNull();
  });

  it('never renders a factor it has just called abnormal as "1×"', () => {
    // 1.03 is past isRealtime's tolerance, so it must not round to "1× time-lapse".
    expect(describeTimeScale(1.03)).toBe('1.03× time-lapse');
    expect(timeScaleTag(0.97)).toBe('1.03× slow');
  });

  it('names the two directions the way a shooter thinks of them', () => {
    expect(describeTimeScale(0.25)).toBe('4× slow motion');
    expect(describeTimeScale(0.4)).toBe('2.5× slow motion');
    expect(describeTimeScale(10)).toBe('10× time-lapse');
    expect(timeScaleTag(0.25)).toBe('4× slow');
  });

  it('spells the cadence as capture → playback only when they differ', () => {
    expect(formatCadence(measureTimeScale(clip(600, 30, 120)))).toBe('120 → 30 fps');
    expect(formatCadence(measureTimeScale(clip(600, 60, 60)))).toBe('60 fps');
    expect(formatCadence(REALTIME)).toBeNull();
  });
});

describe('the project setting', () => {
  const measured = { ...REALTIME, scale: 0.25, mediaFps: 30, captureFps: 120 };

  it('follows the measurement on auto, and the author on manual', () => {
    expect(resolveTimeScale(AUTO_TIME_SCALE, measured)).toBe(0.25);
    expect(resolveTimeScale({ mode: 'manual', scale: 0.5 }, measured)).toBe(0.5);
    expect(resolveTimeScale(undefined, measured)).toBe(0.25);
  });

  it('ignores a manual figure that is not a positive number', () => {
    expect(resolveTimeScale({ mode: 'manual', scale: 0 }, measured)).toBe(0.25);
    expect(resolveTimeScale({ mode: 'manual', scale: NaN }, measured)).toBe(0.25);
  });

  it('applies an override only to the clip it was set for', () => {
    const forB = { mode: 'manual' as const, scale: 0.25, clipId: 'dji_0002' };
    expect(resolveTimeScale(forB, { ...REALTIME }, 'dji_0002')).toBe(0.25);
    // Stepping to another clip must not inherit a cadence measured elsewhere.
    expect(resolveTimeScale(forB, { ...REALTIME, scale: 1 }, 'dji_0001')).toBe(1);
    expect(overrideApplies(forB, 'dji_0001')).toBe(false);
    expect(overrideApplies(forB, 'dji_0002')).toBe(true);
    // No clip recorded: an old document meant "whatever is open".
    expect(overrideApplies({ mode: 'manual', scale: 0.5 }, 'anything')).toBe(true);
    expect(overrideApplies(AUTO_TIME_SCALE, 'anything')).toBe(false);
  });

  it('re-implies the capture rate from an override instead of contradicting it', () => {
    const shown = withScale(measured, 0.5);
    expect(shown.captureFps).toBe(60);
    expect(formatCadence(shown)).toBe('60 → 30 fps');
    expect(withScale(measured, 0.25)).toBe(measured);
  });
});
