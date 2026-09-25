// EDITING a tone curve — grabbing, moving, adding and dropping a control
// point, and the path an editor draws. Port of `src/shared/develop/curve-edit.ts`.
//
// Apart from `Curves.swift`, which is the maths, because these are the rules
// of a GESTURE and they are where a curve editor goes wrong: a point that
// crosses its neighbour makes a curve no spline can draw, and one that can be
// dropped to nothing leaves an editor with no curve to edit.
//
// Coordinates are the curve's own: x and y in [0,1], y UP. An editor draws
// with y down and flips at the edge — `curvePath` does it once, here.

import Foundation

/// How near a pointer must come, in curve units, to grab a point rather than add one.
public let grabRadius = 0.045

/// The least gap in x between neighbours. Two points at one x is a vertical
/// jump `makeCurve` divides by zero on, and `normaliseCurve` would silently
/// drop one — so the gesture never produces it in the first place.
public let minGap = 0.005

/// The point under (x, y), or −1. Nearest wins, so two points close together
/// still each have a side; the test is a circle, not a box, because a pointer
/// is aimed and not snapped.
public func pointAt(_ curve: Curve, _ x: Double, _ y: Double, radius: Double = grabRadius) -> Int {
    var best = -1
    var bestDistance = radius * radius
    for i in curve.indices {
        let dx = curve[i].x - x
        let dy = curve[i].y - y
        let d = dx * dx + dy * dy
        if d <= bestDistance {
            bestDistance = d
            best = i
        }
    }
    return best
}

/// Move point `index` to (x, y). y is free; x is penned in by the neighbours,
/// so dragging a point past the next one pushes it against it instead of
/// swapping them under the hand.
///
/// An END point moves in x too, deliberately: dragging the first point right is
/// how an input black point is set, and `makeCurve` holds the end value below
/// it. That is the gesture every developer has, and it is why there is no
/// separate levels panel for the same thing.
public func moveCurvePoint(_ curve: Curve, _ index: Int, _ x: Double, _ y: Double) -> Curve {
    if index < 0 || index >= curve.count { return curve }
    let lo = index == 0 ? 0 : curve[index - 1].x + minGap
    let hi = index == curve.count - 1 ? 1 : curve[index + 1].x - minGap
    var next = curve
    // A curve squeezed so tight that lo passed hi keeps the point where the
    // neighbours leave room, rather than jumping to the far side of them.
    next[index] = CurvePoint(x: lo <= hi ? clamp(x, lo, hi) : lo, y: clamp01(y))
    return next
}

/// Add a point at (x, y), sorted. A click within `minGap` of one that exists
/// adds nothing and hands back THAT point's index, so a near-miss on a crowded
/// curve grabs rather than piling a second point on the first.
public func addCurvePoint(_ curve: Curve, _ x: Double, _ y: Double) -> (curve: Curve, index: Int) {
    let cx = clamp01(x)
    let cy = clamp01(y)
    for i in curve.indices where abs(curve[i].x - cx) < minGap {
        return (curve, i)
    }
    let at = curve.firstIndex { $0.x > cx } ?? curve.count
    var next = curve
    next.insert(CurvePoint(x: cx, y: cy), at: at)
    return (next, at)
}

/// Drop point `index`. Two points are the fewest a curve can have, so the last
/// two stay — an editor must always have something to drag. Dropping an end is
/// allowed: the next point becomes the end, which is how an input black point
/// is undone.
public func removeCurvePoint(_ curve: Curve, _ index: Int) -> Curve {
    if curve.count <= 2 || index < 0 || index >= curve.count { return curve }
    var next = curve
    next.remove(at: index)
    return next
}

/// JavaScript's `toFixed(4)`: the exact decimal value rounded to nearest, an
/// exact tie going UP — where C's `%.4f` sends a tie to the even digit. At four
/// decimals a double is an exact tie only when it is an odd multiple of 1/32
/// (`0.03125` → `0.0313`, not `0.0312`), which a curve sampled 96 times hits.
private func toFixed4(_ value: Double) -> String {
    let x = value == 0 ? 0 : value
    let scaled = x * 32
    if scaled == scaled.rounded() && Int(scaled) % 2 != 0 {
        let n = Int((abs(x) * 10000 + 0.5).rounded(.down))
        let whole = n / 10000
        let frac = n % 10000
        let digits = String(frac)
        let padded = String(repeating: "0", count: 4 - digits.count) + digits
        return (x < 0 ? "-" : "") + "\(whole).\(padded)"
    }
    return String(format: "%.4f", x)
}

/// The curve as an SVG path in a unit box with y DOWN — what an editor draws.
/// Sampled rather than expressed as béziers: the spline is monotone cubic and
/// its Hermite form is not a bézier the `C` command would reproduce, so drawing
/// it any other way would show a different curve from the one that bakes.
public func curvePath(_ curve: Curve, samples: Int = 96) -> String {
    let f = makeCurve(curve)
    var parts: [String] = []
    for i in 0...samples {
        let x = Double(i) / Double(samples)
        parts.append("\(i == 0 ? "M" : "L")\(toFixed4(x)),\(toFixed4(1 - f(x)))")
    }
    return parts.joined(separator: " ")
}

/// What a point's move does to the curve, for a reader who cannot see it.
public func describeCurvePoint(_ p: CurvePoint) -> String {
    let input = Int((p.x * 255).rounded(.toNearestOrAwayFromZero))
    let output = Int((p.y * 255).rounded(.toNearestOrAwayFromZero))
    return "in \(input), out \(output)"
}

/// A curve to start editing from: the one stored, else the straight line.
public func curveToEdit(_ curve: Curve?) -> Curve {
    if let curve, !isIdentityCurve(curve) { return curve }
    return identityCurve()
}
