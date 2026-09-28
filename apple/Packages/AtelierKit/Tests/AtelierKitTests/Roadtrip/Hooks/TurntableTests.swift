// The turntable's rules — the web component `CarTurntable.tsx` has no spec of
// its own, so this one pins what it does: the lap, the clamp, the drag, the
// keys, and that its car is the DRIVE's car (the same steps the Virée paints).

import XCTest
@testable import AtelierKit

final class TurntableTurnTests: XCTestCase {
    func testOpensThreeQuartersFromTheFrontFiftyTwoDegreesUp() {
        assertClose(Turntable.Angles.initial.heading, Double.pi * 0.82, 12)
        assertClose(Turntable.Angles.initial.tilt, 52 * Double.pi / 180, 12)
    }

    func testTurnsALapInAboutTwentyFiveSeconds() {
        let lap = 2 * Double.pi / Turntable.turnRate
        assertClose(lap, 25.13, 2)
        let start = Turntable.Angles(heading: 1, tilt: 1)
        let back = Turntable.spun(start, seconds: lap)
        assertClose(back.heading, 1, 9)
        XCTAssertEqual(back.tilt, 1)
        assertClose(Turntable.spun(start, seconds: 2).heading, 1.5, 12)
        // No time, or junk time, turns nothing.
        XCTAssertEqual(Turntable.spun(start, seconds: 0), start)
        XCTAssertEqual(Turntable.spun(start, seconds: .nan), start)
    }

    func testWrapsTheHeadingIntoOneLapAndHoldsTheTiltBetween35And90() {
        let a = Turntable.turned(Turntable.Angles(heading: 6, tilt: 1), dHeading: 1, dTilt: 5)
        assertClose(a.heading, 7 - 2 * Double.pi, 12)
        assertClose(a.tilt, Double.pi / 2, 12)
        let b = Turntable.turned(Turntable.Angles(heading: 0.5, tilt: 1), dHeading: -1, dTilt: -5)
        assertClose(b.heading, 2 * Double.pi - 0.5, 12)
        assertClose(b.tilt, 35 * Double.pi / 180, 12)
    }

    func testAFullWidthDraggedIsOneLapAndOnlyAPointerThatTiltsTilts() {
        let start = Turntable.Angles.initial
        let lap = Turntable.dragged(start, dx: 300, dy: 0, width: 300, height: 200, tilts: true)
        assertClose(lap.heading, start.heading, 9)
        // Right turns the platter the other way round the heading.
        let quarter = Turntable.dragged(start, dx: 75, dy: 0, width: 300, height: 200, tilts: false)
        assertClose(quarter.heading, start.heading - Double.pi / 2, 9)
        // A finger never tilts; a mouse pulling down raises the camera.
        let finger = Turntable.dragged(start, dx: 0, dy: 100, width: 300, height: 200, tilts: false)
        XCTAssertEqual(finger.tilt, start.tilt)
        let mouse = Turntable.dragged(start, dx: 0, dy: 20, width: 300, height: 200, tilts: true)
        assertClose(mouse.tilt, start.tilt + 0.1 * (Turntable.maxTilt - Turntable.minTilt), 12)
        // A box with no size moves nothing.
        XCTAssertEqual(Turntable.dragged(start, dx: 50, dy: 50, width: 0, height: 200, tilts: true), start)
    }

    func testTheArrowsTurnByFifteenDegreesAndTiltByFive() {
        let start = Turntable.Angles(heading: 1, tilt: 1)
        assertClose(Turntable.keyed(start, .right).heading, 1 + Double.pi / 12, 12)
        assertClose(Turntable.keyed(start, .left).heading, 1 - Double.pi / 12, 12)
        assertClose(Turntable.keyed(start, .up).tilt, 1 + Double.pi / 36, 12)
        assertClose(Turntable.keyed(start, .down).tilt, 1 - Double.pi / 36, 12)
        XCTAssertEqual(Turntable.keyed(start, .up).heading, start.heading)
    }
}

final class TurntableFrameTests: XCTestCase {
    private let spec = defaultCarSpec()
    private var parts: [Mesh3D.Part] { carModel(spec.model).build(spec.gear) }

    func testABoxWithNoSizePaintsNothing() {
        XCTAssertNil(Turntable.frame(spec, parts: parts, angles: .initial, width: 0, height: 300))
        XCTAssertNil(Turntable.frame(spec, parts: parts, angles: .initial, width: 300, height: -1))
    }

    func testCentresTheCarLowInTheBoxAtAScaleOfTheShorterSide() throws {
        let f = try XCTUnwrap(Turntable.frame(spec, parts: parts, angles: .initial, width: 400, height: 300))
        let scale = 300 / (carLength * 1.35)
        assertClose(f.car.pose.scale, scale, 12)
        assertClose(f.car.pose.x, 200, 12)
        assertClose(f.car.pose.y, 168, 12)
        assertClose(f.car.pose.fx, sin(Turntable.Angles.initial.heading), 12)
        assertClose(f.car.pose.fy, cos(Turntable.Angles.initial.heading), 12)
        XCTAssertEqual(f.car.pose.spins, [:])
        assertClose(f.disc.radius, carLength * 0.64 * scale, 12)
        assertClose(f.disc.squash, sin(Turntable.Angles.initial.tilt), 12)
        // The platter sits under the car, on the pose's own point.
        XCTAssertEqual(f.disc.center, Point(f.car.pose.x, f.car.pose.y))
        XCTAssertEqual(f.disc.fill, "rgba(20,16,12,0.045)")
        assertClose(f.disc.ringWidth, max(1, scale / 60), 12)
    }

    func testDrawsTheDrivesOwnCarOverItsShadow() throws {
        let angles = Turntable.Angles(heading: 2.2, tilt: 0.9)
        let f = try XCTUnwrap(Turntable.frame(spec, parts: parts, angles: angles, width: 360, height: 240))
        let pose = f.car.pose
        let want = Mesh3D.paintSteps(Mesh3D.renderOrder(parts, pose, carLight(spec.finish)),
                                     palette: carPalette(spec.color), ink: "rgba(20,16,12,0.85)",
                                     outlineWidth: max(0.9, pose.scale * carLength / 78))
        XCTAssertFalse(f.car.faces.isEmpty)
        XCTAssertEqual(f.car.faces, want)
        XCTAssertEqual(f.car.shadow, Mesh3D.groundShadow(pose, halfLength: carLength / 2, halfWidth: carWidth / 2,
                                                         alpha: 0.3))
    }

    func testTheFinishAndTheColourReachTheFaces() throws {
        var glossy = spec
        glossy.finish = .gloss
        glossy.color = "#f2f1ea"
        let matte = try XCTUnwrap(Turntable.frame(spec, parts: parts, angles: .initial, width: 300, height: 300))
        let gloss = try XCTUnwrap(Turntable.frame(glossy, parts: parts, angles: .initial, width: 300, height: 300))
        XCTAssertEqual(matte.car.faces.count, gloss.car.faces.count)
        XCTAssertNotEqual(matte.car.faces.map(\.fill), gloss.car.faces.map(\.fill))
    }
}
