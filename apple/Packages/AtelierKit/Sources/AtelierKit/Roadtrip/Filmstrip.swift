// The filmstrip under a clip: which moments it shows, and where a time sits
// along it. Port of `src/shared/roadtrip/filmstrip.ts`; the decoding and the
// dragging are the app's.
//
// A strip cell stands for a SLICE of the clip, so it is sampled at the middle
// of its slice rather than at its left edge. Sampling at the edge puts the
// first cell on frame zero — which on a drone clip is the props spinning up
// on the ground — and leaves the last quarter of the clip unrepresented.

import Foundation

/// How many cells a strip of `widthPx` should hold, at roughly `cell` wide.
public func stripCount(_ widthPx: Double, cell: Double = 68, min lo: Int = 6, max hi: Int = 16) -> Int {
    if !widthPx.isFinite || widthPx <= 0 { return lo }
    let rounded = TripJS.round(widthPx / cell)
    return Int(Swift.max(Double(lo), Swift.min(Double(hi), rounded)))
}

/// The moment each cell shows: the middle of its own slice of the clip.
public func filmstripTimes(_ duration: Double, _ count: Int) -> [Double] {
    let total = duration.isFinite && duration > 0 ? duration : 0
    let n = Swift.max(1, count)
    return (0..<n).map { (Double($0) + 0.5) / Double(n) * total }
}

/// 0..1, a non-finite value reading as 0 (the web's private `clamp01`, which
/// differs from the kernel's on NaN).
private func stripFraction(_ value: Double) -> Double {
    value.isFinite ? Swift.min(1, Swift.max(0, value)) : 0
}

/// Where a time sits along the strip, 0..1.
public func fractionOfTime(_ time: Double, _ duration: Double) -> Double {
    if !duration.isFinite || duration <= 0 { return 0 }
    return stripFraction(time / duration)
}

/// The time a pointer at `clientX` is asking for, given the strip's box (its
/// `minX` is the web's `left`). Clamped to the clip, and held a hair short of
/// the end: a seek past the last frame never lands, so the preview would
/// simply stop updating.
public func timeFromPointer(_ clientX: Double, _ rect: Rect, _ duration: Double) -> Double {
    let total = duration.isFinite && duration > 0 ? duration : 0
    if rect.width <= 0 { return 0 }
    let fraction = stripFraction((clientX - rect.minX) / rect.width)
    return Swift.min(fraction * total, Swift.max(total - 0.05, 0))
}

/// A step along the clip for the arrow keys: fine, but never imperceptible.
public func keyStep(_ duration: Double, coarse: Bool = false) -> Double {
    let total = duration.isFinite && duration > 0 ? duration : 0
    let fine = Swift.max(1.0 / 30, total / 300)
    return coarse ? Swift.max(fine * 10, total / 20) : fine
}
