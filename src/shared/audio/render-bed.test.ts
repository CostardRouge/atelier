import { describe, expect, it } from 'vitest';
import { eventsWithin, scheduleScore } from './render-bed';
import { isVoice, scheduleVoice, VOICE_NAMES } from './voices';

/**
 * A stand-in context that records every source started and when. Web Audio is
 * not in node; what the voices DO with a context is the part worth pinning —
 * that they touch only the context and destination they are handed, and start
 * at the time they are told.
 */
function recordingContext() {
  const starts: number[] = [];
  const connectedTo: unknown[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
  });
  const node = () => ({
    connect: (target: unknown) => {
      connectedTo.push(target);
    },
    disconnect: () => undefined,
  });
  const ctx = {
    sampleRate: 48000,
    createOscillator: () => ({
      ...node(),
      type: 'sine',
      frequency: param(),
      start: (t: number) => starts.push(t),
      stop: () => undefined,
      onended: null,
    }),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: 'bandpass', frequency: param(), Q: param() }),
    createBuffer: (_c: number, frames: number) => ({
      getChannelData: () => new Float32Array(frames),
    }),
    createBufferSource: () => ({
      ...node(),
      buffer: null,
      start: (t: number) => starts.push(t),
      onended: null,
    }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, starts, connectedTo };
}

describe('voices', () => {
  it('knows every voice it names, and nothing else', () => {
    for (const name of VOICE_NAMES) expect(isVoice(name)).toBe(true);
    expect(isVoice('kazoo')).toBe(false);
  });

  it('starts every part of a voice at the time it is given', () => {
    const { ctx, starts } = recordingContext();
    const destination = {} as AudioNode;
    scheduleVoice(ctx, destination, 1.25, 'seat');
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.every((t) => t >= 1.25 && t < 1.3)).toBe(true);
  });

  it('plays an unknown voice as a click rather than as nothing', () => {
    const { ctx, starts } = recordingContext();
    scheduleVoice(ctx, {} as AudioNode, 0.5, 'from-a-newer-build');
    expect(starts.length).toBeGreaterThan(0);
  });

  it('never schedules before zero', () => {
    const { ctx, starts } = recordingContext();
    scheduleVoice(ctx, {} as AudioNode, -3, 'tick');
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(0);
  });
});

describe('eventsWithin', () => {
  it('keeps what the bed can play, in time order', () => {
    const out = eventsWithin(
      [
        { at: 1.2, voice: 'seat' },
        { at: -0.1, voice: 'tick' },
        { at: 0.3, voice: 'detent' },
        { at: 4, voice: 'tick' },
        { at: Number.NaN, voice: 'tick' },
      ],
      2,
    );
    expect(out.map((e) => e.at)).toEqual([0.3, 1.2]);
  });
});

describe('scheduleScore', () => {
  const score = [
    { at: 0.1, voice: 'detent' },
    { at: 0.6, voice: 'leg' },
    { at: 1.9, voice: 'seat' },
  ];

  it('schedules each event at the context time plus its offset into the score', () => {
    const { ctx, starts } = recordingContext();
    expect(scheduleScore(ctx, {} as AudioNode, score, 10)).toBe(3);
    expect(Math.min(...starts)).toBeCloseTo(10.1, 6);
    expect(Math.max(...starts)).toBeGreaterThanOrEqual(11.9);
  });

  it('resumes mid-score: what already played is skipped, the rest keeps its spacing', () => {
    const { ctx, starts } = recordingContext();
    expect(scheduleScore(ctx, {} as AudioNode, score, 5, 0.5)).toBe(2);
    expect(Math.min(...starts)).toBeCloseTo(5.1, 6);
  });
});
