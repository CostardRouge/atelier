// Port of `src/shared/roadtrip/day-track.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

/// A row shaped exactly as `GET /api/assets/geo?by=day` sends one.
private func row(_ extra: [String: JSONValue] = [:]) -> JSONValue {
    var base: [String: JSONValue] = [
        "date": "2025-11-02", "lat": -31.95, "lon": 115.86, "count": 120, "measured": 40, "source": "measured",
    ]
    base.merge(extra) { _, new in new }
    return .object(base)
}

final class TripReadDayPointTests: XCTestCase {
    func testReadsAWellFormedRowAsItStands() {
        XCTAssertEqual(readDayPoint(row()),
                       DayPoint(date: "2025-11-02", lat: -31.95, lon: 115.86, count: 120, measured: 40, inferred: false))
    }

    func testReadsProvenanceFromTheWordTheInstanceReallySends() {
        XCTAssertEqual(readDayPoint(row(["source": "inferred"]))?.inferred, true)
        XCTAssertEqual(readDayPoint(row(["source": "measured"]))?.inferred, false)
        // `source` wins over the counts, so a day placed by five real fixes among
        // eight hundred bulk-accepted ones is still measured.
        XCTAssertEqual(readDayPoint(row(["source": "measured", "measured": 5, "count": 805]))?.inferred, false)
    }

    func testRefusesAnInstantRatherThanSlicingADayOutOfIt() {
        XCTAssertNil(readDayPoint(row(["date": "2025-11-02T07:00:00Z"])))
    }

    func testRefusesACalendarImpossibility() {
        XCTAssertNil(readDayPoint(row(["date": "2025-02-30"])))
    }

    func testRefusesARowWithNoUsablePosition() {
        XCTAssertNil(readDayPoint(row(["lat": nil])))
        XCTAssertNil(readDayPoint(row(["lon": "east"])))
        XCTAssertNil(readDayPoint(row(["lat": .number(Double.nan)])))
    }

    func testRefusesAPositionOffTheGlobe() {
        XCTAssertNil(readDayPoint(row(["lat": -91])))
        XCTAssertNil(readDayPoint(row(["lon": 181])))
    }

    func testRefusesNullIslandWhichIsWhatACameraWritesWithNoFix() {
        XCTAssertNil(readDayPoint(row(["lat": 0, "lon": 0])))
        // A real position ON the equator or the meridian is not Null Island.
        XCTAssertNotNil(readDayPoint(row(["lat": 0, "lon": 115.86])))
    }

    func testStillUnderstandsABooleanForAnOlderOrStubbedInstance() {
        let bare: JSONValue = ["date": "2025-11-02", "lat": -31.95, "lon": 115.86, "count": 120, "measured": 40, "inferred": true]
        XCTAssertEqual(readDayPoint(bare)?.inferred, true)
    }

    func testFallsBackToTheCountsOnlyWhenProvenanceIsNotStatedAtAll() {
        func bare(_ measured: Int) -> JSONValue {
            .object(["date": "2025-11-02", "lat": -31.95, "lon": 115.86, "count": 120, "measured": .number(Double(measured))])
        }
        XCTAssertEqual(readDayPoint(bare(0))?.inferred, true)
        XCTAssertEqual(readDayPoint(bare(3))?.inferred, false)
    }

    func testTrustsTheSmallerNumberWhenARowSaysMoreMeasuredThanItHolds() {
        XCTAssertEqual(readDayPoint(row(["count": 5, "measured": 900]))?.measured, 5)
    }

    func testRefusesAnythingThatIsNotARow() {
        XCTAssertNil(readDayPoint(nil))
        XCTAssertNil(readDayPoint(.null))
        XCTAssertNil(readDayPoint("2025-11-02"))
    }
}

final class TripReadDayTrackTests: XCTestCase {
    func testPutsTheDaysInCalendarOrderWhateverOrderTheyArrivedIn() {
        let track = readDayTrack([row(["date": "2025-11-04"]), row(["date": "2025-11-02"]), row(["date": "2025-11-03"])])
        XCTAssertEqual(track.points.map(\.date), ["2025-11-02", "2025-11-03", "2025-11-04"])
    }

    func testKeepsADeclaredGapApartWhichIsWhyOneRequestIsEnough() {
        // A day matching the filters with no position at all is still sent, with
        // null coordinates. That is "no data for this day", not "no media".
        let track = readDayTrack([
            row(["date": "2025-11-02"]),
            ["date": "2025-11-03", "lat": nil, "lon": nil, "count": 84, "measured": 0, "source": nil],
            row(["date": "2025-11-04"]),
        ])
        XCTAssertEqual(track.points.map(\.date), ["2025-11-02", "2025-11-04"])
        XCTAssertEqual(track.blind, ["2025-11-03"])
    }

    func testKeepsTheFirstOfARepeatedDaySoPageOrderCannotDecide() {
        let track = readDayTrack([row(["date": "2025-11-02", "count": 1]), row(["date": "2025-11-02", "count": 999])])
        XCTAssertEqual(track.points.count, 1)
        XCTAssertEqual(track.points[0].count, 1)
    }

    func testNeverLetsOneDateBeBothPlacedAndBlind() {
        let track = readDayTrack([
            row(["date": "2025-11-02"]),
            ["date": "2025-11-02", "lat": nil, "lon": nil, "count": 5, "measured": 0, "source": nil],
        ])
        XCTAssertEqual(track.points.map(\.date), ["2025-11-02"])
        XCTAssertEqual(track.blind, [])
    }

    func testDropsARowThatIsNeitherAPositionNorAGap() {
        let track = readDayTrack([row(["date": "hier"]), row(["date": "2025-11-03"])])
        XCTAssertEqual(track.points.map(\.date), ["2025-11-03"])
        XCTAssertEqual(track.blind, [])
    }

    func testHasNothingToSayAboutAnEmptyAnswer() {
        XCTAssertEqual(readDayTrack([]), DayTrack(points: [], blind: []))
    }
}
