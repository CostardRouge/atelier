import { describe, expect, it } from 'vitest';
import { curateStory, distance, orderStory, quality, type StoryItem } from './story';

const T0 = Date.UTC(2026, 0, 1, 6, 0, 0);
const H = 60 * 60_000;
const item = (id: number, over: Partial<StoryItem> = {}): StoryItem => ({
  id,
  at: T0 + id * H,
  hash: '0000000000000000',
  sharpness: 0.01,
  light: 'day',
  faces: 0,
  gear: 'camera',
  orientation: 'landscape',
  colour: 'blue',
  hue: 220,
  focal: 35,
  verdict: 'unrated',
  stars: 0,
  ...over,
});

describe('quality and distance', () => {
  it('scores Winnow’s liking, the sharpness rank and the asked shape', () => {
    expect(quality(item(1), 0.5)).toBeCloseTo(0.1);
    expect(quality(item(1, { verdict: 'pick', stars: 4 }), 1, 'landscape')).toBeCloseTo(1);
    expect(quality(item(1, { orientation: 'portrait' }), 0, 'landscape')).toBe(0);
  });
  it('reads two frames of one burst as near, and a different moment as far', () => {
    const a = item(1);
    expect(distance(a, item(1, { at: a.at! + 1000 }))).toBeLessThan(0.05);
    const far = item(9, { hash: 'ffffffffffffffff', light: 'golden', gear: 'drone', faces: 2, colour: 'orange', orientation: 'portrait' });
    expect(distance(a, far)).toBeGreaterThan(0.95);
  });
});

describe('curateStory', () => {
  it('picks the strongest first, then spreads over the day and the looks, in shooting order', () => {
    const items = [
      item(1, { hash: 'ff00ff00ff00ff00' }),
      item(2, { verdict: 'pick', stars: 4, hash: 'ff00ff00ff00ff00' }), // the same look as 1, liked
      item(3, { at: T0 + 2 * H + 1000, hash: 'ff00ff00ff00ff00' }), // 2's burst twin
      item(8, { hash: '0f0f0f0f0f0f0f0f', light: 'golden', gear: 'drone' }),
      item(12, { hash: '00ff00ff00ff00ff', faces: 2 }),
      item(13, { verdict: 'reject', stars: 5 }),
    ];
    const { picks, leftOut } = curateStory(items, { count: 3 });
    expect(picks.map((p) => p.id)).toEqual([2, 8, 12]);
    expect(picks[0].reason).toContain('pick ★4');
    expect(picks[0].reason).toContain('the strongest frame');
    expect(picks[1].reason).toContain('golden hour · drone');
    expect(picks[2].reason).toContain('2 people');
    expect(leftOut).toBe(3);
  });

  it('never picks a reject, asks no more than there are, and favours the asked shape', () => {
    expect(curateStory([item(1, { verdict: 'reject' })], { count: 3 }).picks).toEqual([]);
    expect(curateStory([item(1), item(2)], { count: 5 }).picks).toHaveLength(2);
    const { picks } = curateStory([item(1), item(2, { orientation: 'portrait', hash: 'ffffffffffffffff' })], { count: 1, orientation: 'portrait' });
    expect(picks[0].id).toBe(2);
  });

  it('covers the stretches of the span before repeating one', () => {
    // Four frames at 06:00, two liked ones at 06:05 and 06:10, one lone frame at 18:00.
    const items = [item(1, { at: T0 }), item(2, { at: T0 + 5 * 60_000, stars: 3 }), item(3, { at: T0 + 10 * 60_000, stars: 3 }), item(4, { at: T0 + 12 * H, hash: 'ffffffffffffffff' })];
    const { picks } = curateStory(items, { count: 2 });
    expect(picks.map((p) => p.id)).toEqual([2, 4]);
  });
});

describe('orderStory', () => {
  const items = [item(3, { hue: 10 }), item(1, { hue: 200, focal: 70 }), item(2, { hue: 350, focal: 24 }), item(4, { hue: null, focal: null })];
  it('orders by time, by a colour walk, by focal length', () => {
    expect(orderStory(items, 'time')).toEqual([1, 2, 3, 4]);
    expect(orderStory(items, 'colour')).toEqual([1, 2, 3, 4]);
    expect(orderStory([item(1, { hue: 100 }), item(2, { hue: 300 }), item(3, { hue: 120 })], 'colour')).toEqual([1, 3, 2]);
    expect(orderStory(items, 'focal')).toEqual([2, 3, 1, 4]);
  });
});
