import { describe, expect, it } from 'vitest';
import { createIntroScene, resolveScenes, resolveWindow, type Scene } from './scenes';
import { createTextElement, type OverlayElement } from './overlay-types';

function scene(over: Partial<Scene> = {}): Scene {
  return { ...createIntroScene(4), ...over };
}

function el(over: Partial<OverlayElement> = {}): OverlayElement {
  return { ...createTextElement('Hook'), ...over };
}

describe('resolveWindow', () => {
  it('leaves an element outside a scene on its own window', () => {
    expect(resolveWindow(el({ window: { start: 2, end: 6 } }), null)).toEqual({
      start: 2,
      end: 6,
    });
    expect(resolveWindow(el(), null)).toBeNull();
  });

  it("gives an element with no window of its own the scene's whole span", () => {
    expect(resolveWindow(el({ sceneId: 'intro' }), scene({ start: 1, end: 4 }))).toEqual({
      start: 1,
      end: 4,
    });
  });

  it('reads an element window inside a scene as an offset into it', () => {
    const s = scene({ start: 2, end: 8 });
    expect(resolveWindow(el({ window: { start: 1, end: 3 } }), s)).toEqual({
      start: 3,
      end: 5,
    });
  });

  it('never lets an element outlive its scene', () => {
    const s = scene({ start: 0, end: 3 });
    expect(resolveWindow(el({ window: { start: 1, end: 99 } }), s)).toEqual({
      start: 1,
      end: 3,
    });
  });

  it('moves the whole stagger when the scene moves', () => {
    const staggered = el({ window: { start: 0.5, end: 2 } });
    const a = resolveWindow(staggered, scene({ start: 0, end: 4 }));
    const b = resolveWindow(staggered, scene({ start: 1, end: 5 }));
    expect(b!.start - a!.start).toBeCloseTo(1);
    expect(b!.end! - a!.end!).toBeCloseTo(1);
  });
});

describe('resolveScenes', () => {
  it('contributes nothing without scenes', () => {
    expect(resolveScenes(undefined, 3)).toEqual({ scrim: null, outsideAlpha: 1 });
    expect(resolveScenes([], 3)).toEqual({ scrim: null, outsideAlpha: 1 });
  });

  it('fades the scrim in and out around the scene', () => {
    const s = scene({
      start: 0,
      end: 4,
      scrim: { color: '#000', opacity: 0.8, fade: 1 },
    });
    expect(resolveScenes([s], 0).scrim).toBeNull(); // nothing yet at the very start
    expect(resolveScenes([s], 0.5).scrim!.opacity).toBeCloseTo(0.4);
    expect(resolveScenes([s], 2).scrim!.opacity).toBeCloseTo(0.8);
    expect(resolveScenes([s], 3.5).scrim!.opacity).toBeCloseTo(0.4);
    expect(resolveScenes([s], 4.5).scrim).toBeNull();
  });

  it('never lets the scrim fade longer than half the scene', () => {
    const s = scene({
      start: 0,
      end: 1,
      scrim: { color: '#000', opacity: 1, fade: 10 },
    });
    expect(resolveScenes([s], 0.5).scrim!.opacity).toBeCloseTo(1);
  });

  it('holds the HUD back while a solo scene runs, then fades it in', () => {
    const s = scene({ start: 1, end: 4, solo: true, hudFade: 1 });
    expect(resolveScenes([s], 0).outsideAlpha).toBeCloseTo(1);
    expect(resolveScenes([s], 0.5).outsideAlpha).toBeCloseTo(0.5);
    expect(resolveScenes([s], 2).outsideAlpha).toBe(0);
    expect(resolveScenes([s], 4.5).outsideAlpha).toBeCloseTo(0.5);
    expect(resolveScenes([s], 6).outsideAlpha).toBeCloseTo(1);
  });

  it('cuts the HUD back in with a zero fade', () => {
    const s = scene({ start: 0, end: 2, solo: true, hudFade: 0 });
    expect(resolveScenes([s], 1).outsideAlpha).toBe(0);
    expect(resolveScenes([s], 2).outsideAlpha).toBe(1);
  });

  it('leaves the HUD alone when solo is off', () => {
    expect(resolveScenes([scene({ solo: false })], 1).outsideAlpha).toBe(1);
  });

  it('ignores an empty scene', () => {
    const s = scene({ start: 2, end: 2, solo: true });
    expect(resolveScenes([s], 2).outsideAlpha).toBe(1);
  });

  it('takes the strongest scrim and the dimmest HUD when scenes overlap', () => {
    const a = scene({ id: 'a', start: 0, end: 4, scrim: { color: '#000', opacity: 0.3, fade: 0 } });
    const b = scene({ id: 'b', start: 1, end: 3, scrim: { color: '#fff', opacity: 0.9, fade: 0 }, solo: true });
    const out = resolveScenes([a, b], 2);
    expect(out.scrim).toEqual({ color: '#fff', opacity: 0.9 });
    expect(out.outsideAlpha).toBe(0);
  });
});
