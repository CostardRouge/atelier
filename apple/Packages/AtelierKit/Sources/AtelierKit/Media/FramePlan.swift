// The frames of a stretch of video we PAINT ourselves: how many there are,
// when each starts on the encoder's timeline, and how long it lasts. Port of
// `src/shared/media/frame-plan.ts`.
//
// Two callers, and they are one problem seen twice: the Studio's outro card
// appended after the footage (`ExportTail.swift`), and a whole clip painted
// from nothing — a badge over a photograph, a deck played in order. Both need
// "N seconds at F fps starting here", and a second copy of that arithmetic is
// how two exports come to disagree about a duration.

import Foundation

public struct PlannedFrame: Equatable, Sendable {
    /// Seconds into the painted stretch's own life — what a painter receives.
    public var tSeconds: Double
    /// Encoder timestamp in microseconds, including the start offset.
    public var timestampMicros: Int
    public var durationMicros: Int

    public init(tSeconds: Double, timestampMicros: Int, durationMicros: Int) {
        self.tSeconds = tSeconds; self.timestampMicros = timestampMicros; self.durationMicros = durationMicros
    }
}

/// `seconds` of picture at `fps`, starting at `startMicros`.
///
/// For an appended tail, `startMicros` is the end of the last encoded frame
/// (its timestamp PLUS its duration) — passing the last timestamp alone would
/// overlap the final frame of the footage with the first frame of the card.
/// For a clip painted from nothing it is 0.
///
/// Nothing is planned for a non-finite or non-positive duration or rate: the
/// caller decides whether that is an error or simply nothing to append.
public func framePlan(_ seconds: Double, _ fps: Double, _ startMicros: Int = 0) -> [PlannedFrame] {
    if !seconds.isFinite || seconds <= 0 { return [] }
    if !fps.isFinite || fps <= 0 { return [] }
    let count = max(1, Int((seconds * fps).rounded(.toNearestOrAwayFromZero)))
    var frames: [PlannedFrame] = []
    frames.reserveCapacity(count)
    for i in 0..<count {
        // Rounded per frame against the true rate, so NTSC-ish rates do not
        // accumulate drift over a long card.
        let start = Int(((Double(i) * 1_000_000) / fps).rounded(.toNearestOrAwayFromZero))
        let end = Int(((Double(i + 1) * 1_000_000) / fps).rounded(.toNearestOrAwayFromZero))
        frames.append(PlannedFrame(tSeconds: Double(i) / fps, timestampMicros: startMicros + start, durationMicros: end - start))
    }
    return frames
}
