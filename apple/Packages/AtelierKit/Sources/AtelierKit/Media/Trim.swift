// The in/out range of a clip — port of `src/shared/media/trim.ts`. Pure, so
// a transport bar only ever has to translate pointer positions into seconds.
//
// Every value is a SOURCE time in seconds (a position in the original rush),
// never a position in the trimmed result: telemetry cues, the capture clock
// and the seek fallback all index the source timeline, and a range that
// meant something else would silently desynchronise them.
//
// Two rules the whole feature rests on: the handles never cross — each one
// stops `minLength` away from the other (the butée of an NLE, so a range
// cannot collapse to nothing); and the playhead lives inside the range —
// moving a handle past it PUSHES it (`clampPlayhead`), which is what makes the
// drag feel live.

import Foundation

public struct TrimRange: Equatable, Sendable {
    /// In point, seconds into the source.
    public var start: Double
    /// Out point, seconds into the source.
    public var end: Double
    public init(start: Double, end: Double) { self.start = start; self.end = end }
}

/// Seconds below which two times are the same instant (float scrub noise).
public let trimEpsilon = 1e-3

/// The whole clip — what an untrimmed project means.
public func fullRange(_ duration: Double) -> TrimRange {
    TrimRange(start: 0, end: max(0, duration))
}

/// The shortest range a user can leave behind: one frame, so the export
/// always has something to encode. Falls back to 100 ms when the frame rate
/// is unknown (the container probe is best-effort).
public func minTrimLength(_ fps: Double?) -> Double {
    guard let fps, fps.isFinite, fps > 0 else { return 0.1 }
    return 1 / fps
}

/// The web's local `clamp`: a non-finite value lands on the LOW bound, unlike
/// the kernel's `clamp`, which passes NaN through.
private func finiteClamp(_ value: Double, _ lo: Double, _ hi: Double) -> Double {
    if !value.isFinite { return lo }
    return min(hi, max(lo, value))
}

/// Bring a range inside `[0, duration]`, reorder it if it arrived inverted and
/// give it at least `minLength`. Used on every restore: a saved range meets a
/// shorter clip, a duration lands late, a document was hand-edited.
public func clampRange(_ range: TrimRange, _ duration: Double, _ minLength: Double = 0.1) -> TrimRange {
    let total = max(0, duration)
    if total <= 0 { return TrimRange(start: 0, end: 0) }
    let minimum = min(minLength, total)
    var start = finiteClamp(min(range.start, range.end), 0, total)
    var end = finiteClamp(max(range.start, range.end), 0, total)
    if end - start < minimum {
        // Grow towards the end, then backwards if the clip stops first.
        end = min(total, start + minimum)
        start = max(0, end - minimum)
    }
    return TrimRange(start: start, end: end)
}

/// Move the in point, stopping `minLength` short of the out point.
public func setStart(_ range: TrimRange, _ t: Double, _ duration: Double, _ minLength: Double = 0.1) -> TrimRange {
    let total = max(0, duration)
    let minimum = min(minLength, total)
    return TrimRange(start: finiteClamp(t, 0, max(0, range.end - minimum)), end: range.end)
}

/// Move the out point, stopping `minLength` past the in point.
public func setEnd(_ range: TrimRange, _ t: Double, _ duration: Double, _ minLength: Double = 0.1) -> TrimRange {
    let total = max(0, duration)
    let minimum = min(minLength, total)
    return TrimRange(start: range.start, end: finiteClamp(t, min(total, range.start + minimum), total))
}

/// Keep a playhead inside the range — the "push" when a handle reaches it.
public func clampPlayhead(_ t: Double, _ range: TrimRange?) -> Double {
    guard let range else { return t }
    return finiteClamp(t, range.start, range.end)
}

/// The reverse push: dragging the playhead INTO a handle and carrying on
/// takes the handle with it. Only ever widens the range — the playhead pushes
/// a boundary outwards, it never squeezes one — so the minimum length cannot
/// be violated and the two handles cannot meet.
public func pushBounds(_ range: TrimRange, _ t: Double, _ duration: Double) -> TrimRange {
    let at = finiteClamp(t, 0, max(0, duration))
    if at < range.start { return TrimRange(start: at, end: range.end) }
    if at > range.end { return TrimRange(start: range.start, end: at) }
    return range
}

/// How long the trimmed result runs.
public func trimDuration(_ range: TrimRange) -> Double {
    max(0, range.end - range.start)
}

/// True when the range actually cuts something off the source.
public func isTrimmed(_ range: TrimRange?, _ duration: Double) -> Bool {
    guard let range, duration > 0 else { return false }
    return range.start > trimEpsilon || range.end < duration - trimEpsilon
}

/// The range to hand the export, or nil when it would re-encode the whole
/// clip anyway — so an untrimmed project takes exactly the path it took
/// before trimming existed.
public func exportTrim(_ range: TrimRange?, _ duration: Double) -> TrimRange? {
    isTrimmed(range, duration) ? range : nil
}

/// A range as a project stores it, keyed by media name. The clip's duration
/// rides along as the identity check: a folder can hold a DIFFERENT file
/// under the same name, and silently applying someone else's in/out to it
/// would cut the wrong thing.
public struct SavedTrim: Equatable, Sendable {
    public var start: Double
    public var end: Double
    public var duration: Double
    public init(start: Double, end: Double, duration: Double) { self.start = start; self.end = end; self.duration = duration }

    public var range: TrimRange { TrimRange(start: start, end: end) }

    /// As a project file holds it: `{ start, end, duration }`.
    public var json: JSONValue {
        .object(["start": .number(start), "end": .number(end), "duration": .number(duration)])
    }
}

/// A stored trim read back safely: nil unless all three numbers are there and
/// finite — `restoreTrim` then opens the whole clip, exactly as for no trim.
public func readSavedTrim(_ raw: JSONValue?) -> SavedTrim? {
    guard let o = raw?.objectValue,
          let start = o["start"]?.finiteNumber,
          let end = o["end"]?.finiteNumber,
          let duration = o["duration"]?.finiteNumber else { return nil }
    return SavedTrim(start: start, end: end, duration: duration)
}

/// How far two durations may differ and still be the same media (seconds).
private let sameMediaTolerance = 0.05

/// What to persist for a clip — nil when the whole clip is kept.
public func saveTrim(_ range: TrimRange?, _ duration: Double) -> SavedTrim? {
    guard isTrimmed(range, duration), let range else { return nil }
    return SavedTrim(start: range.start, end: range.end, duration: duration)
}

/// The range to open a clip with: the saved one when it belongs to THIS
/// media, the whole clip otherwise. Always clamped, so a shorter file or a
/// hand-edited document cannot produce an impossible range.
public func restoreTrim(_ saved: SavedTrim?, _ duration: Double, _ minLength: Double = 0.1) -> TrimRange {
    guard let saved, duration > 0 else { return fullRange(duration) }
    if abs(saved.duration - duration) > sameMediaTolerance {
        return fullRange(duration)
    }
    return clampRange(saved.range, duration, minLength)
}
