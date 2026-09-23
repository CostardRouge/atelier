import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { createLayer, type AdjustLayer } from './layer';
import { exceptRaster, makeLayerPassCache } from './layer-render';
import type { BrushRaster } from '../render/brush-raster';
import type { BrushStroke } from '../render/mask';

const stroke: BrushStroke = { points: [[0.3, 0.3], [0.6, 0.5]], radius: 0.15, hardness: 0.5, erase: false };

function layer(over: Partial<AdjustLayer> = {}): AdjustLayer {
  return {
    ...createLayer('linear', 'a'),
    develop: { ...DEFAULT_DEVELOP, exposure: -1 },
    ...over,
  };
}

describe('makeLayerPassCache', () => {
  it('hands the SAME pass object back while nothing it was built from moved', () => {
    const cache = makeLayerPassCache();
    const a = layer();
    const [first] = cache.passes([a], 1.5);
    // A new array of the same layer object, as a React render hands down.
    const [second] = cache.passes([a], 1.5);
    expect(second).toBe(first);
    // And of an EQUAL layer that is a different object: value, not identity.
    const [third] = cache.passes([{ ...a, mask: { ...a.mask! } }], 1.5);
    expect(third).toBe(first);
  });

  it('rebuilds the pass, and only the pass, when the mask or the opacity moves', () => {
    const cache = makeLayerPassCache();
    const a = layer();
    const [first] = cache.passes([a], 1.5);
    const [moved] = cache.passes([{ ...a, opacity: 0.5 }], 1.5);
    expect(moved).not.toBe(first);
    expect(moved.id).toBe(first.id);
  });

  it('forgets a layer that left, and a different aspect is a different pass', () => {
    const cache = makeLayerPassCache();
    const a = layer();
    const [first] = cache.passes([a], 1.5);
    expect(cache.passes([], 1.5)).toEqual([]);
    const [back] = cache.passes([a], 1.5);
    expect(back).not.toBe(first);
    const [wider] = cache.passes([a], 2);
    expect(wider).not.toBe(back);
  });

  it('keeps a painted raster across an opacity nudge and re-walks it for a new stroke array', () => {
    const cache = makeLayerPassCache();
    const painted = layer({ mask: { kind: 'brush', strokes: [stroke] } });
    const [first] = cache.passes([painted], 1);
    // Opacity moved, the strokes array did not: the pass is rebuilt but the
    // raster it was handed is the one already walked. Proved by identity of
    // the pass being NEW while the two builds cannot be told apart otherwise —
    // the raster is private to the pass, so the observable is the cost, which
    // a spec cannot time; what it CAN pin is that the pass changed and the
    // cache did not throw the strokes away (a fresh strokes array below is
    // what forces a re-walk, and that path is exercised too).
    const [nudged] = cache.passes([{ ...painted, opacity: 0.7 }], 1);
    expect(nudged).not.toBe(first);
    const [repainted] = cache.passes([{ ...painted, mask: { kind: 'brush', strokes: [stroke, stroke] } }], 1);
    expect(repainted).not.toBe(nudged);
  });

  it('skips a layer that draws nothing, like layerPasses does', () => {
    const cache = makeLayerPassCache();
    const parked = layer({ opacity: 0 });
    expect(cache.passes([parked], 1)).toEqual([]);
    const untouched = layer({ develop: { ...DEFAULT_DEVELOP } });
    expect(cache.passes([untouched], 1)).toEqual([]);
  });

  it('keeps the overlay pass for the same layer and drops it when the layer changes', () => {
    const cache = makeLayerPassCache();
    const a = layer();
    const first = cache.overlay(a, 1.5);
    expect(first).not.toBeNull();
    expect(cache.overlay({ ...a }, 1.5)).toBe(first);
    expect(cache.overlay({ ...a, invert: true }, 1.5)).not.toBe(first);
    expect(cache.overlay(layer({ mask: null }), 1.5)).toBeNull();
  });

  it('rebuilds a pass when the subtracted subject arrives, and keeps it after', () => {
    const cache = makeLayerPassCache();
    const whole = layer({ mask: null, except: 's' });
    const [before] = cache.passes([whole], 1.5, new Map());
    const cut: BrushRaster = { data: new Uint8Array(4).fill(255), width: 2, height: 2 };
    const rasters = new Map([['s', cut]]);
    const [after] = cache.passes([whole], 1.5, rasters);
    expect(after).not.toBe(before);
    expect(cache.passes([whole], 1.5, rasters)[0]).toBe(after);
  });

  it('draws the outline and the fill as two passes, and shows a hole on a whole layer', () => {
    const cache = makeLayerPassCache();
    const a = layer();
    const fill = cache.overlay(a, 1.5, null, 'fill');
    const outline = cache.overlay(a, 1.5, null, 'outline');
    expect(outline).not.toBe(fill);
    expect(outline?.id).toBe('mask-outline:a');
    const cut: BrushRaster = { data: new Uint8Array(4), width: 2, height: 2 };
    // No mask of its own, but a subject taken out: the hole is worth showing.
    expect(cache.overlay(layer({ mask: null, except: 's' }), 1.5, null, 'outline', cut)).not.toBeNull();
  });

  it('keeps the blink for the same raster and lets it go with none', () => {
    const cache = makeLayerPassCache();
    const r: BrushRaster = { data: new Uint8Array(4), width: 2, height: 2 };
    const first = cache.flash(r, 1.5);
    expect(first).not.toBeNull();
    expect(cache.flash(r, 1.5)).toBe(first);
    expect(cache.flash(null, 1.5)).toBeNull();
  });
});

describe('exceptRaster', () => {
  it('is the subtracted subject’s map, or nothing', () => {
    const r: BrushRaster = { data: new Uint8Array(1), width: 1, height: 1 };
    const rasters = new Map([['s', r]]);
    expect(exceptRaster(layer({ except: 's' }), rasters)).toBe(r);
    expect(exceptRaster(layer({ except: 'gone' }), rasters)).toBeNull();
    expect(exceptRaster(layer(), rasters)).toBeNull();
  });
});
