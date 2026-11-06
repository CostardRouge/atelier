import { describe, expect, it } from 'vitest';
import { DEFAULT_WALL_RULES, type WallCandidate } from './wall-pick';
import { beforeOf, laidPicks, readWallOrder, sameOrder, wallMoved, wallRemoved, wallReplaceCandidates, wallReplaced, wallSwapped, type WallEntry } from './wall-correct';

let next = 1;
function c(day: string, over: Partial<WallCandidate> = {}): WallCandidate {
  const id = next++;
  return { id, day, folder: 1, at: id * 1000, pick: false, reject: false, stars: 0, edited: false, faces: 0, sharp: null, burst: null, screen: false, phash: null, ...over };
}

const wall: WallEntry[] = [
  [1, '2025-01-01'],
  [2, '2025-01-02'],
  [3, '2025-01-03'],
  [4, '2025-01-04'],
];
const ids = (o: readonly WallEntry[]) => o.map((e) => e[0]);

describe('the wall’s corrections', () => {
  it('✕ holds one fewer, the others in their order; nothing comes in', () => {
    expect(ids(wallRemoved(wall, 2))).toEqual([1, 3, 4]);
    expect(wallRemoved(wall, 99)).toEqual(wall);
  });

  it('⇄ puts the chosen one in the replaced one’s place, its day with it', () => {
    expect(wallReplaced(wall, 3, [9, '2024-12-31'])).toEqual([[1, '2025-01-01'], [2, '2025-01-02'], [9, '2024-12-31'], [4, '2025-01-04']]);
    // Never twice on the wall: a picture already on it leaves its own place.
    expect(ids(wallReplaced(wall, 3, [1, '2025-01-01']))).toEqual([2, 1, 4]);
    expect(wallReplaced(wall, 99, [9, '2025-01-01'])).toEqual(wall);
  });

  it('a drag onto a picture swaps the two, onto its edge moves it before or after', () => {
    expect(ids(wallSwapped(wall, 1, 4))).toEqual([4, 2, 3, 1]);
    expect(ids(wallMoved(wall, 1, beforeOf(wall, 1, 3, 'before')))).toEqual([2, 1, 3, 4]);
    expect(ids(wallMoved(wall, 1, beforeOf(wall, 1, 3, 'after')))).toEqual([2, 3, 1, 4]);
    expect(ids(wallMoved(wall, 1, beforeOf(wall, 1, 4, 'after')))).toEqual([2, 3, 4, 1]);
    // A drop where it already is changes nothing — and so freezes nothing.
    expect(sameOrder(wallMoved(wall, 2, beforeOf(wall, 2, 3, 'before')), wall)).toBe(true);
    expect(sameOrder(wallMoved(wall, 2, beforeOf(wall, 2, 1, 'after')), wall)).toBe(true);
    expect(sameOrder(wallSwapped(wall, 2, 2), wall)).toBe(true);
  });

  it('lays a frozen wall as it is, for the counting', () => {
    expect(laidPicks([[4, '2025-01-04'], [1, '2025-01-01']])).toEqual([{ id: 4, day: '2025-01-04' }, { id: 1, day: '2025-01-01' }]);
  });
});

describe('wallReplaceCandidates', () => {
  it('offers what the rules keep, off the wall, nearest in time first, then the best', () => {
    const on = c('2025-03-01', { at: 10_000 });
    const aim = c('2025-03-02', { at: 20_000 });
    const near = c('2025-03-02', { at: 20_500 });
    const nearBetter = c('2025-03-02', { at: 19_500, stars: 4 });
    const far = c('2025-03-09', { at: 90_000, pick: true });
    const reject = c('2025-03-02', { at: 20_100, reject: true });
    const screen = c('2025-03-02', { at: 20_100, screen: true });
    const gone = c('2025-03-02', { at: 20_050 });
    const order: WallEntry[] = [
      [on.id, on.day],
      [aim.id, aim.day],
    ];
    const out = wallReplaceCandidates([on, aim, near, nearBetter, far, reject, screen, gone], DEFAULT_WALL_RULES, order, [gone.id], aim.id);
    expect(out.map((x) => x.id)).toEqual([nearBetter.id, near.id, far.id]);
    // A leave-out turned off lets its pictures be offered.
    const withRejects = wallReplaceCandidates([on, aim, reject], { ...DEFAULT_WALL_RULES, leave: { reject: false } }, order, [], aim.id);
    expect(withRejects.map((x) => x.id)).toEqual([reject.id]);
  });

  it('never offers a look-alike of a picture staying, nor another frame of a burst on the wall', () => {
    const stay = c('2025-04-01', { at: 1000, phash: 0b1111n, folder: 3, burst: 7 });
    const aim = c('2025-04-01', { at: 2000 });
    const alike = c('2025-04-01', { at: 1100, phash: 0b1110n, folder: 3 });
    const sibling = c('2025-04-01', { at: 1200, burst: 7 });
    const b1 = c('2025-04-01', { at: 2100, burst: 8, stars: 1 });
    const b2 = c('2025-04-01', { at: 2200, burst: 8, stars: 3 });
    const order: WallEntry[] = [
      [stay.id, stay.day],
      [aim.id, aim.day],
    ];
    const out = wallReplaceCandidates([stay, aim, alike, sibling, b1, b2], DEFAULT_WALL_RULES, order, [], aim.id);
    expect(out.map((x) => x.id)).toEqual([b2.id]);
  });
});

describe('readWallOrder', () => {
  it('keeps well-formed entries once, up to the wall’s most', () => {
    expect(readWallOrder([[3, '2025-01-01'], [3, '2025-01-02'], [0, '2025-01-01'], [4, 'soon'], 'x', [5, '2025-01-05']], 400)).toEqual([[3, '2025-01-01'], [5, '2025-01-05']]);
    expect(readWallOrder([[1, '2025-01-01'], [2, '2025-01-02']], 1)).toEqual([[1, '2025-01-01']]);
    expect(readWallOrder('nope', 400)).toEqual([]);
  });
});
