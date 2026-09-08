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
export const HEATMAP_LEVELS = ['#efe9dd', '#f4cdbd', '#eb9878', '#e26a45', '#d9442a'];
