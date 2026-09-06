/**
 * Winnow features Atelier will use once they are ready, and not before.
 *
 * A build-time switch, deliberately not a user setting: this is not a taste,
 * it is a statement about how finished the other side is.
 */

/**
 * Reading a Winnow **timeline** — its chapters, as legs to seed or complete a
 * trip with. **Off, and it must stay off until Winnow's timeline is mature.**
 *
 * The reasoning, from the maintainer (2026-09-07): Atelier is a mature
 * project and must not lean on a feature of another project that is not. The
 * timeline shipped on Winnow's side but is young, and its chapters are
 * re-derived on every request, so what Atelier reads today can change under
 * it tomorrow. A screen that half-works is worse than one that is not
 * offered.
 *
 * What "off" does: every entry point disappears rather than being greyed —
 * the leg tab in the media browser, the "seed from" row when a trip is
 * created, the "↓ From <host>" button over the stages, and the two link
 * routes, which are consumed and land on the ordinary screen instead of
 * opening a panel. Nothing asks the instance for a timeline, so an immature
 * route is never called.
 *
 * What "off" does NOT do: remove the work. `timeline-import.ts` and its 42
 * specs, `TimelineImportPanel`, and the wire reading in `client.ts` all stay,
 * tested and dormant. Flipping this to `true` brings the feature back exactly
 * as it was, and `hasTimeline` then falls back to what the instance says
 * about itself — so a Winnow without a timeline still degrades to a sentence.
 *
 * **This is not the way to reach a Winnow's media.** Browsing by day and by
 * folder, and Road Trip's own day strip, use plain date filters that have
 * been part of Winnow since long before the timeline. They are unaffected by
 * this switch, by design: the two were conflated once, and that is what put
 * a mature tool behind an immature dependency.
 */
export const TIMELINE_SYNC_ENABLED = false;
