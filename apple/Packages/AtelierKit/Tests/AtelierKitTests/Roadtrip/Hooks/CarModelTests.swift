// Port of `src/shared/roadtrip/hooks/car-model.test.ts`, case for case.

import XCTest
@testable import AtelierKit

/// Every face of a convex part must point away from the part's centre.
private func outwardEverywhere(_ part: Mesh3D.Part) -> Bool {
    part.faces.allSatisfy { face in
        Mesh3D.dot(Mesh3D.faceNormal(face.verts), Mesh3D.sub(Mesh3D.centroid(face.verts), part.centre)) > -1e-9
    }
}

private func faceCount(_ parts: [Mesh3D.Part]) -> Int {
    parts.reduce(0) { $0 + $1.faces.count }
}

private func gear(_ change: (inout CarGear) -> Void) -> CarGear {
    var g = CarGear.default
    change(&g)
    return g
}

final class BuildCarTests: XCTestCase {
    private let geared = buildCar()
    private let bare = buildCar(.bare)

    func testIsAFewHundredFacesAtMostEveryPartConvexAndWoundOutwardBareOrFullyGeared() {
        XCTAssertGreaterThan(faceCount(bare), 120)
        XCTAssertLessThan(faceCount(bare), 320)
        XCTAssertGreaterThan(faceCount(geared), faceCount(bare))
        XCTAssertLessThan(faceCount(geared), 480)
        for part in geared where part.faces.count > 1 {
            XCTAssertTrue(outwardEverywhere(part), part.id)
        }
    }

    func testFitsItsStatedFootprintWheelsOnTheGroundRoofAtAPradosHeight() {
        let verts = bare.flatMap { $0.faces.flatMap(\.verts) }
        let xs = verts.map(\.x), ys = verts.map(\.y), zs = verts.map(\.z)
        XCTAssertGreaterThan(ys.max()! - ys.min()!, carLength)
        XCTAssertLessThan(ys.max()! - ys.min()!, carLength + 0.6)
        XCTAssertGreaterThanOrEqual(xs.max()! - xs.min()!, carWidth)
        // A 14-gon tyre rests on a flat, a hair above its exact radius.
        XCTAssertGreaterThanOrEqual(zs.min()!, 0)
        XCTAssertLessThan(zs.min()!, 0.03)
        XCTAssertGreaterThan(zs.max()!, 1.9)
        XCTAssertLessThan(zs.max()!, 2.2)
    }

    func testHasFourSpinningWheelsOfTheStatedRadius() {
        let wheels = geared.filter { wheelIds.contains($0.id) }
        XCTAssertEqual(wheels.count, 4)
        for w in wheels {
            XCTAssertEqual(w.spin?.axis, .x)
            assertClose(w.centre.z, wheelRadius, 6)
        }
    }

    func testBoltsEachPieceOfGearOnAndOffByItsToggle() {
        func ids(_ parts: [Mesh3D.Part]) -> Set<String> { Set(parts.map(\.id)) }
        func has(_ parts: [Mesh3D.Part], _ prefix: String) -> Bool { ids(parts).contains { $0.hasPrefix(prefix) } }
        let all = ids(geared)
        XCTAssertFalse(has(bare, "bullbar-"))
        XCTAssertTrue(has(geared, "bullbar-hoop-l-in"))
        XCTAssertTrue(has(geared, "spot-r-lamp"))
        XCTAssertTrue(has(geared, "basket-"))
        XCTAssertTrue(all.contains("solar-panel"))
        XCTAssertTrue(all.contains("storage-box"))
        XCTAssertTrue(all.contains("jerry-fuel"))
        XCTAssertTrue(all.contains("jerry-water-l-handle"))
        XCTAssertTrue(all.contains("awning-bag"))
        XCTAssertTrue(has(geared, "flap-"))
        XCTAssertTrue(has(geared, "visor-"))
        XCTAssertTrue(all.contains("spare"))
        XCTAssertTrue(all.contains("mirror-r"))
        for key in CarGear.keys {
            let prefix: String
            switch key {
            case .bullBar: prefix = "bullbar"
            case .jerryCans: prefix = "jerry"
            case .mudFlaps: prefix = "flap"
            case .rack: prefix = "basket"
            case .spotLights: prefix = "spot"
            case .awning: prefix = "awning"
            case .box: prefix = "storage"
            default: prefix = key.rawValue
            }
            XCTAssertFalse(has(bare, prefix), key.rawValue)
        }
    }

    func testDrawsNoSpotLightWithoutTheBarAndNoLoadWithoutTheBasket() {
        let noBar = buildCar(gear { $0.bullBar = false })
        XCTAssertFalse(noBar.contains { $0.id.hasPrefix("spot-") })
        let noRack = buildCar(gear { $0.rack = false })
        XCTAssertFalse(noRack.contains {
            $0.id.hasPrefix("jerry") || $0.id == "solar-panel" || $0.id == "awning-bag" || $0.id == "storage-box"
        })
    }

    func testPutsTheLoadWhereThePhotographsHaveItThePanelLeftTheBoxRightTheCansAcrossTheRear() {
        func at(_ id: String) -> Mesh3D.Vec3 { geared.first { $0.id == id }!.centre }
        XCTAssertLessThan(at("solar-frame").x, 0)
        XCTAssertGreaterThan(at("storage-box").x, 0)
        XCTAssertLessThan(at("jerry-water-l").x, at("jerry-fuel").x)
        XCTAssertLessThan(at("jerry-fuel").x, at("jerry-water-r").x)
        XCTAssertLessThan(at("jerry-fuel").y, at("solar-frame").y)
        XCTAssertLessThan(at("awning-bag").x, at("solar-frame").x)
        // The spare sits right of centre, which is the LEFT of the tailgate seen from behind.
        XCTAssertGreaterThan(at("spare").x, 0)
    }

    func testFacesItsLampsForwardAndItsVisorsOutward() {
        let lamp = geared.first { $0.id == "spot-l-lamp" }!
        XCTAssertGreaterThan(Mesh3D.faceNormal(lamp.faces[0].verts).y, 0.99)
        let visor = geared.first { $0.id == "visor-r-0" }!
        XCTAssertGreaterThan(Mesh3D.faceNormal(visor.faces[0].verts).x, 0.9)
        let wrap = geared.first { $0.id == "taillight-r-wrap" }!
        let n = Mesh3D.faceNormal(wrap.faces[0].verts)
        XCTAssertGreaterThan(n.x, 0.5)
        XCTAssertLessThan(n.y, -0.5)
    }

    func testShowsItsRoofFromAboveAndItsNoseOnlyWhenHeadingTowardTheCamera() {
        let pose = Mesh3D.Pose(fx: 0, fy: 1, tilt: Double.pi / 3, scale: 20, x: 0, y: 0)
        let north = Mesh3D.renderOrder(geared, pose)
        XCTAssertTrue(north.contains { $0.role == "roof" })
        XCTAssertTrue(north.contains { $0.role == "tail" })
        XCTAssertFalse(north.contains { $0.role == "light" })
        var southPose = pose
        southPose.fy = -1
        let south = Mesh3D.renderOrder(geared, southPose)
        XCTAssertTrue(south.contains { $0.role == "light" })
        XCTAssertTrue(south.contains { $0.role == "lamp" })
        XCTAssertFalse(south.contains { $0.role == "tail" })
    }

    func testPaintsTheBodyInTheAuthorsColourAndEverythingElseInItsOwn() {
        let palette = carPalette("#123456")
        XCTAssertEqual(palette["body"], "#123456")
        XCTAssertEqual(palette["roof"], "#123456")
        XCTAssertNotEqual(palette["tyre"], "#123456")
        for part in geared {
            for face in part.faces { XCTAssertNotNil(palette[face.role], face.role) }
        }
    }
}

final class CarLightTests: XCTestCase {
    func testKeepsTheFactoryHighlightForGlossAndTradesItForABroadSheenOnMatte() {
        XCTAssertEqual(carLight(.gloss), Mesh3D.Light.default)
        let matte = carLight(.matte)
        XCTAssertLessThan(matte.gloss, Mesh3D.Light.default.gloss)
        XCTAssertGreaterThan(matte.sheen ?? 0, 0)
        XCTAssertGreaterThan(matte.ambient, Mesh3D.Light.default.ambient)
    }
}
