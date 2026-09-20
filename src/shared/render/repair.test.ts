import { describe, expect, it } from 'vitest';
import type { DetailImage } from './detail';
import {
  DEFAULT_PATCH_FEATHER,
  MAX_PATCHES,
  PATCH_RADIUS_RANGE,
  describePatches,
  detectDust,
  normalisePatch,
  patchCoverageAt,
  patchExtent,
  patchMeans,
  patchSource,
  readPatches,
  repairAt,
  sampleAt,
  samePatches,
  type Patch,
} from './repair';

const picture = (w: number, h: number, fill: (x: number, y: number) => [number, number, number]): DetailImage => {
  const data = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) data.set(fill(x, y), (y * w + x) * 3);
  return { width: w, height: h, data };
};

const patch = (over: Partial<Patch> = {}): Patch => ({
  id: 'p1',
  kind: 'heal',
  x: 0.5,
  y: 0.5,
  radius: 0.1,
  feather: 0.5,
  dx: 0.2,
  dy: 0,
  ...over,
});

describe('the record', () => {
  it('reads back clamped, drops junk and a repeated id, caps the list', () => {
    expect(normalisePatch({ id: 'a', kind: 'clone', x: 2, y: -1, radius: 9, feather: 3, dx: 5 })).toEqual({
      id: 'a', kind: 'clone', x: 1, y: 0, radius: PATCH_RADIUS_RANGE.max, feather: 1, dx: 1, dy: 0,
    });
    expect(normalisePatch({ id: 'a', kind: 'weird' })!.kind).toBe('heal');
    expect(normalisePatch({ kind: 'heal' })).toBeNull();
    const list = readPatches([{ id: 'a' }, { id: 'a' }, 'junk', { id: 'b', radius: 0.02 }]);
    expect(list.map((p) => p.id)).toEqual(['a', 'b']);
    const many = readPatches(Array.from({ length: 100 }, (_, i) => ({ id: `p${i}` })));
    expect(many.length).toBe(MAX_PATCHES);
    expect(samePatches([patch()], [patch()])).toBe(true);
    expect(samePatches([patch()], [patch({ dx: 0.1 })])).toBe(false);
    expect(samePatches(null, [])).toBe(true);
    expect(describePatches([patch(), patch({ id: 'p2', kind: 'clone' })])).toBe('2 patches · 1 healed, 1 cloned');
    expect(describePatches([])).toBe('');
  });
});

describe('coverage and sampling', () => {
  it('is 1 in the core, 0 past the radius, and fades between, measured against the half-diagonal', () => {
    const p = patch({ x: 0.5, y: 0.5, radius: 0.1, feather: 0.5 });
    expect(patchCoverageAt(p, 0.5, 0.5, 1.5)).toBe(1);
    // A point far away.
    expect(patchCoverageAt(p, 0.9, 0.5, 1.5)).toBe(0);
    // On the ring, halfway through the feather: between 0 and 1.
    const { ru } = patchExtent(p, 1.5);
    const mid = patchCoverageAt(p, 0.5 + ru * 0.75, 0.5, 1.5);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(patchSource(p)).toEqual({ x: 0.7, y: 0.5 });
  });

  it('samples like GL LINEAR with CLAMP_TO_EDGE: texel centres exact, halfway blended, edges held', () => {
    const img = picture(4, 1, (x) => [x / 3, 0, 0]);
    expect(sampleAt(img, 0.5 / 4, 0.5)[0]).toBeCloseTo(0, 6);
    expect(sampleAt(img, 1.5 / 4, 0.5)[0]).toBeCloseTo(1 / 3, 6);
    expect(sampleAt(img, 1 / 4, 0.5)[0]).toBeCloseTo(1 / 6, 6);
    expect(sampleAt(img, -1, 0.5)[0]).toBe(0);
    expect(sampleAt(img, 2, 0.5)[0]).toBeCloseTo(1, 6);
  });
});

describe('repairAt', () => {
  it('clones the source pixel into the destination and leaves the rest alone', () => {
    // Left half dark, right half bright; a clone at the left copies from the right.
    const img = picture(60, 40, (x) => (x < 30 ? [0.2, 0.2, 0.2] : [0.8, 0.8, 0.8]));
    const p = patch({ kind: 'clone', x: 0.25, y: 0.5, radius: 0.08, feather: 0.3, dx: 0.5, dy: 0 });
    expect(repairAt(img, 0.25, 0.5, [p], 1.5)[0]).toBeCloseTo(0.8, 6);
    expect(repairAt(img, 0.1, 0.1, [p], 1.5)[0]).toBeCloseTo(0.2, 6);
    expect(repairAt(img, 0.75, 0.5, [p], 1.5)[0]).toBeCloseTo(0.8, 6);
  });

  it('heals: the source’s texture arrives at the destination’s tone', () => {
    // A bright field with a dark spot at the destination; the source is a
    // bright field with faint texture. Healing must NOT paste the source's
    // brightness (a clone would): it pastes the source's texture shifted so
    // its mean matches the destination's own surroundings.
    const img = picture(80, 60, (x, y) => {
      const spot = Math.hypot(x - 20, y - 30) < 3;
      const texture = ((x + y) % 2) * 0.02;
      const base = x < 40 ? 0.7 : 0.4; // the source side is DARKER
      return spot ? [0.1, 0.1, 0.1] : [base + texture, base + texture, base + texture];
    });
    const p = patch({ kind: 'heal', x: 0.25, y: 0.5, radius: 0.12, feather: 0.4, dx: 0.5, dy: 0 });
    const { dst, src } = patchMeans(img, p, 80 / 60);
    // The means are of the SURROUNDINGS: the destination's ring is the bright
    // field, untouched by the spot in its middle; the source's is the darker one.
    expect(dst[0]).toBeGreaterThan(0.65);
    expect(src[0]).toBeLessThan(dst[0]);
    const healed = repairAt(img, 0.25, 0.5, [p], 80 / 60);
    // Not the source's 0.4 (a clone), not the spot's 0.1: the bright field
    // the destination lives in, with the source's texture on it.
    expect(healed[0]).toBeGreaterThan(0.65);
    expect(healed[0]).toBeLessThan(0.76);
    // And a clone of the same would have brought the dark side over.
    expect(repairAt(img, 0.25, 0.5, [{ ...p, kind: 'clone' }], 80 / 60)[0]).toBeLessThan(0.45);
  });

  it('applies patches in order, each over the last', () => {
    const img = picture(40, 40, (x, y) => [x < 20 ? 0.2 : 0.8, y < 20 ? 0.3 : 0.9, 0.5]);
    const first = patch({ id: 'a', kind: 'clone', x: 0.25, y: 0.25, radius: 0.1, feather: 0, dx: 0.5, dy: 0 });
    const second = patch({ id: 'b', kind: 'clone', x: 0.25, y: 0.25, radius: 0.1, feather: 0, dx: 0, dy: 0.5 });
    const out = repairAt(img, 0.25, 0.25, [first, second], 1);
    // The second patch wins where both cover: it copies from below.
    expect(out[1]).toBeCloseTo(0.9, 6);
    expect(out[0]).toBeCloseTo(0.2, 6);
  });
});

describe('detectDust', () => {
  it('finds small dark round spots and ignores a wire, a big shape and the clean field', () => {
    const W = 600;
    const H = 400;
    const img = picture(W, H, (x, y) => {
      let v = 0.7 + Math.sin(x / 40) * 0.02;
      if (Math.hypot(x - 100, y - 100) < 4) v = 0.4; // dust
      if (Math.hypot(x - 300, y - 250) < 6) v = 0.45; // dust
      if (x > 400 && x < 520 && y > 100 && y < 200) v = 0.3; // a dark rectangle: far too big
      if (y === 320 && x > 50 && x < 350) v = 0.2; // a wire
      return [v, v, v];
    });
    const spots = detectDust(img, { makeId: () => `d${Math.random()}` });
    expect(spots.length).toBe(2);
    const near = (p: Patch, x: number, y: number) => Math.hypot(p.x - x / W, p.y - y / H) < 0.01;
    expect(spots.some((p) => near(p, 100, 100))).toBe(true);
    expect(spots.some((p) => near(p, 300, 250))).toBe(true);
    for (const p of spots) {
      expect(p.kind).toBe('heal');
      expect(p.feather).toBe(DEFAULT_PATCH_FEATHER);
      expect(Math.hypot(p.dx, p.dy)).toBeGreaterThan(0);
      // The source is inside the frame.
      const s = patchSource(p);
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(1);
    }
    // Healing the found spot brings it back to the field.
    const fixed = repairAt(img, 100 / W, 100 / H, spots, W / H);
    expect(fixed[0]).toBeGreaterThan(0.62);
    expect(detectDust(picture(200, 100, () => [0.5, 0.5, 0.5]))).toEqual([]);
  });
});
