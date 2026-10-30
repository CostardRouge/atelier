import { describe, expect, it } from 'vitest';
import { OV } from './charte';
import { INTRO_LEN, OUTRO_LEN, slotAlpha, slotsOf, totalSeconds, type Episode } from './episode';

const ep: Episode = {
  id: 'x',
  number: 'EP.00',
  title: 'T',
  season: 1,
  next: { number: 'EP.01', title: 'U' },
  closing: { series: '', handle: '', ask: '' },
  blocks: [{ block: 'wall', len: 4 }],
};

describe('slotsOf', () => {
  it('opens, plays the blocks, then ends on the next post', () => {
    const slots = slotsOf(ep);
    expect(slots.map((s) => s.block)).toEqual(['intro', 'wall', 'recap']);
    expect(slots[1]).toMatchObject({ a: INTRO_LEN, b: INTRO_LEN + 4, start: INTRO_LEN - OV });
    expect(totalSeconds(ep)).toBeCloseTo(INTRO_LEN + 4 + OUTRO_LEN);
  });

  it('ends on the season card when there is no next post', () => {
    const slots = slotsOf({ ...ep, next: null });
    expect(slots[slots.length - 1].block).toBe('recap-carte');
  });
});

describe('slotAlpha', () => {
  const slots = slotsOf(ep);
  it('shows the first slot at once and hands over through black', () => {
    expect(slotAlpha(slots, 0, 0)).toBe(1);
    const handover = slots[1].start;
    // A out over the first half of the overlap, B in over the second: never both at full.
    expect(slotAlpha(slots, 0, handover + OV / 4)).toBeCloseTo(0.5);
    expect(slotAlpha(slots, 1, handover + OV / 4)).toBe(0);
    expect(slotAlpha(slots, 0, handover + OV * 0.75)).toBe(0);
    expect(slotAlpha(slots, 1, handover + OV * 0.75)).toBeCloseTo(0.5);
    expect(slotAlpha(slots, 1, handover + OV)).toBeCloseTo(1);
  });

  it('is zero outside a slot', () => {
    expect(slotAlpha(slots, 1, 0)).toBe(0);
    expect(slotAlpha(slots, 2, totalSeconds(ep) + 1)).toBe(0);
  });
});
