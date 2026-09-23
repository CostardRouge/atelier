import { describe, expect, it } from 'vitest';
import {
  locate,
  loopsOpenSlide,
  nextAtEnd,
  screenLength,
  snapToEdge,
  stepSlide,
  stripLayout,
  timeAtX,
  xAtTime,
  slideMotionMarks,
} from './deck-strip';
import { createCollage } from './collage';

// A hook of 5s, a still of 3s, a half-second clip, the closing card of 3s —
// at 40 px a second with a 24 px floor and 2 px between cells.
const layout = stripLayout([5, 3, 0.5, 3], 40, 24, 2);

describe('looping', () => {
  it('moves on through the piece and starts it over after the last slide', () => {
    expect(nextAtEnd(0, 4, 'piece')).toBe(1);
    expect(nextAtEnd(2, 4, 'piece')).toBe(3);
    expect(nextAtEnd(3, 4, 'piece')).toBe(0);
  });

  it('starts the open slide over when the slide loops, or when it is the whole piece', () => {
    expect(nextAtEnd(2, 4, 'slide')).toBe(2);
    expect(nextAtEnd(0, 1, 'piece')).toBe(0);
    expect(loopsOpenSlide('slide', 4)).toBe(true);
    expect(loopsOpenSlide('piece', 4)).toBe(false);
    expect(loopsOpenSlide('piece', 1)).toBe(true);
  });

  it('never points past the deck', () => {
    expect(nextAtEnd(9, 4, 'slide')).toBe(3);
    expect(nextAtEnd(0, 0, 'piece')).toBe(0);
  });
});

describe('stripLayout', () => {
  it('lays the slides end to end on one clock', () => {
    expect(layout.cells.map((c) => c.start)).toEqual([0, 5, 8, 8.5]);
    expect(layout.seconds).toBe(11.5);
  });

  it('keeps a short slide wide enough to land on', () => {
    expect(layout.cells.map((c) => c.width)).toEqual([200, 120, 24, 120]);
    expect(layout.cells.map((c) => c.left)).toEqual([0, 202, 324, 350]);
    expect(layout.width).toBe(470);
  });

  it('is empty for an empty deck', () => {
    expect(stripLayout([], 40, 24, 2)).toEqual({ cells: [], seconds: 0, width: 0 });
    expect(locate(stripLayout([], 40, 24, 2), 3)).toEqual({ index: 0, local: 0 });
  });
});

describe('locate', () => {
  it('names the slide under a moment and how far into it', () => {
    expect(locate(layout, 0)).toEqual({ index: 0, local: 0 });
    expect(locate(layout, 6)).toEqual({ index: 1, local: 1 });
    expect(locate(layout, 8.25)).toEqual({ index: 2, local: 0.25 });
  });

  it('gives a boundary to the slide that starts there', () => {
    expect(locate(layout, 5).index).toBe(1);
  });

  it('gives the end of the piece to the last slide, at its end', () => {
    expect(locate(layout, 11.5)).toEqual({ index: 3, local: 3 });
    expect(locate(layout, 99)).toEqual({ index: 3, local: 3 });
    expect(locate(layout, -1)).toEqual({ index: 0, local: 0 });
  });
});

describe('xAtTime / timeAtX', () => {
  it('is linear inside a cell', () => {
    expect(xAtTime(layout, 2.5)).toBe(100);
    expect(xAtTime(layout, 8.25)).toBe(336);
    expect(timeAtX(layout, 100)).toBe(2.5);
    expect(timeAtX(layout, 336)).toBe(8.25);
  });

  it('round-trips through the floor of a short cell', () => {
    for (const t of [0, 1.3, 5, 7.9, 8.1, 8.4, 10]) {
      expect(timeAtX(layout, xAtTime(layout, t))).toBeCloseTo(t, 9);
    }
  });

  it('reads a gap as the end of the cell before it, and clamps', () => {
    expect(timeAtX(layout, 201)).toBe(5);
    expect(timeAtX(layout, -40)).toBe(0);
    expect(timeAtX(layout, 9999)).toBe(11.5);
  });
});

describe('snapToEdge', () => {
  it('pulls a moment onto a slide edge within the tolerance', () => {
    // 5.1s is 4 px into the still.
    expect(snapToEdge(layout, 5.1, 8)).toBe(5);
    expect(snapToEdge(layout, 4.9, 8)).toBe(5);
  });

  it('leaves a moment away from every edge alone', () => {
    expect(snapToEdge(layout, 6.5, 8)).toBe(6.5);
  });
});

describe('stepSlide', () => {
  it('goes to the next slide, or the end of the piece', () => {
    expect(stepSlide(layout, 1, 1)).toBe(5);
    expect(stepSlide(layout, 9, 1)).toBe(11.5);
  });

  it('goes back to this slide, then to the one before', () => {
    expect(stepSlide(layout, 6, -1)).toBe(5);
    expect(stepSlide(layout, 5, -1)).toBe(0);
    expect(stepSlide(layout, 0, -1)).toBe(0);
  });
});

describe('screenLength', () => {
  const slide = { seconds: 5, videoTimeSeconds: 1, speed: 1 };

  it('holds the stored seconds when nothing caps them', () => {
    expect(screenLength(slide, 0)).toBe(5);
    expect(screenLength(slide, 20)).toBe(5);
  });

  it('caps a clip to what is left after its in point', () => {
    expect(screenLength(slide, 3)).toBe(2);
    expect(screenLength({ ...slide, speed: 2 }, 3)).toBe(1);
  });
});

describe('slideMotionMarks', () => {
  const m = (at: number) => ({ keys: [{ at, scale: 2, x: 0, y: 0 }], easing: 'linear' as const, start: 'slide' as const });

  it('marks the lead\'s frames and its rest', () => {
    expect(slideMotionMarks({ motion: m(0), collage: null }, 4)).toEqual([0, 4]);
    expect(slideMotionMarks({ motion: null, collage: null }, 4)).toEqual([]);
  });

  it('merges a drawn cell\'s frames and leaves a kept cell out', () => {
    const collage = createCollage('stack-2')!;
    const cells = [{ ...collage.cells[0], motion: m(0.5) }, { ...collage.cells[0], motion: m(0.25) }];
    const marks = slideMotionMarks({ motion: m(0), collage: { ...collage, cells } }, 4);
    // Cell 3 is past the two-row template: kept, not drawn, not marked.
    expect(marks).toEqual([0, 2, 4]);
  });

  it('waits for the opener when the motion does', () => {
    expect(slideMotionMarks({ motion: { ...m(0), start: 'after-opener' }, collage: null }, 5, 1)).toEqual([1, 5]);
  });
});
