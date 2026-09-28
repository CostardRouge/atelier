// The heading tape (compass ribbon) — port of
// `src/shared/overlay/heading-tape.ts`, pure geometry.
//
// A horizontal strip of ticks that slides under a fixed centre sight as the
// aircraft turns: the cockpit HUD's answer to "where am I pointing". Only a
// window of the 360° scale shows at once, the ends fade, and the value under
// the sight is the heading. Everything here is the maths — which ticks fall
// inside the window, where each sits, what it reads and how opaque it is; the
// drawing is the app's.

import Foundation

/// One tick inside the visible window.
public struct TapeTick: Equatable, Sendable {
    /// The compass bearing this tick marks, [0, 360).
    public var deg: Double
    /// Position across the tape, −1 (left edge) … 0 (sight) … +1 (right edge).
    /// Callers multiply by the tape's half-width.
    public var t: Double
    /// Major ticks are taller and carry a label.
    public var major: Bool
    /// What the tick reads, or nil for an unlabelled minor tick.
    public var label: String?
}

private let cardinalNames: [Double: String] = [0: "N", 90: "E", 180: "S", 270: "W"]

/// JS `Math.round`: halves toward +∞.
private func jsRound(_ x: Double) -> Double {
    let floor = x.rounded(.down)
    return x - floor >= 0.5 ? floor + 1 : floor
}

/// Wrap any angle into [0, 360).
public func wrap360(_ deg: Double) -> Double {
    (deg.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
}

/// Shortest signed difference `deg − from`, in (−180, 180]. What makes the
/// tape continuous across North: at 350°, the 10° tick is +20 away, not −340.
public func angleDelta(_ deg: Double, _ from: Double) -> Double {
    (((deg - from).truncatingRemainder(dividingBy: 360) + 540).truncatingRemainder(dividingBy: 360)) - 180
}

/// What a major tick reads: a cardinal's letter when `cardinals` is on (the
/// aviation convention, far more legible than "270"), else whole degrees.
public func tickLabel(_ deg: Double, _ cardinals: Bool) -> String {
    let d = wrap360(deg)
    if cardinals, let letter = cardinalNames[d] { return letter }
    guard d.isFinite else { return "NaN" } // JS `String(Math.round(NaN))`
    return String(Int(jsRound(d)))
}

/// The ticks visible on a tape centred on `heading`, spanning `spanDeg`.
///
/// Ticks are emitted on the ABSOLUTE compass scale (multiples of the steps),
/// not relative to the heading, so they slide THROUGH the window as the
/// aircraft turns — that sliding is the whole effect. `majorStep` is snapped
/// to at least `minorStep` so the two ladders never disagree about a tick.
public func tapeTicks(_ heading: Double, _ spanDeg: Double, _ majorStep: Double, _ minorStep: Double, _ cardinals: Bool) -> [TapeTick] {
    let span = max(5, spanDeg)
    let half = span / 2
    let minor = max(1, jsRound(minorStep))
    let major = max(minor, jsRound(majorStep))
    let centre = wrap360(heading)

    // Walk the absolute scale from the first minor tick at or after the
    // window's left edge to the last one at or before its right edge.
    let first = ((centre - half) / minor).rounded(.up) * minor
    let last = ((centre + half) / minor).rounded(.down) * minor
    // An infinite span would walk forever (the web's loop does); nothing to draw.
    guard first.isFinite, last.isFinite else { return [] }

    var ticks: [TapeTick] = []
    var deg = first
    while deg <= last {
        let d = wrap360(deg)
        let t = angleDelta(d, centre) / half
        if t >= -1 && t <= 1 {
            let rem = d.truncatingRemainder(dividingBy: major)
            let isMajor = abs(rem) < 1e-9 || abs(rem - major) < 1e-9
            ticks.append(TapeTick(deg: d, t: t, major: isMajor, label: isMajor ? tickLabel(d, cardinals) : nil))
        }
        deg += minor
    }
    return ticks
}

/// Opacity at position `t` (−1…1) for a tape whose ends fade over `fadeFrac`
/// of the half-width — the fade stops the ribbon reading as a hard-cut bar.
public func tapeFadeAlpha(_ t: Double, _ fadeFrac: Double) -> Double {
    let fade = max(0, min(0.9, fadeFrac))
    if fade == 0 { return 1 }
    let edge = 1 - fade
    let a = abs(t)
    if a <= edge { return 1 }
    if a >= 1 { return 0 }
    return 1 - (a - edge) / fade
}
