import { describe, expect, it } from 'vitest';
import { createMosaicDoc, withTiles, type MosaicDoc } from './mosaic-doc';
import { MOSAIC_MODES, checkTarget, cropAsked, mosaicOutline, withMotionAsked } from './mosaic-commands';
import { RECIPE_MOTIONS } from './motion';

const GRID = 'A'.repeat(144);

function mosaic(): MosaicDoc {
  const doc = createMosaicDoc('Iceland', 'local', 1_000);
  return {
    ...withTiles(doc, [
      { id: 1, kind: 'photo', grid: GRID },
      { id: 2, kind: 'clip', grid: GRID },
      { id: 3, kind: 'photo', failed: true },
      { id: 4, kind: 'photo' },
    ]),
    instance: 'winnow.example',
    target: 1,
    chain: { queue: [{ id: 2, by: 'pick' }], draw: true },
  };
}

describe('what an agent reads of a mosaic', () => {
  it('counts its library, names its target, frame, dials, motion and chain', () => {
    const o = mosaicOutline(mosaic());
    expect(o).toMatchObject({ title: 'Iceland', keptOn: 'local', picturesFrom: 'winnow.example', pictures: 4, photos: 3, measured: 2, failed: 1, toMeasure: 1, target: 1, crop: null });
    expect(o.chain).toEqual({ next: [{ id: 2, by: 'pick' }], drawsMore: true });
    expect(o.dials.cellPx).toBe(40);
    expect(o.mode).toBe('single');
    expect(o.motion).toEqual(RECIPE_MOTIONS.mosaics);
  });
});

describe('the checks', () => {
  it('a target is one of its pictures, measured', () => {
    const doc = mosaic();
    expect(checkTarget(doc, 2)).toEqual({ ok: true, value: 2 });
    expect(checkTarget(doc, 9)).toMatchObject({ ok: false, reason: expect.stringContaining('not in this mosaic') });
    expect(checkTarget(doc, 3)).toMatchObject({ ok: false, reason: expect.stringContaining('could not be read') });
    expect(checkTarget(doc, 4)).toMatchObject({ ok: false, reason: expect.stringContaining('mosaic.measure') });
  });

  it('a crop is its centre and scale, the whole frame none at all', () => {
    expect(cropAsked(0.5, 0.5, 1)).toBeUndefined();
    expect(cropAsked(0.3, 0.6, 0.4)).toEqual({ cx: 0.3, cy: 0.6, scale: 0.4 });
  });
});

describe('a motion asked', () => {
  it('a recipe puts its parts back; a part set by hand makes it custom, or the recipe it still is', () => {
    const s = { ...mosaic().settings, mode: 'mosaics' as const };
    const wave = withMotionAsked(s, 'wave', {});
    expect(wave).toMatchObject({ mode: 'wave', motion: RECIPE_MOTIONS.wave });
    const custom = withMotionAsked(s, 'chain', { holdMs: 2500 });
    expect(custom.mode).toBe('custom');
    expect(custom.motion.holdMs).toBe(2500);
    expect(withMotionAsked(s, undefined, { depart: 'pull' }).mode).toBe('custom');
    // Still keeps its parts for the next Play, and a part set under it leaves it Still.
    expect(withMotionAsked(s, 'single', { drift: false })).toMatchObject({ mode: 'single', motion: { ...s.motion, drift: false } });
    expect(withMotionAsked(s, 'mosaics', {})).toBe(s);
    expect(MOSAIC_MODES).toContain('custom');
  });
});
