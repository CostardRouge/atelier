import { describe, expect, it } from 'vitest';
import { MODE_FAMILIES, MODE_WORDS, PREVIEW_AIM, PREVIEW_PERIOD, previewFrame } from './mode-catalog';
import { RECIPES } from './motion';

describe('the mode drawer’s catalogue', () => {
  it('holds every recipe once, in three families', () => {
    const listed = MODE_FAMILIES.flatMap((f) => f.modes);
    expect([...listed].sort()).toEqual([...RECIPES].sort());
    expect(new Set(listed).size).toBe(listed.length);
    expect(MODE_FAMILIES.map((f) => f.label)).toEqual(['Travel', 'Transform', 'Watch']);
    for (const r of RECIPES) expect(MODE_WORDS[r].label).toBeTruthy();
  });
});

describe('a preview’s frames', () => {
  it('a dive goes from the whole mosaic to the aimed cell, then the next mosaic crosses in', () => {
    const start = previewFrame('mosaics', 0);
    expect(start).toMatchObject({ s: 1, cx: 0.5, cy: 0.5, next: 0, base: 0 });
    const deep = previewFrame('mosaics', PREVIEW_PERIOD * 0.79);
    expect(deep.s).toBeGreaterThan(10);
    expect(deep.cx).toBeCloseTo(PREVIEW_AIM.x);
    expect(previewFrame('mosaics', PREVIEW_PERIOD * 0.95).next).toBeGreaterThan(0.5);
    // The loop after lands on the other mosaic.
    expect(previewFrame('mosaics', PREVIEW_PERIOD * 1.01).base).toBe(1);
  });

  it('a pull back starts on the photo, deep in, and ends on the whole mosaic', () => {
    expect(previewFrame('dezoom', 0.05)).toMatchObject({ photo: 1 });
    expect(previewFrame('dezoom', 0.05).s).toBeGreaterThan(10);
    expect(previewFrame('dezoom', PREVIEW_PERIOD * 0.9)).toMatchObject({ s: 1, photo: 0 });
  });

  it('a reveal flips, a wave spreads, a slideshow cuts, a steer clicks first; every frame is bounded', () => {
    expect(previewFrame('reveal', PREVIEW_PERIOD * 0.5).flipped).toBeCloseTo(0.5 / 0.75);
    expect(previewFrame('wave', PREVIEW_PERIOD * 0.85 + 0.01).wave).toBe(1);
    expect(previewFrame('slideshow', 0).base).not.toBe(previewFrame('slideshow', PREVIEW_PERIOD / 2 + 0.01).base);
    expect(previewFrame('steer', PREVIEW_PERIOD * 0.1).ring).toBeGreaterThan(0);
    for (let t = 0; t < 10; t += 0.37) {
      for (const f of [previewFrame('chain', t), previewFrame('drift', t), previewFrame('wave', t)]) {
        for (const v of [f.next, f.photo, f.flipped, f.wave, f.ring]) expect(v >= 0 && v <= 1).toBe(true);
        expect(f.s).toBeGreaterThanOrEqual(1);
      }
    }
    expect(previewFrame('drift', -3)).toEqual(previewFrame('drift', 0));
  });
});
