/**
 * The arithmetic behind the Mosaic instrument's agent commands (M9,
 * `docs/memory/agent-commands.md`): what `mosaic.get` answers of a mosaic,
 * which picture a target may be, a crop asked by its centre and scale, and a
 * motion asked part by part. The commands themselves are registered by the
 * screens that can do them (`MosaicTool`, `MosaicEditor`); everything they
 * write goes through the editor's own funnel, so an agent's edit is saved,
 * synced and one undo step like a gesture.
 *
 * Every check refuses rather than clamps (the registry's rule): the bounds
 * are the commands' params, and what only the mosaic can say (a picture it
 * does not hold, one not measured yet) is said here. Pure and DOM-free.
 */

import { MIN_CROP_SCALE, isWhole, type Crop } from './frame';
import { chainOf, type MosaicDoc, type MosaicMode, type MosaicSettings } from './mosaic-doc';
import { motionOf, recipeOf, sanitizeMotion, type Motion } from './motion';

/** The modes an agent may name: Still, every recipe, and Custom. */
export const MOSAIC_MODES = ['single', 'chain', 'dezoom', 'reveal', 'drift', 'mosaics', 'wave', 'slideshow', 'steer', 'custom'] as const satisfies readonly MosaicMode[];

/** The mosaic as an agent reads it: its library's counts, its target and frame, its dials, its motion, its chain. */
export function mosaicOutline(doc: MosaicDoc) {
  const measured = doc.tiles.reduce((n, t) => (t.grid ? n + 1 : n), 0);
  const failed = doc.tiles.reduce((n, t) => (t.failed ? n + 1 : n), 0);
  const chain = chainOf(doc);
  const s = doc.settings;
  return {
    id: doc.id,
    title: doc.title,
    keptOn: doc.sourceId,
    picturesFrom: doc.instance ?? null,
    span: doc.span ?? null,
    pictures: doc.tiles.length,
    photos: doc.tiles.reduce((n, t) => (t.kind === 'photo' ? n + 1 : n), 0),
    measured,
    failed,
    toMeasure: doc.tiles.length - measured - failed,
    target: doc.target ?? null,
    crop: doc.crop ?? null,
    dials: { aspect: s.aspect, cellPx: s.cellPx, level: s.level, space: s.space, tint: s.tint, distinctNeighbours: s.distinctNeighbours, speed: s.speed, seed: s.seed },
    mode: s.mode,
    motion: s.motion,
    export: s.export,
    chain: { next: chain.queue.map((e) => ({ id: e.id, by: e.by })), drawsMore: chain.draw },
    updatedAt: doc.updatedAt,
  };
}

export type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

/** A picture that may be the target: one of the mosaic's, its colours measured. */
export function checkTarget(doc: MosaicDoc, id: number): Check<number> {
  const tile = doc.tiles.find((t) => t.id === id);
  if (!tile) return { ok: false, reason: `picture ${id} is not in this mosaic — mosaic.get counts its pictures, mosaic.add adds some` };
  if (!tile.grid) return { ok: false, reason: `picture ${id} is not measured yet${tile.failed ? ' (it could not be read)' : ' — mosaic.measure first'}` };
  return { ok: true, value: id };
}

/**
 * The part of the target rebuilt, asked by its centre (0..1 of the picture)
 * and its scale (1 = the largest frame of the shape the picture holds, down
 * to `MIN_CROP_SCALE`) — `undefined` for the whole frame. A frame that would
 * overhang is pushed back onto the picture where it is drawn (`cropRect`), as
 * a drag is; the bounds are the registry's to refuse.
 */
export function cropAsked(cx: number, cy: number, scale: number): Crop | undefined {
  const crop = { cx, cy, scale: Math.max(MIN_CROP_SCALE, Math.min(1, scale)) };
  return isWhole(crop) ? undefined : crop;
}

/**
 * The settings with a mode and motion parts asked: the mode first (a recipe
 * puts its parts back, as the transport does), then each part; parts set by
 * hand make the mode the recipe they still are, or Custom (`recipeOf`), as
 * the Motion section does. Bounds are the registry's to refuse.
 */
export function withMotionAsked(s: MosaicSettings, mode: MosaicMode | undefined, parts: Partial<Motion>): MosaicSettings {
  let next = s;
  if (mode !== undefined && mode !== s.mode) {
    next = mode === 'single' || mode === 'custom' ? { ...next, mode } : { ...next, mode, motion: motionOf(mode, next.motion) };
  }
  if (Object.keys(parts).length) {
    const motion = sanitizeMotion({ ...next.motion, ...parts }, next.motion);
    next = { ...next, motion, mode: next.mode === 'single' ? 'single' : recipeOf(motion, next.mode) };
  }
  return next;
}
