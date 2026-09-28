// The day heatmap's five rungs — the web's `heatmap-ramp.ts` and the
// `--color-heat-*` tokens of `src/index.css`, one for one.
//
// The rungs are the question the maintainer asks the grid, in order: nothing
// here · something drafted but never sent · sent once · twice · more. So a
// drafted day is visibly NOT an empty one (there is work sitting there) and
// just as visibly not a published one. Measured at cell size on the web: the
// accent-wash token for the drafted rung was indistinguishable from bare paper
// at 14px — do not flatten it back toward that token for tidiness.
//
// One place, because the gallery's rhythm strip, the cover panel's preview
// and the overview's calendar draw the SAME ramp: a trip's card and its grid
// must not disagree about what a day looks like. Every rung follows the
// system appearance (the web's night ramp), and rung 0 is the palette's own
// `paper2`, so an untold day is bare paper under either theme.

import SwiftUI

extension Palette {
    /// Rung 0 (nothing told) … rung 4 (sent often).
    var heatmapLevels: [Color] {
        [
            paper2,
            Color(light: 0xF4CDBD, dark: 0x3F231B),
            Color(light: 0xEB9878, dark: 0x7A3624),
            Color(light: 0xE26A45, dark: 0xD4583A),
            Color(light: 0xD9442A, dark: 0xEF5638),
        ]
    }

    /// One rung, clamped into the ramp — what `rhythmLevel` and the grid's
    /// day rung hand over.
    func heatmapLevel(_ level: Int) -> Color {
        let levels = heatmapLevels
        return levels[Swift.max(0, Swift.min(levels.count - 1, level))]
    }
}
