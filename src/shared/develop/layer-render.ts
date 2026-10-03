/**
 * A stack of adjustment layers, as passes.
 *
 * The one thing worth knowing here: **a layer's develop is baked with NO look
 * and NO output transform** — `composeLutStack([], 'none', …, develop)`. The
 * look belongs to the picture or the roll and is applied once, after the whole
 * stack; the output transform belongs to the delivery and is applied last. A
 * layer that carried either would apply it twice over, once per layer, which is
 * the sort of error a preview shows only where two layers overlap.
 *
 * Order is bottom to top: the array's first entry is applied first, and each
 * pass reads what the one under it wrote.
 *
 * Kept apart from `layer.ts` so the record stays a record — this is the only
 * file that knows a layer becomes a cube.
 */

import { composeLutStack } from '../lut/lut-stack';
import { getDefaultLutInterpolation } from '../lut/lut-gl';
import type { Interpolation } from '../lut/interpolate';
import type { CubeLut } from '../lib/cube-parser';
import { makeLayerPass } from '../render/layer-pass';
import type { RenderPass } from '../render/graph';
import { rasteriseBrushFrom, releaseBrushWorking, type BrushRaster, type BrushRasterState } from '../render/brush-raster';
import { cloneMask, sameMask, type BrushStroke, type Mask } from '../render/mask';
import { cloneParts, drawingLayers, sameParts, type AdjustLayer, type MaskPart } from './layer';
import { cloneDevelop, sameDevelop, type DevelopSettings } from './develop';

/** One layer's develop as a cube: the correction alone, no look, no transform. */
export function layerCube(
  develop: DevelopSettings,
  interpolation: Interpolation = getDefaultLutInterpolation(),
): CubeLut | null {
  return composeLutStack([], 'none', interpolation, develop);
}

/**
 * The passes for a stack, bottom to top. Empty when nothing in it draws, so a
 * picture with a parked layer costs exactly what one with no layers costs.
 *
 * `aspectRatio` is the SOURCE's: layers apply before any crop, like the
 * geometry, so a mask's coordinates mean the same in the preview and the file.
 */
export function layerPasses(
  layers: readonly AdjustLayer[] | null | undefined,
  aspectRatio: number,
  interpolation: Interpolation = getDefaultLutInterpolation(),
  /**
   * Alpha maps for the masks this module cannot compute — a segmented subject,
   * resolved by `use-subject-masks.ts` or `subject-rasters.ts`. A layer asking
   * for one that is not here yet draws NOTHING rather than everything: a
   * subject still being thought about must not apply to the whole picture for
   * four seconds. A PAINTED mask is never looked up here: its strokes are
   * walked by `makeLayerPass` (`ownRaster`).
   */
  rasters?: ReadonlyMap<string, BrushRaster> | null,
): RenderPass[] {
  return drawingLayers(layers).flatMap((layer) => {
    const cube = layerCube(layer.develop, interpolation);
    if (!cube) return [];
    const pass = makeLayerPass({
      lut: cube,
      mask: layer.mask,
      invert: layer.invert,
      opacity: layer.opacity,
      aspectRatio,
      interpolation,
      raster: ownRaster(layer, rasters),
      except: exceptRaster(layer, rasters),
      parts: layer.parts,
      // Keyed by the LAYER's id: the graph caches programs by pass id, and two
      // layers sharing one would share a program and, through it, one uploaded
      // cube — the second layer would then grade with the first one's numbers.
      id: `layer:${layer.id}`,
    });
    return pass ? [pass] : [];
  });
}

/**
 * What a layer's OWN mask hands `makeLayerPass` as its map, whose contract is
 * `undefined` = walk the strokes here and `null` = an EMPTY map. Only a SUBJECT
 * takes one from `rasters` — null while its answer has not arrived, so it
 * draws nothing. Every other kind is handed nothing: a painted mask handed
 * `null` is delivered empty (the layer vanishes from the file while the stage,
 * which walks its own strokes, still shows it), and `rasters` holds subjects
 * alone, so an entry left under a layer that is painted now must never stand
 * in for its strokes.
 */
function ownRaster(
  layer: AdjustLayer,
  rasters: ReadonlyMap<string, BrushRaster> | null | undefined,
): BrushRaster | null | undefined {
  return layer.mask?.kind === 'subject' ? (rasters?.get(layer.id) ?? null) : undefined;
}

/**
 * The map of the subject a layer SUBTRACTS, from the same rasters its own
 * subject would come from — null when it subtracts nothing, or when that
 * subject's answer has not arrived (the layer then applies whole for the
 * moment the model thinks, rather than vanishing).
 */
export function exceptRaster(
  layer: AdjustLayer,
  rasters: ReadonlyMap<string, BrushRaster> | null | undefined,
): BrushRaster | null {
  return layer.except ? (rasters?.get(layer.except) ?? null) : null;
}

/** How show-the-mask draws: a red wash, or the line where the mask crosses one half. */
export type MaskOverlayStyle = 'fill' | 'outline';

/**
 * Every colour to the same vermilion — the suite's accent, so the overlay reads
 * as ours and not as a warning.
 */
const RED_CUBE: CubeLut = {
  title: 'mask overlay',
  size: 2,
  domainMin: [0, 0, 0],
  domainMax: [1, 1, 1],
  data: (() => {
    const data = new Float32Array(2 * 2 * 2 * 3);
    for (let i = 0; i < 8; i += 1) {
      data[i * 3] = 0.85;
      data[i * 3 + 1] = 0.16;
      data[i * 3 + 2] = 0.1;
    }
    return data;
  })(),
};

/** How strongly the overlay tints — enough to read, not enough to hide the picture. */
const OVERLAY_STRENGTH = 0.55;

/**
 * SHOW ME THE MASK: the layer's own shape painted over the picture in red.
 *
 * It is `makeLayerPass` again with a cube that maps every colour to one, rather
 * than a second shader — so what is drawn is the mask the render really uses,
 * down to the feather and the invert. A separate overlay shader would be a
 * second implementation of `maskAt` to keep in step, which is the exact mistake
 * `glsl.ts` exists to prevent.
 *
 * Null for a layer with no mask: tinting the whole frame says nothing.
 */
export function maskOverlayPass(
  layer: AdjustLayer | null | undefined,
  aspectRatio: number,
  /**
   * The layer's own map when the caller holds it — a subject's answer, or a
   * painted mask already walked for these strokes. Null and absent mean the
   * same here: a painted mask is walked, a subject not yet answered shows
   * nothing. Never an EMPTY map for strokes that exist.
   */
  raster?: BrushRaster | null,
  style: MaskOverlayStyle = 'fill',
  except: BrushRaster | null = null,
  /** The painted parts' maps, by index, when the caller holds them (`undefined` rasterises). */
  partRasters?: readonly (BrushRaster | null | undefined)[],
): RenderPass | null {
  // A layer with no mask of its own is still worth showing once it subtracts
  // a subject or combines a part: the hole, or the part, IS its shape.
  if (!layer) return null;
  if (!layer.mask && !except && !(layer.parts ?? []).length) return null;
  return makeLayerPass({
    lut: RED_CUBE,
    mask: layer.mask,
    // `?? undefined`, not `?? null`: `makeLayerPass` reads null as an empty
    // map, which would show a painted layer's mask as nothing at all.
    raster: raster ?? undefined,
    except,
    parts: layer.parts,
    partRasters,
    invert: layer.invert,
    opacity: style === 'outline' ? 1 : OVERLAY_STRENGTH,
    finish: style === 'outline' ? 'outline' : 'grade',
    aspectRatio,
    // Trilinear: a 2-point cube of one colour, where the lookup cannot matter,
    // and this way the overlay never waits on a tetrahedral branch.
    interpolation: 'trilinear',
    // The style is in the id: the two draw with different programs.
    id: `mask-${style}:${layer.id}`,
  });
}

/** Brighter than the overlay's wash, so a blink reads over it. */
const FLASH_CUBE: CubeLut = {
  ...RED_CUBE,
  title: 'mask flash',
  data: (() => {
    const data = new Float32Array(2 * 2 * 2 * 3);
    for (let i = 0; i < 8; i += 1) {
      data[i * 3] = 0.94;
      data[i * 3 + 1] = 0.34;
      data[i * 3 + 2] = 0.22;
    }
    return data;
  })(),
};

/**
 * A REMOVED region blinks in ink, never in the accent (2026-10-02): the red
 * wash says "this is in the subject", and a tap that took a region out must
 * not say the opposite of what it did.
 */
const FLASH_REMOVE_CUBE: CubeLut = {
  ...RED_CUBE,
  title: 'mask flash (removed)',
  data: (() => {
    const data = new Float32Array(2 * 2 * 2 * 3);
    for (let i = 0; i < 8; i += 1) {
      data[i * 3] = 0.08;
      data[i * 3 + 1] = 0.07;
      data[i * 3 + 2] = 0.06;
    }
    return data;
  })(),
};

/** What blinks: one tap's region, and which way the tap went. */
export interface MaskFlash {
  raster: BrushRaster;
  tone: 'add' | 'remove';
}

/**
 * One point's own region, washed — what BLINKS when the model answers a tap
 * (the maintainer's pick, 2026-09-23: twice, like a macOS menu item). The
 * point's raster alone, never the layer's union: the blink says what this tap
 * CHANGED — added in the accent, taken away in ink.
 */
export function maskFlashPass(raster: BrushRaster, aspectRatio: number, tone: MaskFlash['tone'] = 'add'): RenderPass | null {
  return makeLayerPass({
    lut: tone === 'add' ? FLASH_CUBE : FLASH_REMOVE_CUBE,
    mask: { kind: 'subject', points: [], model: 'flash' },
    raster,
    opacity: 0.7,
    aspectRatio,
    interpolation: 'trilinear',
    // The tone is in the id: the two blink through different cubes.
    id: `mask-flash-${tone}`,
  });
}

// --- the cache ---------------------------------------------------------------

/**
 * The passes for ONE picture's stack, REMEMBERED between calls.
 *
 * `layerPasses` above is right for a delivery — built once, thrown away — and
 * was wrong for the stage. There, `graderFor` rebuilt the whole list on every
 * change to ANY layer field, and a rebuilt list is expensive three times over:
 * every layer's develop was re-baked into a cube (`composeLutStack` at 33³,
 * ~40 ms each), every painted mask was walked again on the CPU (a 1024-wide
 * map), and every pass was a new object whose cube and mask textures the
 * graph then uploaded again. Five layers made an opacity slider cost five
 * bakes, five rasters and ten uploads per step — and "show the mask" made the
 * histogram and the stage swap the list back and forth on every repaint.
 *
 * So the cache keeps, per layer id, the three things that are dear and the
 * value each was made from:
 *
 * - the CUBE, reused while the layer's develop is `sameDevelop`;
 * - the painted RASTER, reused while the strokes are the same array (a stroke
 *   in progress rewrites the array, so a live drag still re-rasterises — but
 *   only the layer being painted) at the same aspect;
 * - the PASS object itself, reused while everything it was built from is
 *   unchanged — so a swap that puts the same object back in the graph's list
 *   costs no upload, because the graph only releases what LEAVES the list.
 *
 * Nothing here touches the GPU: a pass is a shader and a setter until the
 * graph draws it, and the graph disposes what it drops. Layers no longer in
 * the list are forgotten on the next call, so a picture change cannot pin the
 * last picture's cubes.
 */
export interface LayerPassCache {
  passes(
    layers: readonly AdjustLayer[] | null | undefined,
    aspectRatio: number,
    rasters?: ReadonlyMap<string, BrushRaster> | null,
    interpolation?: Interpolation,
  ): RenderPass[];
  /**
   * The show-me-the-mask pass for a layer, kept the same way. `raster` is the
   * layer's SUBJECT map (null until it arrives), like `passes`' `rasters`, and
   * is ignored for any other kind — a painted mask's map is the cache's own.
   */
  overlay(
    layer: AdjustLayer | null | undefined,
    aspectRatio: number,
    raster?: BrushRaster | null,
    style?: MaskOverlayStyle,
    except?: BrushRaster | null,
  ): RenderPass | null;
  /** The blink over one point's region, kept while it is the same blink. */
  flash(flash: MaskFlash | null, aspectRatio: number): RenderPass | null;
  /**
   * Bake the cubes of `layers` AHEAD of `passes`, where it is cheap to be
   * interrupted: the Develop stage calls this while React renders a DEFERRED
   * value, so a layer's slider bakes its 33³ cube in a render React may
   * abandon for the next step — the global develop's deferred bake
   * (`use-lut-stack.ts`) — rather than synchronously in the paint for every
   * input event. `passes` then finds the cube already made. Idempotent.
   */
  prime(layers: readonly AdjustLayer[] | null | undefined, interpolation?: Interpolation): void;
  /**
   * The cube this cache already holds for `layer` — held by a pass, or baked
   * ahead by `prime` — while the layer's develop is the one it was baked
   * from; `undefined` otherwise. What a SECOND cache over the same picture
   * (a thumbnail's grader beside the stage's) asks before baking its own: a
   * 33³ bake is ~40 ms, and the two graders see the same layers.
   */
  cubeOf(layer: AdjustLayer, interpolation?: Interpolation): CubeLut | null | undefined;
}

interface Held {
  develop: DevelopSettings;
  interpolation: Interpolation;
  cube: CubeLut | null;
  /** The strokes the raster was walked from, by identity, and at what aspect. */
  strokes: readonly BrushStroke[] | null;
  rasterAspect: number;
  raster: BrushRaster | null;
  /** The raster's incremental state, so the next point of a live stroke costs its segment (`brush-raster.ts`). */
  brushState: BrushRasterState | null;
  /** What the pass was built from. */
  mask: Mask | null;
  invert: boolean;
  opacity: number;
  aspectRatio: number;
  passRaster: BrushRaster | null;
  passExcept: BrushRaster | null;
  /** Each part's painted map, its state, and the strokes it was walked from, by index. */
  partStrokes: (readonly BrushStroke[] | null)[];
  partRasters: (BrushRaster | null)[];
  partStates: (BrushRasterState | null)[];
  parts: MaskPart[];
  pass: RenderPass | null;
}

interface HeldOverlay {
  mask: Mask | null;
  parts: MaskPart[];
  partRasters: (BrushRaster | null)[];
  partStates: (BrushRasterState | null)[];
  invert: boolean;
  aspectRatio: number;
  raster: BrushRaster | null;
  /** The overlay's own incremental state, for a painted layer that does not draw yet (its sliders at zero). */
  brushState: BrushRasterState | null;
  style: MaskOverlayStyle;
  except: BrushRaster | null;
  pass: RenderPass | null;
}

/** A raster stepped from its previous state — the one step the pointer asks for — or built whole. */
type BrushStep = (prev: BrushRasterState | null | undefined, strokes: readonly BrushStroke[], aspectRatio: number) => BrushRasterState;

/**
 * Each painted part's map, reused from the last call while its strokes are the
 * same array at the same aspect — a part being painted steps itself alone.
 */
function partRasterFor(
  parts: readonly MaskPart[],
  strokes: readonly (readonly BrushStroke[] | null)[],
  prev: { partStrokes: (readonly BrushStroke[] | null)[]; partRasters: (BrushRaster | null)[]; partStates: (BrushRasterState | null)[]; rasterAspect: number } | undefined,
  aspectRatio: number,
  step: BrushStep,
): { rasters: (BrushRaster | null)[]; states: (BrushRasterState | null)[] } {
  const rasters: (BrushRaster | null)[] = [];
  const states: (BrushRasterState | null)[] = [];
  parts.forEach((_, i) => {
    const s = strokes[i];
    if (!s || !s.length) {
      rasters.push(null);
      states.push(null);
      return;
    }
    if (prev && prev.partStrokes[i] === s && prev.rasterAspect === aspectRatio) {
      rasters.push(prev.partRasters[i]);
      states.push(prev.partStates[i]);
      return;
    }
    const state = step(prev?.partStates[i], s, aspectRatio);
    rasters.push(state.raster);
    states.push(state);
  });
  return { rasters, states };
}

export function makeLayerPassCache(
  /**
   * Another cache over the SAME picture whose cubes this one may borrow
   * (`cubeOf`) rather than bake again — the stage's, for the small grader
   * that draws the picture as a layer sees it. A pass is never shared: it
   * holds textures on the one context it drew on; a cube is plain data.
   */
  lender: Pick<LayerPassCache, 'cubeOf'> | null = null,
): LayerPassCache {
  const held = new Map<string, Held>();
  /** Cubes baked by `prime`, by layer id, with the develop they were baked from. */
  const baked = new Map<string, { develop: DevelopSettings; interpolation: Interpolation; cube: CubeLut | null }>();
  let overlay: { id: string; held: HeldOverlay } | null = null;
  let flash: { flash: MaskFlash; aspectRatio: number; pass: RenderPass | null } | null = null;
  /**
   * The ONE painted map whose working arrays are kept (`brush-raster.ts`,
   * 8.4 MB at a 1024 map): the stroke being painted. Stepping another releases
   * this one's, and its next step is a whole build — today's cost, once.
   */
  let liveBrush: BrushRasterState | null = null;
  const step: BrushStep = (prev, strokes, aspectRatio) => {
    const state = rasteriseBrushFrom(prev, strokes, aspectRatio);
    if (state !== liveBrush) {
      releaseBrushWorking(liveBrush);
      liveBrush = state;
    }
    return state;
  };

  const cubeOf = (layer: AdjustLayer, interpolation: Interpolation = getDefaultLutInterpolation()): CubeLut | null | undefined => {
    const prev = held.get(layer.id);
    if (prev && prev.interpolation === interpolation && sameDevelop(prev.develop, layer.develop)) return prev.cube;
    const primed = baked.get(layer.id);
    if (primed && primed.interpolation === interpolation && sameDevelop(primed.develop, layer.develop)) return primed.cube;
    return undefined;
  };

  return {
    cubeOf,

    passes(layers, aspectRatio, rasters = null, interpolation = getDefaultLutInterpolation()) {
      const drawing = drawingLayers(layers);
      const keep = new Set<string>();
      const out: RenderPass[] = [];
      for (const layer of drawing) {
        keep.add(layer.id);
        const prev = held.get(layer.id);

        const own = cubeOf(layer, interpolation);
        const cube = own !== undefined ? own : (lender?.cubeOf(layer, interpolation) ?? layerCube(layer.develop, interpolation));

        let raster: BrushRaster | null;
        let brushState: BrushRasterState | null = null;
        let strokes: readonly BrushStroke[] | null = null;
        if (layer.mask?.kind === 'brush') {
          strokes = layer.mask.strokes;
          if (prev && prev.strokes === strokes && prev.rasterAspect === aspectRatio) {
            raster = prev.raster;
            brushState = prev.brushState;
          } else if (strokes.length) {
            // A pointer move hands the same strokes with the last one longer:
            // stepped from the previous state, the new segment's box alone.
            brushState = step(prev?.brushState, strokes, aspectRatio);
            raster = brushState.raster;
          } else {
            raster = null;
          }
        } else if (layer.mask?.kind === 'subject') {
          raster = rasters?.get(layer.id) ?? null;
        } else {
          raster = null;
        }

        const except = exceptRaster(layer, rasters);
        const parts = layer.parts ?? [];
        const partStrokes = parts.map((p) => (p.mask.kind === 'brush' ? p.mask.strokes : null));
        const { rasters: partRasters, states: partStates } = partRasterFor(parts, partStrokes, prev, aspectRatio, step);
        const reusable =
          prev?.pass &&
          prev.cube === cube &&
          prev.passRaster === raster &&
          prev.passExcept === except &&
          prev.partRasters.length === partRasters.length &&
          prev.partRasters.every((r, i) => r === partRasters[i]) &&
          sameParts(prev.parts, parts) &&
          prev.invert === layer.invert &&
          prev.opacity === layer.opacity &&
          prev.aspectRatio === aspectRatio &&
          sameMask(prev.mask, layer.mask);
        const pass = reusable
          ? prev.pass
          : cube
            ? makeLayerPass({
                lut: cube,
                mask: layer.mask,
                invert: layer.invert,
                opacity: layer.opacity,
                aspectRatio,
                interpolation,
                raster,
                except,
                parts,
                partRasters,
                id: `layer:${layer.id}`,
              })
            : null;

        held.set(layer.id, {
          develop: cloneDevelop(layer.develop),
          interpolation,
          cube,
          strokes,
          rasterAspect: aspectRatio,
          raster,
          brushState,
          mask: cloneMask(layer.mask),
          invert: layer.invert,
          opacity: layer.opacity,
          aspectRatio,
          passRaster: raster,
          passExcept: except,
          partStrokes,
          partRasters,
          partStates,
          parts: cloneParts(parts),
          pass,
        });
        if (pass) out.push(pass);
      }
      for (const id of held.keys()) if (!keep.has(id)) held.delete(id);
      return out;
    },

    prime(layers, interpolation = getDefaultLutInterpolation()) {
      const drawing = drawingLayers(layers);
      const keep = new Set<string>();
      for (const layer of drawing) {
        keep.add(layer.id);
        const prev = held.get(layer.id);
        if (prev && prev.interpolation === interpolation && sameDevelop(prev.develop, layer.develop)) continue;
        const done = baked.get(layer.id);
        if (done && done.interpolation === interpolation && sameDevelop(done.develop, layer.develop)) continue;
        baked.set(layer.id, { develop: cloneDevelop(layer.develop), interpolation, cube: layerCube(layer.develop, interpolation) });
      }
      for (const id of baked.keys()) if (!keep.has(id)) baked.delete(id);
    },

    overlay(layer, aspectRatio, raster = null, style = 'fill', except = null) {
      if (!layer || (!layer.mask && !except && !(layer.parts ?? []).length)) {
        overlay = null;
        return null;
      }
      const prev = overlay?.id === layer.id ? overlay.held : null;
      // The painted maps — the layer's own and its parts' — come from the
      // layer's held entry when it draws, so showing the mask of a layer being
      // painted walks nothing twice; a subject's is the caller's.
      const own = held.get(layer.id);
      const mask = layer.mask;
      // A layer that does not draw yet (a fresh painted mask, its sliders at
      // zero) has no held entry, so the overlay keeps a state of its own and
      // steps it per pointer move, exactly as `passes` does for one that draws.
      let ownMap: BrushRaster | null = null;
      let brushState: BrushRasterState | null = null;
      if (mask?.kind === 'brush') {
        if (own && own.strokes === mask.strokes && own.rasterAspect === aspectRatio) {
          ownMap = own.raster;
        } else if (prev && prev.mask?.kind === 'brush' && sameMask(prev.mask, mask) && prev.aspectRatio === aspectRatio) {
          ownMap = prev.raster;
          brushState = prev.brushState;
        } else if (mask.strokes.length) {
          brushState = step(prev?.brushState, mask.strokes, aspectRatio);
          ownMap = brushState.raster;
        }
      } else if (mask?.kind === 'subject') {
        ownMap = raster;
      }
      const parts = layer.parts ?? [];
      const partRasters: (BrushRaster | null)[] = [];
      const partStates: (BrushRasterState | null)[] = [];
      parts.forEach((p, i) => {
        if (p.mask.kind !== 'brush' || !p.mask.strokes.length) {
          partRasters.push(null);
          partStates.push(null);
        } else if (own && own.partStrokes[i] === p.mask.strokes && own.rasterAspect === aspectRatio) {
          partRasters.push(own.partRasters[i]);
          partStates.push(null);
        } else if (prev && prev.parts[i]?.mask.kind === 'brush' && sameMask(prev.parts[i].mask, p.mask) && prev.aspectRatio === aspectRatio) {
          partRasters.push(prev.partRasters[i]);
          partStates.push(prev.partStates[i]);
        } else {
          const state = step(prev?.partStates[i], p.mask.strokes, aspectRatio);
          partRasters.push(state.raster);
          partStates.push(state);
        }
      });
      if (
        prev?.pass &&
        sameParts(prev.parts, parts) &&
        prev.partRasters.every((r, i) => r === partRasters[i]) &&
        prev.raster === ownMap &&
        prev.style === style &&
        prev.except === except &&
        prev.invert === layer.invert &&
        prev.aspectRatio === aspectRatio &&
        sameMask(prev.mask, layer.mask)
      ) {
        return prev.pass;
      }
      const pass = maskOverlayPass(layer, aspectRatio, ownMap, style, except, partRasters);
      overlay = {
        id: layer.id,
        held: {
          mask: cloneMask(layer.mask),
          parts: cloneParts(parts),
          partRasters,
          partStates,
          invert: layer.invert,
          aspectRatio,
          raster: ownMap,
          brushState,
          style,
          except,
          pass,
        },
      };
      return pass;
    },

    flash(blink, aspectRatio) {
      if (!blink) {
        flash = null;
        return null;
      }
      if (flash && flash.flash === blink && flash.aspectRatio === aspectRatio) return flash.pass;
      flash = { flash: blink, aspectRatio, pass: maskFlashPass(blink.raster, aspectRatio, blink.tone) };
      return flash.pass;
    },
  };
}
