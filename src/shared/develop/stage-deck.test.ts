import { describe, expect, it } from 'vitest';
import { SWEEP_COMMIT_PX, SWIPE_DISTANCE, rubberBand } from '../ui/pan-zoom';
import { deckCommit, deckOffset, deckSweep } from './stage-deck';

const travel = 824;
const both = { previous: true, next: true };
const first = { previous: false, next: true };
const last = { previous: true, next: false };
const alone = { previous: false, next: false };

describe('deckOffset', () => {
  it('follows the hand towards a picture that is there, one page at most', () => {
    expect(deckOffset(120, travel, both)).toBe(120);
    expect(deckOffset(-120, travel, both)).toBe(-120);
    expect(deckOffset(3000, travel, both)).toBe(travel);
    expect(deckOffset(-3000, travel, both)).toBe(-travel);
  });

  it('resists where the roll ends, as the lightbox does with one media', () => {
    // The first picture: dragging right reveals nothing, and rubber-bands.
    expect(deckOffset(200, travel, first)).toBe(rubberBand(200, travel));
    expect(Math.abs(deckOffset(200, travel, first))).toBeLessThan(200);
    // Dragging left from it still pages towards the next.
    expect(deckOffset(-200, travel, first)).toBe(-200);
    // The last picture, the other way round.
    expect(deckOffset(-200, travel, last)).toBe(rubberBand(-200, travel));
    expect(deckOffset(200, travel, last)).toBe(200);
    // A roll of one resists both ways.
    expect(deckOffset(200, travel, alone)).toBe(rubberBand(200, travel));
    expect(deckOffset(-200, travel, alone)).toBe(rubberBand(-200, travel));
  });

  it('is at rest with no travel or no distance', () => {
    expect(deckOffset(120, 0, both)).toBe(0);
    expect(deckOffset(0, travel, both)).toBe(0);
  });
});

describe('deckCommit', () => {
  const far = travel * SWIPE_DISTANCE + 1;

  it('pages by distance or by a flick, the lightbox rule', () => {
    expect(deckCommit(-far, travel, 0, both)).toBe(1);
    expect(deckCommit(far, travel, 0, both)).toBe(-1);
    // A flick that never crossed a quarter of the slot still pages.
    expect(deckCommit(-40, travel, -1.2, both)).toBe(1);
    // A short drag with no speed snaps back.
    expect(deckCommit(-40, travel, 0.1, both)).toBe(0);
  });

  it('never pages towards a picture that is not there', () => {
    expect(deckCommit(far, travel, 0, first)).toBe(0);
    expect(deckCommit(-far, travel, 0, first)).toBe(1);
    expect(deckCommit(-far, travel, 0, last)).toBe(0);
    expect(deckCommit(far, travel, 0, last)).toBe(-1);
    expect(deckCommit(far, travel, 2, alone)).toBe(0);
    expect(deckCommit(-far, travel, -2, alone)).toBe(0);
  });
});

describe('deckSweep', () => {
  it('pages once the sweep has travelled far enough, within the roll', () => {
    expect(deckSweep(-(SWEEP_COMMIT_PX + 1), travel, both)).toBe(1);
    expect(deckSweep(SWEEP_COMMIT_PX + 1, travel, both)).toBe(-1);
    expect(deckSweep(-20, travel, both)).toBe(0);
    expect(deckSweep(SWEEP_COMMIT_PX + 1, travel, first)).toBe(0);
    expect(deckSweep(-(SWEEP_COMMIT_PX + 1), travel, last)).toBe(0);
  });
});
