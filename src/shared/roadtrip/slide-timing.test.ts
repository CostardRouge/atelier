import { describe, expect, it } from 'vitest';
import { MAX_HOOK_SECONDS, MIN_HOOK_SECONDS } from './hook-video';
import type { HookRender } from './hooks/hook-variant';
import {
  AUTO_TAIL_SECONDS,
  FIT_FLOOR_SECONDS,
  autoSeconds,
  fitRefusal,
  fitRender,
  fitScale,
  slideTiming,
} from './slide-timing';

describe('autoSeconds / slideTiming', () => {
  it('follows the opener plus a hold under Auto, and keeps the slide’s own seconds without one', () => {
    expect(autoSeconds(10.4, 5)).toBeCloseTo(10.4 + AUTO_TAIL_SECONDS, 9);
    expect(autoSeconds(0, 5)).toBe(5);
    expect(autoSeconds(100, 5)).toBe(MAX_HOOK_SECONDS);
    // A clip shorter than the opener bounds Auto: the slide stops at the clip.
    expect(autoSeconds(10.4, 5, 3)).toBe(3);
    expect(autoSeconds(10.4, 5, 0.2)).toBe(MIN_HOOK_SECONDS);
  });

  it('keeps a set length as it is, and says what it cuts', () => {
    const set = slideTiming(false, 5, 10.4);
    expect(set).toEqual({ seconds: 5, owner: 'set', openerSeconds: 10.4, overflow: 5.4, held: 0 });
    const auto = slideTiming(true, 5, 10.4);
    expect(auto.owner).toBe('auto');
    expect(auto.seconds).toBeCloseTo(10.9, 9);
    expect(auto.overflow).toBe(0);
    expect(auto.held).toBeCloseTo(AUTO_TAIL_SECONDS, 9);
    // An Auto slide over a clip shorter than its opener is cut by the CLIP, and says so.
    expect(slideTiming(true, 5, 10.4, 3)).toMatchObject({ seconds: 3, overflow: 7.4, held: 0 });
    // Nothing on the slide: a set length cuts nothing, an Auto one keeps its seconds.
    expect(slideTiming(false, 5, 0).overflow).toBe(0);
    expect(slideTiming(true, 4.5, 0).seconds).toBe(4.5);
  });
});

describe('fitScale / fitRefusal', () => {
  it('scales only an opener longer than its slide', () => {
    expect(fitScale(10, 5)).toBe(0.5);
    expect(fitScale(4, 5)).toBe(1);
    expect(fitScale(0, 5)).toBe(1);
  });

  it('refuses a fit that would flash a picture under the floor', () => {
    expect(fitRefusal(1, 0.1)).toBeNull();
    expect(fitRefusal(0.5, 0.9)).toBeNull();
    expect(fitRefusal(0.5, 0.6)).toMatch(new RegExp(String(FIT_FLOOR_SECONDS)));
  });
});

describe('fitRender', () => {
  const render: HookRender = {
    seconds: 10,
    content: (t) => ({ headline: String(t) }),
    paint: (g, t) => {
      (g as unknown as { seen: number[] }).seen.push(t);
    },
    score: () => [{ at: 2, voice: 'tick', gain: 1, rate: 1 }],
    mixWithSource: true,
  };

  it('leaves an opener that fits, or an Auto slide, alone', () => {
    expect(fitRender(render, 12, 0.9).render).toBe(render);
    expect(fitRender(render, undefined, 0.9).render).toBe(render);
  });

  it('scales the clock of every reader alike', () => {
    const fitted = fitRender(render, 5, 0.9);
    expect(fitted.scale).toBe(0.5);
    expect(fitted.refused).toBeNull();
    expect(fitted.render.seconds).toBe(5);
    expect(fitted.render.content!(2)).toEqual({ headline: '4' });
    const g = { seen: [] as number[] };
    fitted.render.paint!(g as never, 1, { width: 1, height: 1 });
    expect(g.seen).toEqual([2]);
    expect(fitted.render.score!()[0].at).toBe(1);
    expect(fitted.render.mixWithSource).toBe(true);
  });

  it('hands the render back untouched, with the reason, when the floor refuses', () => {
    const fitted = fitRender(render, 2, 0.9);
    expect(fitted.render).toBe(render);
    expect(fitted.scale).toBe(1);
    expect(fitted.refused).toMatch(/under the/);
  });
});
