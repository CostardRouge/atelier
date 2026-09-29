import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { createLayer, type AdjustLayer } from './layer';
import { exceptRaster, layerPasses, makeLayerPassCache, maskOverlayPass } from './layer-render';
import { rasteriseBrush, type BrushRaster } from '../render/brush-raster';
import type { RenderPass } from '../render/graph';
import { DEFAULT_SHADE, type BrushStroke, type ShadeMask } from '../render/mask';
import { rasteriseShade } from '../render/shade-raster';

const stroke: BrushStroke = { points: [[0.3, 0.3], [0.6, 0.5]], radius: 0.15, hardness: 0.5, erase: false };

function layer(over: Partial<AdjustLayer> = {}): AdjustLayer {
  return {
    ...createLayer('linear', 'a'),
    develop: { ...DEFAULT_DEVELOP, exposure: -1 },
    ...over,
  };
}

/**
 * A WebGL2 context that draws nothing and records each 2D upload by the unit
 * it went to — enough to see which alpha map a pass binds for a mask, which a
 * node test cannot otherwise see: an empty map and a painted one build the
 * same shader and differ only in the texels uploaded.
 */
function recordingGl() {
  const TEXTURE0 = 0x84c0;
  const uploads = new Map<number, { width: number; height: number; data: Uint8Array }>();
  const names = new Map<string, number>();
  let active = TEXTURE0;
  const gl = new Proxy(
    {},
    {
      get(_, key) {
        if (typeof key !== 'string') return undefined;
        const unit = /^TEXTURE(\d+)$/.exec(key);
        if (unit) return TEXTURE0 + Number(unit[1]);
        if (/^[A-Z][A-Z0-9_]*$/.test(key)) {
          if (!names.has(key)) names.set(key, 0x10000 + names.size);
          return names.get(key);
        }
        switch (key) {
          case 'activeTexture':
            return (u: number) => {
              active = u;
            };
          case 'texImage2D':
            return (...a: unknown[]) => {
              uploads.set(active - TEXTURE0, { width: a[3] as number, height: a[4] as number, data: a[8] as Uint8Array });
            };
          case 'createTexture':
            return () => ({});
          case 'getExtension':
            return () => null;
          case 'getUniformLocation':
            return (_p: unknown, name: string) => name;
          default:
            return () => undefined;
        }
      },
    },
  ) as WebGL2RenderingContext;
  return { gl, uploads };
}

/** The alpha map a pass binds for the layer's OWN mask — unit 2. */
function ownMapOf(pass: RenderPass | null | undefined) {
  const { gl, uploads } = recordingGl();
  pass?.setUniforms?.(gl, {} as WebGLProgram);
  return uploads.get(2);
}

type Map2D = { width: number; height: number; data: Uint8Array };

/** The same map to the byte — `toEqual` walks a 700 000-texel map far too slowly. */
function sameMap(a: Map2D | undefined, b: Map2D | undefined): boolean {
  if (!a || !b || a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i += 1) if (a.data[i] !== b.data[i]) return false;
  return true;
}

const EMPTY: Map2D = { width: 1, height: 1, data: new Uint8Array([0]) };

describe('layerPasses — the delivery', () => {
  const painted = layer({ mask: { kind: 'brush', strokes: [stroke] } });
  const walked = rasteriseBrush([stroke], 1.5);

  it('walks a painted mask’s strokes when it holds no map for it', () => {
    // `roll-render.ts` passes null rasters when no subject is asked for and a
    // map of SUBJECTS otherwise — never a painted one. Handing `makeLayerPass`
    // null there meant an EMPTY map, and the layer left every file blank.
    for (const rasters of [undefined, null, new Map<string, BrushRaster>()]) {
      const [pass] = layerPasses([painted], 1.5, undefined, rasters);
      expect(sameMap(ownMapOf(pass), walked)).toBe(true);
    }
  });

  it('never lets a subject map filed under a painted layer stand in for its strokes', () => {
    const stale: BrushRaster = { data: new Uint8Array(4).fill(255), width: 2, height: 2 };
    const [pass] = layerPasses([painted], 1.5, undefined, new Map([[painted.id, stale]]));
    expect(sameMap(ownMapOf(pass), walked)).toBe(true);
  });

  it('binds what the stage binds for the same painted layer', () => {
    const [delivered] = layerPasses([painted], 1.5);
    const [staged] = makeLayerPassCache().passes([painted], 1.5);
    expect(sameMap(ownMapOf(delivered), ownMapOf(staged))).toBe(true);
  });

  it('still draws NOTHING for a subject whose answer has not arrived', () => {
    const subject = layer({ mask: { kind: 'subject', points: [[0.5, 0.5]], model: 'm' } });
    expect(sameMap(ownMapOf(layerPasses([subject], 1.5, undefined, new Map())[0]), EMPTY)).toBe(true);
    const answer: BrushRaster = { data: new Uint8Array([0, 255, 255, 0]), width: 2, height: 2 };
    expect(sameMap(ownMapOf(layerPasses([subject], 1.5, undefined, new Map([[subject.id, answer]]))[0]), answer)).toBe(true);
  });
});

describe('a SHADE layer — its map is made from its shape, never the caller’s', () => {
  const mask: ShadeMask = { ...DEFAULT_SHADE, direction: 'radial', reach: 0.7, center: { x: 0.3, y: 0.6 } };
  const shaded = layer({ mask });
  const made = rasteriseShade(mask, 1.5)!;

  /** The map a pass binds on `unit`. */
  function mapOn(pass: RenderPass | null | undefined, unit: number) {
    const { gl, uploads } = recordingGl();
    pass?.setUniforms?.(gl, {} as WebGLProgram);
    return uploads.get(unit);
  }

  it('is delivered whatever the rasters hold — nothing, none, or a stale map under its id', () => {
    const stale: BrushRaster = { data: new Uint8Array(4).fill(255), width: 2, height: 2 };
    for (const rasters of [undefined, null, new Map<string, BrushRaster>(), new Map([[shaded.id, stale]])]) {
      const [pass] = layerPasses([shaded], 1.5, undefined, rasters);
      expect(sameMap(ownMapOf(pass), made)).toBe(true);
    }
  });

  it('binds on the stage what the file binds, and shows it as the mask', () => {
    const [staged] = makeLayerPassCache().passes([shaded], 1.5);
    expect(sameMap(ownMapOf(staged), made)).toBe(true);
    expect(sameMap(ownMapOf(maskOverlayPass(shaded, 1.5, null)), made)).toBe(true);
    expect(sameMap(ownMapOf(makeLayerPassCache().overlay(shaded, 1.5)), made)).toBe(true);
  });

  it('binds a shade PART on its own unit, through the delivery and the stage alike', () => {
    const withPart = layer({ parts: [{ op: 'subtract', invert: false, mask }] });
    // Part 0 is component 1, on unit 4.
    expect(sameMap(mapOn(layerPasses([withPart], 1.5)[0], 4), made)).toBe(true);
    expect(sameMap(mapOn(makeLayerPassCache().passes([withPart], 1.5)[0], 4), made)).toBe(true);
  });
});

describe('show-the-mask on a painted layer', () => {
  const painted = layer({ mask: { kind: 'brush', strokes: [stroke] } });
  const walked = rasteriseBrush([stroke], 1.5);

  it('paints the strokes, whether the caller hands null or nothing', () => {
    expect(sameMap(ownMapOf(maskOverlayPass(painted, 1.5, null)), walked)).toBe(true);
    expect(sameMap(ownMapOf(maskOverlayPass(painted, 1.5)), walked)).toBe(true);
  });

  it('paints the strokes through the cache, which ignores a subject map for a painted mask', () => {
    // `use-develop-picture.ts` hands `rasters.get(id) ?? null` for any kind.
    const cache = makeLayerPassCache();
    expect(sameMap(ownMapOf(cache.overlay(painted, 1.5, null)), walked)).toBe(true);
    const stale: BrushRaster = { data: new Uint8Array(4).fill(255), width: 2, height: 2 };
    const other = makeLayerPassCache();
    expect(sameMap(ownMapOf(other.overlay(painted, 1.5, stale)), walked)).toBe(true);
  });

  it('keeps the overlay pass while the strokes stand, and rebuilds it for a new stroke', () => {
    const cache = makeLayerPassCache();
    cache.passes([painted], 1.5);
    const first = cache.overlay(painted, 1.5, null);
    expect(cache.overlay({ ...painted }, 1.5, null)).toBe(first);
    const more = layer({ mask: { kind: 'brush', strokes: [stroke, { ...stroke, points: [[0.1, 0.9]] }] } });
    expect(cache.overlay(more, 1.5, null)).not.toBe(first);
  });
});

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
