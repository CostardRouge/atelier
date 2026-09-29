import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from '../develop/develop';
import { createCollage } from './collage';
import type { DeckSlide } from './deck';
import { freezeLooks } from './frozen-looks';

const slide = (position: number, over: Partial<DeckSlide> = {}): DeckSlide =>
  ({ kind: 'content', position, media: null, framing: {}, develop: null, motion: null, collage: null, ...over }) as unknown as DeckSlide;

describe('freezeLooks', () => {
  it('answers from the looks as they were when it was taken, not as they are now', () => {
    let look = 'warm';
    const live = (s: DeckSlide) => `${look}:${s.position}`;
    const frozen = freezeLooks([slide(0), slide(1)], live, () => null);
    look = 'cold'; // the author nudges the look while the run goes on
    expect(frozen.lutFor(slide(1))).toBe('warm:1');
    // A question nobody foresaw is answered live rather than left without a look.
    expect(frozen.lutFor(slide(7))).toBe('cold:7');
  });

  it('takes a collage cell with its own develop, the way the renderers ask', () => {
    const collage = createCollage('grid-2x2')!;
    const cellDevelop = { ...DEFAULT_DEVELOP, exposure: 1 };
    collage.cells[0] = { ...collage.cells[0], develop: cellDevelop };
    const lead = slide(2, { collage });
    let calls = 0;
    let look = 'a';
    const frozen = freezeLooks(
      [lead],
      (s) => {
        calls += 1;
        return `${look}:${s.develop?.exposure ?? 'none'}`;
      },
      (s) => `film:${s.position}`,
    );
    look = 'b';
    expect(frozen.lutFor({ ...lead, develop: cellDevelop })).toBe('a:1');
    expect(frozen.lutFor(lead)).toBe('a:none');
    expect(frozen.filmFor(lead)).toBe('film:2');
    // Asked once per distinct (slide, develop), up front.
    const asked = calls;
    frozen.lutFor(lead);
    expect(calls).toBe(asked);
  });
});
