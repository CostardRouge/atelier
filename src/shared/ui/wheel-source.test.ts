import { describe, expect, it } from 'vitest';
import { STREAM_MS, WheelSource, wheelHandOf } from './wheel-source';

describe('wheelHandOf', () => {
  it('reads a delta in lines as a notched wheel', () => {
    expect(wheelHandOf({ deltaX: 0, deltaY: 3, deltaMode: 1, t: 0 })).toBe('mouse');
  });

  it('reads a sideways component as a trackpad', () => {
    expect(wheelHandOf({ deltaX: 2, deltaY: 6, wheelDeltaY: -120, t: 0 })).toBe('trackpad');
  });

  it('reads a legacy delta in multiples of 120 as a notch', () => {
    expect(wheelHandOf({ deltaX: 0, deltaY: 100, wheelDeltaY: -120, t: 0 })).toBe('mouse');
    expect(wheelHandOf({ deltaX: 0, deltaY: -200, wheelDeltaY: 240, t: 0 })).toBe('mouse');
  });

  it('reads a small legacy delta as a glide', () => {
    expect(wheelHandOf({ deltaX: 0, deltaY: 4, wheelDeltaY: -12, t: 0 })).toBe('trackpad');
  });

  it('falls back on the step size with no legacy delta', () => {
    expect(wheelHandOf({ deltaX: 0, deltaY: 6, t: 0 })).toBe('trackpad');
    expect(wheelHandOf({ deltaX: 0, deltaY: 100, t: 0 })).toBe('mouse');
  });
});

describe('WheelSource', () => {
  it('keeps a glide a glide when one event looks like a notch', () => {
    const s = new WheelSource();
    expect(s.read({ deltaX: 0, deltaY: 8, wheelDeltaY: -24, t: 0 })).toBe('trackpad');
    expect(s.read({ deltaX: 0, deltaY: 40, wheelDeltaY: -120, t: 16 })).toBe('trackpad');
  });

  it('lets a notch after the glide has ended zoom again', () => {
    const s = new WheelSource();
    s.read({ deltaX: 0, deltaY: 8, wheelDeltaY: -24, t: 0 });
    expect(s.read({ deltaX: 0, deltaY: 100, wheelDeltaY: -120, t: STREAM_MS + 1 })).toBe('mouse');
  });
});
