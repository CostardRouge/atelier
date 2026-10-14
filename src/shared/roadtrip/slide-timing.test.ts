import { describe, expect, it } from 'vitest';
import type { HookRender } from './hooks/hook-variant';
import { scaleRender } from './slide-timing';

describe('scaleRender', () => {
  const render: HookRender = {
    seconds: 10,
    shortestBeat: 0.9,
    content: (t) => ({ headline: String(t) }),
    paint: (g, t) => {
      (g as unknown as { seen: number[] }).seen.push(t);
    },
    score: () => [{ at: 2, voice: 'tick', gain: 1, rate: 1 }],
    badgeWindow: { start: 4, end: null },
    mixWithSource: true,
  };

  it('leaves an opener at its own pace alone', () => {
    expect(scaleRender(render, 1)).toBe(render);
    expect(scaleRender(render, 1.4)).toBe(render);
    expect(scaleRender(render, 0)).toBe(render);
  });

  it('runs every reader on one faster clock', () => {
    const fast = scaleRender(render, 0.5);
    expect(fast.seconds).toBe(5);
    expect(fast.shortestBeat).toBe(0.45);
    expect(fast.content!(2)).toEqual({ headline: '4' });
    const g = { seen: [] as number[] };
    fast.paint!(g as never, 1, { width: 1, height: 1 });
    expect(g.seen).toEqual([2]);
    expect(fast.score!()[0].at).toBe(1);
    expect(fast.badgeWindow).toEqual({ start: 2, end: null });
    expect(fast.mixWithSource).toBe(true);
  });
});
