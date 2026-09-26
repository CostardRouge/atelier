// The pure half of `src/shared/media/render-video.ts` — a clip with NO source,
// frames we paint ourselves: the size it can be encoded at and the cadence it
// is delivered at. The encode loop (`encodeFrames`) is the app's, on
// `AVAssetWriter` (`apple/Atelier/Video/VideoExport.swift`), and it shares
// `framePlan` (`FramePlan.swift`) and `deriveBitrate` (`WebcodecsExport.swift`)
// with the decode pipeline, so a change to how this suite encodes lands once.
//
// Two properties are structural, not omissions: a painted clip has no source
// cadence to inherit (the rate is a delivery choice, `defaultPaintedFps`
// when absent), and it is silent unless the suite MADE audio for it.

import Foundation

/// The cadence a painted clip is delivered at. 30 is the platforms' own
/// default for a vertical piece, and doubling it would double the encode for a
/// badge that moves through a handful of keyframed steps.
public let defaultPaintedFps = 30

/// Sanity ceiling: past this a "clip" is a render job, not a hook.
private let maxPaintedFps = 60.0

/// JavaScript's `Math.round`: a half goes towards +∞.
private func jsRoundHalfUp(_ x: Double) -> Double {
    (x + 0.5).rounded(.down)
}

/// The encodable size for a painted clip: even in both axes, never zero.
/// H.264 cannot encode an odd dimension, and a frame fitted to an aspect
/// lands on one about half the time.
public func paintedOutputSize(_ width: Double, _ height: Double) -> (w: Int, h: Int) {
    func even(_ n: Double) -> Int {
        // A non-finite side is 0, as the web's; bounded so nothing traps.
        let safe = n.isFinite ? min(max(n, -1e9), 1e9) : 0
        let doubled = 2 * jsRoundHalfUp(safe / 2)
        return max(2, Int(doubled))
    }
    return (even(width), even(height))
}

/// The cadence actually used: the ask, clamped and rounded, or the default.
public func paintedFps(_ fps: Double?) -> Int {
    guard let fps, fps.isFinite, fps > 0 else { return defaultPaintedFps }
    return Int(min(maxPaintedFps, max(1, jsRoundHalfUp(fps))))
}
