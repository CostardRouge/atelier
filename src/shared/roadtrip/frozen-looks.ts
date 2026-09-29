import { collageCellAt, collageCellCount } from './collage';
import type { DeckSlide } from './deck';

/**
 * A piece's looks TAKEN AT THE CLICK that starts an export (L2 of the
 * 2026-09-29 Trips lab, and its precondition): the export reads each slide's
 * cube and film through `lutFor` / `filmFor`, and those answer from the grade
 * stack as it is NOW — so a look nudged while a reel was encoding reached the
 * slides not yet rendered, and a file carried a look nobody pressed Export
 * on. Every answer the run can ask for is asked once, up front: each slide,
 * and each cell of a collage with that cell's own develop.
 *
 * Keyed by the slide's position and the develop the renderer passes, which is
 * exactly how the renderers call it (`{ ...slide, develop: cell.develop }` for
 * a cell). A question nobody foresaw falls back to the live answer rather
 * than to no look at all.
 *
 * Pure: the two lookups are handed in.
 */
export function freezeLooks<L, F>(
  slides: readonly DeckSlide[],
  lutFor: (slide: DeckSlide) => L,
  filmFor: (slide: DeckSlide) => F,
): { lutFor: (slide: DeckSlide) => L; filmFor: (slide: DeckSlide) => F } {
  const luts = new Map<string, L>();
  const films = new Map<string, F>();
  const keyOf = (slide: DeckSlide) => `${slide.position}|${JSON.stringify(slide.develop ?? null)}`;
  const take = (slide: DeckSlide) => {
    const key = keyOf(slide);
    if (!luts.has(key)) luts.set(key, lutFor(slide));
    if (!films.has(key)) films.set(key, filmFor(slide));
  };
  for (const slide of slides) {
    take(slide);
    if (!slide.collage) continue;
    for (let i = 0; i < collageCellCount(slide.collage); i++) {
      take({ ...slide, develop: collageCellAt(slide, slide.collage, i).develop });
    }
  }
  return {
    lutFor: (slide) => {
      const key = keyOf(slide);
      return luts.has(key) ? (luts.get(key) as L) : lutFor(slide);
    },
    filmFor: (slide) => {
      const key = keyOf(slide);
      return films.has(key) ? (films.get(key) as F) : filmFor(slide);
    },
  };
}
