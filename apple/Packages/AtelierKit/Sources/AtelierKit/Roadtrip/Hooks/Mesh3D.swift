// A very small software 3D renderer for a cartoon on a map — the car the
// Virée opener drives, and nothing heavier. Port of
// `src/shared/roadtrip/hooks/mesh3d.ts`, everything up to the ORDERED list of
// projected polygons with their fill and ink; the canvas paint itself
// (`paintMesh`, `paintGroundShadow`) is the app's, and what it decides —
// each face's colour, stroke and width, the shadow's ellipses — is ported as
// `paintSteps` and `groundShadow` so both clients paint the same picture.
//
// Why not a 3D library (the web's reasoning, which the native app keeps): the
// car is ~180 flat-shaded faces drawn a few hundred times per export; a
// painter's algorithm over convex parts costs nothing and stays inside the
// engine's one seam.
//
// The model: a list of PARTS, each a convex solid (a box, a cylinder, an
// extruded plan) or a flat decal, made of faces wound counter-clockwise seen
// from outside. Convexity is what makes the picture right without a depth
// buffer: within a part, back-face culling alone leaves exactly the visible
// faces. The view is a 2.5D orthographic camera looking north and down at
// `tilt` above the ground — a half-turn (π/2) is straight down, the map's own.
//
// Coordinates. Model: x to the right, y forward (the nose), z up, ground at
// z = 0. World: X east (screen right), Y north (screen UP), Z up. The pose
// turns the model about Z so its nose points along a unit heading (fx, fy),
// then scales it to pixels and places its origin on screen.
//
// The rules it keeps (`roadtrip.md`, «Virée»; `docs/hook-engine.md` §13):
// - ordering is ONE sort over every visible FACE, keyed on the depth of the
//   face's FARTHEST vertex — never per part (a decal lies ON its host, the
//   cabin sits ON a body whose top spans the car; a part-centre sort buried
//   both), equal keys keeping build order so a pose paints the same sequence
//   twice;
// - the few pairs one key cannot order are SETTLED by an exact overlap test
//   (clip one projected outline to the other, read both planes' depth inside
//   the shared region), bounded — a window of 24, four moves a face — and it
//   NEVER splits a polygon: the ink is stroked once per face, so a fragment
//   would scribble a seam. A BSP tree is ruled out for that reason;
// - a polygon with no area is dropped, never painted as a sliver;
// - the sampled depth-buffer ORACLE the specs hold this to lives in
//   `RenderOrderTests.swift`, ported with its thresholds.
//
// Numbers follow the web's: `hypot` is V8's (normalised Kahan sum),
// `Math.round` is JavaScript's (half up), `Math.max(0, …)` never keeps a −0,
// and every expression keeps the web's evaluation order. MEASURED against the
// web's own output (node; 864 poses = 3 gear sets × 2 finishes × 6 tilts ×
// 24 headings, 2026-09-26):
// the model is identical vertex for vertex and the order face for face, save
// for what `sin`/`cos` put in the last ulp — V8's libm is not the platform's
// (glibc here, Apple's on a device) — which moves a vertex of the round decals
// by an ulp and, in 12 of the 864 poses, swaps two left/right-symmetric faces
// whose depths TIE to the ulp: faces that do not overlap, so the picture is
// the same. The oracle's measures land where the web's comments say (worst
// part keeps 54 %, worst pose 1.9 % wrong). Hot loops reuse scratch buffers;
// nothing is allocated per vertex.

import Foundation

/// The namespace of the software renderer — the web module `mesh3d.ts`. Its
/// names (`Part`, `Face`, `Pose`, `dot`, `box`…) are too generic for the
/// kernel's module scope, so they live here: `Mesh3D.renderOrder(...)`.
public enum Mesh3D {}

// MARK: - The model

extension Mesh3D {
    /// A point or a direction in model or world space — the web's `Vec3`
    /// (`readonly [number, number, number]`), writable as `[x, y, z]`.
    public struct Vec3: Equatable, Sendable, ExpressibleByArrayLiteral, CustomStringConvertible {
        public var x: Double
        public var y: Double
        public var z: Double

        @inlinable public init(_ x: Double, _ y: Double, _ z: Double) {
            self.x = x; self.y = y; self.z = z
        }

        public init(arrayLiteral elements: Double...) {
            precondition(elements.count == 3, "a Vec3 is three numbers")
            self.init(elements[0], elements[1], elements[2])
        }

        /// The web's `v[0]`, `v[1]`, `v[2]`.
        @inlinable public subscript(i: Int) -> Double {
            i == 0 ? x : (i == 1 ? y : z)
        }

        public var description: String { "[\(x), \(y), \(z)]" }
    }

    public struct Face: Equatable, Sendable {
        public var verts: [Vec3]
        /// A colour role, resolved through a palette at paint time.
        public var role: String

        public init(verts: [Vec3], role: String) {
            self.verts = verts; self.role = role
        }
    }

    public enum Axis: String, Sendable {
        case x, y, z
    }

    /// A cylinder turns about x or y only — the web's `'x' | 'y'`.
    public enum CylinderAxis: String, Sendable {
        case x, y

        var axis: Axis { self == .x ? .x : .y }
    }

    /// Turn the part about an axis through `pivot` by the pose's spin for its id.
    public struct Spin: Equatable, Sendable {
        public var pivot: Vec3
        public var axis: Axis

        public init(pivot: Vec3, axis: Axis) {
            self.pivot = pivot; self.axis = axis
        }
    }

    public struct Part: Equatable, Sendable {
        public var id: String
        public var faces: [Face]
        /// The part's middle.
        public var centre: Vec3
        /// Draw the ink outline on this part's faces.
        public var outline: Bool
        public var spin: Spin?

        public init(id: String, faces: [Face], centre: Vec3, outline: Bool, spin: Spin? = nil) {
            self.id = id; self.faces = faces; self.centre = centre; self.outline = outline; self.spin = spin
        }
    }

    public struct Pose: Equatable, Sendable {
        /// The nose's direction in the world: a unit vector, X east and Y north.
        public var fx: Double
        public var fy: Double
        /// The camera's elevation above the ground, radians; π/2 looks straight down.
        public var tilt: Double
        /// Pixels per model unit.
        public var scale: Double
        /// Where the model's origin lands on screen.
        public var x: Double
        public var y: Double
        /// Spin angles, radians, by part id — the wheels. Absent is 0.
        public var spins: [String: Double]

        public init(fx: Double, fy: Double, tilt: Double, scale: Double, x: Double, y: Double,
                    spins: [String: Double] = [:]) {
            self.fx = fx; self.fy = fy; self.tilt = tilt; self.scale = scale; self.x = x; self.y = y
            self.spins = spins
        }
    }

    public struct Projected: Equatable, Sendable {
        public var x: Double
        public var y: Double
        /// Larger is farther from the camera.
        public var depth: Double

        public init(x: Double, y: Double, depth: Double) {
            self.x = x; self.y = y; self.depth = depth
        }
    }
}

// MARK: - Vector arithmetic

extension Mesh3D {
    /// A model-space point after the pose, in world axes, still in model units.
    @inlinable public static func toWorld(_ p: Vec3, fx: Double, fy: Double) -> Vec3 {
        // R·(0,1) = (fx, fy): the nose goes where the heading points, the
        // right-hand side a quarter-turn clockwise from it.
        Vec3(p.x * fy + p.y * fx, -p.x * fx + p.y * fy, p.z)
    }

    @inlinable public static func toWorld(_ p: Vec3, _ pose: Pose) -> Vec3 {
        toWorld(p, fx: pose.fx, fy: pose.fy)
    }

    /// A world point on screen, and its distance along the view.
    public static func project(_ w: Vec3, _ pose: Pose) -> Projected {
        projected(w, sin(pose.tilt), cos(pose.tilt), pose)
    }

    /// `project` with the tilt's sine and cosine taken once per frame.
    @inline(__always) fileprivate static func projected(_ w: Vec3, _ s: Double, _ c: Double, _ pose: Pose) -> Projected {
        let lift = w.y * s + w.z * c
        return Projected(x: pose.x + w.x * pose.scale, y: pose.y - lift * pose.scale, depth: w.y * c - w.z * s)
    }

    /// The camera's own direction of view, for the tilt: north and down.
    public static func viewDirection(_ tilt: Double) -> Vec3 {
        Vec3(0, cos(tilt), -sin(tilt))
    }

    @inlinable public static func cross(_ a: Vec3, _ b: Vec3) -> Vec3 {
        Vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
    }

    @inlinable public static func dot(_ a: Vec3, _ b: Vec3) -> Double {
        a.x * b.x + a.y * b.y + a.z * b.z
    }

    @inlinable public static func sub(_ a: Vec3, _ b: Vec3) -> Vec3 {
        Vec3(a.x - b.x, a.y - b.y, a.z - b.z)
    }

    /// A unit vector, or straight up for the zero vector.
    public static func normalise(_ v: Vec3) -> Vec3 {
        let n = hypot3(v.x, v.y, v.z)
        return n > 0 ? Vec3(v.x / n, v.y / n, v.z / n) : Vec3(0, 0, 1)
    }

    /// A polygon's normal by Newell's method — sound for any planar polygon.
    public static func faceNormal(_ verts: [Vec3]) -> Vec3 {
        var nx = 0.0, ny = 0.0, nz = 0.0
        let count = verts.count
        for i in 0..<count {
            let a = verts[i]
            let b = verts[(i + 1) % count]
            nx += (a.y - b.y) * (a.z + b.z)
            ny += (a.z - b.z) * (a.x + b.x)
            nz += (a.x - b.x) * (a.y + b.y)
        }
        return normalise(Vec3(nx, ny, nz))
    }

    public static func centroid(_ verts: [Vec3]) -> Vec3 {
        var x = 0.0, y = 0.0, z = 0.0
        for v in verts {
            x += v.x
            y += v.y
            z += v.z
        }
        let n = Double(max(1, verts.count))
        return Vec3(x / n, y / n, z / n)
    }

    /// Rotate `p` about an axis through `pivot` by `angle` radians.
    public static func rotateAbout(_ p: Vec3, _ pivot: Vec3, _ axis: Axis, _ angle: Double) -> Vec3 {
        let c = cos(angle)
        let s = sin(angle)
        let d = sub(p, pivot)
        let r: Vec3
        switch axis {
        case .x: r = Vec3(d.x, d.y * c - d.z * s, d.y * s + d.z * c)
        case .y: r = Vec3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c)
        case .z: r = Vec3(d.x * c - d.y * s, d.x * s + d.y * c, d.z)
        }
        return Vec3(r.x + pivot.x, r.y + pivot.y, r.z + pivot.z)
    }
}

/// V8's `Math.hypot` over three numbers, exactly: normalised to the largest
/// magnitude, Kahan-summed, `sqrt(sum) × max` — so a normal lands on the very
/// bits it lands on in the browser.
private func hypot3(_ a: Double, _ b: Double, _ c: Double) -> Double {
    let x = abs(a), y = abs(b), z = abs(c)
    if a.isNaN || b.isNaN || c.isNaN {
        return x == .infinity || y == .infinity || z == .infinity ? .infinity : .nan
    }
    var top = 0.0
    if x > top { top = x }
    if y > top { top = y }
    if z > top { top = z }
    if top == .infinity { return .infinity }
    if top == 0 { return 0 }
    // Kahan summation over the three, in argument order, as V8 walks them.
    var sum = 0.0
    var compensation = 0.0
    var n = x / top
    var summand = n * n - compensation
    var preliminary = sum + summand
    compensation = (preliminary - sum) - summand
    sum = preliminary
    n = y / top
    summand = n * n - compensation
    preliminary = sum + summand
    compensation = (preliminary - sum) - summand
    sum = preliminary
    n = z / top
    summand = n * n - compensation
    preliminary = sum + summand
    sum = preliminary
    return sum.squareRoot() * top
}

/// JavaScript's `Math.max(0, v)` — which is +0 for a −0, where Swift's `max` keeps the −0.
@inline(__always) private func atLeastZero(_ v: Double) -> Double {
    v > 0 ? v : 0
}

/// JavaScript's `Math.round`: the nearest integer, halves toward +∞.
private func jsRound(_ v: Double) -> Double {
    let down = v.rounded(.down)
    return v - down >= 0.5 ? down + 1 : down
}

// MARK: - Light and colour

extension Mesh3D {
    /// Two directional lights, world-space unit vectors TOWARD each: a key from
    /// behind the camera's left shoulder and high, a weaker fill from the other
    /// side, so no side of a turning car is ever the same flat tone as its
    /// neighbour. The key also throws a highlight, which is what lets a black
    /// car read as a shape rather than a silhouette.
    public struct Light: Equatable, Sendable {
        public var key: Vec3
        public var fill: Vec3
        public var ambient: Double
        public var keyWeight: Double
        public var fillWeight: Double
        /// Strength of the highlight the key throws, 0..1.
        public var gloss: Double
        /// A broad, additive sheen from the key — light a matte coating scatters
        /// back rather than reflects. A multiplier cannot lift a black surface,
        /// so a matte black car with no gloss would be a silhouette with inked
        /// edges; this is the term that keeps it a shape. Absent = none.
        public var sheen: Double?

        public init(key: Vec3, fill: Vec3, ambient: Double, keyWeight: Double, fillWeight: Double,
                    gloss: Double, sheen: Double? = nil) {
            self.key = key; self.fill = fill; self.ambient = ambient
            self.keyWeight = keyWeight; self.fillWeight = fillWeight; self.gloss = gloss; self.sheen = sheen
        }

        /// The web's `DEFAULT_LIGHT`.
        public static let `default` = Light(
            key: Mesh3D.normalise(Vec3(-0.5, -0.42, 0.75)),
            fill: Mesh3D.normalise(Vec3(0.6, 0.5, 0.55)),
            ambient: 0.4,
            keyWeight: 0.48,
            fillWeight: 0.16,
            gloss: 0.34
        )
    }

    /// The shade (a multiplier) and the highlight (added) one face gets.
    public struct Lighting: Equatable, Sendable {
        public var shade: Double
        public var highlight: Double
    }

    /// The shade and the highlight a face of normal `n` gets.
    public static func lighting(_ n: Vec3, _ light: Light) -> Lighting {
        let k = atLeastZero(dot(n, light.key))
        let f = atLeastZero(dot(n, light.fill))
        let shade = light.ambient + light.keyWeight * k + light.fillWeight * f
        let highlight = light.gloss * pow(k, 3) + (light.sheen ?? 0) * k
        return Lighting(shade: shade, highlight: highlight)
    }

    /// An 8-bit colour — the web's `[r, g, b]`.
    public struct Rgb: Equatable, Sendable {
        public var r: Int
        public var g: Int
        public var b: Int

        public init(_ r: Int, _ g: Int, _ b: Int) {
            self.r = r; self.g = g; self.b = b
        }

        /// `rgb(r,g,b)`, as the canvas takes it.
        public var css: String { "rgb(\(r),\(g),\(b))" }
    }

    /// `#rrggbb` → its three channels; anything else is mid grey rather than a throw.
    public static func hexToRgb(_ hex: String) -> Rgb {
        let bytes = Array(hex.utf8)
        guard bytes.count == 7, bytes[0] == UInt8(ascii: "#") else { return Rgb(128, 128, 128) }
        var digits: [Int] = []
        digits.reserveCapacity(6)
        for b in bytes[1...] {
            switch b {
            case 48...57: digits.append(Int(b) - 48)
            case 65...70: digits.append(Int(b) - 55)
            case 97...102: digits.append(Int(b) - 87)
            default: return Rgb(128, 128, 128)
            }
        }
        return Rgb(digits[0] * 16 + digits[1], digits[2] * 16 + digits[3], digits[4] * 16 + digits[5])
    }

    /// A colour under a shade and a highlight, each channel clamped to 0…255.
    public static func litRgb(_ rgb: Rgb, _ shade: Double, _ highlight: Double) -> Rgb {
        func channel(_ v: Int) -> Int {
            let lifted = Double(v) * shade + 255 * highlight
            return Int(max(0, min(255, jsRound(lifted))))
        }
        return Rgb(channel(rgb.r), channel(rgb.g), channel(rgb.b))
    }

    /// A colour under a shade and a highlight, as a CSS string — the web's `litColor`.
    public static func litColor(_ rgb: Rgb, _ shade: Double, _ highlight: Double) -> String {
        litRgb(rgb, shade, highlight).css
    }
}

// MARK: - The order

extension Mesh3D {
    public struct RenderedFace: Equatable, Sendable {
        public var points: [Point]
        public var role: String
        public var shade: Double
        public var highlight: Double
        public var outline: Bool
        /// The depth of the face's FARTHEST vertex — its sort key.
        public var depth: Double

        public init(points: [Point], role: String, shade: Double, highlight: Double, outline: Bool, depth: Double) {
            self.points = points; self.role = role; self.shade = shade; self.highlight = highlight
            self.outline = outline; self.depth = depth
        }
    }

    /// Every visible face of every part under `pose`, back to front — what the
    /// paint draws in order. Culling is by the face's world normal against the
    /// view; ordering is ONE sort over every visible face, keyed on the depth
    /// of the face's FARTHEST vertex, then the overlapping pairs one key cannot
    /// order are settled exactly (`settleOverlaps`).
    ///
    /// The farthest vertex rather than the average: a face that spans the
    /// whole car then sorts by the end that is genuinely behind everything, and
    /// it is exact for a decal, whose outline sits inside the face it is pushed
    /// off — depth is linear over a plane. Equal keys keep the order they were
    /// built in, so the same pose paints the same sequence twice — a video
    /// export cannot shimmer where a still looks right.
    public static func renderOrder(_ parts: [Part], _ pose: Pose, _ light: Light = .default) -> [RenderedFace] {
        let view = viewDirection(pose.tilt)
        let s = sin(pose.tilt)
        let c = cos(pose.tilt)
        var out: [RenderedFace] = []
        // Every visible face's per-vertex depths, flat, with where each starts.
        var depths: [Double] = []
        var depthStart: [Int] = []
        var world: [Vec3] = []
        world.reserveCapacity(16)

        for part in parts {
            let spin = part.spin != nil ? (pose.spins[part.id] ?? 0) : 0
            let turn = spin != 0 ? part.spin : nil
            for face in part.faces {
                world.removeAll(keepingCapacity: true)
                for v in face.verts {
                    let turned = turn.map { rotateAbout(v, $0.pivot, $0.axis, spin) } ?? v
                    world.append(toWorld(turned, fx: pose.fx, fy: pose.fy))
                }
                let n = faceNormal(world)
                // A polygon with no area has no normal to speak of — `faceNormal`
                // hands back a default that would sail through the cull and
                // paint a sliver.
                if n.x == 0 && n.y == 0 && n.z == 1 && !hasArea(world) { continue }
                // Facing the camera means facing AGAINST the view direction.
                if dot(n, view) >= -1e-9 { continue }
                var points: [Point] = []
                points.reserveCapacity(world.count)
                depthStart.append(depths.count)
                var depth = -Double.infinity
                for w in world {
                    let p = projected(w, s, c, pose)
                    points.append(Point(p.x, p.y))
                    depths.append(p.depth)
                    if p.depth > depth { depth = p.depth }
                }
                let lit = lighting(n, light)
                out.append(RenderedFace(points: points, role: face.role, shade: lit.shade,
                                        highlight: lit.highlight, outline: part.outline, depth: depth))
            }
        }

        var rows: [Placed] = []
        rows.reserveCapacity(out.count)
        for (i, face) in out.enumerated() {
            rows.append(placed(face, i, depths, depthStart[i]))
        }
        rows.sort { a, b in a.depth > b.depth || (a.depth == b.depth && a.i < b.i) }
        settleOverlaps(&rows)
        return rows.map { out[$0.i] }
    }
}

// MARK: - Settling the pairs a single key cannot order

/// A face ready to be compared with another: where it lands, and how deep it is there.
private struct Placed {
    var i: Int
    var depth: Double
    /// The outline wound counter-clockwise, so one sign test decides "inside".
    var ring: [Point]
    var x0: Double
    var x1: Double
    var y0: Double
    var y1: Double
    /// Depth over the face as an affine function of the screen point.
    var pa: Double
    var pb: Double
    var pc: Double
}

/// How far a face may lie behind another before the order between them matters.
private let settleEpsilon = 1e-3
/// The overlap, in square pixels, below which a disagreement is a seam.
private let settleMinArea = 1.0
/// How far ahead a face is compared, and how many moves one frame may make.
private let settleWindow = 24
private let settleMoves: Int32 = 4

extension Mesh3D {
    fileprivate static func placed(_ face: RenderedFace, _ i: Int, _ depths: [Double], _ start: Int) -> Placed {
        let pts = face.points
        var x0 = Double.infinity, x1 = -Double.infinity
        var y0 = Double.infinity, y1 = -Double.infinity
        for p in pts {
            if p.x < x0 { x0 = p.x }
            if p.x > x1 { x1 = p.x }
            if p.y < y0 { y0 = p.y }
            if p.y > y1 { y1 = p.y }
        }
        // The projection is affine and the face is planar, so depth really is
        // affine in (x, y). Fitted from the corner pair that spans the most
        // area, so a long thin face is not fitted from three points almost in
        // a row — the first three corners span a quad well, which is most of
        // the model; only a face they nearly line up on pays for the search.
        let bi = 0
        var bj = 1
        var bk = 2
        let span = max(x1 - x0, y1 - y0)
        let first = (pts[1].x - pts[0].x) * (pts[2].y - pts[0].y)
        let second = (pts[2].x - pts[0].x) * (pts[1].y - pts[0].y)
        var best = abs(first - second)
        if best < span * span * 0.05 {
            for j in 1..<pts.count {
                for k in (j + 1)..<pts.count {
                    let u = (pts[j].x - pts[0].x) * (pts[k].y - pts[0].y)
                    let v = (pts[k].x - pts[0].x) * (pts[j].y - pts[0].y)
                    let area = abs(u - v)
                    if area > best {
                        best = area
                        bj = j
                        bk = k
                    }
                }
            }
        }
        let ax = pts[bj].x - pts[bi].x
        let ay = pts[bj].y - pts[bi].y
        let ad = depths[start + bj] - depths[start + bi]
        let bx = pts[bk].x - pts[bi].x
        let by = pts[bk].y - pts[bi].y
        let bd = depths[start + bk] - depths[start + bi]
        let det = ax * by - bx * ay
        let pa = det == 0 ? 0 : (ad * by - bd * ay) / det
        let pb = det == 0 ? 0 : (ax * bd - bx * ad) / det
        var ring = pts
        var twice = 0.0
        for k in 0..<ring.count {
            let p = ring[k]
            let q = ring[(k + 1) % ring.count]
            twice += p.x * q.y - q.x * p.y
        }
        if twice < 0 { ring.reverse() }
        let pc = depths[start + bi] - pa * pts[bi].x - pb * pts[bi].y
        return Placed(i: i, depth: face.depth, ring: ring, x0: x0, x1: x1, y0: y0, y1: y1, pa: pa, pb: pb, pc: pc)
    }

    /// The part of `subject` inside the CONVEX `clip` — exact, the projection
    /// being affine — left in `poly`; `scratch` is the other half of the
    /// ping-pong, so a clip allocates nothing once the buffers have grown.
    fileprivate static func clipTo(_ subject: [Point], _ clip: [Point],
                                   into poly: inout [Point], scratch: inout [Point]) {
        poly.removeAll(keepingCapacity: true)
        poly.append(contentsOf: subject)
        var i = 0
        while i < clip.count && !poly.isEmpty {
            let A = clip[i]
            let B = clip[(i + 1) % clip.count]
            swap(&poly, &scratch)
            poly.removeAll(keepingCapacity: true)
            let m = scratch.count
            for k in 0..<m {
                let P = scratch[k]
                let Q = scratch[(k + 1) % m]
                let sp = (B.x - A.x) * (P.y - A.y) - (B.y - A.y) * (P.x - A.x)
                let sq = (B.x - A.x) * (Q.y - A.y) - (B.y - A.y) * (Q.x - A.x)
                if sp >= 0 { poly.append(P) }
                if (sp >= 0) != (sq >= 0) {
                    let t = sp / (sp - sq)
                    poly.append(Point(P.x + (Q.x - P.x) * t, P.y + (Q.y - P.y) * t))
                }
            }
            i += 1
        }
    }

    /// Put right the pairs a single depth key cannot order.
    ///
    /// Sorting by the farthest vertex is right almost everywhere and wrong in
    /// one shape of case: a LONG panel is keyed by its far corner, so it sorts
    /// behind things that stand under its near half — the bonnet against a
    /// front wheel. No key fixes that. So the pairs that overlap on screen are
    /// asked the real question instead: clip one projected outline against the
    /// other and read each face's own plane depth at a point inside the shared
    /// region. A face that is really behind one drawn before it moves ahead of it.
    ///
    /// Bounded on purpose, and it never splits a polygon: each face is compared
    /// against the next few only, each may be moved a fixed number of times, so
    /// the pass cannot cycle and cannot grow with the model.
    fileprivate static func settleOverlaps(_ rows: inout [Placed]) {
        var moves = [Int32](repeating: 0, count: rows.count)
        var shared: [Point] = []
        var scratch: [Point] = []
        shared.reserveCapacity(32)
        scratch.reserveCapacity(32)
        for i in 0..<rows.count {
            let under = rows[i]
            let last = min(rows.count, i + 1 + settleWindow)
            var j = i + 1
            while j < last {
                defer { j += 1 }
                let over = rows[j]
                if moves[over.i] >= settleMoves { continue }
                if over.x1 <= under.x0 || over.x0 >= under.x1 || over.y1 <= under.y0 || over.y0 >= under.y1 { continue }
                clipTo(over.ring, under.ring, into: &shared, scratch: &scratch)
                if shared.count < 3 { continue }
                var twice = 0.0
                var cx = 0.0
                var cy = 0.0
                for k in 0..<shared.count {
                    let p = shared[k]
                    let q = shared[(k + 1) % shared.count]
                    twice += p.x * q.y - q.x * p.y
                    cx += p.x
                    cy += p.y
                }
                if abs(twice) / 2 < settleMinArea { continue }
                cx /= Double(shared.count)
                cy /= Double(shared.count)
                let deep = over.pa * cx + over.pb * cy + over.pc
                let near = under.pa * cx + under.pb * cy + under.pc
                // `over` is drawn later but lies behind `under` there: it belongs first.
                if deep > near + settleEpsilon {
                    moves[over.i] += 1
                    rows.remove(at: j)
                    rows.insert(over, at: i)
                    break
                }
            }
        }
    }

    /// Whether a polygon encloses any area at all, in the plane it spans.
    fileprivate static func hasArea(_ verts: [Vec3]) -> Bool {
        guard verts.count >= 3 else { return false }
        for i in 2..<verts.count {
            let u = sub(verts[i - 1], verts[0])
            let v = sub(verts[i], verts[0])
            let c = cross(u, v)
            if hypot3(c.x, c.y, c.z) > 1e-12 { return true }
        }
        return false
    }
}

// MARK: - What the paint does, as data

extension Mesh3D {
    /// One face as the paint lays it down — the web's `paintMesh`, decided.
    public struct PaintStep: Equatable, Sendable {
        public var points: [Point]
        /// The lit fill.
        public var fill: Rgb
        /// Whether the stroke is the INK outline (the part asks for it) or the
        /// fill itself — a one-pixel stroke in the fill's own colour, the
        /// standard cure for the hairline seams adjacent fills leave.
        public var inked: Bool
        /// The stroke as the canvas takes it: the ink, or `fill.css`.
        public var stroke: String
        public var lineWidth: Double

        public init(points: [Point], fill: Rgb, inked: Bool, stroke: String, lineWidth: Double) {
            self.points = points; self.fill = fill; self.inked = inked; self.stroke = stroke; self.lineWidth = lineWidth
        }
    }

    /// What `paintMesh` draws, in order: every face of three points or more,
    /// its role resolved through `palette` (`#rrggbb`; an unknown role paints
    /// mid grey), lit, filled, then stroked — with `ink` at `outlineWidth` on
    /// the parts that ask, with its own fill at `min(1, outlineWidth)` on the
    /// rest. The app strokes with round joins and caps.
    public static func paintSteps(_ faces: [RenderedFace], palette: [String: String], ink: String,
                                  outlineWidth: Double) -> [PaintStep] {
        var rgbByRole: [String: Rgb] = [:]
        var steps: [PaintStep] = []
        steps.reserveCapacity(faces.count)
        for face in faces where face.points.count >= 3 {
            let rgb: Rgb
            if let known = rgbByRole[face.role] {
                rgb = known
            } else {
                rgb = hexToRgb(palette[face.role] ?? "#808080")
                rgbByRole[face.role] = rgb
            }
            let fill = litRgb(rgb, face.shade, face.highlight)
            steps.append(PaintStep(
                points: face.points,
                fill: fill,
                inked: face.outline,
                stroke: face.outline ? ink : fill.css,
                lineWidth: face.outline ? outlineWidth : min(1, outlineWidth)
            ))
        }
        return steps
    }

    /// One ellipse of the ground shadow, in the shadow's own turned frame.
    public struct ShadowEllipse: Equatable, Sendable {
        /// Radius across the car and along it, pixels.
        public var radiusX: Double
        public var radiusY: Double
        public var alpha: Double
    }

    /// The soft ground shadow `paintGroundShadow` draws, as numbers: the context
    /// is translated to `origin`, squashed vertically by `squash` (the tilt
    /// foreshortening the ground plane), turned by `rotation`, and three
    /// ellipses centred there are filled in `rgba(20,16,12,alpha)`, outermost
    /// first. No blur — a blur per frame is the one canvas operation the
    /// openers avoid. Thrown a little north-east, away from the key light.
    public struct GroundShadow: Equatable, Sendable {
        public var origin: Point
        public var squash: Double
        public var rotation: Double
        public var ellipses: [ShadowEllipse]
        /// The shadow's colour, before each ellipse's alpha.
        public static let rgb = Rgb(20, 16, 12)
    }

    /// The shadow under a body of `halfLength` × `halfWidth` model units.
    public static func groundShadow(_ pose: Pose, halfLength: Double, halfWidth: Double,
                                    alpha: Double = 0.26) -> GroundShadow {
        let angle = atan2(pose.fx, pose.fy)
        let sinT = sin(pose.tilt)
        let origin = Point(pose.x + pose.scale * 0.3, pose.y - pose.scale * 0.22 * sinT)
        let rings: [(Double, Double)] = [(1.16, alpha * 0.35), (1.06, alpha * 0.5), (0.96, alpha)]
        let ellipses = rings.map { grow, a in
            ShadowEllipse(radiusX: halfWidth * pose.scale * grow, radiusY: halfLength * pose.scale * grow, alpha: a)
        }
        return GroundShadow(origin: origin, squash: sinT, rotation: angle, ellipses: ellipses)
    }
}

// MARK: - Builders

extension Mesh3D {
    /// A convex solid's faces, each wound so its normal points away from the
    /// solid's centre — the one property the renderer relies on, enforced here
    /// rather than trusted from whoever typed the vertices.
    public static func outward(_ faces: [Face], _ centre: Vec3) -> [Face] {
        faces.map { face in
            let n = faceNormal(face.verts)
            let away = sub(centroid(face.verts), centre)
            return dot(n, away) < 0 ? Face(verts: Array(face.verts.reversed()), role: face.role) : face
        }
    }

    /// A convex part from faces that may be wound either way.
    public static func solid(_ id: String, _ faces: [Face], outline: Bool = true, spin: Spin? = nil) -> Part {
        var all: [Vec3] = []
        for f in faces { all.append(contentsOf: f.verts) }
        let centre = centroid(all)
        return Part(id: id, faces: outward(faces, centre), centre: centre, outline: outline, spin: spin)
    }

    /// A flat decal — a single face with a stated outward side — drawn a hair
    /// off the surface it sits on, so it always lands after that surface.
    public static func decal(_ id: String, _ verts: [Vec3], _ role: String, _ normal: Vec3,
                             outline: Bool = false) -> Part {
        let n = faceNormal(verts)
        let face = Face(verts: dot(n, normal) < 0 ? Array(verts.reversed()) : verts, role: role)
        return Part(id: id, faces: [face], centre: centroid(verts), outline: outline)
    }

    /// An axis-aligned box from two corners.
    public static func box(_ id: String, _ a: Vec3, _ b: Vec3, _ role: String, outline: Bool = true) -> Part {
        let x0 = min(a.x, b.x), x1 = max(a.x, b.x)
        let y0 = min(a.y, b.y), y1 = max(a.y, b.y)
        let z0 = min(a.z, b.z), z1 = max(a.z, b.z)
        let plan = [Point(x0, y0), Point(x1, y0), Point(x1, y1), Point(x0, y1)]
        return extrude(id, plan, z0, z1, ExtrudeRoles(side: role, top: role, bottom: role), outline: outline)
    }

    /// The roles an extrusion paints with. A cap may be `nil`, which builds it
    /// NOT AT ALL — for a face that is interior by construction, buried against
    /// the block stacked on it. Such a face is not merely invisible: it is a
    /// surface the painter's algorithm has to place among the ones you can see,
    /// and it will sometimes place it on top of them. The cure is to not have it.
    public struct ExtrudeRoles: Equatable, Sendable {
        public var side: String
        public var top: String?
        public var bottom: String?

        public init(side: String, top: String?, bottom: String?) {
            self.side = side; self.top = top; self.bottom = bottom
        }
    }

    /// A convex plan (x, y) pulled up from `z0` to `z1`.
    public static func extrude(_ id: String, _ plan: [Point], _ z0: Double, _ z1: Double, _ roles: ExtrudeRoles,
                               outline: Bool = true) -> Part {
        var faces: [Face] = []
        let n = plan.count
        for i in 0..<n {
            let a = plan[i]
            let b = plan[(i + 1) % n]
            faces.append(Face(verts: [Vec3(a.x, a.y, z0), Vec3(b.x, b.y, z0), Vec3(b.x, b.y, z1), Vec3(a.x, a.y, z1)],
                              role: roles.side))
        }
        if let top = roles.top { faces.append(Face(verts: plan.map { Vec3($0.x, $0.y, z1) }, role: top)) }
        if let bottom = roles.bottom { faces.append(Face(verts: plan.map { Vec3($0.x, $0.y, z0) }, role: bottom)) }
        return solid(id, faces, outline: outline)
    }

    /// A cylinder's roles: its side quads alternate between `side` and
    /// `sideAlt` when given (a tyre's tread, so its turning shows).
    public struct CylinderRoles: Equatable, Sendable {
        public var side: String
        public var sideAlt: String?
        public var cap: String

        public init(side: String, sideAlt: String? = nil, cap: String) {
            self.side = side; self.sideAlt = sideAlt; self.cap = cap
        }
    }

    /// A cylinder about the x or y axis: `segments` side quads and two caps;
    /// `spin` turns it with the pose's spin for its id (a wheel).
    public static func cylinder(_ id: String, _ centre: Vec3, _ axis: CylinderAxis, _ radius: Double,
                                _ halfWidth: Double, _ segments: Int, _ roles: CylinderRoles,
                                outline: Bool = false, spin: Bool = false) -> Part {
        func ring(_ offset: Double) -> [Vec3] {
            (0..<segments).map { i in
                let a = Double(i) / Double(segments) * Double.pi * 2
                let u = radius * cos(a)
                let v = radius * sin(a)
                return axis == .x
                    ? Vec3(centre.x + offset, centre.y + u, centre.z + v)
                    : Vec3(centre.x + u, centre.y + offset, centre.z + v)
            }
        }
        let near = ring(-halfWidth)
        let far = ring(halfWidth)
        var faces: [Face] = []
        for i in 0..<segments {
            let j = (i + 1) % segments
            // The web's `roles.sideAlt && i % 2`: an empty string is no alternate.
            let alt = roles.sideAlt ?? ""
            let role = (!alt.isEmpty && i % 2 == 1) ? alt : roles.side
            faces.append(Face(verts: [near[i], near[j], far[j], far[i]], role: role))
        }
        faces.append(Face(verts: near, role: roles.cap))
        faces.append(Face(verts: far, role: roles.cap))
        return solid(id, faces, outline: outline, spin: spin ? Spin(pivot: centre, axis: axis.axis) : nil)
    }
}
