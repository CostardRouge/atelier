import { describe, expect, it } from 'vitest';
import { GRID_BYTES, encodeGrid } from './measure';
import {
  DEFAULT_SETTINGS,
  MAX_MOSAIC_TILES,
  MOSAIC_DOC_VERSION,
  createMosaicDoc,
  measuredTiles,
  readMosaicDoc,
  readTiles,
  sanitizeSettings,
  unionSpan,
  withCrop,
  withMeasures,
  withPictures,
  withTarget,
  withTiles,
  withoutTiles,
} from './mosaic-doc';

const grid = encodeGrid(new Uint8Array(GRID_BYTES).fill(77));

describe('sanitizeSettings', () => {
  it('gives the defaults for nothing and bounds every number', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ aspect: '2:1', cellPx: 2, level: 9, space: 'lab', tint: 3, speed: 0.01, seed: -4, mode: 'spiral', direction: 'up', distinctNeighbours: 'yes' });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, cellPx: 12, level: 3, tint: 0.7, speed: 0.4, seed: 1 });
    expect(s.aspect).toBe('original');
  });

  it('keeps a valid setting as given', () => {
    const s = sanitizeSettings({ aspect: '1:1', cellPx: 64, level: 1, space: 'rgb', tint: 0, distinctNeighbours: false, mode: 'chain', direction: 'alternate', speed: 2, seed: 42 });
    expect(s).toEqual({ aspect: '1:1', cellPx: 64, level: 1, space: 'rgb', tint: 0, distinctNeighbours: false, mode: 'chain', direction: 'alternate', speed: 2, seed: 42 });
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
