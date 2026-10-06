import { describe, expect, it } from 'vitest';
import { bandFragment } from './band-plan';
import { DITHER_LSB, ditherFragment, ditherNoise, readDitherPreference, wantsDither } from './dither';

const PASS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
void main() {
  vec4 c = texture(u_src, v_uv);
  if (c.a < 0.0) { outColor = c; return; }
  outColor = vec4(c.rgb * 0.5, c.a);
}`;

/** What the canvas does with a value: round to the nearest code, clamped. */
const toByte = (codes: number) => Math.min(255, Math.max(0, Math.round(codes)));

describe('wantsDither', () => {
  it('leaves one pass over an 8-bit source to the old renderer, pixel for pixel', () => {
    expect(wantsDither({ precision: 'float16', halfSource: false, passes: 1 })).toBe(false);
  });

  it('dithers a chain that ran in float16, and any RAW', () => {
    expect(wantsDither({ precision: 'float16', halfSource: false, passes: 2 })).toBe(true);
    expect(wantsDither({ precision: 'float16', halfSource: true, passes: 1 })).toBe(true);
    // A RAW's half-floats reach the last pass even when the targets are bytes.
    expect(wantsDither({ precision: 'byte', halfSource: true, passes: 1 })).toBe(true);
  });

  it('does not pretend a chain of 8-bit targets carried more than 8 bits', () => {
    expect(wantsDither({ precision: 'byte', halfSource: false, passes: 3 })).toBe(false);
  });
});

describe('ditherFragment', () => {
  it('renames main and wraps it, so an early return still reaches the noise', () => {
    const out = ditherFragment(PASS)!;
    expect(out).toContain('void _undithered()');
    expect(out.match(/\bvoid\s+main\s*\(\)/g)).toHaveLength(1);
    expect(out.indexOf('void _undithered()')).toBeLessThan(out.indexOf('void main()'));
    expect(out).toContain('uniform float u_dither;');
  });

  it('composes with the band rewrite, whichever runs first', () => {
    const banded = bandFragment(PASS)!;
    const out = ditherFragment(banded)!;
    expect(out).toContain('_bandUv(');
    expect(out).toContain('_undithered();');
  });

  it('refuses a shader it cannot read, rather than guessing', () => {
    expect(ditherFragment(PASS.replace('void main()', 'void other()'))).toBeNull();
    expect(ditherFragment(`${PASS}\nvoid main() {}`)).toBeNull();
    expect(ditherFragment(PASS.replace(/outColor/g, 'fragColor'))).toBeNull();
  });
});

describe('ditherNoise', () => {
  it('stays inside [-0.5, 0.5) and averages to nothing', () => {
    let sum = 0;
    let n = 0;
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const v = ditherNoise(x, y);
        expect(v).toBeGreaterThanOrEqual(-0.5);
        expect(v).toBeLessThan(0.5);
        sum += v;
        n += 1;
      }
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.01);
  });

  it('is a function of the pixel alone, one value per 2 × 2 block', () => {
    expect(ditherNoise(4000, 3000)).toBe(ditherNoise(4000, 3000));
    expect(ditherNoise(10, 10)).toBe(ditherNoise(11, 11));
    expect(ditherNoise(10, 10)).not.toBe(ditherNoise(12, 10));
    expect(ditherNoise(10, 10)).not.toBe(ditherNoise(10, 12));
  });

  it('brings an exact code home, even after a float16 target moved it', () => {
    // A code held in a half-float target is off by at most 1/16 of a code at
    // the top of the range: the noise's margin is for exactly that.
    for (let x = 0; x < 256; x += 1) {
      for (const drift of [-1 / 16, 0, 1 / 16]) {
        const code = x;
        const dithered = code + drift + 2 * DITHER_LSB * ditherNoise(x, 7);
        expect(toByte(dithered)).toBe(code);
      }
    }
  });

  it('takes the steps out of a gentle gradient', () => {
    // 1024 columns climbing 8 codes, 256 rows: undithered, every column holds
    // the code it rounds to and the error against the ramp reaches half a
    // code; dithered, a column's average follows the ramp.
    const width = 1024;
    const rows = 256;
    let plainWorst = 0;
    let ditheredWorst = 0;
    for (let x = 0; x < width; x += 1) {
      const ideal = 100 + (8 * x) / width;
      let plain = 0;
      let dithered = 0;
      for (let y = 0; y < rows; y += 1) {
        plain += toByte(ideal);
        dithered += toByte(ideal + 2 * DITHER_LSB * ditherNoise(x, y));
      }
      plainWorst = Math.max(plainWorst, Math.abs(plain / rows - ideal));
      ditheredWorst = Math.max(ditheredWorst, Math.abs(dithered / rows - ideal));
    }
    expect(plainWorst).toBeGreaterThan(0.45);
    // Only a fraction within 1/16 of a code is never moved (`DITHER_LSB`).
    expect(ditheredWorst).toBeLessThan(0.2);
  });
});

describe('readDitherPreference', () => {
  it('reads off as off and anything else as the rule as built', () => {
    expect(readDitherPreference('off')).toBe('off');
    expect(readDitherPreference('auto')).toBe('auto');
    expect(readDitherPreference(null)).toBe('auto');
    expect(readDitherPreference('always')).toBe('auto');
  });
});
