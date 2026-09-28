// Port of `src/shared/roadtrip/segment-track.test.ts`, case for case.

import Foundation
import XCTest
@testable import AtelierKit

/// Perth, and Kalbarri ~470 km north of it — far past any sane radius.
private let perth = -31.95
private let kalbarri = -27.71
private let between = -29.8
private let lon = 115.86

private func day(_ date: String, _ lat: Double, count: Int = 100, measured: Int = 50, inferred: Bool = false) -> DayPoint {
    DayPoint(date: date, lat: lat, lon: lon, count: count, measured: measured, inferred: inferred)
}

private func spans(_ legs: [TrackLeg]) -> [String] {
    legs.map { "\($0.startDate)→\($0.endDate)" }
}

final class SegmentTrackRunsTests: XCTestCase {
    func testHasNothingToSayAboutAnEmptyTrace() {
        XCTAssertEqual(segmentTrack([]), TrackSegmentation(legs: [], blind: []))
    }

    func testReadsARunOfDaysAtOnePlaceAsOneLeg() {
        let r = segmentTrack([
            day("2025-11-02", perth),
            day("2025-11-03", perth + 0.01),
            day("2025-11-04", perth - 0.02),
            day("2025-11-05", perth),
        ])
        XCTAssertEqual(r.legs.count, 1)
        let leg = r.legs[0]
        XCTAssertEqual(leg.startDate, "2025-11-02")
        XCTAssertEqual(leg.endDate, "2025-11-05")
        XCTAssertEqual(leg.dayCount, 4)
        XCTAssertEqual(leg.bridged, 0)
        XCTAssertEqual(leg.count, 400)
        XCTAssertFalse(leg.short)
        XCTAssertEqual(r.blind, [])
    }

    func testCutsWhereTheDayMovedFurtherThanTheRadius() {
        let r = segmentTrack([
            day("2025-11-02", perth), day("2025-11-03", perth), day("2025-11-04", kalbarri), day("2025-11-05", kalbarri),
        ])
        XCTAssertEqual(spans(r.legs), ["2025-11-02→2025-11-03", "2025-11-04→2025-11-05"])
    }

    func testFoldsTheSameTwoHaltsIntoOneWhenTheRadiusGrows() {
        let trace = [
            day("2025-11-02", perth), day("2025-11-03", perth), day("2025-11-04", kalbarri), day("2025-11-05", kalbarri),
        ]
        XCTAssertEqual(segmentTrack(trace, SegmentOptions(radiusKm: 600)).legs.count, 1)
    }

    func testNamesTheLegFromTheMedianSoOneStrayDayCannotMoveIt() {
        let r = segmentTrack([day("2025-11-02", perth), day("2025-11-03", perth + 0.01), day("2025-11-04", perth + 0.2)])
        XCTAssertEqual(r.legs.count, 1)
        assertClose(r.legs[0].centroid.lat, perth + 0.01, 6)
        // The running mean the walk uses would have landed elsewhere.
        XCTAssertGreaterThanOrEqual(abs(r.legs[0].centroid.lat - (perth + 0.07)), 0.0005)
    }
}

final class SegmentTrackBlindDaysTests: XCTestCase {
    func testBridgesABlindDayWhoseNeighboursAreTheSamePlaceAndCountsIt() {
        let r = segmentTrack([
            day("2025-11-02", perth),
            day("2025-11-03", perth),
            // 2025-11-04 carries no position at all.
            day("2025-11-05", perth - 0.01),
        ])
        XCTAssertEqual(r.legs.count, 1)
        XCTAssertEqual(spans(r.legs), ["2025-11-02→2025-11-05"])
        XCTAssertEqual(r.legs[0].dayCount, 4)
        XCTAssertEqual(r.legs[0].bridged, 1)
        XCTAssertEqual(r.blind, [])
    }

    func testCutsOnThatSameDayWhenBridgingIsTurnedOff() {
        let r = segmentTrack([day("2025-11-02", perth), day("2025-11-03", perth), day("2025-11-05", perth)],
                             SegmentOptions(bridgeBlind: false))
        XCTAssertEqual(spans(r.legs), ["2025-11-02→2025-11-03", "2025-11-05→2025-11-05"])
        XCTAssertEqual(r.blind, [Gap(start: "2025-11-04", end: "2025-11-04", length: 1)])
    }

    func testNeverBridgesAHoleWhoseTwoEndsContradictEachOther() {
        let r = segmentTrack([
            day("2025-11-02", perth),
            day("2025-11-03", perth),
            // 2025-11-04 blind, and the trace resumes 470 km away.
            day("2025-11-05", kalbarri),
        ])
        XCTAssertEqual(spans(r.legs), ["2025-11-02→2025-11-03", "2025-11-05→2025-11-05"])
        XCTAssertEqual(r.blind, [Gap(start: "2025-11-04", end: "2025-11-04", length: 1)])
    }

    func testInventsTheDaysOfAMoveOnlyWhenAskedAndMarksWhatItInvented() {
        let r = segmentTrack([day("2025-11-02", perth), day("2025-11-03", perth), day("2025-11-05", kalbarri)],
                             SegmentOptions(interpolateMoves: true))
        XCTAssertEqual(spans(r.legs), ["2025-11-02→2025-11-03", "2025-11-04→2025-11-04", "2025-11-05→2025-11-05"])
        XCTAssertTrue(r.legs[1].inferred)
        XCTAssertEqual(r.legs[1].count, 0)
        XCTAssertFalse(r.legs[0].inferred)
        XCTAssertEqual(r.blind, [])
    }

    func testCallsALegInferredOnlyWhenNotOneOfItsDaysWasMeasured() {
        let allGuessed = segmentTrack([
            day("2025-11-02", perth, measured: 0, inferred: true), day("2025-11-03", perth, measured: 0, inferred: true),
        ])
        XCTAssertTrue(allGuessed.legs[0].inferred)

        let oneReal = segmentTrack([day("2025-11-02", perth, measured: 0, inferred: true), day("2025-11-03", perth)])
        XCTAssertFalse(oneReal.legs[0].inferred)
    }
}

final class SegmentTrackShortHaltsTests: XCTestCase {
    private let stopover = [
        day("2025-11-02", perth),
        day("2025-11-03", perth),
        day("2025-11-04", perth),
        day("2025-11-05", between),
        day("2025-11-06", kalbarri),
        day("2025-11-07", kalbarri),
        day("2025-11-08", kalbarri),
    ]

    func testListsAShortHaltAndMarksItRatherThanHidingIt() {
        let legs = segmentTrack(stopover).legs
        XCTAssertEqual(legs.count, 3)
        XCTAssertEqual(legs[1].startDate, "2025-11-05")
        XCTAssertEqual(legs[1].dayCount, 1)
        XCTAssertTrue(legs[1].short)
        XCTAssertEqual(legs.filter(\.short).count, 1)
    }

    func testFoldsItIntoTheHaltItWasOnTheWayToWhenAsked() {
        let legs = segmentTrack(stopover, SegmentOptions(shortLegs: .merge)).legs
        XCTAssertEqual(spans(legs), ["2025-11-02→2025-11-04", "2025-11-05→2025-11-08"])
        XCTAssertEqual(legs[1].dayCount, 4)
        XCTAssertEqual(legs[1].absorbed, 1)
        XCTAssertFalse(legs[1].short)
    }

    func testGivesATrailingShortHaltToTheOneBeforeIt() {
        let legs = segmentTrack([
            day("2025-11-02", perth), day("2025-11-03", perth), day("2025-11-04", perth), day("2025-11-05", kalbarri),
        ], SegmentOptions(shortLegs: .merge)).legs
        XCTAssertEqual(spans(legs), ["2025-11-02→2025-11-05"])
        XCTAssertEqual(legs[0].absorbed, 1)
        XCTAssertEqual(legs[0].dayCount, 4)
    }

    func testRefusesToFoldAcrossABlindGapWhichWouldClaimDaysNothingSupports() {
        let r = segmentTrack([
            day("2025-11-02", perth),
            day("2025-11-03", perth),
            day("2025-11-04", perth),
            day("2025-11-05", between),
            // 2025-11-06 is blind, and the trace resumes elsewhere.
            day("2025-11-07", kalbarri),
            day("2025-11-08", kalbarri),
        ], SegmentOptions(shortLegs: .merge))
        XCTAssertEqual(r.blind, [Gap(start: "2025-11-06", end: "2025-11-06", length: 1)])
        XCTAssertEqual(spans(r.legs), ["2025-11-02→2025-11-04", "2025-11-05→2025-11-05", "2025-11-07→2025-11-08"])
        XCTAssertTrue(r.legs[1].short)
    }

    func testTakesTheHaltThresholdFromTheCaller() {
        let legs = segmentTrack(stopover, SegmentOptions(minNights: 4)).legs
        XCTAssertEqual(legs.map(\.short), [true, true, true])
    }
}
