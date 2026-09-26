// Where a dragged bottom sheet lands when the finger lifts. Port of
// `src/shared/ui/sheet-snap.ts`.
//
// A sheet on a phone is not a modal that is either open or shut: it rests at
// a few declared heights, and the drag between them is the control. Heights
// are FRACTIONS of the screen (0…1), never pixels, so one number describes a
// phone in either orientation. The rules kept: two default rests, not three
// (a "peek" was drawn and dropped — peeking at a library you cannot read is a
// state nobody chooses); a drag under `dismissBelow` closes, but a sheet with
// a low first snap still dismisses only under its own floor; a tie between
// two snaps goes to the smaller, so a hesitant drag does not grow; a finger
// moving DOWN the screen (positive `dy`) shrinks the sheet; a tap on the
// handle cycles upward and wraps.

import Foundation

/// A sheet's resting heights, smallest first, each a fraction of the screen.
public typealias SnapPoints = [Double]

/// The default rest: a little over half the screen, and nearly all of it.
public let defaultSnaps: SnapPoints = [0.55, 0.92]

/// Below this fraction, letting go closes the sheet instead of snapping back.
/// It sits under the smallest default snap on purpose: a downward flick
/// should dismiss.
public let dismissBelow = 0.3

/// Keep a fraction inside the screen, with a floor nothing can drag under. A
/// broken number reads as 0.
public func clampFraction(_ v: Double) -> Double {
    if !v.isFinite { return 0 }
    return clamp(v, 0.08, 0.96)
}

/// The declared height nearest a fraction. Ties go to the smaller.
public func nearestSnap(_ v: Double, _ snaps: SnapPoints = defaultSnaps) -> Double {
    guard var best = snaps.first else { return clampFraction(v) }
    for s in snaps where abs(s - v) < abs(best - v) {
        best = s
    }
    return best
}

/// What a released drag means: a fraction to rest at, or nil for "close". The
/// dismissal threshold is whichever is LOWER — the shared one, or a hair under
/// the sheet's own smallest rest, so a sheet's lowest state stays reachable
/// by the very gesture that is supposed to reach it.
public func snapAfterDrag(_ fraction: Double, _ snaps: SnapPoints = defaultSnaps) -> Double? {
    let floor: Double
    if let first = snaps.first {
        floor = min(dismissBelow, first * 0.8)
    } else {
        floor = dismissBelow
    }
    if fraction < floor { return nil }
    return nearestSnap(fraction, snaps)
}

/// The fraction a drag has reached: where it started, minus how far the
/// finger travelled DOWN the screen. A sheet grows upward, so a positive `dy`
/// shrinks it. A viewport nothing has measured yet holds still.
public func dragFraction(_ startFraction: Double, _ dy: Double, _ viewportHeight: Double) -> Double {
    if !(viewportHeight > 0) { return startFraction }
    return clampFraction(startFraction - dy / viewportHeight)
}

/// The next stop when the handle is TAPPED rather than dragged, cycling upward
/// and wrapping back to the smallest — the answer a mouse and the keyboard
/// share.
public func nextSnap(_ current: Double, _ snaps: SnapPoints = defaultSnaps) -> Double {
    if snaps.isEmpty { return current }
    let at = nearestSnap(current, snaps)
    let i = snaps.firstIndex(of: at) ?? 0
    return snaps[(i + 1) % snaps.count]
}
