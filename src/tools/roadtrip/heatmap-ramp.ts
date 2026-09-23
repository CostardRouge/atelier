/**
 * Five steps from bare paper to the vermilion accent. The rungs are the
 * question the maintainer asks the grid, in order: nothing here · something
 * drafted but never sent · sent once · twice · more. So a drafted day is
 * visibly NOT an empty one (there is work sitting there) and just as visibly
 * not a published one.
 *
 * Measured at cell size: the first pass used the accent-wash token for the
 * drafted rung and it was indistinguishable from bare paper at 14px. Do not
 * flatten it back toward the token for palette tidiness.
 *
 * Its own module because the gallery card's rhythm strip draws the same ramp:
 * a trip's card and the trip's grid must not disagree about what a day looks
 * like, and two copies of five hex values is how they start to.
 */
/* Every rung is a TOKEN, not a hex: on the dark theme bare paper is
   near-black, and a hex drew every untold day as a bright tile — and the two
   pale told rungs stayed pale under night ink, so a day's number vanished on
   them. `index.css` carries both ramps (`--color-heat-*`). */
export const HEATMAP_LEVELS = [
  'var(--color-paper-2)',
  'var(--color-heat-1)',
  'var(--color-heat-2)',
  'var(--color-heat-3)',
  'var(--color-heat-4)',
];
