// Port of `src/shared/roadtrip/hooks/geo.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let PERTH = GeoPoint(lat: -31.95, lon: 115.86)
private let BROOME = GeoPoint(lat: -17.96, lon: 122.24)

final class TripProjectionForTests: XCTestCase {
    func testAgreesWithFitProjectionAboutWhereAPointLands() {
        let box = Rect(x: 10, y: 20, width: 300, height: 500)
        let fit = fitProjection([PERTH, BROOME], box)
        let p = projectionFor([PERTH, BROOME], box.width, box.height)
        let cx = box.x + box.width / 2
        let cy = box.y + box.height / 2
        for point in [PERTH, BROOME, GeoPoint(lat: -25, lon: 118)] {
            let a = fit(point)
            let b = p.at(point, cx, cy)
            assertClose(b.x, a.x, 6)
            assertClose(b.y, a.y, 6)
        }
    }

    func testKeepsItsScaleWhenReCentredACameraThatFollowsMovesTheViewNotTheMap() {
        let p = projectionFor([PERTH, BROOME], 300, 500)
        let a = p.at(BROOME, 0, 0)
        let b = p.at(BROOME, 100, -40)
        assertClose(b.x - a.x, 100, 9)
        assertClose(b.y - a.y, -40, 9)
    }

    func testHasNorthUpAndEastRight() {
        let p = projectionFor([PERTH, BROOME], 300, 500)
        let perth = p.at(PERTH, 0, 0)
        let broome = p.at(BROOME, 0, 0)
        XCTAssertLessThan(broome.y, perth.y)
        XCTAssertGreaterThan(broome.x, perth.x)
    }

    func testTakesTheFallbackScaleForASingleSpot() {
        let p = projectionFor([PERTH], 300, 500, fallbackScale: 42)
        XCTAssertEqual(p.scale, 42)
        XCTAssertEqual(p.at(PERTH, 7, 9), Point(7, 9))
    }
}

final class TripHaversineFormatDistanceTests: XCTestCase {
    func testMeasuresPerthToBroomeAtAbout1680Km() {
        let km = haversineKm(PERTH, BROOME)
        XCTAssertGreaterThan(km, 1650)
        XCTAssertLessThan(km, 1720)
    }

    func testFormatsWithAThousandsSpaceAndOneDecimalUnderTen() {
        XCTAssertEqual(formatDistance(1682.4, .km), "1 682 km")
        XCTAssertEqual(formatDistance(3.14159, .km), "3.1 km")
        XCTAssertEqual(formatDistance(100, .mi), "62 mi")
        XCTAssertEqual(formatDistance(100, .off), "")
    }

    /// `toFixed` rounds an exact tie up where `printf` rounds it to even, and
    /// groups every three digits — pinned so the two clients write one label.
    func testRoundsAndGroupsAsJavaScriptDoes() {
        XCTAssertEqual(formatDistance(0.25, .km), "0.3 km")
        XCTAssertEqual(formatDistance(9.75, .km), "9.8 km")
        XCTAssertEqual(formatDistance(0.15, .km), "0.1 km")
        XCTAssertEqual(formatDistance(10, .km), "10 km")
        XCTAssertEqual(formatDistance(1_234_567.5, .km), "1 234 568 km")
    }
}

final class TripPlaceLabelsTests: XCTestCase {
    private let frame = Size(400, 400)

    func testPlacesToTheRightFirstThenTheLeftWhenTheRightLeavesTheFrame() {
        let labels = placeLabels([
            LabelCandidate(x: 100, y: 100, name: "Perth", wanted: true),
            LabelCandidate(x: 395, y: 300, name: "Broome", wanted: true),
        ], 20, frame, 4)
        XCTAssertEqual(labels[0].side, .right)
        XCTAssertEqual(labels[1].side, .left)
    }

    func testNeverPutsANameInsideABoxTheCallerReserved() {
        let reserved = [LabelBox(x0: 100, y0: 60, x1: 260, y1: 140)]
        let labels = placeLabels([LabelCandidate(x: 100, y: 100, name: "Perth", wanted: true)], 20, frame, 4,
                                 reserved: reserved)
        XCTAssertEqual(labels[0].side, .left)
    }

    func testDropsANameRatherThanDrawingItOverAnother() {
        let labels = placeLabels([
            LabelCandidate(x: 200, y: 200, name: "Somewhere", wanted: true),
            LabelCandidate(x: 201, y: 200, name: "Elsewhere", wanted: true),
            LabelCandidate(x: 202, y: 201, name: "Nowhere", wanted: true),
            LabelCandidate(x: 203, y: 199, name: "Anywhere", wanted: true),
            LabelCandidate(x: 200, y: 202, name: "Everywhere", wanted: true),
        ], 20, frame, 4)
        XCTAssertLessThan(labels.count, 5)
        XCTAssertEqual(Set(labels.map(\.side)).count, labels.count)
    }
}
