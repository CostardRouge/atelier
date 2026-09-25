// The SLICE of `src/shared/render/mask.ts` that the repair and brush modules
// read: the shared CENTRED frame space (`framePoint`), the cubic step every
// mask fades on, and a painted stroke's coverage. Nothing else of `mask.ts`
// (the six mask kinds, `maskAt`, the record) is here — when that module is
// ported whole into `Render/Mask.swift`, this file goes: every name below is
// the web's own, with the web's signature, so the fuller port replaces it
// symbol for symbol.
//
// Rules kept:
// - A point of the frame is measured CENTRED: the corner at radius 1 whatever
//   the aspect, so a radius means the same on a wide frame and on a square
//   crop of it — and a circle here is an ellipse in [0,1] space, which is why
//   points are converted (`strokePoints`) before a distance is taken.
// - A stroke of one point is a DAB, not nothing; the hardest brush keeps one
//   soft hair (`0.95`) so a raster never draws a bare step.
// - Strokes composite in the ORDER they were painted; an eraser only takes
//   away what is already down.

import Foundation

/// A point of the frame in the shared centred space: the corner at radius 1,
/// whatever the aspect. `u`/`v` are [0,1] across the frame.
public func framePoint(_ u: Double, _ v: Double, _ aspectRatio: Double) -> (Double, Double) {
    let ar = aspectRatio.isFinite && aspectRatio > 0 ? aspectRatio : 1
    let d = hypot(ar, 1)
    return (((u - 0.5) * 2 * ar) / d, ((v - 0.5) * 2) / d)
}

/// `3s² − 2s³` on [0,1], 0 below and 1 above — cubic rather than linear because
/// a linear ramp has a CORNER at each end, the one thing a mask must not have.
public func smoothStep01(_ s: Double) -> Double {
    if !(s > 0) { return 0 }
    if s >= 1 { return 1 }
    return s * s * (3 - 2 * s)
}

/// One stroke of a painted mask: a polyline in [0,1] frame coordinates with
/// the size and softness it was painted with. Vectors, never pixels.
public struct BrushStroke: Equatable, Sendable {
    /// In [0,1] frame coordinates, in the order they were painted.
    public var points: [Point]
    /// Half-width, as a fraction of the half-diagonal — the shared unit.
    public var radius: Double
    /// 0 is a soft edge that fades across the whole radius, 1 is a hard one.
    public var hardness: Double
    /// This stroke takes coverage AWAY: the eraser, as a stroke rather than a mode.
    public var erase: Bool

    public init(points: [Point], radius: Double, hardness: Double, erase: Bool = false) {
        self.points = points
        self.radius = radius
        self.hardness = hardness
        self.erase = erase
    }
}

/// The distance from `p` to the segment `a`–`b`.
@inline(__always)
private func distanceToSegment(_ px: Double, _ py: Double, _ ax: Double, _ ay: Double, _ bx: Double, _ by: Double) -> Double {
    let dx = bx - ax
    let dy = by - ay
    let len2 = dx * dx + dy * dy
    // A stroke of one point is a dab, and its "segment" is that point.
    let t = len2 > 0 ? max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
    let qx = ax + t * dx - px
    let qy = ay + t * dy - py
    return hypot(qx, qy)
}

/// A stroke's points in the shared CENTRED space — converted once per stroke,
/// never per texel.
public func strokePoints(_ stroke: BrushStroke, _ aspectRatio: Double) -> [Point] {
    stroke.points.map { p in
        let (x, y) = framePoint(p.x, p.y, aspectRatio)
        return Point(x, y)
    }
}

/// How much a stroke of this shape covers a point, both already CENTRED.
/// `hardness` decides where the fall begins — at 1 the whole radius is solid
/// and only the last hair softens; at 0 it fades from the spine outward.
public func coverageAt(_ points: [Point], _ radius: Double, _ hardness: Double, _ px: Double, _ py: Double) -> Double {
    let r = max(radius, 1e-6)
    if points.isEmpty { return 0 }
    var best: Double
    if points.count == 1 {
        best = hypot(points[0].x - px, points[0].y - py)
    } else {
        best = .infinity
        for i in 1..<points.count {
            let a = points[i - 1]
            let b = points[i]
            let d = distanceToSegment(px, py, a.x, a.y, b.x, b.y)
            if d < best { best = d }
            // Nothing beyond here can be closer than the spine itself.
            if best == 0 { break }
        }
    }
    if best >= r { return 0 }
    // The solid core, as a fraction of the radius. Capped below 1 so even the
    // hardest brush keeps one soft hair and does not draw a jagged edge.
    let core = clamp(hardness, 0, 1) * 0.95
    return smoothStep01((1 - best / r) / (1 - core))
}

/// The same, from the stroke itself — for a spec, or a one-off question.
public func strokeCoverage(_ stroke: BrushStroke, _ px: Double, _ py: Double, _ aspectRatio: Double = 1) -> Double {
    coverageAt(strokePoints(stroke, aspectRatio), stroke.radius, stroke.hardness, px, py)
}

/// The whole painted mask at a CENTRED point: the strokes laid down in order,
/// each adding coverage or taking it away.
public func brushCoverageAt(_ strokes: [BrushStroke], _ px: Double, _ py: Double, _ aspectRatio: Double = 1) -> Double {
    var out = 0.0
    for stroke in strokes {
        let c = strokeCoverage(stroke, px, py, aspectRatio)
        if c <= 0 { continue }
        out = stroke.erase ? out * (1 - c) : out + (1 - out) * c
    }
    return out
}
