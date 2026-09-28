// How many pixels an editor stage works on — port of
// `src/shared/overlay/stage-size.ts`, pure.
//
// The stage used to draw at the media's own density, right for a clip (4K is
// 8.3 megapixels) and ruinous for a photograph: a 48-megapixel still put a
// 194 MB buffer on screen and killed the tab on an iPhone. So the stage has a
// PIXEL BUDGET, no more than a 4K frame — every clip the Studio was built for
// is untouched, only a big still is scaled. A PREVIEW budget and nothing else:
// exports and the frame grab compose from the source at its own density.

import Foundation

/// A 4K frame's worth of pixels — the most any stage will work on.
public let maxStagePixels = 3840.0 * 2160.0

/// JS `Math.round`: halves toward +∞.
private func jsRound(_ x: Double) -> Double {
    let floor = x.rounded(.down)
    return x - floor >= 0.5 ? floor + 1 : floor
}

/// The frame size a stage should hold `w`×`h` in: the media's own size while
/// it is within the budget, scaled down by AREA — aspect kept — once it is
/// not. 0×0 for a frame that has no size yet.
public func stageFrameSize(_ w: Double, _ h: Double, budget: Double = maxStagePixels) -> Size {
    guard w > 0, h > 0 else { return Size(0, 0) }
    let pixels = w * h
    if !(budget > 0) || pixels <= budget { return Size(jsRound(w), jsRound(h)) }
    let scale = (budget / pixels).squareRoot()
    return Size(max(1, jsRound(w * scale)), max(1, jsRound(h * scale)))
}
