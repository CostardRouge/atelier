// Content appended AFTER the footage's last frame — today the Studio's outro
// card. Port of `src/shared/media/export-tail.ts`; the frames it plans come
// from `FramePlan.swift`, which a clip painted from nothing shares.
//
// Appending is deliberately the whole feature: nothing already encoded moves,
// the audio is still copied bit-for-bit and simply ends with the footage (the
// card plays silent, which is what an outro is on every platform), and the
// trim arithmetic never learns the output grew. That is what makes "output
// longer than the source" cheap at this end of the file, where a pre-roll —
// which shifts every timestamp — is not.

import Foundation

/// What a pipeline needs to append: a duration, and a painter for it. The web
/// paints onto a canvas; here `Frame` is whatever the app's encoder takes (a
/// `CIImage`, a pixel buffer), so the kernel names the contract and not the
/// picture.
public struct ExportTail<Frame> {
    /// Seconds of card after the footage. Nothing is appended for <= 0.
    public var seconds: Double
    /// Produce the frame at `tSeconds` into the tail's own life, at the
    /// export's output size. Called once per appended frame, so a static card
    /// is cheap and an animated one plays.
    public var draw: (Double) -> Frame

    public init(seconds: Double, draw: @escaping (Double) -> Frame) {
        self.seconds = seconds; self.draw = draw
    }

    /// The frames this tail appends at `fps`, starting where the footage
    /// ended (`startMicros` is the last frame's timestamp PLUS its duration).
    /// Empty for no time, no rate, or nonsense — the rule `framePlan` keeps.
    public func frames(fps: Double, startMicros: Int) -> [PlannedFrame] {
        framePlan(seconds, fps, startMicros)
    }
}
