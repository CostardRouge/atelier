import { describe, expect, it } from 'vitest';
import type { WinnowAssetRow } from '../sources/winnow/client';
import { candidateOf, DEFAULT_WALL_RULES, pickWall, rankBy, readWallRules, type WallCandidate } from './wall-pick';

let next = 1;
function c(day: string, over: Partial<WallCandidate> = {}): WallCandidate {
  const id = next++;
  return { id, day, folder: 1, at: id * 1000, fav: false, pick: false, reject: false, stars: 0, edited: false, faces: 0, sharp: null, burst: null, screen: false, phash: null, ...over };
}

describe('pickWall', () => {
  it('gives every day one, the best by the rules in their order', () => {
    const a1 = c('2025-01-01');
    const a2 = c('2025-01-01', { stars: 4 });
    const a3 = c('2025-01-01', { pick: true });
    const b1 = c('2025-01-02', { stars: 2 });
    const out = pickWall([a1, a2, a3, b1], DEFAULT_WALL_RULES, 2);
    expect(out.picks.map((p) => p.id)).toEqual([a3.id, b1.id]);
    expect(out.picks[0].why).toMatch(/the best of 3 that day — picked in Winnow/);
    // Stars first, then Picked: the starred one wins.
    const starsFirst = pickWall([a1, a2, a3, b1], { ...DEFAULT_WALL_RULES, prefer: ['stars', 'pick'] }, 2);
    expect(starsFirst.picks.map((p) => p.id)).toEqual([a2.id, b1.id]);
  });

  it('leaves out rejects, screens, all but a burst’s best and look-alikes — each counted', () => {
    const keep = c('2025-02-01', { stars: 3, phash: 0b1111n });
    const reject = c('2025-02-01', { reject: true, stars: 5 });
    const screen = c('2025-02-01', { screen: true, stars: 5 });
    const b1 = c('2025-02-01', { burst: 9, stars: 1 });
    const b2 = c('2025-02-01', { burst: 9, stars: 2 });
    const alike = c('2025-02-01', { stars: 2, phash: 0b1110n, at: keep.at + 60 });
    const out = pickWall([keep, reject, screen, b1, b2, alike], DEFAULT_WALL_RULES, 10);
    expect(out.picks.map((p) => p.id).sort()).toEqual([keep.id, b2.id].sort());
    expect(out.left).toEqual({ reject: 1, screen: 1, burst: 1, alike: 1 });
    // A rule turned off lets them back.
    const all = pickWall([keep, reject], { ...DEFAULT_WALL_RULES, leave: { reject: false } }, 10);
    expect(all.picks).toHaveLength(2);
  });

  it('spreads more places to a busy day, at most three times a quiet one', () => {
    const quiet = ['2025-03-01', '2025-03-02', '2025-03-03'].flatMap((d) => [c(d), c(d)]);
    const busy = Array.from({ length: 30 }, () => c('2025-03-04'));
    const out = pickWall([...quiet, ...busy], DEFAULT_WALL_RULES, 9);
    const onBusy = out.picks.filter((p) => p.day === '2025-03-04').length;
    expect(out.picks).toHaveLength(9);
    expect(onBusy).toBeGreaterThan(2);
    const even = pickWall([...quiet, ...busy], { ...DEFAULT_WALL_RULES, share: 'even' }, 8);
    expect(even.picks.filter((p) => p.day === '2025-03-04').length).toBe(2);
  });

  it('keeps his pins whatever the rules, and never brings back what he removed', () => {
    const a = c('2025-04-01', { stars: 5 });
    const b = c('2025-04-01', { stars: 1 });
    const d = c('2025-04-02', { reject: true });
    const out = pickWall([a, b, d], DEFAULT_WALL_RULES, 2, { pins: [d.id], removed: [a.id] });
    expect(out.picks.map((p) => p.id).sort()).toEqual([b.id, d.id].sort());
    expect(out.picks.find((p) => p.id === d.id)?.pinned).toBe(true);
    // More places: the pin is still there, the removed one still out.
    const more = pickWall([a, b, d], DEFAULT_WALL_RULES, 10, { pins: [d.id], removed: [a.id] });
    expect(more.picks.map((p) => p.id)).not.toContain(a.id);
    expect(more.picks.map((p) => p.id)).toContain(d.id);
  });

  it('spreads across folders or weeks too', () => {
    const f1 = [c('2025-05-01', { folder: 1 }), c('2025-05-02', { folder: 1 })];
    const f2 = [c('2025-05-03', { folder: 2 })];
    const out = pickWall([...f1, ...f2], { ...DEFAULT_WALL_RULES, unit: 'folder', share: 'even' }, 2);
    expect(out.groups).toBe(2);
    expect(out.picks.map((p) => p.id)).toEqual([f1[0].id, f2[0].id]);
  });
});

describe('rankBy', () => {
  it('lets a rule without the fact pass its turn', () => {
    const a = c('2025-06-01', { sharp: null, stars: 2 });
    const b = c('2025-06-01', { sharp: 0.9, stars: 1 });
    expect([a, b].sort(rankBy(['sharp', 'stars']))[0].id).toBe(a.id);
  });
});

describe('candidateOf and readWallRules', () => {
  it('reads what the rules need from a Winnow row', () => {
    const row = { id: 7, verdict: 'pick', star: 3, session_id: 4, captured_at: '2025-01-01T10:00:00Z', ext: 'jpg', camera_model: 'ILCE-7CM2', burst_id: 2, edit_count: 1, face_count: 2, sharpness: 0.4, phash: '255' } as unknown as WinnowAssetRow;
    const cand = candidateOf(row, '2025-01-01');
    expect(cand).toMatchObject({ id: 7, pick: true, stars: 3, folder: 4, edited: true, faces: 2, sharp: 0.4, burst: 2, screen: false, phash: 255n });
    expect(candidateOf({ ...row, camera_model: null, ext: 'png' } as WinnowAssetRow, '2025-01-01').screen).toBe(true);
  });
  it('keeps the rules field by field', () => {
    // A list kept before Winnow's ♥ existed gets it first; one where he turned it off keeps it off.
    expect(readWallRules({ unit: 'week', share: 'even', leave: { burst: false }, prefer: ['stars', 'nope', 'stars'] })).toEqual({ unit: 'week', share: 'even', leave: { burst: false }, prefer: ['fav', 'stars'] });
    expect(readWallRules({ prefer: ['stars'], favOff: true })).toMatchObject({ prefer: ['stars'], favOff: true });
    expect(readWallRules('x')).toBeUndefined();
  });
});
