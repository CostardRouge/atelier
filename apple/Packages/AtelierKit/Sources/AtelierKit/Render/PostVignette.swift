// The POST-CROP VIGNETTE — Lightroom's Effects vignette: a darkening (or a
// lightening) toward the edges of the picture AS DELIVERED, so it follows the
// crop, where the lens correction's vignetting (`Lens.swift`) follows the
// optics of the whole frame. Port of `src/shared/render/post-vignette.ts`,
// plus the pure half of `src/shared/develop/vignette-frame.ts` (`frameAffine`).
//
// The rules it keeps:
// - the crop is drawn AFTER the graph, so the pass is handed an AFFINE from
//   the picture's image coordinates to the delivered frame's, read off the
//   very `framePoint` the crop is drawn with; it depends on the ASPECTS only;
// - only Amount does anything — the other four shape a vignette that is not
//   there, so a record at Amount 0 is nil;
// - the move is made in LINEAR light, like every gain in the graph, and a
//   bright pixel is spared a dark vignette by Highlights.

import Foundation

public struct PostCropVignette: Equatable, Sendable {
    /// −100..100: dark below zero, light above.
    public var amount: Double
    /// 0..100: how far in the falloff begins.
    public var midpoint: Double
    /// −100..100: 0 an ellipse fitted to the frame, +100 a circle, −100 toward a rounded rectangle.
    public var roundness: Double
    /// 0..100: how soft the falloff is.
    public var feather: Double
    /// 0..100: how much a bright pixel is spared a dark vignette.
    public var highlights: Double

    public init(amount: Double = 0, midpoint: Double = 50, roundness: Double = 0, feather: Double = 50, highlights: Double = 0) {
        self.amount = amount; self.midpoint = midpoint; self.roundness = roundness; self.feather = feather; self.highlights = highlights
    }

    /// The web's `DEFAULT_POST_VIGNETTE`.
    public static let `default` = PostCropVignette()
}

/// The sliders' reaches, by the record's key — the web's `POST_VIGNETTE_RANGES`.
public let postVignetteRanges: [String: (min: Double, max: Double)] = [
    "amount": (-100, 100),
    "midpoint": (0, 100),
    "roundness": (-100, 100),
    "feather": (0, 100),
    "highlights": (0, 100),
]

/// The keys in the record's own order.
private let postVignetteKeys: [(key: String, path: WritableKeyPath<PostCropVignette, Double>)] = [
    ("amount", \.amount),
    ("midpoint", \.midpoint),
    ("roundness", \.roundness),
    ("feather", \.feather),
    ("highlights", \.highlights),
]

/// Only Amount does anything: the other four shape a vignette that is not
/// there. (`Roll.swift` keeps a twin over the carried `JSONValue`.)
public func isDefaultPostVignette(_ v: PostCropVignette?) -> Bool {
    guard let v else { return true }
    return v.amount == 0
}

public func samePostVignette(_ a: PostCropVignette?, _ b: PostCropVignette?) -> Bool {
    if isDefaultPostVignette(a) || isDefaultPostVignette(b) { return isDefaultPostVignette(a) && isDefaultPostVignette(b) }
    return a == b
}

/// A stored vignette read back safely — each number clamped, a missing one its
/// default — or nil for none.
public func postVignetteOrNull(_ raw: JSONValue?) -> PostCropVignette? {
    guard let src = raw?.objectValue else { return nil }
    var out = PostCropVignette.default
    for entry in postVignetteKeys {
        guard let v = src[entry.key]?.finiteNumber, let range = postVignetteRanges[entry.key] else { continue }
        out[keyPath: entry.path] = max(range.min, min(range.max, v))
    }
    return isDefaultPostVignette(out) ? nil : out
}

/// A number as JavaScript prints it: no `.0` on a whole one.
private func plain(_ n: Double) -> String {
    if n.isFinite, n == n.rounded(), abs(n) < 1e15 { return String(Int64(n)) }
    return "\(n)"
}

/// `vignette −40` · `vignette −40, round +100` — Amount and what departs from the defaults.
public func describePostVignette(_ v: PostCropVignette?) -> String {
    guard let v, !isDefaultPostVignette(v) else { return "" }
    func s(_ n: Double) -> String { n > 0 ? "+\(plain(n))" : (n < 0 ? "−\(plain(abs(n)))" : "0") }
    var extra: [String] = []
    if v.midpoint != PostCropVignette.default.midpoint { extra.append("mid \(plain(v.midpoint))") }
    if v.roundness != 0 { extra.append("round \(s(v.roundness))") }
    if v.feather != PostCropVignette.default.feather { extra.append("feather \(plain(v.feather))") }
    if v.highlights != 0 { extra.append("highlights \(plain(v.highlights))") }
    return "vignette \(s(v.amount))" + (extra.isEmpty ? "" : ", " + extra.joined(separator: ", "))
}

/// The numbers the kernel takes — ONE place, read by the GPU and the maths alike.
public struct PostVignetteTerms: Equatable, Sendable {
    /// −1..1.
    public var amount: Double
    /// Where the falloff begins, in the frame's shape distance (1 at an edge's middle).
    public var start: Double
    /// How wide the falloff is, in the same units.
    public var width: Double
    /// −1..1.
    public var roundness: Double
    /// 0..1.
    public var highlights: Double

    public init(amount: Double, start: Double, width: Double, roundness: Double, highlights: Double) {
        self.amount = amount; self.start = start; self.width = width; self.roundness = roundness; self.highlights = highlights
    }
}

public func postVignetteTerms(_ v: PostCropVignette) -> PostVignetteTerms {
    PostVignetteTerms(
        amount: v.amount / 100,
        start: 0.25 + (v.midpoint / 100) * 0.9,
        width: 0.02 + (v.feather / 100) * 1.0,
        roundness: v.roundness / 100,
        highlights: v.highlights / 100
    )
}

/// Image coordinates → the delivered frame's, both in [0,1], y down:
/// `u = a·x + b·y + c`, `v = d·x + e·y + f`. The identity is a picture never cropped.
public struct FrameAffine: Equatable, Sendable, ExpressibleByArrayLiteral {
    public var a, b, c, d, e, f: Double

    public init(_ a: Double, _ b: Double, _ c: Double, _ d: Double, _ e: Double, _ f: Double) {
        self.a = a; self.b = b; self.c = c; self.d = d; self.e = e; self.f = f
    }

    public init(arrayLiteral elements: Double...) {
        precondition(elements.count == 6, "a FrameAffine takes six numbers")
        self.init(elements[0], elements[1], elements[2], elements[3], elements[4], elements[5])
    }

    /// The web's `IDENTITY_FRAME`.
    public static let identity: FrameAffine = [1, 0, 0, 0, 1, 0]

    /// As the web's tuple reads.
    public var values: [Double] { [a, b, c, d, e, f] }
}

@inline(__always) public func toFrame(_ affine: FrameAffine, _ x: Double, _ y: Double) -> (Double, Double) {
    (affine.a * x + affine.b * y + affine.c, affine.d * x + affine.e * y + affine.f)
}

@inline(__always) private func smoothstep(_ a: Double, _ b: Double, _ x: Double) -> Double {
    let t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)
}

/// How far a frame point is from the centre, in the vignette's own shape: 1
/// at the middle of an edge, more toward a corner. Roundness blends toward a
/// circle or raises the norm toward a rounded rectangle.
public func shapeDistance(_ u: Double, _ v: Double, _ frameAspect: Double, _ roundness: Double) -> Double {
    var x = (u - 0.5) * 2
    var y = (v - 0.5) * 2
    if roundness > 0 {
        let qx = frameAspect >= 1 ? x : x * frameAspect
        let qy = frameAspect >= 1 ? y / frameAspect : y
        x += (qx - x) * roundness
        y += (qy - y) * roundness
    }
    let n = roundness < 0 ? 2 + 8 * -roundness : 2
    return pow(pow(abs(x), n) + pow(abs(y), n), 1 / n)
}

/// One ENCODED pixel at frame point (u, v) through the vignette.
public func postVignetteAt(_ r: Double, _ g: Double, _ b: Double, _ u: Double, _ v: Double, _ frameAspect: Double,
                           _ terms: PostVignetteTerms) -> (Double, Double, Double) {
    let t = smoothstep(terms.start, terms.start + terms.width, shapeDistance(u, v, frameAspect, terms.roundness))
    if t.isNaN || t == 0 || terms.amount.isNaN || terms.amount == 0 { return (r, g, b) }
    let lr = toLinear(r, .srgb)
    let lg = toLinear(g, .srgb)
    let lb = toLinear(b, .srgb)
    if terms.amount < 0 {
        // A bright pixel is spared a dark vignette by Highlights.
        let y = 0.2126 * r + 0.7152 * g + 0.0722 * b
        let spare = 1 - terms.highlights * smoothstep(0.5, 1, y)
        let k = 1 + terms.amount * t * spare
        return (fromLinear(lr * k, .srgb), fromLinear(lg * k, .srgb), fromLinear(lb * k, .srgb))
    }
    let or = lr + (1 - lr) * terms.amount * t
    let og = lg + (1 - lg) * terms.amount * t
    let ob = lb + (1 - lb) * terms.amount * t
    return (fromLinear(or, .srgb), fromLinear(og, .srgb), fromLinear(ob, .srgb))
}

// MARK: - where the vignette lands (`develop/vignette-frame.ts`)

/// Image [0,1]² → frame [0,1]², read off the crop's `framePoint` at three
/// corners: the crop's map is affine (a scale, a turn, a mirror, a pan), so
/// three points are all of it. Depends on the aspects alone, so an export can
/// build it with no pixel size.
public func frameAffine(_ srcW: Double, _ srcH: Double, _ frameRatio: Double, _ framing: Framing?) -> FrameAffine {
    let f = framing ?? .default
    func at(_ x: Double, _ y: Double) -> (Double, Double) {
        let (fx, fy) = framePoint(x * srcW, y * srcH, srcW, srcH, frameRatio, 1, f)
        return (fx / frameRatio, fy)
    }
    let (u0, v0) = at(0, 0)
    let (ux, vx) = at(1, 0)
    let (uy, vy) = at(0, 1)
    return FrameAffine(ux - u0, uy - u0, u0, vx - v0, vy - v0, v0)
}
