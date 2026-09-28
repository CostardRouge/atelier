// MASKS — where an adjustment applies, as a number between 0 and 1 per pixel.
// Port of `src/shared/render/mask.ts`, the pure module the web's GLSL and its
// CPU raster are both held to; the app's Core Image kernels are checked
// against these functions the same way.
//
// The rules it keeps:
// - NO mask is the WHOLE picture (a layer starts global); an empty brush, a
//   colour range with no sample and a subject (which needs a model this
//   module has not got) cover NOTHING.
// - The coordinate space is the lens's: centred, the frame's corner at
//   radius 1 (half the diagonal), so a feather means the same on a 3:2 frame
//   and on a 4:5 crop of it.
// - A stroke is a VECTOR: points in [0,1] frame coordinates, distance
//   measured CENTRED (the two axes scale differently), strokes composited in
//   the order painted so an eraser only removes what is already down.
// - A luma band reads BRIGHTNESS, a colour range an opponent plane on ENCODED
//   values; every shape fades along `smoothStep01`, never a linear ramp.
// - A record read from a document is clamped and its junk left behind, never
//   refused whole; an unknown kind is no mask at all.

import Foundation

public enum MaskKind: String, Codable, Sendable, CaseIterable {
    case linear, radial, luma, colour, brush, subject
}

/// A straight edge with a soft transition. A darkened sky.
public struct LinearMask: Equatable, Sendable {
    /// The line's midpoint, in [0,1] frame coordinates — (0,0) is the top left.
    public var x: Double
    public var y: Double
    /// Degrees, read like a compass bearing: 0 covers the TOP of the frame and
    /// fades downward, 90 covers the right, 180 the bottom.
    public var angle: Double
    /// The width of the transition, as a fraction of the half-diagonal. 0 is a hard edge.
    public var feather: Double

    public init(x: Double = 0.5, y: Double = 0.4, angle: Double = 0, feather: Double = 0.35) {
        self.x = x; self.y = y; self.angle = angle; self.feather = feather
    }

    /// The web's `DEFAULT_LINEAR`.
    public static let `default` = LinearMask()
}

/// An ellipse, rotatable: a subject lifted out of its surround, or a vignette
/// drawn on purpose.
public struct RadialMask: Equatable, Sendable {
    /// The centre, in [0,1] frame coordinates.
    public var x: Double
    public var y: Double
    /// The half-axes, as fractions of the half-diagonal.
    public var radiusX: Double
    public var radiusY: Double
    /// Degrees the ellipse is turned by.
    public var angle: Double
    /// The soft band OUTSIDE the ellipse, as a fraction of the half-diagonal —
    /// so the ellipse a panel draws is exactly the fully-affected part.
    public var feather: Double

    public init(x: Double = 0.5, y: Double = 0.5, radiusX: Double = 0.4, radiusY: Double = 0.4, angle: Double = 0, feather: Double = 0.3) {
        self.x = x; self.y = y; self.radiusX = radiusX; self.radiusY = radiusY; self.angle = angle; self.feather = feather
    }

    /// The web's `DEFAULT_RADIAL`.
    public static let `default` = RadialMask()
}

/// A band of BRIGHTNESS rather than a place: the shadows alone, wherever they are.
public struct LumaMask: Equatable, Sendable {
    /// The band that is IN the mask, 0..1 of brightness.
    public var from: Double
    public var to: Double
    /// How far past each end the mask fades out, in the same units.
    public var feather: Double

    public init(from: Double = 0, to: Double = 0.35, feather: Double = 0.15) {
        self.from = from; self.to = to; self.feather = feather
    }

    /// The web's `DEFAULT_LUMA`.
    public static let `default` = LumaMask()
}

/// One colour the author sampled: WHERE it was taken (what the stage marks and
/// a second tap removes) and the colour there, ENCODED 0..1, the one the LAYER
/// sees, taken once at the tap so the mask does not slide when a slider below
/// it moves.
public struct ColourSample: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var r: Double
    public var g: Double
    public var b: Double

    public init(x: Double, y: Double, r: Double, g: Double, b: Double) {
        self.x = x; self.y = y; self.r = r; self.g = g; self.b = b
    }
}

/// A COLOUR RANGE — every pixel near one of the sampled colours, wherever it is.
public struct ColourMask: Equatable, Sendable {
    /// Up to `maxColourSamples`; none covers nothing, like an empty brush.
    public var samples: [ColourSample]
    /// Refine, 0..1: how far from a sample a colour may stray and still be in.
    public var range: Double

    public init(samples: [ColourSample] = [], range: Double = defaultColourRange) {
        self.samples = samples; self.range = range
    }
}

/// One painted stroke: a polyline with a width and a softness. VECTOR, never
/// pixels — a stroke painted on a 2048 px preview is the same stroke when the
/// 48-megapixel original is delivered.
public struct BrushStroke: Equatable, Sendable {
    /// In [0,1] frame coordinates, in the order they were painted.
    public var points: [Point]
    /// Half-width, as a fraction of the half-diagonal — the shared unit.
    public var radius: Double
    /// 0 is a soft edge that fades across the whole radius, 1 is a hard one.
    public var hardness: Double
    /// This stroke takes coverage AWAY: the eraser, as a stroke rather than a mode.
    public var erase: Bool

    public init(points: [Point], radius: Double = defaultBrushRadius, hardness: Double = defaultBrushHardness, erase: Bool = false) {
        self.points = points; self.radius = radius; self.hardness = hardness; self.erase = erase
    }
}

public struct BrushMask: Equatable, Sendable {
    public var strokes: [BrushStroke]

    public init(strokes: [BrushStroke] = []) { self.strokes = strokes }

    /// The web's `DEFAULT_BRUSH`.
    public static let `default` = BrushMask()
}

/// The SUBJECT the author pointed at, segmented by a model. What is stored is
/// the REQUEST — the points and which model answered them — never the pixels.
public struct SubjectMask: Equatable, Sendable {
    /// Where the author tapped, in [0,1] frame coordinates.
    public var points: [Point]
    /// Which model produced the cached raster; a mismatch refuses the cache.
    public var model: String

    public init(points: [Point] = [], model: String = subjectModel) {
        self.points = points; self.model = model
    }
}

/// The web's `Mask` union, one case per kind.
public enum Mask: Equatable, Sendable {
    case linear(LinearMask)
    case radial(RadialMask)
    case luma(LumaMask)
    case colour(ColourMask)
    case brush(BrushMask)
    case subject(SubjectMask)

    public var kind: MaskKind {
        switch self {
        case .linear: return .linear
        case .radial: return .radial
        case .luma: return .luma
        case .colour: return .colour
        case .brush: return .brush
        case .subject: return .subject
        }
    }
}

/// How a further mask COMBINES with what is there: Lightroom's Add, Subtract
/// and Intersect. `combineMask` is the maths; the layer kernel transcribes it.
public enum MaskOp: String, Codable, Sendable, CaseIterable {
    case add, subtract, intersect
}

/// `add` is the LARGER of the two — a union, so adding a shape to itself
/// changes nothing and two overlapping gradients never add up to more than
/// either. `subtract` is `m × (1 − v)` and `intersect` `m × v`: the product,
/// so two feathers crossing make a feather rather than the corner a `min` draws.
public func combineMask(_ m: Double, _ v: Double, _ op: MaskOp) -> Double {
    switch op {
    case .subtract: return m * (1 - v)
    case .intersect: return m * v
    case .add: return m > v ? m : v
    }
}

/// How many colours one range can hold — Lightroom's five.
public let maxColourSamples = 5

public let defaultColourRange = 0.5

/// The colour a range compares in: an OPPONENT plane (red–green, yellow–blue)
/// for the hue and chroma, and luma for the lightness at half the weight — so
/// a sampled blue takes in the sky's lighter and darker blues, and not a grey
/// of the same brightness.
@inline(__always) private func opponent(_ r: Double, _ g: Double, _ b: Double) -> (Double, Double, Double) {
    (r - g, (r + g) * 0.5 - b, lumaOf(r, g, b))
}

/// Refine → the distance inside which a colour is fully in; it fades out by twice that.
public func colourReach(_ range: Double) -> Double {
    0.04 + 0.36 * clamp(range, 0, 1)
}

/// How much of a colour a range takes in, 0..1: the nearest sample decides.
public func colourRangeAt(_ mask: ColourMask, _ r: Double, _ g: Double, _ b: Double) -> Double {
    let reach = colourReach(mask.range)
    let (a, y, l) = opponent(r, g, b)
    var best = 0.0
    for s in mask.samples {
        let (sa, sy, sl) = opponent(s.r, s.g, s.b)
        let dx = a - sa
        let dy = y - sy
        let dz = (l - sl) * 0.5
        let d = (dx * dx + dy * dy + dz * dz).squareRoot()
        let m = 1 - smoothStep01((d - reach) / reach)
        if m > best { best = m }
    }
    return best
}

/// The model a subject mask is made with. Stored on the mask, so a raster
/// cached by an older build is refused rather than shown as though current.
public let subjectModel = "mediapipe/magic_touch@1"

/// Where a new stroke starts, before the author touches the size or the softness.
public let defaultBrushRadius = 0.12
public let defaultBrushHardness = 0.5

/// A new mask of one kind, at its own sensible starting shape.
public func defaultMask(_ kind: MaskKind) -> Mask {
    switch kind {
    case .radial: return .radial(.default)
    case .luma: return .luma(.default)
    case .colour: return .colour(ColourMask(samples: [], range: defaultColourRange))
    case .brush: return .brush(BrushMask(strokes: []))
    case .subject: return .subject(SubjectMask(points: [], model: subjectModel))
    case .linear: return .linear(.default)
    }
}

private func number(_ v: JSONValue?, _ fallback: Double) -> Double {
    v?.finiteNumber ?? fallback
}

/// The ramp every shape fades along: 0 below, 1 above, smooth between.
/// Cubic (`3s² − 2s³`) rather than linear, because a linear ramp has a CORNER
/// at each end — a visible line where the adjustment starts.
@inline(__always) public func smoothStep01(_ s: Double) -> Double {
    if !(s > 0) { return 0 }
    if s >= 1 { return 1 }
    return s * s * (3 - 2 * s)
}

/// Rec. 709 luma — the brightness a luma mask selects on. Stated here rather
/// than taken from the develop, because a mask must not depend on the develop
/// it modulates.
public let rec709Luma: (Double, Double, Double) = (0.2126, 0.7152, 0.0722)

@inline(__always) public func lumaOf(_ r: Double, _ g: Double, _ b: Double) -> Double {
    rec709Luma.0 * r + rec709Luma.1 * g + rec709Luma.2 * b
}

/// A point of the frame in the shared centred space: the corner at radius 1,
/// whatever the aspect. `u`/`v` are [0,1] across the frame. (The web's
/// `mask.ts` `framePoint`; `Framing.swift`'s seven-argument `framePoint` is
/// the crop's, another function under the same web name.)
@inline(__always) public func framePoint(_ u: Double, _ v: Double, _ aspectRatio: Double) -> (Double, Double) {
    let ar = aspectRatio.isFinite && aspectRatio > 0 ? aspectRatio : 1
    let d = hypot(ar, 1)
    return (((u - 0.5) * 2 * ar) / d, ((v - 0.5) * 2) / d)
}

/// The distance from `p` to the segment `a`–`b`.
@inline(__always) private func distanceToSegment(_ px: Double, _ py: Double, _ ax: Double, _ ay: Double, _ bx: Double, _ by: Double) -> Double {
    let dx = bx - ax
    let dy = by - ay
    let len2 = dx * dx + dy * dy
    // A stroke of one point is a dab, and its "segment" is that point.
    let t = len2 > 0 ? max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
    let qx = ax + t * dx - px
    let qy = ay + t * dy - py
    return hypot(qx, qy)
}

/// A stroke's points in the shared CENTRED space — converted once per stroke
/// rather than per texel, which is why this is its own function.
public func strokePoints(_ stroke: BrushStroke, _ aspectRatio: Double) -> [Point] {
    stroke.points.map { p in
        let (x, y) = framePoint(p.x, p.y, aspectRatio)
        return Point(x, y)
    }
}

/// How much a stroke of this shape covers a point, both already CENTRED — the
/// raster's hot loop, so it takes a buffer and allocates nothing.
///
/// `hardness` decides where the fall begins — at 1 the whole radius is solid
/// and only the last hair softens (never a bare step, which would alias); at 0
/// it fades from the spine outward.
public func coverageAt(_ points: UnsafeBufferPointer<Point>, _ radius: Double, _ hardness: Double, _ px: Double, _ py: Double) -> Double {
    let r = max(radius, 1e-6)
    let n = points.count
    if n == 0 { return 0 }
    var best: Double
    if n == 1 {
        best = hypot(points[0].x - px, points[0].y - py)
    } else {
        best = .infinity
        var i = 1
        while i < n {
            let a = points[i - 1]
            let b = points[i]
            let d = distanceToSegment(px, py, a.x, a.y, b.x, b.y)
            if d < best { best = d }
            // Nothing beyond here can be closer than the spine itself.
            if best == 0 { break }
            i += 1
        }
    }
    if best >= r { return 0 }
    // The solid core, as a fraction of the radius. Capped below 1 so even the
    // hardest brush keeps one soft hair and does not draw a jagged edge.
    let core = clamp(hardness, 0, 1) * 0.95
    return smoothStep01((1 - best / r) / (1 - core))
}

/// The same, from an array of centred points.
public func coverageAt(_ points: [Point], _ radius: Double, _ hardness: Double, _ px: Double, _ py: Double) -> Double {
    points.withUnsafeBufferPointer { coverageAt($0, radius, hardness, px, py) }
}

/// The same, from the stroke itself — for a spec, or a one-off question.
public func strokeCoverage(_ stroke: BrushStroke, _ px: Double, _ py: Double, _ aspectRatio: Double = 1) -> Double {
    coverageAt(strokePoints(stroke, aspectRatio), stroke.radius, stroke.hardness, px, py)
}

/// The whole painted mask at a CENTRED point: the strokes laid down in order,
/// each adding coverage or taking it away. An eraser only removes what is
/// already there, so a stroke painted AFTER it comes back — painting, not set
/// arithmetic.
public func brushCoverageAt(_ strokes: [BrushStroke], _ px: Double, _ py: Double, _ aspectRatio: Double = 1) -> Double {
    var out = 0.0
    for stroke in strokes {
        let c = strokeCoverage(stroke, px, py, aspectRatio)
        if c <= 0 { continue }
        out = stroke.erase ? out * (1 - c) : out + (1 - out) * c
    }
    return out
}

/// How much of the adjustment lands at this point: 0 to 1.
///
/// `luma` is the pixel's own brightness, which only a luma mask reads; `rgb`
/// the pixel itself, ENCODED, which only a colour range reads (without it one
/// covers nothing). One signature for every kind, so a caller never branches.
public func maskAt(_ mask: Mask?, _ u: Double, _ v: Double, _ luma: Double, _ aspectRatio: Double = 1,
                   rgb: (Double, Double, Double)? = nil) -> Double {
    // No mask is the WHOLE picture, not none of it: a layer with nothing drawn
    // on it is a global adjustment, which is how one is started.
    guard let mask else { return 1 }

    switch mask {
    case .luma(let m):
        let f = max(m.feather, 0)
        if f <= 0 { return luma >= m.from && luma <= m.to ? 1 : 0 }
        let up = smoothStep01((luma - (m.from - f)) / f)
        let down = smoothStep01((m.to + f - luma) / f)
        return up * down

    case .colour(let m):
        guard let rgb else { return 0 }
        return colourRangeAt(m, rgb.0, rgb.1, rgb.2)

    case .brush(let m):
        let (px, py) = framePoint(u, v, aspectRatio)
        return brushCoverageAt(m.strokes, px, py, aspectRatio)

    case .subject:
        // A SUBJECT cannot be answered here: it takes a model, and this module
        // is pure. 0 rather than 1, for the same reason an empty brush covers
        // nothing — and the renderer never asks, it samples the cached raster.
        return 0

    case .linear(let m):
        let (px, py) = framePoint(u, v, aspectRatio)
        let (cx, cy) = framePoint(m.x, m.y, aspectRatio)
        let a = (m.angle * Double.pi) / 180
        // At angle 0 this points UP the frame (y grows downward), so the
        // covered side is the top. Turning it is a compass bearing from there.
        let dx = sin(a)
        let dy = -cos(a)
        let t = (px - cx) * dx + (py - cy) * dy
        let f = max(m.feather, 0)
        if f <= 0 { return t >= 0 ? 1 : 0 }
        // Centred on the line: half the fade each side, so the line a panel
        // draws is where the mask reads 0.5.
        return smoothStep01(t / f + 0.5)

    case .radial(let m):
        let (px, py) = framePoint(u, v, aspectRatio)
        let (cx, cy) = framePoint(m.x, m.y, aspectRatio)
        let a = (m.angle * Double.pi) / 180
        let cosA = cos(a)
        let sinA = sin(a)
        let ox = px - cx
        let oy = py - cy
        // Into the ellipse's own frame.
        let qx = ox * cosA + oy * sinA
        let qy = -ox * sinA + oy * cosA
        let rx = max(m.radiusX, 1e-6)
        let ry = max(m.radiusY, 1e-6)
        let e = hypot(qx / rx, qy / ry)
        let f = max(m.feather, 0)
        if f <= 0 { return e <= 1 ? 1 : 0 }
        // 1 inside the ellipse, 0 by `feather` past it.
        return smoothStep01((1 + f - e) / f)
    }
}

// MARK: - the record

/// A stored `[x, y]` pair, or nil for junk; each coordinate clamped to `lo…hi`.
private func readPair(_ p: JSONValue, _ lo: Double, _ hi: Double) -> Point? {
    guard let pair = p.arrayValue, pair.count >= 2 else { return nil }
    guard let x = pair[0].finiteNumber, let y = pair[1].finiteNumber else { return nil }
    return Point(clamp(x, lo, hi), clamp(y, lo, hi))
}

public func normaliseMask(_ raw: JSONValue?) -> Mask? {
    guard let src = raw?.objectValue else { return nil }
    let kind = src["kind"]?.stringValue
    if kind == "radial" {
        return .radial(RadialMask(
            x: clamp(number(src["x"], RadialMask.default.x), -1, 2),
            y: clamp(number(src["y"], RadialMask.default.y), -1, 2),
            radiusX: clamp(number(src["radiusX"], RadialMask.default.radiusX), 0.01, 3),
            radiusY: clamp(number(src["radiusY"], RadialMask.default.radiusY), 0.01, 3),
            angle: clamp(number(src["angle"], 0), -180, 180),
            feather: clamp(number(src["feather"], RadialMask.default.feather), 0, 2)
        ))
    }
    if kind == "luma" {
        // Swapped ends are a slider dragged past its partner, not a broken record.
        let a = clamp(number(src["from"], LumaMask.default.from), 0, 1)
        let b = clamp(number(src["to"], LumaMask.default.to), 0, 1)
        return .luma(LumaMask(from: min(a, b), to: max(a, b), feather: clamp(number(src["feather"], LumaMask.default.feather), 0, 1)))
    }
    if kind == "colour" {
        var samples: [ColourSample] = []
        for entry in src["samples"]?.arrayValue ?? [] {
            guard let e = entry.objectValue else { continue }
            guard let x = e["x"]?.finiteNumber, let y = e["y"]?.finiteNumber,
                  let r = e["r"]?.finiteNumber, let g = e["g"]?.finiteNumber, let b = e["b"]?.finiteNumber else { continue }
            samples.append(ColourSample(x: clamp01(x), y: clamp01(y), r: clamp01(r), g: clamp01(g), b: clamp01(b)))
            if samples.count >= maxColourSamples { break }
        }
        return .colour(ColourMask(samples: samples, range: clamp01(number(src["range"], defaultColourRange))))
    }
    if kind == "brush" {
        var strokes: [BrushStroke] = []
        for entry in src["strokes"]?.arrayValue ?? [] {
            guard let e = entry.objectValue else { continue }
            let points = (e["points"]?.arrayValue ?? []).compactMap { readPair($0, -1, 2) }
            // A stroke with no point draws nothing, so it is not kept: an empty
            // entry would otherwise survive every round trip for ever.
            if points.isEmpty { continue }
            strokes.append(BrushStroke(
                points: points,
                radius: clamp(number(e["radius"], defaultBrushRadius), 0.002, 2),
                hardness: clamp(number(e["hardness"], defaultBrushHardness), 0, 1),
                erase: e["erase"]?.boolValue == true
            ))
            if strokes.count >= maxStrokes { break }
        }
        return .brush(BrushMask(strokes: strokes))
    }
    if kind == "subject" {
        let points = (src["points"]?.arrayValue ?? []).compactMap { readPair($0, 0, 1) }
        let model = src["model"]?.stringValue
        return .subject(SubjectMask(points: points, model: (model?.isEmpty == false) ? model! : subjectModel))
    }
    if kind != "linear" { return nil }
    return .linear(LinearMask(
        x: clamp(number(src["x"], LinearMask.default.x), -1, 2),
        y: clamp(number(src["y"], LinearMask.default.y), -1, 2),
        angle: clamp(number(src["angle"], 0), -180, 180),
        feather: clamp(number(src["feather"], LinearMask.default.feather), 0, 2)
    ))
}

/// The cap on one mask's strokes: the cost is in the area painted rather than
/// the count, but a document with no limit at all can be made unopenable.
public let maxStrokes = 500

/// Two masks that mean the same shape — by value, never by reference.
public func sameMask(_ a: Mask?, _ b: Mask?) -> Bool {
    a == b
}

/// A copy safe to hold against a live draft. A value type copies on its own;
/// the function survives so a caller reads as the web's does.
public func cloneMask(_ m: Mask?) -> Mask? {
    m
}

/// JavaScript's `Math.round`: halves go toward +∞, so `−22.5` is `−22`.
private func jsRound(_ x: Double) -> Double {
    let f = x.rounded(.down)
    return x - f >= 0.5 ? f + 1 : f
}

/// JavaScript's `toFixed`, on a non-negative value: the nearest `digits`-place
/// decimal, halves rounded up.
private func toFixed(_ x: Double, _ digits: Int) -> String {
    let p = pow(10.0, Double(digits))
    let n = jsRound(x * p)
    var s = String(Int64(abs(n)))
    if digits > 0 {
        while s.count <= digits { s = "0" + s }
        s.insert(".", at: s.index(s.endIndex, offsetBy: -digits))
    }
    return (n < 0 ? "-" : "") + s
}

/// `radial · 40 %`, `linear · 0°`, `shadows`, or `the whole picture`.
public func describeMask(_ m: Mask?) -> String {
    guard let m else { return "the whole picture" }
    switch m {
    case .linear(let l):
        return "linear · \(Int(jsRound(l.angle)))°"
    case .radial(let r):
        return "radial · \(Int(jsRound(r.radiusX * 100))) %"
    case .brush(let b):
        let n = b.strokes.count
        return n == 0 ? "painted · nothing yet" : "painted · \(n) stroke\(n == 1 ? "" : "s")"
    case .subject(let s):
        let n = s.points.count
        return n == 0 ? "subject · tap it" : "subject · \(n) point\(n == 1 ? "" : "s")"
    case .colour(let c):
        let n = c.samples.count
        return n == 0 ? "colour · tap one" : "colour · \(n) sample\(n == 1 ? "" : "s")"
    case .luma(let l):
        // A luma band gets a WORD where it has one: "shadows" says more than
        // "0.00–0.35" to anybody, and the numbers are on the sliders anyway.
        if l.to <= 0.4 && l.from <= 0.05 { return "shadows" }
        if l.from >= 0.6 && l.to >= 0.95 { return "highlights" }
        if l.from > 0.05 && l.to < 0.95 { return "midtones" }
        return "luma \(toFixed(l.from, 2))–\(toFixed(l.to, 2))"
    }
}
