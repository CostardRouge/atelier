// Export cadence and speed — the output timeline, and the arithmetic that
// produces it. Port of `src/shared/media/frame-rate.ts`.
//
// Two independent knobs, one grid. The output frames always land on a regular
// grid of `1/fps`, each showing the source frame that was on screen at that
// instant; below the source rate frames are dropped, above it they are
// duplicated — no motion is ever invented (`media-pipeline.md`).
//
// - `ExportFrameRate` changes the CADENCE and keeps the duration: the clip
//   lasts as long as it did, so the copied audio stays in sync.
// - `resolveSpeed` changes the DURATION: the source timeline is divided by
//   the speed before it meets the grid. This is a real re-time, so the audio
//   cannot come along: a re-timed variant ships silent (`AudioPlan.swift`).

import Foundation

/// `source` keeps the clip's own cadence; a number is an explicit target.
public enum ExportFrameRate: Equatable, Sendable {
    case source
    case fps(Double)
}

/// What the pickers offer. Cinema (24), PAL (25), the broadcast/web default
/// (30), and the high-cadence rates (48/50/60/120) — a superset of what the
/// capture devices in this suite record.
public let frameRateChoices: [Int] = [24, 25, 30, 48, 50, 60, 120]

/// JavaScript's `Math.round`, exact for what reaches it here (a non-negative
/// number; a negative one is clamped to 1 by every caller): a half goes up.
private func jsRound(_ x: Double) -> Double {
    x.rounded(.toNearestOrAwayFromZero)
}

/// JavaScript's `${n}`: an integer-valued number prints without `.0`.
private func jsNumber(_ x: Double) -> String {
    if x.isFinite, x == x.rounded(), abs(x) < 1e15 { return String(Int64(x)) }
    return "\(x)"
}

/// A rounded rate as a whole number, at least 1 and never past what an Int
/// holds — `Math.max(1, Math.round(x))`.
private func wholeRate(_ x: Double) -> Int {
    let rounded = x.isFinite ? jsRound(x) : 1
    return Int(min(max(rounded, 1), 1e9))
}

/// The rate to encode at. Anything absent, out of range or `source` follows
/// the clip; `sourceFps` is the measured (already rounded) source cadence, so
/// asking for 30 on 29.97 footage resolves to the source rate and takes the
/// exact pass-through path rather than resampling onto a drifting grid.
public func resolveFrameRate(_ requested: ExportFrameRate?, _ sourceFps: Double) -> Int {
    // `Math.round(sourceFps) || 1`: a rate that rounds to 0 (or is NaN) is 1.
    let source = wholeRate(sourceFps)
    guard let requested else { return source }
    switch requested {
    case .source:
        return source
    case .fps(let rate):
        if !rate.isFinite || rate <= 0 { return source }
        return wholeRate(rate)
    }
}

/// Presentation time (microseconds, relative to the first frame) of output `index`.
public func frameTimestampMicros(_ index: Int, _ fps: Double) -> Int {
    Int(jsRound((Double(index) * 1_000_000) / fps))
}

/// How many frames a `durationSec` clip holds at `fps`.
public func outputFrameCount(_ durationSec: Double, _ fps: Double) -> Int {
    let frames = durationSec * fps
    if !frames.isFinite { return 1 }
    return max(1, Int(jsRound(min(frames, 1e12))))
}

/// How far from a frame boundary an instant is still treated as belonging to
/// the NEXT frame. Sample times and durations are each rounded to whole
/// microseconds independently, so a span built as `timestamp + duration`
/// overshoots its successor's start by a microsecond or two; without this
/// margin, a 60 → 30 conversion keeps frames 0, 1, 3, 5 (right count, wrong
/// phase) instead of 0, 2, 4. Half a millisecond is orders of magnitude above
/// that jitter and far below any real frame interval (8.3 ms at 120 fps).
private let edgeToleranceMicros = 500.0

/// The output frames a source frame spanning `[startMicros, endMicros)` must
/// produce: every grid instant `i / fps` that falls inside the span, from
/// `nextIndex` on. Empty when the source frame is passed over entirely (the
/// grid instant fell in a neighbour) — that is the drop case, and the caller
/// can skip the whole per-frame transform for it.
///
/// Times are relative to the first decoded frame, so a clip whose first
/// sample is not at t=0 still starts its grid at index 0.
public func planFrameIndices(_ startMicros: Double, _ endMicros: Double, _ fps: Double, _ nextIndex: Int) -> [Int] {
    if !(endMicros > startMicros) { return [] }
    let start = startMicros - edgeToleranceMicros
    let end = endMicros - edgeToleranceMicros
    let first = max(nextIndex, Int(((start * fps) / 1_000_000).rounded(.up)))
    // `i < end` → the last index is one below the ceiling, integer end included.
    let last = Int(((end * fps) / 1_000_000).rounded(.up)) - 1
    if last < first { return [] }
    return Array(first...last)
}

/// Label for a picker row ("source fps" / "30 fps").
public func describeFrameRate(_ rate: ExportFrameRate) -> String {
    switch rate {
    case .source: return "source fps"
    case .fps(let value): return "\(jsNumber(value)) fps"
    }
}

/// Delivery speed: 1 keeps the clip's own, 2 delivers it twice as fast.
public let speedChoices: [Double] = [0.25, 0.5, 1, 2, 4]

/// Beyond these a frame lasts minutes, or the clip is gone in a blink.
private let minSpeed = 1.0 / 16
private let maxSpeed = 16.0

/// The speed to deliver at. Anything absent, unreadable or out of range keeps
/// the clip's own — the same "fall back to the source" rule the cadence uses.
public func resolveSpeed(_ requested: Double?) -> Double {
    guard let requested, requested.isFinite else { return 1 }
    if requested < minSpeed || requested > maxSpeed { return 1 }
    return requested
}

/// How long the delivered clip runs, in seconds.
public func retimedDuration(_ durationSec: Double, _ speed: Double) -> Double {
    durationSec / resolveSpeed(speed)
}

/// Label for a picker row — nil at normal speed, which needs no words.
public func describeSpeed(_ speed: Double) -> String? {
    let s = resolveSpeed(speed)
    if s == 1 { return nil }
    return "\(jsNumber(s))× speed"
}

/// File-name part for a re-timed variant (`2x`, `0.5x`), nil at normal speed.
public func speedSuffix(_ speed: Double) -> String? {
    let s = resolveSpeed(speed)
    return s == 1 ? nil : "\(jsNumber(s))x"
}
