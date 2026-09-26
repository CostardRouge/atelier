// A still has no clock — port of `src/shared/overlay/still-frame.ts`, pure.
//
// Windows, animations and scenes all answer "when?", and a photograph is a
// single instant: no first exported frame to count from, no entrance to play,
// no intro to hold the HUD back for. Drawn naively at t = 0, an element with
// an entrance would render at the START of its slide — off frame, or
// transparent — and one whose window opens later would not render at all.
// Both read as a broken composition rather than as a feature that does not
// apply.
//
// So a still is composed from the deck in its SETTLED state: the timing is
// stripped before it reaches the renderer, and every visible element draws
// where and how it finally comes to rest. Preview, frame grab and export all
// go through here, so what the stage shows is what burns in.

import Foundation

/// True when this element's appearance depends on a clock.
private func isTimed(_ el: OverlayElement) -> Bool {
    el.window != nil || el.animation != nil || el.sceneId != nil
}

/// The deck as a still shows it: the same elements, with `window`,
/// `animation` and `sceneId` dropped. Untimed elements are returned as they
/// are (the web returns the very input when nothing is timed; a Swift array
/// is a value, so "the same" is equality here).
public func settleForStill(_ elements: [OverlayElement]) -> [OverlayElement] {
    if !elements.contains(where: isTimed) { return elements }
    return elements.map { el in
        guard isTimed(el) else { return el }
        var settled = el
        settled.window = nil
        settled.animation = nil
        settled.sceneId = nil
        return settled
    }
}
