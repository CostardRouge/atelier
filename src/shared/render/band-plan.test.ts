import { describe, expect, it } from 'vitest';
import { BAND_PAD, nearRows, OWN_ROWS, planBands, warpRows } from './band-plan';

const frame = { width: 400, height: 1000 };

describe('planBands', () => {
  it('cuts the output into bands and walks each back through the passes', () => {
    // source → colour → blur of 10 rows → colour → canvas
    const plan = planBands(frame, 250, [OWN_ROWS, OWN_ROWS, nearRows(10), OWN_ROWS])!;
    expect(plan.bands.map((b) => b.out)).toEqual([
      { y0: 0, y1: 250 },
      { y0: 250, y1: 500 },
      { y0: 500, y1: 750 },
      { y0: 750, y1: 1000 },
    ]);
    const second = plan.bands[1];
    // The last colour pass reads its own rows (padded); the blur needs 10 more.
    expect(second.regions[3]).toEqual({ y0: 250, y1: 500 });
    expect(second.regions[2]).toEqual({ y0: 250 - BAND_PAD, y1: 500 + BAND_PAD });
    expect(second.regions[1]).toEqual({ y0: 250 - 2 * BAND_PAD - 10, y1: 500 + 2 * BAND_PAD + 10 });
    // Clamped to the frame at its edges.
    expect(plan.bands[0].regions[1].y0).toBe(0);
    expect(plan.bands[3].regions[1].y1).toBe(1000);
    expect(plan.targetRows).toBe(250 + 6 * BAND_PAD + 20);
  });

  it('refuses where a pass after the first cannot say what it reads', () => {
    expect(planBands(frame, 250, [OWN_ROWS, null, OWN_ROWS])).toBeNull();
    expect(planBands(frame, 250, [OWN_ROWS, () => null])).toBeNull();
  });

  it('asks nothing of the FIRST pass: it reads the source, which stays whole', () => {
    expect(planBands(frame, 250, [null, OWN_ROWS])).not.toBeNull();
  });

  it('refuses where it would buy nothing', () => {
    expect(planBands(frame, 1000, [OWN_ROWS, OWN_ROWS])).toBeNull();
    expect(planBands(frame, 250, [OWN_ROWS, nearRows(2000)])).toBeNull();
    expect(planBands(frame, 250, [OWN_ROWS])).toBeNull();
  });

  it('takes a radius that depends on the frame', () => {
    const plan = planBands(frame, 250, [OWN_ROWS, nearRows((f) => f.height / 100)])!;
    expect(plan.bands[1].regions[0]).toEqual({ y0: 250 - 10 - BAND_PAD, y1: 500 + 10 + BAND_PAD });
  });
});

describe('warpRows', () => {
  it('follows a shift: the rows it reads are the band moved', () => {
    // Reads 100 rows above where it writes (v - 0.1).
    const need = warpRows((u, v) => [[u, v - 0.1]]);
    const read = need({ y0: 500, y1: 600 }, frame, 0)!;
    expect(read.y0).toBeLessThanOrEqual(400);
    expect(read.y0).toBeGreaterThan(395);
    expect(read.y1).toBeGreaterThanOrEqual(500);
    expect(read.y1).toBeLessThan(505);
  });

  it('covers every channel it samples, and ignores points off the picture', () => {
    const need = warpRows((u, v) => [
      [u, v],
      [u, v * 1.05],
      [u, v + 2],
    ]);
    const read = need({ y0: 800, y1: 900 }, frame, 0)!;
    expect(read.y1).toBeGreaterThanOrEqual(900 * 1.05 - 1);
  });

  it('asks for nothing where the whole band maps off the picture', () => {
    const need = warpRows(() => [[0.5, -1]]);
    const read = need({ y0: 0, y1: 100 }, frame, 0)!;
    expect(read.y1 - read.y0).toBe(0);
  });
});

describe('bandFragment', () => {
  it('routes every read of u_src through the band map, nested calls and all', async () => {
    const { bandFragment } = await import('./band-plan');
    const src = `#version 300 es
uniform sampler2D u_src;
vec3 pick(vec2 img) { return texture(u_src, imageUv(img)).rgb; }
void main() { vec4 a = texture(u_src, v_uv + u_texel * vec2(float(dx), float(dy))); }`;
    const out = bandFragment(src)!;
    expect(out).toContain('texture(u_src, _bandUv(imageUv(img))).rgb');
    expect(out).toContain('texture(u_src, _bandUv(v_uv + u_texel * vec2(float(dx), float(dy))))');
    expect(out.indexOf('uniform vec4 u_srcBand;')).toBeGreaterThan(out.indexOf('uniform sampler2D u_src;'));
    expect(out.match(/_bandUv\(/g)!.length).toBe(3);
  });

  it('answers null for a shader that does not declare its source the usual way', async () => {
    const { bandFragment } = await import('./band-plan');
    expect(bandFragment('uniform sampler2D u_other; void main() {}')).toBeNull();
  });
});
