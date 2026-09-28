// Port of `src/shared/roadtrip/hooks/mesh3d.test.ts`, case for case. The
// web's `paintMesh` case is held against `paintSteps`, which is what that
// paint decides (a fill per face, the ink on the outlined parts); the canvas
// itself is the app's. Two small cases pin the ported layout arithmetic the
// web has no spec for: the ground shadow, and JavaScript's rounding.

import XCTest
@testable import AtelierKit

private let topDown = Double.pi / 2

private func meshPose(fx: Double = 0, fy: Double = 1, tilt: Double = topDown, scale: Double = 10,
                  x: Double = 100, y: Double = 100, spins: [String: Double] = [:]) -> Mesh3D.Pose {
    Mesh3D.Pose(fx: fx, fy: fy, tilt: tilt, scale: scale, x: x, y: y, spins: spins)
}

final class Mesh3DToWorldTests: XCTestCase {
    func testSendsTheNoseWhereTheHeadingPointsTheRightSideAQuarterTurnClockwise() {
        // Heading east: the nose (+y) lands on +X, the right-hand side (+x) on -Y (south).
        XCTAssertEqual(Mesh3D.toWorld([0, 1, 0], fx: 1, fy: 0), [1, 0, 0])
        XCTAssertEqual(Mesh3D.toWorld([1, 0, 0], fx: 1, fy: 0), [0, -1, 0])
        // Heading north is the identity.
        XCTAssertEqual(Mesh3D.toWorld([0.5, 2, 3], fx: 0, fy: 1), [0.5, 2, 3])
    }
}

final class Mesh3DProjectTests: XCTestCase {
    func testLooksStraightDownAtAHalfTurnYUpOnScreenHeightInvisible() {
        let p = meshPose()
        let a = Mesh3D.project([1, 2, 0], p)
        assertClose(a.x, 110, 9)
        assertClose(a.y, 80, 9)
        let high = Mesh3D.project([1, 2, 5], p)
        assertClose(high.y, a.y, 9)
        // Higher is nearer to a camera above.
        XCTAssertLessThan(high.depth, a.depth)
    }

    func testShowsHeightWhenTheCameraTiltsAndFartherNorthIsFartherAway() {
        let p = meshPose(tilt: Double.pi / 4)
        let ground = Mesh3D.project([0, 0, 0], p)
        let up = Mesh3D.project([0, 0, 1], p)
        XCTAssertLessThan(up.y, ground.y)
        XCTAssertGreaterThan(Mesh3D.project([0, 1, 0], p).depth, ground.depth)
    }
}

final class Mesh3DFaceNormalTests: XCTestCase {
    func testReadsACounterClockwiseSquareAsFacingUp() {
        XCTAssertEqual(Mesh3D.faceNormal([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]), [0, 0, 1])
    }

    func testTurnsEveryFaceOfASolidToFaceAwayFromItsCentre() {
        // Clockwise: faces down.
        let wrong = [Mesh3D.Face(verts: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]], role: "r")]
        let fixed = Mesh3D.outward(wrong, [0.5, 0.5, -1])
        XCTAssertEqual(Mesh3D.faceNormal(fixed[0].verts), [0, 0, 1])
    }

    func testBuildsABoxWhoseSixFacesAllPointOutward() {
        let b = Mesh3D.box("b", [0, 0, 0], [2, 3, 4], "body")
        XCTAssertEqual(b.faces.count, 6)
        for face in b.faces {
            let away = Mesh3D.sub(Mesh3D.centroid(face.verts), b.centre)
            XCTAssertGreaterThan(Mesh3D.dot(Mesh3D.faceNormal(face.verts), away), 0)
        }
    }

    func testBuildsACylinderWhoseCapsFaceAlongItsAxisAndWhoseSidesFaceOut() {
        let c = Mesh3D.cylinder("w", [1, 2, 3], .x, 1, 0.5, 8, Mesh3D.CylinderRoles(side: "s", cap: "c"))
        XCTAssertEqual(c.faces.count, 10)
        let caps = c.faces.filter { $0.role == "c" }.map { Mesh3D.faceNormal($0.verts) }
        let signs = Set(caps.map { $0.x.rounded() })
        XCTAssertTrue(signs.contains(1))
        XCTAssertTrue(signs.contains(-1))
        for face in c.faces where face.role == "s" {
            let n = Mesh3D.faceNormal(face.verts)
            XCTAssertLessThan(abs(n.x), 1e-9)
            XCTAssertGreaterThan(Mesh3D.dot(n, Mesh3D.sub(Mesh3D.centroid(face.verts), c.centre)), 0)
        }
    }

    func testOrientsADecalTheWayItIsTold() {
        let d = Mesh3D.decal("d", [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], "r", [0, 0, -1])
        XCTAssertEqual(Mesh3D.faceNormal(d.faces[0].verts), [0, 0, -1])
    }
}

final class Mesh3DRotateAboutTests: XCTestCase {
    func testTurnsAPointAQuarterTurnAboutAnAxisThroughAPivot() {
        let r = Mesh3D.rotateAbout([1, 2, 1], [1, 1, 1], .x, Double.pi / 2)
        assertClose(r.x, 1, 9)
        assertClose(r.y, 1, 9)
        assertClose(r.z, 2, 9)
    }
}

final class Mesh3DRenderOrderTests: XCTestCase {
    private let cube = Mesh3D.box("cube", [-1, -1, 0], [1, 1, 2], "body")

    func testCullsWhatFacesAwayStraightDownACubeShowsItsTopOnly() {
        let faces = Mesh3D.renderOrder([cube], meshPose())
        XCTAssertEqual(faces.count, 1)
        let corners = faces[0].points.map { [$0.x.rounded(), $0.y.rounded()] }
        for want: [Double] in [[90, 90], [110, 90], [110, 110], [90, 110]] {
            XCTAssertTrue(corners.contains(want), "\(want)")
        }
    }

    func testShowsTheTopAndTheSideNearestTheCameraOnceTilted() {
        let faces = Mesh3D.renderOrder([cube], meshPose(tilt: Double.pi / 3))
        XCTAssertEqual(faces.count, 2)
        // The top is drawn last: it is nearer a camera above than the south face's middle.
        XCTAssertLessThanOrEqual(faces[faces.count - 1].depth, faces[0].depth)
    }

    func testTurnsWithTheHeadingHeadingWestTheEastSideFacesTheCameraNever() {
        // Facing west the cube's own +y side points west; the visible side is still the one facing south.
        let faces = Mesh3D.renderOrder([cube], meshPose(fx: -1, fy: 0, tilt: Double.pi / 3))
        XCTAssertEqual(faces.count, 2)
        let view = Mesh3D.viewDirection(Double.pi / 3)
        for face in faces { XCTAssertEqual(face.points.count, 4) }
        XCTAssertLessThan(Mesh3D.dot(view, [0, 0, 1]), 0)
    }

    func testDrawsANearerPartAfterAFartherOne() {
        let far = Mesh3D.box("far", [-1, 4, 0], [1, 6, 1], "body")
        let near = Mesh3D.box("near", [-1, -6, 0], [1, -4, 1], "body")
        let faces = Mesh3D.renderOrder([near, far], meshPose(tilt: Double.pi / 3))
        XCTAssertGreaterThan(faces[0].depth, faces[faces.count - 1].depth)
    }

    func testSpinsAPartAboutItsAxisByThePosesAngle() {
        let wheel = Mesh3D.cylinder("w", [0, 0, 1], .x, 1, 0.2, 8,
                                    Mesh3D.CylinderRoles(side: "s", sideAlt: "t", cap: "c"),
                                    outline: false, spin: true)
        let still = Mesh3D.renderOrder([wheel], meshPose(tilt: Double.pi / 3))
        let turned = Mesh3D.renderOrder([wheel], meshPose(tilt: Double.pi / 3, spins: ["w": Double.pi / 8]))
        XCTAssertEqual(turned.count, still.count)
        func shades(_ faces: [Mesh3D.RenderedFace]) -> String {
            faces.filter { $0.role == "s" || $0.role == "t" }.map { String(format: "%.3f", $0.shade) }.joined(separator: ",")
        }
        XCTAssertNotEqual(shades(turned), shades(still))
    }
}

final class Mesh3DLightingTests: XCTestCase {
    func testLightsTheRoofMoreThanASideTurnedFromTheKey() {
        let up = Mesh3D.lighting([0, 0, 1], .default)
        let north = Mesh3D.lighting([0, 1, 0], .default)
        XCTAssertGreaterThan(up.shade, north.shade)
        XCTAssertGreaterThan(up.highlight, 0)
        // Jest's `toBe(0)` is `Object.is`: a −0 would fail it, so this does too.
        XCTAssertEqual(north.highlight, 0)
        XCTAssertEqual(north.highlight.sign, .plus)
    }

    func testAddsABroadSheenByTheKeysAngleNotItsCubeAndLeavesTheDefaultLightAlone() {
        let n: Mesh3D.Vec3 = [0, 0, 1]
        let plain = Mesh3D.lighting(n, .default)
        var sheenLight = Mesh3D.Light.default
        sheenLight.gloss = 0
        sheenLight.sheen = 0.2
        let sheened = Mesh3D.lighting(n, sheenLight)
        let k = max(0, Mesh3D.Light.default.key.z)
        assertClose(sheened.highlight, 0.2 * k, 9)
        assertClose(sheened.shade, plain.shade, 9)
        XCTAssertNil(Mesh3D.Light.default.sheen)
        assertClose(plain.highlight, Mesh3D.Light.default.gloss * pow(k, 3), 9)
    }

    func testReadsAHexColourAndFallsToGreyForAnythingElse() {
        XCTAssertEqual(Mesh3D.hexToRgb("#d9442a"), Mesh3D.Rgb(217, 68, 42))
        XCTAssertEqual(Mesh3D.hexToRgb("red"), Mesh3D.Rgb(128, 128, 128))
    }

    func testLetsABlackSurfaceComeUpUnderAHighlightAndClampsAtWhite() {
        XCTAssertEqual(Mesh3D.litColor(Mesh3D.Rgb(28, 28, 30), 0.5, 0.2), "rgb(65,65,66)")
        XCTAssertEqual(Mesh3D.litColor(Mesh3D.Rgb(250, 250, 250), 1.2, 0.5), "rgb(255,255,255)")
    }

    func testRoundsHalvesUpTheWayJavaScriptDoes() {
        // 28 × 0.5 + 0 = 14 exactly; 29 × 0.5 = 14.5 → 15 (Math.round), never
        // the banker's 14; a negative clamps to 0.
        XCTAssertEqual(Mesh3D.litRgb(Mesh3D.Rgb(28, 29, 0), 0.5, 0), Mesh3D.Rgb(14, 15, 0))
        XCTAssertEqual(Mesh3D.litRgb(Mesh3D.Rgb(10, 10, 10), -1, 0), Mesh3D.Rgb(0, 0, 0))
    }
}

final class Mesh3DPaintTests: XCTestCase {
    func testFillsAndStrokesEveryFaceItIsHandedInkedWhereThePartAsks() {
        var outlined = Mesh3D.box("a", [0, 0, 0], [1, 1, 1], "body")
        outlined.outline = true
        var plain = Mesh3D.box("b", [0, 3, 0], [1, 4, 1], "body")
        plain.outline = false
        let faces = Mesh3D.renderOrder([outlined, plain], meshPose(tilt: Double.pi / 3))
        let steps = Mesh3D.paintSteps(faces, palette: ["body": "#ffffff"], ink: "#000000", outlineWidth: 2)
        XCTAssertEqual(steps.count, faces.count)
        XCTAssertEqual(steps.filter { $0.stroke == "#000000" }.count, faces.filter(\.outline).count)
        // The rest are stroked in their own fill, one pixel at most.
        for step in steps where !step.inked {
            XCTAssertEqual(step.stroke, step.fill.css)
            XCTAssertEqual(step.lineWidth, 1)
        }
        // An unknown role paints mid grey, lit.
        let grey = Mesh3D.paintSteps(faces, palette: [:], ink: "#000000", outlineWidth: 2)
        XCTAssertEqual(grey[0].fill, Mesh3D.litRgb(Mesh3D.Rgb(128, 128, 128), faces[0].shade, faces[0].highlight))
    }

    func testThrowsTheGroundShadowNorthEastSquashedByTheTiltAndTurnedWithTheHeading() {
        let p = meshPose(fx: 1, fy: 0, tilt: Double.pi / 6, scale: 20, x: 50, y: 60)
        let shadow = Mesh3D.groundShadow(p, halfLength: 2.3, halfWidth: 0.95)
        assertClose(shadow.origin.x, 56, 9)
        assertClose(shadow.origin.y, 60 - 20 * 0.22 * 0.5, 9)
        assertClose(shadow.squash, 0.5, 9)
        assertClose(shadow.rotation, Double.pi / 2, 9)
        XCTAssertEqual(shadow.ellipses.count, 3)
        assertClose(shadow.ellipses[0].radiusX, 0.95 * 20 * 1.16, 9)
        assertClose(shadow.ellipses[0].radiusY, 2.3 * 20 * 1.16, 9)
        assertClose(shadow.ellipses[0].alpha, 0.26 * 0.35, 9)
        assertClose(shadow.ellipses[2].alpha, 0.26, 9)
    }
}
