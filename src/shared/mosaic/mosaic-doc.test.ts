import { describe, expect, it } from 'vitest';
import { GRID_BYTES, encodeGrid, oklabOf } from './measure';
import { RECIPE_MOTIONS } from './motion';
import {
  DEFAULT_EXPORT,
  DEFAULT_SETTINGS,
  MAX_MOSAIC_TILES,
  MOSAIC_DOC_VERSION,
  QUEUE_AHEAD,
  QUEUE_REFILL_AT,
  chainAdvanced,
  chainOf,
  createMosaicDoc,
  measuredTiles,
  queueInsert,
  queueRemove,
  queueSet,
  queueShuffle,
  readMosaicDoc,
  readTiles,
  refillQueue,
  sanitizeSettings,
  unionSpan,
  withChainDraw,
  withCrop,
  withMeasures,
  withPictures,
  withTarget,
  withTiles,
  withoutTiles,
  type MosaicDoc,
  type MosaicTile,
} from './mosaic-doc';

const grid = encodeGrid(new Uint8Array(GRID_BYTES).fill(77));

/** A library of `n` measured pictures, each one flat colour so a draw can tell them apart. */
function library(n: number): MosaicTile[] {
  return Array.from({ length: n }, (_, i) => {
    const g = new Uint8Array(GRID_BYTES);
    for (let c = 0; c < 36; c++) {
      g[c * 3] = (i * 37) % 256;
      g[c * 3 + 1] = (i * 91) % 256;
      g[c * 3 + 2] = (i * 151) % 256;
    }
    return { id: 100 + i, kind: 'photo', grid: encodeGrid(g) };
  });
}

function withChainLibrary(n: number, target = 100): { doc: MosaicDoc; lab: Float32Array; measured: MosaicTile[] } {
  const doc = { ...withTiles(createMosaicDoc('m', 's', 1), library(n), 2), target };
  const { tiles, grids } = measuredTiles(doc);
  return { doc, lab: oklabOf(grids, tiles.length), measured: tiles };
}

describe('the chain’s queue', () => {
  it('fills from the seed to QUEUE_AHEAD, the same way twice, never twice the same picture in a row', () => {
    const { doc, lab, measured } = withChainLibrary(40);
    const a = refillQueue(doc, lab, measured, 0, 3);
    expect(chainOf(a).queue.length).toBe(QUEUE_AHEAD);
    expect(chainOf(a).queue.every((e) => e.by === 'draw')).toBe(true);
    const ids = [doc.target, ...chainOf(a).queue.map((e) => e.id)];
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
    expect(chainOf(refillQueue(doc, lab, measured, 0, 9)).queue).toEqual(chainOf(a).queue);
    // Enough ahead: the same object back.
    expect(refillQueue(a, lab, measured, 0)).toBe(a);
    // Played past the refill mark: filled again, the played entries kept.
    const b = refillQueue(a, lab, measured, QUEUE_AHEAD - QUEUE_REFILL_AT + 1, 4);
    expect(chainOf(b).queue.length).toBe(QUEUE_AHEAD + QUEUE_AHEAD - QUEUE_REFILL_AT + 1);
    expect(chainOf(b).queue.slice(0, QUEUE_AHEAD)).toEqual(chainOf(a).queue);
  });

  it('does not fill with draw off, without a target, or alone in the library', () => {
    const { doc, lab, measured } = withChainLibrary(40);
    expect(refillQueue(withChainDraw(doc, false), lab, measured)).toEqual(expect.objectContaining({ chain: { queue: [], draw: false } }));
    expect(refillQueue({ ...doc, target: undefined }, lab, measured)).toEqual({ ...doc, target: undefined });
    const one = withChainLibrary(1);
    expect(refillQueue(one.doc, one.lab, one.measured)).toBe(one.doc);
  });

  it('sets, inserts, removes and shuffles — the picks stay, the drawn go, the seed turns', () => {
    const { doc, lab, measured } = withChainLibrary(40);
    const a = refillQueue(doc, lab, measured);
    const b = queueSet(a, 2, 130, 'pick', 5);
    expect(chainOf(b).queue[2]).toEqual({ id: 130, by: 'pick' });
    expect(queueSet(b, 2, 999)).toBe(b);
    const c = queueInsert(b, chainOf(b).queue.length, 131, 6);
    expect(chainOf(c).queue[chainOf(c).queue.length - 1]).toEqual({ id: 131, by: 'pick' });
    const d = queueRemove(c, 0, 7);
    expect(chainOf(d).queue.length).toBe(chainOf(c).queue.length - 1);
    expect(queueRemove(d, 99)).toBe(d);
    const e = queueShuffle(d, 8);
    expect(chainOf(e).queue.map((x) => x.id)).toEqual([130, 131]);
    expect(e.settings.seed).not.toBe(d.settings.seed);
    expect(chainOf(refillQueue(e, lab, measured)).queue.slice(0, 2).map((x) => x.id)).toEqual([130, 131]);
  });

  it('a run ended: the picture seen is the target, the steps played leave the queue, a head already seen too', () => {
    const { doc, lab, measured } = withChainLibrary(40);
    const a = refillQueue(doc, lab, measured);
    const q = chainOf(a).queue;
    const b = chainAdvanced(a, 3, q[2].id, 9);
    expect(b.target).toBe(q[2].id);
    expect(chainOf(b).queue).toEqual(q.slice(3));
    // A pull-back stopped in its hold: `current` is the head not yet counted done.
    const c = chainAdvanced(a, 2, q[2].id, 10);
    expect(c.target).toBe(q[2].id);
    expect(chainOf(c).queue).toEqual(q.slice(3));
    expect(chainAdvanced(a, 0, a.target as number)).toBe(a);
  });

  it('a new target drops the drawn entries and keeps the picks; a removed picture leaves the queue; the file reads v1 and v2', () => {
    const { doc, lab, measured } = withChainLibrary(40);
    const a = queueSet(refillQueue(doc, lab, measured), 4, 120);
    const b = withTarget(a, 101);
    expect(chainOf(b).queue).toEqual([{ id: 120, by: 'pick' }]);
    expect(chainOf(withoutTiles(a, [120])).queue.some((e) => e.id === 120)).toBe(false);
    const read = readMosaicDoc(JSON.parse(JSON.stringify(a)), 's')!;
    expect(read.chain).toEqual(a.chain);
    expect(readMosaicDoc({ ...JSON.parse(JSON.stringify(doc)), version: 1 }, 's')!.chain).toBeUndefined();
    // A queue of pictures the library has not got, or malformed, reads as none.
    expect(readMosaicDoc({ ...a, chain: { queue: [{ id: 5 }, 'x', { id: 101, by: 'pick' }], draw: true } }, 's')!.chain).toEqual({ queue: [{ id: 101, by: 'pick' }], draw: true });
  });
});

describe('sanitizeSettings', () => {
  it('gives the defaults for nothing and bounds every number', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ aspect: '2:1', cellPx: 2, level: 9, space: 'lab', tint: 3, speed: 0.01, seed: -4, mode: 'spiral', direction: 'up', distinctNeighbours: 'yes' });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, cellPx: 12, level: 3, tint: 0.7, speed: 0.4, seed: 1 });
    expect(s.aspect).toBe('original');
  });

  it('keeps a valid setting as given', () => {
    const s = sanitizeSettings({ aspect: '1:1', cellPx: 64, level: 1, space: 'rgb', tint: 0, distinctNeighbours: false, mode: 'chain', direction: 'alternate', speed: 2, seed: 42 });
    // A v2 body: its chain direction becomes the recipe's departure.
    expect(s).toEqual({ aspect: '1:1', cellPx: 64, level: 1, space: 'rgb', tint: 0, distinctNeighbours: false, mode: 'chain', motion: { ...RECIPE_MOTIONS.chain, depart: 'alternate' }, speed: 2, seed: 42, export: DEFAULT_EXPORT });
    // An export's settings: kept when valid, bounded otherwise.
    expect(sanitizeSettings({ export: { short: 2160, cells: 'screen', steps: 12 } }).export).toEqual({ short: 2160, cells: 'screen', steps: 12 });
    expect(sanitizeSettings({ export: { short: 999, cells: 'x', steps: 400 } }).export).toEqual({ short: 1080, cells: 'pixels', steps: 40 });
    // A v3 body: the motion as stored, bounded; a recipe's name with no motion gives that recipe.
    expect(sanitizeSettings({ mode: 'wave', motion: { ...RECIPE_MOTIONS.wave, holdMs: 99999 } }).motion).toEqual({ ...RECIPE_MOTIONS.wave, holdMs: 8000 });
    expect(sanitizeSettings({ mode: 'reveal' }).motion).toEqual(RECIPE_MOTIONS.reveal);
    // A custom motion fills its missing parts from the default recipe (mosaics, lab 3's default).
    expect(sanitizeSettings({ mode: 'custom', motion: { depart: 'cut' } }).motion).toEqual({ ...RECIPE_MOTIONS.mosaics, depart: 'cut' });
    expect(sanitizeSettings({}).motion).toEqual(RECIPE_MOTIONS.mosaics);
  });
});

describe('readTiles', () => {
  it('drops a malformed tile, keeps one per asset, keeps a grid only when it decodes', () => {
    const tiles = readTiles([
      { id: 1, kind: 'photo', grid },
      { id: 1, kind: 'clip' },
      { id: 2, kind: 'clip', grid: 'not a grid', hash: 'abc' },
      { id: -1, kind: 'photo' },
      { id: 'x', kind: 'photo' },
      { id: 3, kind: 'whatever', failed: true },
      { id: 4, grid, failed: true },
      null,
    ]);
    expect(tiles).toEqual([
      { id: 1, kind: 'photo', grid },
      { id: 2, kind: 'clip', hash: 'abc' },
      { id: 3, kind: 'photo', failed: true },
      { id: 4, kind: 'photo', grid },
    ]);
  });

  it('is bounded', () => {
    const many = Array.from({ length: MAX_MOSAIC_TILES + 5 }, (_, i) => ({ id: i, kind: 'photo' }));
    expect(readTiles(many).length).toBe(MAX_MOSAIC_TILES);
  });
});

describe('readMosaicDoc', () => {
  it('refuses what is not a mosaic, and a newer version', () => {
    expect(readMosaicDoc(null, 's')).toBeNull();
    expect(readMosaicDoc([], 's')).toBeNull();
    expect(readMosaicDoc({ title: 'no id' }, 's')).toBeNull();
    expect(readMosaicDoc({ id: 'm', version: MOSAIC_DOC_VERSION + 1 }, 's')).toBeNull();
  });

  it('reads a sparse body with defaults and the fallback source', () => {
    const doc = readMosaicDoc({ id: 'm' }, 'src-1', 1000)!;
    expect(doc).toEqual({
      id: 'm',
      version: MOSAIC_DOC_VERSION,
      title: 'Mosaic',
      sourceId: 'src-1',
      tiles: [],
      settings: DEFAULT_SETTINGS,
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it('keeps the target only where the library holds it, and a span only when it is one', () => {
    const base = { id: 'm', tiles: [{ id: 7, kind: 'photo', grid }], span: { from: '2026-01-01', to: '2026-02-01' } };
    expect(readMosaicDoc({ ...base, target: 7 }, 's')!.target).toBe(7);
    expect(readMosaicDoc({ ...base, target: 8 }, 's')!.target).toBeUndefined();
    expect(readMosaicDoc(base, 's')!.span).toEqual({ from: '2026-01-01', to: '2026-02-01' });
    expect(readMosaicDoc({ ...base, span: { from: '2026-02-01', to: '2026-01-01' } }, 's')!.span).toBeUndefined();
    expect(readMosaicDoc({ ...base, span: { from: 'yesterday', to: '2026-01-01' } }, 's')!.span).toBeUndefined();
  });

  it('round-trips what createMosaicDoc makes', () => {
    const doc = createMosaicDoc('  Sydney   2025 ', 'src-9', 5000);
    expect(doc.title).toBe('Sydney 2025');
    expect(doc.settings.seed).toBeGreaterThan(0);
    const back = readMosaicDoc(JSON.parse(JSON.stringify(doc)), 'other');
    expect(back).toEqual(doc);
  });
});

describe('withTiles / withoutTiles / withMeasures', () => {
  const doc = createMosaicDoc('m', 's', 1);

  it('adds only what is new and returns the same object when nothing is', () => {
    const a = withTiles(doc, [{ id: 1, kind: 'photo' }, { id: 2, kind: 'clip' }], 2);
    expect(a.tiles.map((t) => t.id)).toEqual([1, 2]);
    expect(a.updatedAt).toBe(2);
    const b = withTiles(a, [{ id: 2, kind: 'photo' }, { id: 1, kind: 'photo' }], 3);
    expect(b).toBe(a);
    const c = withTiles(a, [{ id: 3, kind: 'photo' }, { id: 3, kind: 'photo' }], 4);
    expect(c.tiles.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it('removes tiles and a target among them', () => {
    const a = { ...withTiles(doc, [{ id: 1, kind: 'photo' }, { id: 2, kind: 'photo' }], 2), target: 2 };
    expect(withoutTiles(a, [9], 3)).toBe(a);
    const b = withoutTiles(a, [2], 3);
    expect(b.tiles.map((t) => t.id)).toEqual([1]);
    expect(b.target).toBeUndefined();
    expect(withoutTiles(a, [1], 3).target).toBe(2);
  });

  it('writes grids and failures onto the tiles, a grid clearing a failure', () => {
    const a = withTiles(doc, [{ id: 1, kind: 'photo' }, { id: 2, kind: 'photo' }, { id: 3, kind: 'photo' }], 2);
    const b = withMeasures(a, new Map([[1, grid]]), [2], 3);
    expect(b.tiles).toEqual([
      { id: 1, kind: 'photo', grid },
      { id: 2, kind: 'photo', failed: true },
      { id: 3, kind: 'photo' },
    ]);
    expect(withMeasures(b, new Map([[1, grid]]), [2], 4)).toBe(b);
    const c = withMeasures(b, new Map([[2, grid]]), [], 5);
    expect(c.tiles[1]).toEqual({ id: 2, kind: 'photo', grid });
    expect(withMeasures(c, new Map(), [1], 6)).toBe(c);
  });

  it('withPictures sets the instance once, grows the span, and refuses another instance', () => {
    const a = withPictures(doc, [{ id: 1, kind: 'photo' }], 'winnow.one', { from: '2026-01-05', to: '2026-01-09' }, 2);
    expect(a.instance).toBe('winnow.one');
    expect(a.span).toEqual({ from: '2026-01-05', to: '2026-01-09' });
    const b = withPictures(a, [{ id: 2, kind: 'clip' }], 'winnow.one', { from: '2025-12-30', to: '2026-01-06' }, 3);
    expect(b.tiles.map((t) => t.id)).toEqual([1, 2]);
    expect(b.span).toEqual({ from: '2025-12-30', to: '2026-01-09' });
    expect(withPictures(b, [{ id: 3, kind: 'photo' }], 'winnow.two', undefined, 4)).toBe(b);
    expect(withPictures(b, [{ id: 2, kind: 'photo' }], 'winnow.one', undefined, 5)).toBe(b);
    expect(readMosaicDoc(JSON.parse(JSON.stringify(b)), 's')).toEqual(b);
    expect(readMosaicDoc({ ...b, instance: 42 }, 's')!.instance).toBeUndefined();
    expect(unionSpan(undefined, undefined)).toBeUndefined();
  });

  it('a crop belongs to its target: kept when read with it, dropped by a new target, the whole frame stored as none', () => {
    const a = { ...withTiles(doc, [{ id: 1, kind: 'photo', grid }, { id: 2, kind: 'photo', grid }], 2), target: 1 };
    const b = withCrop(a, { cx: 0.5, cy: 0.5, scale: 0.4 }, 3);
    expect(b.crop).toEqual({ cx: 0.5, cy: 0.5, scale: 0.4 });
    expect(withCrop(b, { cx: 0.5, cy: 0.5, scale: 0.4 }, 4)).toBe(b);
    expect(withCrop(b, { cx: 0.5, cy: 0.5, scale: 1 }, 5).crop).toBeUndefined();
    expect(readMosaicDoc(JSON.parse(JSON.stringify(b)), 's')!.crop).toEqual(b.crop);
    expect(readMosaicDoc({ ...b, target: undefined }, 's')!.crop).toBeUndefined();
    const c = withTarget(b, 2, 6);
    expect(c.target).toBe(2);
    expect(c.crop).toBeUndefined();
    expect(withTarget(c, 2, 7)).toBe(c);
    expect(withoutTiles(b, [1], 8).crop).toBeUndefined();
  });

  it('measuredTiles lists the tiles with a grid and packs their bytes', () => {
    const a = withMeasures(withTiles(doc, [{ id: 1, kind: 'photo' }, { id: 2, kind: 'photo' }], 2), new Map([[2, grid]]));
    const { tiles, grids } = measuredTiles(a);
    expect(tiles.map((t) => t.id)).toEqual([2]);
    expect(grids.length).toBe(GRID_BYTES);
    expect(grids[0]).toBe(77);
  });
});
