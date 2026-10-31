import { describe, expect, it } from 'vitest';
import { clipWindow, scheduleClips, type SoundClip } from './sound-clip';

describe('clipWindow', () => {
  it('plays a clip from its start, for its length, where it is placed', () => {
    expect(clipWindow({ at: 1 }, 3, 10)).toEqual({ when: 1, offset: 0, duration: 3 });
  });

  it('cuts a clip at the end of the bed', () => {
    expect(clipWindow({ at: 8 }, 5, 10)).toEqual({ when: 8, offset: 0, duration: 2 });
  });

  it('starts reading inside the file when asked', () => {
    expect(clipWindow({ at: 0, from: 1.5 }, 4, 10)).toEqual({ when: 0, offset: 1.5, duration: 2.5 });
  });

  it('moves a clip early by the lead, and cuts its head when that would go below zero', () => {
    const lead = 0.044;
    expect(clipWindow({ at: 2 }, 1, 10, lead)?.when).toBeCloseTo(2 - lead);
    const atZero = clipWindow({ at: 0 }, 1, 10, lead)!;
    expect(atZero.when).toBe(0);
    expect(atZero.offset).toBeCloseTo(lead);
    expect(atZero.duration).toBeCloseTo(1 - lead);
  });

  it('answers null for what cannot be heard', () => {
    expect(clipWindow({ at: 12 }, 3, 10)).toBeNull();
    expect(clipWindow({ at: 0, from: 5 }, 3, 10)).toBeNull();
    expect(clipWindow({ at: Number.NaN }, 3, 10)).toBeNull();
    expect(clipWindow({ at: 0 }, 0, 10)).toBeNull();
    expect(clipWindow({ at: 0 }, 3, 0)).toBeNull();
  });
});

describe('scheduleClips', () => {
  function context() {
    const starts: [number, number, number][] = [];
    const ramps: [string, number, number][] = [];
    const param = {
      setValueAtTime: (v: number, t: number) => ramps.push(['set', v, t]),
      linearRampToValueAtTime: (v: number, t: number) => ramps.push(['ramp', v, t]),
    };
    const ctx = {
      createBufferSource: () => ({
        buffer: null,
        connect: () => undefined,
        start: (when: number, offset: number, duration: number) => starts.push([when, offset, duration]),
      }),
      createGain: () => ({ gain: param, connect: () => undefined }),
    };
    return { ctx: ctx as unknown as BaseAudioContext, starts, ramps };
  }
  const buffer = (duration: number) => ({ duration }) as AudioBuffer;

  it('starts each audible clip at its window, and skips the rest', () => {
    const { ctx, starts } = context();
    const clips: SoundClip[] = [
      { buffer: buffer(2), at: 1 },
      { buffer: buffer(2), at: 30 },
    ];
    expect(scheduleClips(ctx, {} as AudioNode, clips, 10)).toBe(1);
    expect(starts).toEqual([[1, 0, 2]]);
  });

  it('ramps a fade in and a fade out at the gain asked', () => {
    const { ctx, ramps } = context();
    scheduleClips(ctx, {} as AudioNode, [{ buffer: buffer(4), at: 0, gain: 0.5, fadeIn: 1, fadeOut: 1 }], 10);
    expect(ramps).toEqual([
      ['set', 0, 0],
      ['ramp', 0.5, 1],
      ['set', 0.5, 3],
      ['ramp', 0, 4],
    ]);
  });
});
