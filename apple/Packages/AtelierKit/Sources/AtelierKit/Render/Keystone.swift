// KEYSTONE — the perspective a lens pointed up or down puts into a building,
// taken back out. Port of `src/shared/render/geometry.ts`; the plane types
// (`Point`, `Size`, `Rect`) are the kernel's own `Geometry.swift`.
//
// A homography carries the whole of it — converging verticals, converging
// horizontals, a rotation and the zoom that hides the corners a warp empties —
// in ONE 3×3 matrix, so one resample serves all of it. The rules it keeps:
// - the matrix is built and inverted HERE, where a spec can hold it; the
//   kernel that draws the warp only applies what it is given, and walks the
//   OUTPUT asking where each pixel came from, so it carries the INVERSE;
// - coordinates are normalised and centred, (0,0) the middle, (±0.5, ±0.5)
//   the corners, y DOWN, always in IMAGE space (the web's `imageUv` rule —
//   there is no y mirror here, and there must not be one);
// - built in a SQUARE space and conjugated by the aspect (`A · M · A⁻¹`), so
//   a rotation turns rather than shears and one number means the same on a
//   4:5 crop as on a 3:2 frame;
// - the order is fixed — perspective, aspect stretch, rotation, zoom;
// - a point bent past the horizon is nil, never a huge number, and numbers
//   that fold the plane give a nil sample matrix so a caller draws unwarped.

import Foundation

/// Row-major 3×3, homogeneous: `[a b c, d e f, g h i]`.
public struct Matrix3: Equatable, Sendable, ExpressibleByArrayLiteral {
    public var a, b, c, d, e, f, g, h, i: Double

    public init(_ a: Double, _ b: Double, _ c: Double,
                _ d: Double, _ e: Double, _ f: Double,
                _ g: Double, _ h: Double, _ i: Double) {
        self.a = a; self.b = b; self.c = c
        self.d = d; self.e = e; self.f = f
        self.g = g; self.h = h; self.i = i
    }

    /// Nine numbers, row-major — the web's tuple.
    public init(arrayLiteral elements: Double...) {
        precondition(elements.count == 9, "a Matrix3 takes nine numbers")
        self.init(elements[0], elements[1], elements[2], elements[3], elements[4], elements[5], elements[6], elements[7], elements[8])
    }

    /// The web's `IDENTITY_MATRIX`.
    public static let identity: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

    /// Row-major, as the web's tuple reads.
    public var values: [Double] { [a, b, c, d, e, f, g, h, i] }

    public subscript(_ index: Int) -> Double {
        switch index {
        case 0: return a
        case 1: return b
        case 2: return c
        case 3: return d
        case 4: return e
        case 5: return f
        case 6: return g
        case 7: return h
        case 8: return i
        default: preconditionFailure("a Matrix3 has nine entries")
        }
    }
}

public struct Keystone: Equatable, Sendable {
    /// −100..100. Converging verticals: above 0 widens the top, as pointing UP does.
    public var vertical: Double
    /// −100..100. Converging horizontals, for a wall shot from one side.
    public var horizontal: Double
    /// Degrees, −45..45. Levelling, carried in the SAME matrix so one resample serves both.
    public var rotation: Double
    /// −100..100. A horizontal stretch, for an anamorphic lens or to undo the
    /// squeeze a strong keystone leaves. 0 is untouched.
    public var aspect: Double
    /// 1..3. Zoom, which is how the empty corners a warp creates are hidden.
    public var scale: Double

    public init(vertical: Double = 0, horizontal: Double = 0, rotation: Double = 0, aspect: Double = 0, scale: Double = 1) {
        self.vertical = vertical; self.horizontal = horizontal; self.rotation = rotation; self.aspect = aspect; self.scale = scale
    }

    /// The web's `DEFAULT_KEYSTONE`.
    public static let `default` = Keystone()
}

/// How far ±100 bends the frame. Beyond this the far edge folds through infinity.
private let perspectiveReach = 0.45
/// ±100 stretches or squeezes the width by a third.
private let aspectReach = 1.0 / 3
public let minKeystoneScale = 1.0
public let maxKeystoneScale = 3.0
public let maxKeystoneRotation = 45.0

/// Whether a keystone does nothing; nil reads as neutral. (`Roll.swift` keeps a
/// twin over the carried `JSONValue`; this is the typed record's.)
public func isDefaultKeystone(_ k: Keystone?) -> Bool {
    guard let k else { return true }
    return k.vertical == 0 && k.horizontal == 0 && k.rotation == 0 && k.aspect == 0 && k.scale == 1
}

private func number(_ v: JSONValue?, _ fallback: Double) -> Double {
    v?.finiteNumber ?? fallback
}

/// A stored keystone read back safely; junk and non-finite values become neutral.
public func normaliseKeystone(_ raw: JSONValue?) -> Keystone {
    let src = raw?.objectValue ?? [:]
    return Keystone(
        vertical: clamp(number(src["vertical"], 0), -100, 100),
        horizontal: clamp(number(src["horizontal"], 0), -100, 100),
        rotation: clamp(number(src["rotation"], 0), -maxKeystoneRotation, maxKeystoneRotation),
        aspect: clamp(number(src["aspect"], 0), -100, 100),
        scale: clamp(number(src["scale"], 1), minKeystoneScale, maxKeystoneScale)
    )
}

/// As a document holds it: nil when it does nothing.
public func keystoneOrNull(_ raw: JSONValue?) -> Keystone? {
    guard let raw, !raw.isNull else { return nil }
    let k = normaliseKeystone(raw)
    return isDefaultKeystone(k) ? nil : k
}

/// By value, nil and neutral alike.
public func sameKeystone(_ a: Keystone?, _ b: Keystone?) -> Bool {
    (a ?? .default) == (b ?? .default)
}

public func multiplyMatrix3(_ x: Matrix3, _ y: Matrix3) -> Matrix3 {
    let a = x.a * y.a + x.b * y.d + x.c * y.g
    let b = x.a * y.b + x.b * y.e + x.c * y.h
    let c = x.a * y.c + x.b * y.f + x.c * y.i
    let d = x.d * y.a + x.e * y.d + x.f * y.g
    let e = x.d * y.b + x.e * y.e + x.f * y.h
    let f = x.d * y.c + x.e * y.f + x.f * y.i
    let g = x.g * y.a + x.h * y.d + x.i * y.g
    let h = x.g * y.b + x.h * y.e + x.i * y.h
    let i = x.g * y.c + x.h * y.f + x.i * y.i
    return Matrix3(a, b, c, d, e, f, g, h, i)
}

/// Map a point. The homogeneous divide is what makes it a PERSPECTIVE rather
/// than an affine transform — and a point whose w reaches zero has been bent
/// past the horizon, so it is reported as nil rather than as infinity.
@inline(__always) public func applyMatrix3(_ m: Matrix3, _ x: Double, _ y: Double) -> (Double, Double)? {
    let w = m.g * x + m.h * y + m.i
    if !w.isFinite || abs(w) < 1e-9 { return nil }
    return ((m.a * x + m.b * y + m.c) / w, (m.d * x + m.e * y + m.f) / w)
}

/// The inverse, or nil for a matrix that collapses the plane.
public func invertMatrix3(_ m: Matrix3) -> Matrix3? {
    let A = m.e * m.i - m.f * m.h
    let B = -(m.d * m.i - m.f * m.g)
    let C = m.d * m.h - m.e * m.g
    let det = m.a * A + m.b * B + m.c * C
    if !det.isFinite || abs(det) < 1e-12 { return nil }
    let inv = 1 / det
    let r0 = A * inv
    let r1 = -(m.b * m.i - m.c * m.h) * inv
    let r2 = (m.b * m.f - m.c * m.e) * inv
    let r3 = B * inv
    let r4 = (m.a * m.i - m.c * m.g) * inv
    let r5 = -(m.a * m.f - m.c * m.d) * inv
    let r6 = C * inv
    let r7 = -(m.a * m.h - m.b * m.g) * inv
    let r8 = (m.a * m.e - m.b * m.d) * inv
    return Matrix3(r0, r1, r2, r3, r4, r5, r6, r7, r8)
}

/// The FORWARD transform: where a point of the source lands in the corrected
/// frame, in normalised centred coordinates.
public func keystoneMatrix(_ k: Keystone, _ aspectRatio: Double = 1) -> Matrix3 {
    let ar = aspectRatio.isFinite && aspectRatio > 0 ? aspectRatio : 1

    let v = (k.vertical / 100) * perspectiveReach
    let h = (k.horizontal / 100) * perspectiveReach
    // The projective row: w = 1 + h·x + v·y, so one edge is divided by more
    // than the other and converges. This is the whole of a keystone.
    let perspective: Matrix3 = [1, 0, 0, 0, 1, 0, h, v, 1]

    let stretch = 1 + (k.aspect / 100) * aspectReach
    let squeeze: Matrix3 = [stretch, 0, 0, 0, 1, 0, 0, 0, 1]

    let rad = (k.rotation * Double.pi) / 180
    let cosR = cos(rad)
    let sinR = sin(rad)
    let rotate: Matrix3 = [cosR, -sinR, 0, sinR, cosR, 0, 0, 0, 1]

    let zoom: Matrix3 = [k.scale, 0, 0, 0, k.scale, 0, 0, 0, 1]

    let square = multiplyMatrix3(zoom, multiplyMatrix3(rotate, multiplyMatrix3(squeeze, perspective)))
    let toSquare: Matrix3 = [ar, 0, 0, 0, 1, 0, 0, 0, 1]
    let fromSquare: Matrix3 = [1 / ar, 0, 0, 0, 1, 0, 0, 0, 1]
    return multiplyMatrix3(fromSquare, multiplyMatrix3(square, toSquare))
}

/// What the kernel needs: DESTINATION to SOURCE, because a warp is drawn by
/// walking the output and asking where each pixel came from. Nil when the
/// numbers fold the plane, in which case the caller draws unwarped rather
/// than drawing nothing.
public func keystoneSampleMatrix(_ k: Keystone, _ aspectRatio: Double = 1) -> Matrix3? {
    invertMatrix3(keystoneMatrix(k, aspectRatio))
}

/// JavaScript's `Math.round`: halves go toward +∞.
private func jsRound(_ x: Double) -> Double {
    let f = x.rounded(.down)
    return x - f >= 0.5 ? f + 1 : f
}

/// A number as JavaScript prints it: no `.0` on a whole one.
private func plain(_ n: Double) -> String {
    if n.isFinite, n == n.rounded(), abs(n) < 1e15 { return String(Int64(n)) }
    return "\(n)"
}

/// JavaScript's `toFixed`.
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

/// `vertical +40 · rotation −1.5°`, or an empty string when it does nothing.
public func describeKeystone(_ k: Keystone?) -> String {
    guard let k, !isDefaultKeystone(k) else { return "" }
    var parts: [String] = []
    if k.vertical != 0 { parts.append("vertical \(k.vertical > 0 ? "+" : "−")\(plain(abs(k.vertical)))") }
    if k.horizontal != 0 { parts.append("horizontal \(k.horizontal > 0 ? "+" : "−")\(plain(abs(k.horizontal)))") }
    if k.rotation != 0 { parts.append("rotation \(k.rotation > 0 ? "+" : "−")\(plain(abs(k.rotation)))°") }
    if k.aspect != 0 { parts.append("aspect \(k.aspect > 0 ? "+" : "−")\(plain(abs(k.aspect)))") }
    if k.scale != 1 { parts.append("zoom \(toFixed(k.scale, 2))×") }
    return parts.joined(separator: " · ")
}

/// Column-major, the order a GPU's `float3x3` reads without a transpose.
public func toColumnMajor(_ m: Matrix3) -> [Float] {
    [Float(m.a), Float(m.d), Float(m.g), Float(m.b), Float(m.e), Float(m.h), Float(m.c), Float(m.f), Float(m.i)]
}
