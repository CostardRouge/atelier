/**
 * The column a tool SCREEN scrolls — the trip overview and the two galleries.
 *
 * One constant because the three had already written the same five classes by
 * hand and had already drifted: two of them paid `pt-3` at `compact` and the
 * third did not. What it fixes now is the other end. **The scroller's bottom
 * edge IS the bottom bar's top on a phone**, so the last card in the column
 * landed against the bar with nothing between them — reported as "in the bottom
 * of the pages we lack of padding", and it is the same 16px rhythm the `gap-4`
 * between cards already uses, simply missing after the last one.
 *
 * The padding goes INSIDE the scroller, which is the whole point and the mirror
 * of the gutter rule in `frontend.md`: between a fixed edge and a scroll
 * container it would be paper the content is clipped against, and `<main>`
 * paying it is exactly the stripe that was reported before. Here it scrolls
 * away with the last card, which is what breathing room is supposed to do.
 *
 * Unconditional, not `compact`-only: above a phone the frame's own `pb-3` sits
 * OUTSIDE this box, so the last card was landing on the frame's edge there too.
 *
 * The TOP is deliberately not here — it is already paid, differently and
 * correctly, by whatever the screen opens on: `PageBar` clears the masthead
 * itself at `compact`, and a screen without one adds `pt-3`.
 */
export const pageScroll = 'flex flex-col flex-1 min-h-0 gap-4 overflow-auto pb-4';
