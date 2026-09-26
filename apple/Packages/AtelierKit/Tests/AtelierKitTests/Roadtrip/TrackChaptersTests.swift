// Port of `src/shared/roadtrip/track-chapters.test.ts`, case for case.

import Foundation
import XCTest
@testable import AtelierKit

private let kalbarriCity = GazetteerCity(name: "Kalbarri", country: "AU", lat: -27.7105, lon: 114.165,
                                         population: 2602, section: false)

private func leg(startDate: String = "2025-11-02", endDate: String = "2025-11-05",
                 centroid: GeoPoint = GeoPoint(lat: -27.71, lon: 114.165), inferred: Bool = false,
                 short: Bool = false) -> TrackLeg {
    TrackLeg(startDate: startDate, endDate: endDate, centroid: centroid, dayCount: 4, bridged: 0, count: 400,
             inferred: inferred, short: short, absorbed: 0)
}

final class TrackChaptersOfferTests: XCTestCase {
    func testOffersTheNameInThePlaceAndLeavesTheTitleNil() {
        let entry = trackChapters([leg()], [kalbarriCity])[0]
        XCTAssertNil(entry.chapter.title)
        XCTAssertEqual(entry.chapter.places, [TimelinePlace(name: "Kalbarri", lat: -27.7105, lon: 114.165)])
        XCTAssertEqual(entry.city?.country, "AU")
    }

    func testGivesALegNobodyCanNameNoPlaceAtAll() {
        let middleOfNowhere = leg(centroid: GeoPoint(lat: -31.5, lon: 128.9))
        let entry = trackChapters([middleOfNowhere], [kalbarriCity])[0]
        XCTAssertEqual(entry.chapter.places, [])
        XCTAssertNil(entry.city)
    }

    func testKeepsTheCountryOutOfTheDocument() {
        let entry = trackChapters([leg()], [kalbarriCity])[0]
        XCTAssertFalse(entry.chapter.json.serialized().contains("AU"))
    }

    func testKeysAChapterOnTheDayTheLegBeginsUnderItsOwnPrefix() {
        XCTAssertEqual(trackChapters([leg()], [kalbarriCity])[0].chapter.id, "track:2025-11-02")
    }

    func testChangesTheRevisionWhenTheLegMovesNotWhenItMerelyRepeats() {
        let same = trackChapters([leg()], [kalbarriCity])[0].chapter.revision
        let again = trackChapters([leg()], [kalbarriCity])[0].chapter.revision
        let moved = trackChapters([leg(endDate: "2025-11-07")], [kalbarriCity])[0].chapter.revision
        XCTAssertEqual(again, same)
        XCTAssertNotEqual(moved, same)
    }

    func testNamesNothingWhenThereIsNoIndexToNameFrom() {
        XCTAssertEqual(trackChapters([leg()], [])[0].chapter.places, [])
    }

    func testTakesTheReachFromTheCaller() {
        let outskirts = leg(centroid: GeoPoint(lat: -28.3, lon: 114.165))
        XCTAssertNil(trackChapters([outskirts], [kalbarriCity], TrackChapterOptions(maxKm: 30))[0].city)
        XCTAssertEqual(trackChapters([outskirts], [kalbarriCity], TrackChapterOptions(maxKm: 120))[0].city?.name, "Kalbarri")
    }
}

final class TrackChaptersDoubtfulTests: XCTestCase {
    func testHoldsBackAStopOnTheWayAndALegRestingOnlyOnGuesses() {
        let entries = trackChapters([
            leg(startDate: "2025-11-02", endDate: "2025-11-05"),
            leg(startDate: "2025-11-06", endDate: "2025-11-06", short: true),
            leg(startDate: "2025-11-07", endDate: "2025-11-09", inferred: true),
        ], [kalbarriCity])
        XCTAssertEqual(doubtful(entries), ["track:2025-11-06", "track:2025-11-07"])
    }
}

final class TrackChaptersChainTests: XCTestCase {
    private func day(_ date: String, _ lat: Double) -> DayPoint {
        DayPoint(date: date, lat: lat, lon: 114.165, count: 100, measured: 50, inferred: false)
    }

    private let options = ImportOptions(sourceId: "winnow.example", importedAt: 1_700_000_000_000)

    func testDerivesTheLegLabelFromTheOfferedPlaceNeverPinningAName() {
        let legs = segmentTrack([day("2025-11-02", -27.71), day("2025-11-03", -27.7105), day("2025-11-04", -27.712)]).legs
        let imported = importTimeline(chaptersOf(trackChapters(legs, [kalbarriCity])), options)

        XCTAssertEqual(imported.warnings, [])
        XCTAssertEqual(imported.stages.count, 1)

        let stage = imported.stages[0]
        // The name stays EMPTY and the label comes from the place — so renaming
        // the place renames the leg, which is the whole point of not pinning it.
        XCTAssertEqual(stage.name, "")
        XCTAssertEqual(stageLabel(stage), "Kalbarri")
        XCTAssertEqual(stage.places[0].name, "Kalbarri")
        XCTAssertEqual(stage.places[0].coords, GeoPoint(lat: -27.7105, lon: 114.165))
        XCTAssertEqual(stage.origin?.sourceId, "winnow.example")
        XCTAssertEqual(stage.origin?.chapterId, "track:2025-11-02")
        XCTAssertEqual(imported.span, TripSpan(startDate: "2025-11-02", endDate: "2025-11-04"))
    }

    func testCarriesAnUnnamedLegThroughWithItsDatesAndNothingElse() {
        let legs = segmentTrack([day("2025-11-02", -31.5), day("2025-11-03", -31.5)]).legs
        let imported = importTimeline(chaptersOf(trackChapters(legs, [])), options)

        XCTAssertEqual(imported.warnings, [])
        XCTAssertEqual(imported.stages.count, 1)
        XCTAssertEqual(imported.stages[0].places, [])
        XCTAssertEqual(stageLabel(imported.stages[0]), "")
    }
}
