import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILM_TEXTURE,
  FADE_CELL_PX,
  MIN_CELL_PX,
  NOISE_SIZE,
  TEXTURE_RANGES,
  describeFilmTexture,
  filmTextureKey,
  grainCellPixels,
  grainShowable,
  grainUniforms,
  halationBuffer,
  isSilentTexture,
  normaliseFilmTexture,
  type FilmTexture,
} from './film-texture';

const texture = (over: Partial<FilmTexture> = {}): FilmTexture => ({
  ...DEFAULT_FILM_TEXTURE,
  grain: 0.3,
  halation: 0.25,
  ...over,
});

describe('the record', () => {
  it('is silent when neither grain nor halation is asked for', () => {
    expect(isSilentTexture(null)).toBe(true);
    expect(isSilentTexture(DEFAULT_FILM_TEXTURE)).toBe(true);
    expect(isSilentTexture(texture({ halation: 0 }))).toBe(false);
    expect(isSilentTexture(texture({ grain: 0 }))).toBe(false);
  });

  it('reads defensively: clamps every number, keeps a sound tint, rounds the seed', () => {
    const t = normaliseFilmTexture({
      grain: 4,
      grainSize: -1,
      grainChroma: 'lots',
      grainFps: 1e9,
      halation: NaN,
      halationRadius: 0.5,
      halationTint: [2, 0.5, 'x'],
      seed: 12.7,
    });
    expect(t.grain).toBe(1);
    expect(t.grainSize).toBe(TEXTURE_RANGES.grainSize.min);
    expect(t.grainChroma).toBe(DEFAULT_FILM_TEXTURE.grainChroma);
    expect(t.grainFps).toBe(TEXTURE_RANGES.grainFps.max);
    expect(t.halation).toBe(0);
    expect(t.halationRadius).toBe(TEXTURE_RANGES.halationRadius.max);
    expect(t.halationTint).toEqual([1, 0.5, DEFAULT_FILM_TEXTURE.halationTint[2]]);
    expect(t.seed).toBe(13);
    expect(normaliseFilmTexture(null)).toEqual(DEFAULT_FILM_TEXTURE);
    expect(normaliseFilmTexture(texture())).toEqual(texture());
  });

  it('keys change with every field and answer for none', () => {
    const base = texture();
    const key = filmTextureKey(base);
    for (const k of Object.keys(TEXTURE_RANGES) as (keyof typeof TEXTURE_RANGES)[]) {
      const changed = { ...base, [k]: base[k] + TEXTURE_RANGES[k].step };
      expect(filmTextureKey(changed)).not.toBe(key);
    }
    expect(filmTextureKey({ ...base, seed: base.seed + 1 })).not.toBe(key);
    expect(filmTextureKey({ ...base, halationTint: [0, 0, 0] })).not.toBe(key);
    expect(filmTextureKey(null)).toBe('-');
  });

  it('describes what it draws', () => {
    expect(describeFilmTexture(null)).toBe('No texture');
    expect(describeFilmTexture(texture())).toBe('grain 30 % · halation 25 %');
    expect(describeFilmTexture(texture({ halation: 0 }))).toBe('grain 30 %');
  });
});

describe('grain is the same fraction of the picture at every size', () => {
  it('a cell scales with the render height, exactly', () => {
    const t = texture({ grainSize: 0.002 });
    expect(grainCellPixels(t, 1000) / grainCellPixels(t, 250)).toBe(4);
    expect(grainCellPixels(t, 2494)).toBeCloseTo(4.988, 6);
  });

  it('the noise UV puts 1 / grainSize cells down the frame whatever the render size', () => {
    const t = texture({ grainSize: 0.002 });
    for (const [w, h] of [
      [640, 480],
      [3326, 2494],
      [8064, 6048],
    ]) {
      const u = grainUniforms(t, w, h);
      // Texels down the height = scale · NOISE_SIZE = 1 / grainSize cells.
      expect(u.scale * NOISE_SIZE).toBeCloseTo(1 / 0.002, 9);
      expect(u.aspect).toEqual([w / h, 1]);
      expect(u.amount).toBe(0.3);
    }
  });

  it('fades out where a cell cannot be resolved, and says so', () => {
    const fine = texture({ grainSize: 0.0005 });
    expect(grainUniforms(fine, 1000, 500).fade).toBe(0); // 0.25 px per cell
    expect(grainUniforms(fine, 16000, 8000).fade).toBe(1); // 4 px per cell
    const mid = grainUniforms(fine, 8000, (MIN_CELL_PX + FADE_CELL_PX) / 2 / 0.0005).fade;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(grainShowable(fine, 500)).toEqual({ showable: false, cellPixels: 0.25 });
    expect(grainShowable(fine, 8000).showable).toBe(true);
  });
});

describe('halation is resolution-independent by construction', () => {
  it('the buffer height depends on the radius alone, and sigma / height IS the radius', () => {
    for (const radius of [0.005, 0.01, 0.02, 0.05, 0.1, 0.2]) {
      const t = texture({ halationRadius: radius });
      const small = halationBuffer(t, 640, 480)!;
      const large = halationBuffer(t, 8064, 6048)!;
      expect(small.h).toBe(large.h);
      expect(small.sigma).toBe(large.sigma);
      expect(small.sigma / small.h).toBeCloseTo(radius, 12);
      // Only the aspect reaches the width.
      expect(halationBuffer(t, 1000, 500)!.w).toBe(halationBuffer(t, 1000, 500)!.h * 2);
    }
  });

  it('clamps the buffer to its bounds at the ends of the radius range', () => {
    expect(halationBuffer(texture({ halationRadius: 0.005 }), 100, 100)!.h).toBe(512);
    expect(halationBuffer(texture({ halationRadius: 0.2 }), 100, 100)!.h).toBe(64);
    // Sigma stays a few texels wide — enough for a 13-tap kernel, never a single texel.
    expect(halationBuffer(texture({ halationRadius: 0.2 }), 100, 100)!.sigma).toBeGreaterThan(2);
    expect(halationBuffer(texture({ halationRadius: 0.005 }), 100, 100)!.sigma).toBeLessThan(6);
  });

  it('is nothing when there is no halation to draw', () => {
    expect(halationBuffer(texture({ halation: 0 }), 100, 100)).toBeNull();
  });
});
