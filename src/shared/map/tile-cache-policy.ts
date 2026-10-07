/**
 * The rules of the tile cache kept on this device (`tile-cache.ts`), pure:
 * when a kept tile is fresh enough to draw without asking, when a read
 * should refresh its «last used» mark, and which tiles leave first when the
 * cache is over its budget.
 *
 * Why these numbers: OpenStreetMap's tile usage policy asks a client to
 * cache tiles and not to fetch them again needlessly; a road map changes
 * slowly, and the cache exists so a piece reopened tomorrow, or exported
 * twice, costs the volunteer-run server nothing. A month keeps the ground
 * honest without re-asking every session; past it the tile is fetched
 * again — and still drawn from the kept copy if the server cannot answer:
 * an old tile beats a hole in a recorded file.
 */

/** How long a kept tile is drawn without asking the server again. */
export const TILE_FRESH_MS = 30 * 24 * 3600 * 1000;
/** A read refreshes a tile's «last used» mark at most this often — a read is not a write. */
export const TOUCH_EVERY_MS = 24 * 3600 * 1000;
/** The bytes the cache may hold on a computer, and on a constrained device. */
export const TILE_CACHE_BYTES = 256 * 1024 * 1024;
export const TILE_CACHE_BYTES_CONSTRAINED = 64 * 1024 * 1024;
/** What an eviction brings the cache down to, under its budget, so it does not run on every write. */
export const EVICT_TO = 0.85;

export interface KeptTileMeta {
  key: string;
  size: number;
  /** When it was fetched. */
  at: number;
  /** When it was last drawn from. */
  used: number;
}

export function isFresh(at: number, now: number): boolean {
  return now - at < TILE_FRESH_MS;
}

export function shouldTouch(used: number, now: number): boolean {
  return now - used >= TOUCH_EVERY_MS;
}

/**
 * The keys to delete, least recently used first, to bring `tiles` under
 * `budget` bytes — down to `EVICT_TO` of it, so the next writes have room.
 * Nothing when the cache is already within its budget.
 */
export function evictionOrder(tiles: readonly KeptTileMeta[], budget: number): string[] {
  let total = tiles.reduce((sum, t) => sum + t.size, 0);
  if (total <= budget) return [];
  const target = budget * EVICT_TO;
  const out: string[] = [];
  for (const t of [...tiles].sort((a, b) => a.used - b.used || a.at - b.at)) {
    if (total <= target) break;
    out.push(t.key);
    total -= t.size;
  }
  return out;
}
