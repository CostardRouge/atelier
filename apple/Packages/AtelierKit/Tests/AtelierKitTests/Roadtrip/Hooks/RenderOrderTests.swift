// Port of `src/shared/roadtrip/hooks/render-order.test.ts` — the paint order,
// checked against the truth for every angle the car is seen at.
//
// `renderOrder` has no depth buffer: it decides, once per frame, a single
// sequence for every visible face and the paint draws them in it. When that
// sequence is wrong a face is painted over something in front of it and a
// piece of the car simply is not there — silently, in a preview and in an
// export alike. So this is the gate, and it judges the PICTURE rather than the
// algorithm: it rebuilds the geometry independently of `renderOrder` — its own
// culling, its own per-vertex depths, its own plane fit — then walks the
// painted sequence over a grid of screen samples keeping two things at each:
// the last face laid down over it, and the nearest face covering it. Where
// those disagree, a point of the car shows the wrong surface.
//
// Every threshold is the web's: `MIN_KEPT` 0.45, `MIN_CLAIM` 40, `TOLERANCE`
// 0.03, a 2 px grid at 60 px per model unit, twelve headings × three tilts.
// The one liberty: a drawn face is matched to the oracle's by its projected
// outline rounded to 1e-4 as integers, where the web joins `toFixed(4)` text —
// the same key, without formatting a string per vertex.

import XCTest
@testable import AtelierKit

/// The oracle: everything the spec rebuilds on its own, kept off the test
/// module's scope.
private enum Oracle {
    /// Pixels per model unit — the car lands about 280 px long, as on a phone.
    static let oracleScale = 60.0
    /// The sampling grid, in pixels. Fine enough to see a 20 px blemish.
    static let oracleStep = 2.0
    /// How much nearer a face must be to count as really in front, in model units.
    /// Under the decals' own 0.004 push off their host, so a decal falling behind
    /// its surface is still caught; over the noise of two surfaces that touch.
    static let oracleEpsilon = 1e-3
    /// The least of itself a part may show where it is the nearest thing to the
    /// camera — the fault the maintainer reported, a piece of the car not being
    /// there. Measured over the sweep the worst part keeps 54% on the web.
    static let minKept = 0.45
    /// Below this a part is a speck on screen and a share of it means nothing.
    static let minClaim = 40
    /// How much of one view may show a surface that is not the nearest one — a
    /// canary over the whole picture (measured worst pose on the web: 1.9%).
    static let tolerance = 0.03

    static func poseAt(_ headingDeg: Double, _ tiltDeg: Double) -> Mesh3D.Pose {
        Mesh3D.Pose(
            fx: sin(headingDeg * Double.pi / 180),
            fy: cos(headingDeg * Double.pi / 180),
            tilt: tiltDeg * Double.pi / 180,
            scale: oracleScale,
            x: 0,
            y: 0,
            spins: [:]
        )
    }

    /// The face's projected outline as a key, so a `RenderedFace` can be matched to it.
    struct OutlineKey: Hashable {
        let coords: [Int64]

        init(_ points: [Point]) {
            var coords: [Int64] = []
            coords.reserveCapacity(points.count * 2)
            for p in points {
                coords.append(Int64((p.x * 10_000).rounded()))
                coords.append(Int64((p.y * 10_000).rounded()))
            }
            self.coords = coords
        }
    }

    /// One face as the oracle sees it: where it lands, and how deep it is there.
    struct Seen {
        let partId: String
        /// The outline, wound counter-clockwise so one sign test decides "inside".
        let ring: [Point]
        /// Depth as an affine function of the screen point: a·x + b·y + c.
        let a: Double
        let b: Double
        let c: Double
        let x0: Double
        let x1: Double
        let y0: Double
        let y1: Double
    }

    static func signedArea(_ poly: [Point]) -> Double {
        var sum = 0.0
        for i in 0..<poly.count {
            let p = poly[i]
            let q = poly[(i + 1) % poly.count]
            sum += p.x * q.y - q.x * p.y
        }
        return sum / 2
    }

    /// Depth over the face, as a plane in screen coordinates — fitted from the most
    /// spread-out three of its corners, so a sliver is not fitted from three
    /// points in a row.
    static func fitPlane(_ points: [Point], _ depths: [Double]) -> (a: Double, b: Double, c: Double)? {
        var best: (Int, Int, Int)?
        var bestArea = 0.0
        let n = points.count
        for i in 0..<n {
            for j in (i + 1)..<n {
                for k in (j + 1)..<n {
                    let u = (points[j].x - points[i].x) * (points[k].y - points[i].y)
                    let v = (points[k].x - points[i].x) * (points[j].y - points[i].y)
                    let area = abs(u - v)
                    if area > bestArea {
                        bestArea = area
                        best = (i, j, k)
                    }
                }
            }
        }
        guard let (i, j, k) = best, bestArea >= 1e-9 else { return nil }
        let ax = points[j].x - points[i].x
        let ay = points[j].y - points[i].y
        let ad = depths[j] - depths[i]
        let bx = points[k].x - points[i].x
        let by = points[k].y - points[i].y
        let bd = depths[k] - depths[i]
        let det = ax * by - bx * ay
        if abs(det) < 1e-9 { return nil }
        let a = (ad * by - bd * ay) / det
        let b = (ax * bd - bx * ad) / det
        return (a, b, depths[i] - a * points[i].x - b * points[i].y)
    }

    /// Every face the camera can see, rebuilt from the model without asking
    /// `renderOrder` anything — the same spin, the same world transform and the
    /// same back-face rule, written again so the oracle and the thing it judges
    /// cannot share a mistake.
    static func seenFaces(_ parts: [Mesh3D.Part], _ pose: Mesh3D.Pose) -> [OutlineKey: Seen] {
        let view = Mesh3D.viewDirection(pose.tilt)
        var out: [OutlineKey: Seen] = [:]
        for part in parts {
            let spin = part.spin != nil ? (pose.spins[part.id] ?? 0) : 0
            for face in part.faces {
                let world = face.verts.map { v -> Mesh3D.Vec3 in
                    var turned = v
                    if let s = part.spin, spin != 0 { turned = Mesh3D.rotateAbout(v, s.pivot, s.axis, spin) }
                    return Mesh3D.toWorld(turned, pose)
                }
                let n = Mesh3D.faceNormal(world)
                if Mesh3D.dot(n, view) >= -1e-9 { continue }
                let projected = world.map { Mesh3D.project($0, pose) }
                let points = projected.map { Point($0.x, $0.y) }
                guard let plane = fitPlane(points, projected.map(\.depth)) else { continue }
                out[OutlineKey(points)] = Seen(
                    partId: part.id,
                    ring: signedArea(points) < 0 ? Array(points.reversed()) : points,
                    a: plane.a, b: plane.b, c: plane.c,
                    x0: points.map(\.x).min()!, x1: points.map(\.x).max()!,
                    y0: points.map(\.y).min()!, y1: points.map(\.y).max()!
                )
            }
        }
        return out
    }

    /// Whether a screen point is inside the CONVEX projected face.
    static func inside(_ face: Seen, _ x: Double, _ y: Double) -> Bool {
        let poly = face.ring
        let n = poly.count
        for i in 0..<n {
            let a = poly[i]
            let b = poly[(i + 1) % n]
            if (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0 { return false }
        }
        return true
    }

    struct Wrong {
        /// The part the paint left on top, and the one that is really nearest there.
        let painted: String
        let nearest: String
        var samples: Int
    }

    /// What one part should be showing of itself, and what it actually shows.
    struct Kept {
        let id: String
        /// Samples where this part is the nearest thing to the camera.
        var claimed: Int
        /// Of those, the ones where it is also what the paint left on top.
        var kept: Int
    }

    struct Verdict {
        var wrong: [Wrong]
        var parts: [Kept]
        /// Samples showing the wrong surface, and samples on the car at all.
        var bad: Int
        var covered: Int
    }

    /// What the paint leaves on screen, against what should be there — a depth
    /// buffer, sampled. The pairwise question ("is this face over that one?") is
    /// the harsher one and the wrong one: a pair in the wrong order that a third
    /// face later covers shows nobody anything.
    static func mispainted(_ parts: [Mesh3D.Part], _ pose: Mesh3D.Pose,
                            file: StaticString = #filePath, line: UInt = #line) -> Verdict {
        let seen = seenFaces(parts, pose)
        let drawn = Mesh3D.renderOrder(parts, pose)
        let matched = drawn.map { seen[OutlineKey($0.points)] }
        // Every face the renderer draws must be one the oracle also saw; a mismatch
        // would mean the two disagree about culling, which is its own bug.
        let unmatched = matched.filter { $0 == nil }.count
        XCTAssertEqual(unmatched, 0, "faces the renderer draws that the oracle never saw", file: file, line: line)
        let order = matched.compactMap { $0 }
        if order.isEmpty { return Verdict(wrong: [], parts: [], bad: 0, covered: 0) }

        // Parts tallied by index; ids that repeat merge, as the web's maps by id do.
        var partIndex: [String: Int] = [:]
        var partIds: [String] = []
        let faceParts: [Int] = order.map { face in
            if let known = partIndex[face.partId] { return known }
            partIndex[face.partId] = partIds.count
            partIds.append(face.partId)
            return partIds.count - 1
        }

        let x0 = order.map(\.x0).min()!.rounded(.down)
        let x1 = order.map(\.x1).max()!.rounded(.up)
        let y0 = order.map(\.y0).min()!.rounded(.down)
        let y1 = order.map(\.y1).max()!.rounded(.up)
        let w = Int(((x1 - x0) / oracleStep).rounded(.up)) + 1
        let h = Int(((y1 - y0) / oracleStep).rounded(.up)) + 1
        var painted = [Int32](repeating: -1, count: w * h)
        var nearest = [Int32](repeating: -1, count: w * h)
        var best = [Double](repeating: .infinity, count: w * h)

        for (index, face) in order.enumerated() {
            let i0 = max(0, Int(((face.x0 - x0) / oracleStep).rounded(.down)))
            let i1 = min(w - 1, Int(((face.x1 - x0) / oracleStep).rounded(.up)))
            let j0 = max(0, Int(((face.y0 - y0) / oracleStep).rounded(.down)))
            let j1 = min(h - 1, Int(((face.y1 - y0) / oracleStep).rounded(.up)))
            if i0 > i1 || j0 > j1 { continue }
            for j in j0...j1 {
                let y = y0 + Double(j) * oracleStep
                for i in i0...i1 {
                    let x = x0 + Double(i) * oracleStep
                    if !inside(face, x, y) { continue }
                    let k = j * w + i
                    painted[k] = Int32(index)
                    let d = face.a * x + face.b * y + face.c
                    if d < best[k] - oracleEpsilon {
                        best[k] = d
                        nearest[k] = Int32(index)
                    }
                }
            }
        }

        var byPair: [String: Int] = [:]
        var pairs: [Wrong] = []
        var tallies = partIds.map { Kept(id: $0, claimed: 0, kept: 0) }
        var seenPart = [Bool](repeating: false, count: partIds.count)
        var partOrder: [Int] = []
        var covered = 0
        var bad = 0
        for k in 0..<painted.count {
            if painted[k] < 0 { continue }
            covered += 1
            let a = faceParts[Int(painted[k])]
            let b = faceParts[Int(nearest[k])]
            if !seenPart[b] {
                seenPart[b] = true
                partOrder.append(b)
            }
            tallies[b].claimed += 1
            if a == b { tallies[b].kept += 1 }
            if painted[k] == nearest[k] { continue }
            // Two visible faces of one convex part cannot overlap; a disagreement
            // inside one is the grid landing on the seam between them.
            if a == b { continue }
            bad += 1
            let key = "\(partIds[a]) left on top of \(partIds[b])"
            if let at = byPair[key] {
                pairs[at].samples += 1
            } else {
                byPair[key] = pairs.count
                pairs.append(Wrong(painted: partIds[a], nearest: partIds[b], samples: 1))
            }
        }
        // Stable, like the web's sort: equal counts keep the order they were met in.
        let wrong = pairs.enumerated()
            .sorted { $0.element.samples > $1.element.samples || ($0.element.samples == $1.element.samples && $0.offset < $1.offset) }
            .map(\.element)
        return Verdict(wrong: wrong, parts: partOrder.map { tallies[$0] }, bad: bad, covered: covered)
    }

    static func percent(_ share: Double, _ digits: Int) -> String {
        String(format: "%.\(digits)f", share * 100)
    }

    /// Twelve headings around the turntable; the shallow end of the tilt range,
    /// the garage's own default, and a near-overhead map view.
    static let headings: [Double] = (0..<12).map { Double($0 * 30) }
    static let tilts: [Double] = [35, 52, 80]
}

final class RenderOrderPaintTests: XCTestCase {
    private static let geared = buildCar()
    private var geared: [Mesh3D.Part] { Self.geared }

    /// The gate. Every part the camera can see must actually be SEEN: where a
    /// part is the nearest thing to the eye, it has to be what the paint left
    /// on top, over most of that area. A part ordered wrongly against something
    /// that spans it does not look subtly off — it is gone.
    func testNeverBuriesAPartThatShouldBeOnTop() {
        var buried: [String] = []
        for tilt in Oracle.tilts {
            for heading in Oracle.headings {
                for part in Oracle.mispainted(geared, Oracle.poseAt(heading, tilt)).parts {
                    if part.claimed < Oracle.minClaim { continue }
                    let kept = Double(part.kept) / Double(part.claimed)
                    if kept < Oracle.minKept {
                        buried.append("heading \(Int(heading))° tilt \(Int(tilt))°: \(part.id) shows \(Oracle.percent(kept, 0))% "
                            + "of the \(part.claimed) samples where it is the nearest surface")
                    }
                }
            }
        }
        XCTAssertEqual(buried, [], buried.joined(separator: "\n"))
    }

    func testShowsTheNearestSurfaceOverNearlyAllOfTheCarAtEveryAngle() {
        var lines: [String] = []
        for tilt in Oracle.tilts {
            for heading in Oracle.headings {
                let verdict = Oracle.mispainted(geared, Oracle.poseAt(heading, tilt))
                let share = Double(verdict.bad) / Double(verdict.covered)
                if share > Oracle.tolerance {
                    let worst = verdict.wrong.prefix(4).map { "\($0.painted) over \($0.nearest) (\($0.samples))" }
                    lines.append("heading \(Int(heading))° tilt \(Int(tilt))°: \(Oracle.percent(share, 1))% shows the wrong surface — "
                        + worst.joined(separator: ", "))
                }
            }
        }
        XCTAssertEqual(lines, [], lines.joined(separator: "\n"))
    }

    // The two failures measured on the part-centre ordering this replaced,
    // pinned so a "simplification" back to a per-part sort fails here with the
    // angle that proves it.
    func testKeepsTheCabinOverTheBodysFullLengthTopFaceNoseTowardTheCamera() {
        for heading in [150.0, 180, 210] {
            let wrong = Oracle.mispainted(geared, Oracle.poseAt(heading, 35)).wrong.filter { $0.painted == "body" && $0.nearest == "cabin" }
            XCTAssertEqual(wrong.map { "heading \(Int(heading))°: \($0.painted) over \($0.nearest) (\($0.samples))" }, [])
        }
    }

    func testKeepsTheWrapAroundCornerLightsOverTheBodyThatCarriesThem() {
        var lines: [String] = []
        for tilt in [35.0, 52, 58, 80] {
            var heading = 40.0
            while heading <= 75 {
                for w in Oracle.mispainted(geared, Oracle.poseAt(heading, tilt)).wrong where w.nearest.hasSuffix("-wrap") {
                    lines.append("heading \(Int(heading))° tilt \(Int(tilt))°: \(w.painted) over \(w.nearest) (\(w.samples))")
                }
                heading += 5
            }
        }
        XCTAssertEqual(lines, [], lines.joined(separator: "\n"))
    }

    /// Farthest first is the SORT, and settling the overlapping pairs is a
    /// repair on top of it — so the sequence is no longer monotonic, and must
    /// not be. What has to stay true is that the repair is a repair and not a
    /// second sort, so the faces it moves stay a small minority.
    func testStaysWithinAFewMovesOfFarthestFirst() {
        for tilt in Oracle.tilts {
            for heading in Oracle.headings {
                let faces = Mesh3D.renderOrder(geared, Oracle.poseAt(heading, tilt))
                XCTAssertGreaterThan(faces.count, 80)
                var moved = 0
                for i in 1..<faces.count where faces[i].depth > faces[i - 1].depth + 1e-9 {
                    moved += 1
                }
                XCTAssertLessThan(Double(moved) / Double(faces.count), 0.25, "heading \(Int(heading))° tilt \(Int(tilt))°")
            }
        }
    }

    /// The three surfaces the maintainer named, at the angles that were worst
    /// for each. They were see-through because the body was one box keyed by
    /// its far end with the wheels modelled inside it.
    func testKeepsTheBonnetTheGlassAndTheFlaresSolid() {
        var thin: [String] = []
        for tilt in Oracle.tilts {
            for heading in Oracle.headings {
                for part in Oracle.mispainted(geared, Oracle.poseAt(heading, tilt)).parts {
                    let named = part.id == "body-bonnet" || part.id == "cabin" || part.id.hasPrefix("flare-")
                    if !named || part.claimed < Oracle.minClaim { continue }
                    let kept = Double(part.kept) / Double(part.claimed)
                    if kept < 0.7 {
                        thin.append("heading \(Int(heading))° tilt \(Int(tilt))°: \(part.id) shows \(Oracle.percent(kept, 0))% "
                            + "of its \(part.claimed) samples")
                    }
                }
            }
        }
        XCTAssertEqual(thin, [], thin.joined(separator: "\n"))
    }

    func testPaintsTheSameSequenceTwiceForTheSamePose() {
        func roles() -> [String] {
            Mesh3D.renderOrder(geared, Oracle.poseAt(56, 52)).map { "\($0.role):\(String(format: "%.6f", $0.depth))" }
        }
        XCTAssertEqual(roles(), roles())
    }
}

/// Sorting faces globally rests on every part being CONVEX: that is what makes
/// back-face culling alone leave exactly the faces you can see, none of them
/// overlapping another of the same part. Here it is a test, so a new fitting
/// that is a hoop with a hole in it fails the build instead of the picture.
final class RenderOrderConvexTests: XCTestCase {
    func testPutsEveryVertexBehindEveryOneOfItsOwnFaces() {
        var bad = Set<String>()
        for part in buildCar() where part.faces.count >= 2 {
            let verts = part.faces.flatMap(\.verts)
            for face in part.faces {
                let n = Mesh3D.faceNormal(face.verts)
                let d = Mesh3D.dot(n, face.verts[0])
                for v in verts where Mesh3D.dot(n, v) > d + 1e-6 {
                    bad.insert("\(part.id): a vertex sits \(String(format: "%.4f", Mesh3D.dot(n, v) - d)) outside one of its own faces")
                    break
                }
            }
        }
        XCTAssertEqual(bad, [], bad.sorted().joined(separator: "\n"))
    }

    func testGivesEveryFaceARealNormalAndKeepsItFlat() {
        for part in buildCar() {
            for face in part.faces {
                XCTAssertGreaterThanOrEqual(face.verts.count, 3, part.id)
                // Newell's normal is a unit vector for any polygon that has area.
                let n = Mesh3D.faceNormal(face.verts)
                assertClose((n.x * n.x + n.y * n.y + n.z * n.z).squareRoot(), 1, 9, part.id)
                let d = Mesh3D.dot(n, face.verts[0])
                for v in face.verts { XCTAssertLessThan(abs(Mesh3D.dot(n, v) - d), 1e-6, part.id) }
            }
        }
    }

    func testDropsAFaceWithNoAreaRatherThanPaintingASliver() {
        // Three points in a row: a polygon with no area, whose normal is a guess.
        let flat = Mesh3D.Part(id: "flat", faces: [Mesh3D.Face(verts: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], role: "body")],
                               centre: [1, 0, 0], outline: true)
        XCTAssertEqual(Mesh3D.renderOrder([flat], Oracle.poseAt(0, 52)), [])
        XCTAssertEqual(Mesh3D.cross([1, 0, 0], [0, 1, 0]), [0, 0, 1])
        XCTAssertEqual(Mesh3D.sub([3, 3, 3], [1, 2, 3]), [2, 1, 0])
    }
}
