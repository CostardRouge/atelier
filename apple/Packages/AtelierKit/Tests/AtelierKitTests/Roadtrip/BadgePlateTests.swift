// Port of `src/shared/roadtrip/badge-plate.test.ts` — every case: the camera
// credit read from facts (`badgeContent`), a plate under the badge and in a
// cell of its own (`badgeElements`, `badgeBlockExtent`), and a plate run's id.

import XCTest
@testable import AtelierKit

private func trip() -> TripDoc { createTripDoc("Australia", "2025-01-01", "2025-12-31") }
private func post() -> TripPost { createTripPost(.photo, "2025-03-27", "Cliffs") }

private func opts(_ change: (inout BadgeOptions) -> Void = { _ in }) -> BadgeOptions {
    var o = BadgeOptions(mode: .day, words: defaultBadgeWords, timeAgo: .off, showExif: true, today: "2026-01-01")
    change(&o)
    return o
}

private func plate(_ change: (inout CameraPlateSpec) -> Void = { _ in }) -> CameraPlateSpec {
    var spec = CameraPlateSpec(fields: [.body, .lens, .focal35, .aperture, .shutter, .iso], layout: .tiers,
                               place: .badge, size: 1)
    change(&spec)
    return spec
}

private let aspect = 4.0 / 5
private let layout = defaultBadgeLayout

private func content(_ change: (inout BadgeOptions) -> Void) throws -> BadgeContent {
    try XCTUnwrap(badgeContent(trip(), post(), opts(change)))
}

private func exifRuns(_ els: [OverlayElement]) -> [OverlayElement] {
    els.filter { pieceFromElementId($0.id) == .exif }
}

final class BadgePlateCreditTests: XCTestCase {
    func testDrawsTheLegacyLineFromTheExifItselfWithNoPlate() throws {
        let c = try content { $0.exif = .some(plateSony) }
        XCTAssertEqual(c.exif, exposureSummary(plateSony))
        XCTAssertNil(c.plate)
    }

    func testTreatsAPlateThatIsOnlyThePlainLineAsThatLine() throws {
        let c = try content {
            $0.exif = .some(plateSony)
            $0.camera = plate { $0.layout = .line; $0.fields = [.iso, .aperture] }
        }
        XCTAssertEqual(c.exif, "ISO 200 · ƒ/4")
        XCTAssertNil(c.plate)
    }

    func testHandsAComposedPlateOverWithItsWords() throws {
        let c = try content {
            $0.exif = .some(plateSony)
            $0.camera = plate()
            $0.words = frenchBadgeWords
        }
        XCTAssertEqual(c.plate?.spec.layout, .tiers)
        XCTAssertEqual(c.plate?.words.shotOn, "Pris au")
    }

    func testSaysNothingOverAPictureThatRecordsNoneOfTheChosenFacts() throws {
        let c = try content {
            $0.exif = .some(ExifData(iso: 100))
            $0.camera = plate { $0.fields = [.lens] }
        }
        XCTAssertNil(c.exif)
        XCTAssertNil(c.plate)
    }

    func testGivesAnOverrideTheLastWordAsThePlainLine() throws {
        let c = try content {
            $0.exif = .some(plateSony)
            $0.camera = plate()
            $0.overrides = [.exif: "Shot on a Hasselblad"]
        }
        XCTAssertEqual(c.exif, "Shot on a Hasselblad")
        XCTAssertNil(c.plate)
    }

    func testRenamesTheBodyFromTheTripsOwnTable() throws {
        let c = try content {
            $0.exif = .some(plateSony)
            $0.cameraNames = ["SONY ILCE-7CM2": "Sony α7C II"]
        }
        XCTAssertTrue(c.exif?.hasPrefix("Sony α7C II · ") == true)
    }

    func testStaysOffUntilItIsAskedFor() throws {
        XCTAssertNil(try content {
            $0.exif = .some(plateSony)
            $0.showExif = false
        }.exif)
    }
}

final class BadgePlateUnderTheBadgeTests: XCTestCase {
    func testDrawsThePlainLineExactlyAsTheLegacyPiece() throws {
        let legacy = try content { $0.exposure = exposureSummary(plateSony) }
        let facts = try content { $0.exif = .some(plateSony) }
        XCTAssertEqual(badgeElements(facts, layout, aspect).map(\.id), badgeElements(legacy, layout, aspect).map(\.id))
        XCTAssertEqual(badgeElements(facts, layout, aspect), badgeElements(legacy, layout, aspect))
        XCTAssertEqual(badgeBlockExtent(facts, layout, aspect), badgeBlockExtent(legacy, layout, aspect))
    }

    func testGrowsTheBlockByThePlateAndKeepsItsBottomWhereTheBadgeIsAnchored() throws {
        let line = try content { $0.exif = .some(plateSony) }
        let tiers = try content {
            $0.exif = .some(plateSony)
            $0.camera = plate()
        }
        let a = try XCTUnwrap(badgeBlockExtent(line, layout, aspect))
        let b = try XCTUnwrap(badgeBlockExtent(tiers, layout, aspect))
        assertClose(b.bottom, a.bottom, 9)
        XCTAssertLessThan(b.top, a.top)
    }

    func testDrawsEveryRunOfThePlateAsTheOneCameraPiece() throws {
        let c = try content {
            $0.exif = .some(plateSony)
            $0.camera = plate()
        }
        let els = badgeElements(c, layout, aspect)
        let runs = exifRuns(els)
        XCTAssertEqual(runs.count, 2)
        XCTAssertEqual(runs.map(\.id), ["piece:exif", "piece:exif:1"])
        // Under the rest of the block, hung from the badge's own left edge.
        let headline = try XCTUnwrap(els.first { $0.id == "piece:headline" })
        for r in runs {
            XCTAssertGreaterThan(r.y, headline.y)
            assertClose(r.x, layout.x, 9)
        }
    }

    func testStylesThePlateAsThePieceKeepingItsPinnedFace() throws {
        let c = try content {
            $0.exif = .some(plateSony)
            $0.camera = plate { $0.layout = .plate }
        }
        let els = badgeElements(c, layout, aspect, [.exif: BadgePieceStyle(color: .some("#ff0000"))])
        let mono = exifRuns(els).filter { $0.fontFamily == .jetBrainsMono }
        XCTAssertGreaterThan(mono.count, 0)
        for e in mono {
            XCTAssertEqual(e.color, "#ff0000")
            XCTAssertTrue(e.styleOverrides?.contains("fontFamily") == true)
            XCTAssertTrue(e.styleOverrides?.contains("color") == true)
        }
    }
}

final class BadgePlateInACellTests: XCTestCase {
    func testLeavesTheBlockAloneAndDrawsThePlateInItsCell() throws {
        let none = try content {
            $0.exif = .some(plateSony)
            $0.showExif = false
        }
        let own = try content {
            $0.exif = .some(plateSony)
            $0.camera = plate { $0.place = .cell(.topRight) }
        }
        XCTAssertEqual(badgeBlockExtent(own, layout, aspect), badgeBlockExtent(none, layout, aspect))
        let runs = exifRuns(badgeElements(own, layout, aspect))
        XCTAssertGreaterThan(runs.count, 0)
        for r in runs {
            XCTAssertEqual(r.anchor, .topRight)
            assertClose(r.x, 0.93, 9)
            XCTAssertLessThan(r.y, 0.3)
        }
    }

    func testSendsAnEdgeBarToTheFramesBottomEdgeAcrossItsWidth() throws {
        let c = try content {
            $0.exif = .some(plateSony)
            $0.camera = plate { $0.layout = .bar }
        }
        let runs = exifRuns(badgeElements(c, layout, aspect))
        XCTAssertEqual(runs.map(\.x), [0.05, 0.95])
        for r in runs { XCTAssertGreaterThan(r.y, 0.9) }
    }

    func testLetsThePlateArriveAfterTheBlockWhenTheBadgeCascades() throws {
        let c = try content {
            $0.exif = .some(plateSony)
            $0.camera = plate { $0.place = .cell(.topLeft) }
        }
        let cascade = BadgeCascade(step: AnimStep(preset: .fade, duration: 0.5, easing: .out),
                                   stagger: Stagger(each: 0.1, order: .sequence))
        let els = badgeElements(c, layout, aspect, [:], 4, cascade)
        func delay(_ id: String) -> Double { els.first { $0.id == id }?.animation?.inStep?.delay ?? -1 }
        let blockDelays = els.filter { pieceFromElementId($0.id) != .exif }.map { delay($0.id) }
        XCTAssertGreaterThan(delay("piece:exif"), blockDelays.max()!)
    }
}

final class BadgePlatePieceIdTests: XCTestCase {
    func testReadsAPlateRunsIdAsItsPiece() {
        XCTAssertEqual(pieceFromElementId("piece:exif:3"), .exif)
        XCTAssertEqual(pieceFromElementId("piece:headline"), .headline)
        XCTAssertNil(pieceFromElementId("piece:nope:1"))
    }
}
