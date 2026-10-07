import { describe, expect, it } from 'vitest';
import { EVICT_TO, TILE_FRESH_MS, TOUCH_EVERY_MS, evictionOrder, isFresh, shouldTouch } from './tile-cache-policy';

const DAY = 24 * 3600 * 1000;

describe('the tile cache’s rules', () => {
  it('draws a kept tile without asking for a month, then asks again', () => {
    expect(isFresh(0, TILE_FRESH_MS - 1)).toBe(true);
    expect(isFresh(0, TILE_FRESH_MS)).toBe(false);
  });

  it('refreshes a tile’s last use at most once a day', () => {
    expect(shouldTouch(0, TOUCH_EVERY_MS - 1)).toBe(false);
    expect(shouldTouch(0, TOUCH_EVERY_MS)).toBe(true);
  });

  it('keeps everything within its budget', () => {
    expect(evictionOrder([{ key: 'a', size: 10, at: 0, used: 0 }], 10)).toEqual([]);
  });

  it('lets the least recently used go first, down under the budget with room', () => {
    const tiles = [
      { key: 'old', size: 40, at: 0, used: 1 * DAY },
      { key: 'new', size: 40, at: 0, used: 9 * DAY },
      { key: 'mid', size: 40, at: 0, used: 5 * DAY },
    ];
    // 120 bytes into a budget of 100: down to 85 — the oldest leaves, 80 stay.
    const out = evictionOrder(tiles, 100);
    expect(out).toEqual(['old']);
    expect(evictionOrder(tiles, 60)).toEqual(['old', 'mid']);
    const left = tiles.filter((t) => !out.includes(t.key)).reduce((s, t) => s + t.size, 0);
    expect(left).toBeLessThanOrEqual(100 * EVICT_TO);
  });
});
