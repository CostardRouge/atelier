// Winnow features Atelier will use once they are ready, and not before —
// port of `src/shared/sources/winnow/features.ts`.
//
// A build-time switch, deliberately not a user setting: this is not a taste,
// it is a statement about how finished the other side is.

import Foundation

/// Reading a Winnow **timeline** — its chapters, as legs to seed or complete a
/// trip with. **Off, and it must stay off until Winnow's timeline is mature.**
///
/// The maintainer's reasoning (2026-09-07): Atelier must not lean on a
/// feature of another project that is not mature. The timeline shipped on
/// Winnow's side but is young, and its chapters are re-derived on every
/// request, so what Atelier reads today can change under it tomorrow. A
/// screen that half-works is worse than one that is not offered.
///
/// "Off" makes every entry point disappear rather than grey (`hasTimeline`
/// answers false), so nothing asks the instance for a timeline. It does NOT
/// remove the work: `chapterFromWire`, `localDayOf`, `chapterDays` and
/// `WinnowClient.timeline` stay, tested and dormant.
///
/// **This is not the way to reach a Winnow's media.** Browsing by day and by
/// folder use plain date filters that long predate the timeline, and are
/// unaffected by this switch — the two were conflated once, and that put a
/// mature tool behind an immature dependency.
public let timelineSyncEnabled = false
