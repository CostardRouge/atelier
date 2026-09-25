import { describe, expect, it } from 'vitest';
import {
  RAW_TILE_MARGIN,
  decodedFrame,
  halfEdge,
  isTileFlip,
  librawFlip,
  placeRect,
  planRawTiles,
  unplaceRect,
  type TileFlip,
} from './raw-tiles';

describe('LibRaw’s flip for an EXIF orientation', () => {
  it('follows dcraw’s table, and the four grid-keeping ones are the tile flips', () => {
    expect(librawFlip(1)).toBe(0);
    expect(librawFlip(3)).toBe(3);
    expect(librawFlip(6)).toBe(6);
    expect(librawFlip(8)).toBe(5);
    expect(librawFlip(null)).toBe(0);
    expect(librawFlip(0)).toBe(0);
    expect(librawFlip(9)).toBe(0);
    // The mirrors are not tiled.
    expect(librawFlip(2)).toBe(1);
    expect(librawFlip(5)).toBe(4);
    expect(isTileFlip(0) && isTileFlip(3) && isTileFlip(5) && isTileFlip(6)).toBe(true);
    expect(isTileFlip(1) || isTileFlip(4) || isTileFlip(7)).toBe(false);
  });
});

describe('where a sensor rectangle lands once LibRaw has turned the picture', () => {
  // The crop measured against the decoder on a 2400 × 1600 synthetic DNG for
  // each orientation: the placement that matched to 0 codes.
  const W = 2400;
  const H = 1600;
  const crop = { x: 600, y: 400, w: 800, h: 600 };
  it('keeps a landscape where it is, and mirrors a half turn through the centre', () => {
    expect(placeRect(crop, W, H, 0)).toEqual(crop);
    expect(placeRect(crop, W, H, 3)).toEqual({ x: W - 600 - 800, y: H - 400 - 600, w: 800, h: 600 });
  });
  it('lays a quarter turn down with the axes swapped', () => {
    expect(placeRect(crop, W, H, 6)).toEqual({ x: H - 400 - 600, y: 600, w: 600, h: 800 });
    expect(placeRect(crop, W, H, 5)).toEqual({ x: 400, y: W - 600 - 800, w: 600, h: 800 });
    expect(decodedFrame(W, H, 6)).toEqual({ width: H, height: W });
    expect(decodedFrame(W, H, 3)).toEqual({ width: W, height: H });
  });
  it('unplaceRect is the inverse of placeRect for every flip', () => {
    for (const flip of [0, 3, 5, 6] as TileFlip[]) {
      const placed = placeRect(crop, W, H, flip);
      expect(unplaceRect(placed, W, H, flip)).toEqual(crop);
      const frame = decodedFrame(W, H, flip);
      expect(placed.x + placed.w).toBeLessThanOrEqual(frame.width);
      expect(placed.y + placed.h).toBeLessThanOrEqual(frame.height);
    }
  });
});

describe('planRawTiles', () => {
  const sensor = { width: 8064, height: 4536 };

  it('answers null when the whole frame fits the budget', () => {
    expect(planRawTiles({ ...sensor, flip: 0, halved: true, factor: 1, tilePixels: 4032 * 2268 + 4032 * 16 })).toBe(null);
    expect(planRawTiles({ ...sensor, flip: 0, halved: false, factor: 1, tilePixels: 40_000_000 })).toBe(null);
  });

  it('cuts a half-size decode into full-width bands that tile the plane exactly, on the box factor’s grid', () => {
    const plan = planRawTiles({ ...sensor, flip: 0, halved: true, factor: 2, tilePixels: 4_000_000 });
    expect(plan).not.toBeNull();
    const { tiles, plane } = plan!;
    expect(plane).toEqual({ width: 4032, height: 2268 });
    expect(tiles.length).toBeGreaterThan(1);
    // Every band starts where the last one ended, on a multiple of the factor; the last ends at the plane's edge.
    let at = 0;
    for (const t of tiles) {
      expect(t.rows.from).toBe(at);
      expect(t.rows.from % 2).toBe(0);
      expect(t.rows.to).toBeGreaterThan(t.rows.from);
      at = t.rows.to;
      // The crop is inside the sensor, full width, with the margin where there is room for one.
      const [l, top, w, h] = t.crop;
      expect(l).toBe(0);
      expect(w).toBe(sensor.width);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top + h).toBeLessThanOrEqual(sensor.height);
      expect(t.size.width).toBe(4032);
      expect(t.skipX).toBe(0);
      expect(t.size.height).toBe(halfEdge(h));
      // What LibRaw hands back covers the interior plus the margins: the skip is the top margin in plane rows.
      expect(t.rows.from * 2 - t.skip * 2).toBe(top);
      // The crop's output holds at most the budget.
      expect(t.size.width * t.size.height).toBeLessThanOrEqual(4_000_000);
    }
    expect(at).toBe(2268);
    expect(tiles[0].skip).toBe(0);
    expect(tiles[1].skip).toBe(RAW_TILE_MARGIN / 2);
    // The last band's crop reaches the sensor's own bottom row.
    const last = tiles[tiles.length - 1];
    expect(last.crop[1] + last.crop[3]).toBe(sensor.height);
  });

  it('cuts a whole decode into bands whose crops overlap by the margin on each side', () => {
    const plan = planRawTiles({ ...sensor, flip: 0, halved: false, factor: 1, tilePixels: 8064 * 500 });
    const { tiles, plane } = plan!;
    expect(plane).toEqual(sensor);
    const rows = tiles.map((t) => t.rows.to - t.rows.from);
    expect(Math.max(...rows)).toBeLessThanOrEqual(500 - 2 * RAW_TILE_MARGIN);
    for (let i = 1; i < tiles.length; i += 1) {
      expect(tiles[i].crop[1]).toBe(tiles[i].rows.from - RAW_TILE_MARGIN);
      expect(tiles[i].skip).toBe(RAW_TILE_MARGIN);
      expect(tiles[i - 1].crop[1] + tiles[i - 1].crop[3]).toBe(Math.min(sensor.height, tiles[i - 1].rows.to + RAW_TILE_MARGIN));
    }
    expect(tiles[tiles.length - 1].rows.to).toBe(sensor.height);
  });

  it('a turned camera is cut from sensor COLUMNS, which the flip lays down as rows', () => {
    // A portrait: 4536 wide × 8064 tall once decoded. Bands of the decoded
    // frame are columns of the sensor.
    for (const flip of [5, 6] as TileFlip[]) {
      const plan = planRawTiles({ ...sensor, flip, halved: true, factor: 1, tilePixels: 2268 * 900 });
      const { tiles, plane } = plan!;
      expect(plane).toEqual({ width: 2268, height: 4032 });
      let at = 0;
      for (const t of tiles) {
        expect(t.rows.from).toBe(at);
        at = t.rows.to;
        const [l, top, w, h] = t.crop;
        // A column band: the full sensor height, a slice of its width.
        expect(top).toBe(0);
        expect(h).toBe(sensor.height);
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l + w).toBeLessThanOrEqual(sensor.width);
        expect(l % 2).toBe(0);
        expect(t.size).toEqual({ width: 2268, height: halfEdge(w) });
        // The crop, placed, is the band plus its margins.
        const placed = placeRect({ x: l, y: top, w, h }, sensor.width, sensor.height, flip);
        expect(placed.x).toBe(0);
        expect(placed.w).toBe(sensor.height);
        expect(placed.y).toBe(t.rows.from * 2 - t.skip * 2);
      }
      expect(at).toBe(4032);
    }
  });

  it('a half turn is cut from the sensor’s bottom up', () => {
    const plan = planRawTiles({ ...sensor, flip: 3, halved: false, factor: 1, tilePixels: 8064 * 1000 });
    const { tiles } = plan!;
    // The first band of the decoded frame is the sensor's last rows.
    const [, top, , h] = tiles[0].crop;
    expect(top + h).toBe(sensor.height);
    const last = tiles[tiles.length - 1];
    expect(last.crop[1]).toBe(0);
  });

  it('refuses a half-size cut that would straddle a quad, and an empty frame', () => {
    // An odd sensor height mirrored by a half turn: the boundaries would land on odd rows.
    expect(planRawTiles({ width: 6000, height: 4001, flip: 3, halved: true, factor: 1, tilePixels: 1_000_000 })).toBe(null);
    // Not mirrored: fine, the first boundary is row 0.
    expect(planRawTiles({ width: 6000, height: 4001, flip: 0, halved: true, factor: 1, tilePixels: 1_000_000 })).not.toBeNull();
    expect(planRawTiles({ width: 0, height: 10, flip: 0, halved: false, factor: 1, tilePixels: 10 })).toBe(null);
  });

  it('a region is one or more tiles of that rectangle alone, on the grid, with its origin said', () => {
    const plan = planRawTiles({
      ...sensor,
      flip: 0,
      halved: false,
      factor: 1,
      tilePixels: 100_000_000,
      region: { x: 1003, y: 507, w: 1990, h: 1201 },
    });
    expect(plan).not.toBeNull();
    const { tiles, plane, origin } = plan!;
    expect(tiles).toHaveLength(1);
    expect(origin).toEqual({ x: 1003, y: 507 });
    expect(plane).toEqual({ width: 1990, height: 1201 });
    const [l, top, w, h] = tiles[0].crop;
    // A region is decoded with a margin on every side: its edges are seams, not the frame's.
    expect([l, top]).toEqual([1003 - RAW_TILE_MARGIN, 507 - RAW_TILE_MARGIN]);
    expect([w, h]).toEqual([1990 + 2 * RAW_TILE_MARGIN, 1201 + 2 * RAW_TILE_MARGIN]);
    expect(tiles[0].skip).toBe(RAW_TILE_MARGIN);
    expect(tiles[0].skipX).toBe(RAW_TILE_MARGIN);
    expect(tiles[0].size).toEqual({ width: 1990 + 2 * RAW_TILE_MARGIN, height: 1201 + 2 * RAW_TILE_MARGIN });
    // A region at the frame's own edge has no margin to take there.
    const corner = planRawTiles({ ...sensor, flip: 0, halved: false, factor: 1, tilePixels: 1e9, region: { x: 0, y: 0, w: 100, h: 100 } });
    expect(corner!.tiles[0].crop).toEqual([0, 0, 100 + RAW_TILE_MARGIN, 100 + RAW_TILE_MARGIN]);
    expect(corner!.tiles[0].skipX).toBe(0);
    expect(corner!.tiles[0].skip).toBe(0);
    // Halved and boxed: the region's edges move out to the grid.
    const boxed = planRawTiles({ ...sensor, flip: 0, halved: true, factor: 2, tilePixels: 100_000_000, region: { x: 1003, y: 507, w: 1990, h: 1201 } });
    expect(boxed!.origin).toEqual({ x: 500, y: 252 });
    expect(boxed!.plane).toEqual({ width: 998, height: 602 });
    // A region off the frame is nothing.
    expect(planRawTiles({ ...sensor, flip: 0, halved: false, factor: 1, tilePixels: 1e9, region: { x: 9000, y: 0, w: 10, h: 10 } })).toBe(null);
  });

  it('a region on a turned camera is cut from the sensor through the same inverse', () => {
    const plan = planRawTiles({ ...sensor, flip: 6, halved: false, factor: 1, tilePixels: 1e9, region: { x: 100, y: 200, w: 300, h: 400 } });
    const [l, top, w, h] = plan!.tiles[0].crop;
    // Decoded x runs along the sensor's height, from its bottom.
    const m = RAW_TILE_MARGIN;
    expect(unplaceRect({ x: 100 - m, y: 200 - m, w: 300 + 2 * m, h: 400 + 2 * m }, sensor.width, sensor.height, 6)).toEqual({ x: l, y: top, w, h });
  });
});
