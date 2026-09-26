// Port of `src/shared/roadtrip/trip-edit.test.ts`, case for case.

import Foundation
import XCTest
@testable import AtelierKit

/// A trip over the whole of November, optionally with one leg naming `places`.
private func trip(_ places: [TripPlace] = []) -> TripDoc {
    var doc = createTripDoc("Australie", "2025-11-02", "2025-11-30")
    if !places.isEmpty {
        doc.stages = [createTripStage("", "", "2025-11-02", "2025-11-30", places: places)]
    }
    return doc
}

final class SpanEditImpactTests: XCTestCase {
    func testSaysNothingWhenTheSpanOnlyGrows() {
        let doc = trip([createTripPlace("Perth"), createTripPlace("Cairns")])
        let impact = spanImpact(doc, "2025-11-01", "2025-12-10")
        XCTAssertEqual(impact, SpanImpact(trimmedStages: 0, droppedStages: 0, strandedPosts: 0))
        XCTAssertFalse(hasImpact(impact))
    }

    func testCountsALegThatOverhangsAsTrimmedAndOneOutsideAsDropped() {
        var doc = trip()
        doc.stages = [
            createTripStage("", "", "2025-11-02", "2025-11-10"),
            createTripStage("", "", "2025-11-20", "2025-11-30"),
        ]
        let impact = spanImpact(doc, "2025-11-05", "2025-11-15")
        XCTAssertEqual(impact.trimmedStages, 1)
        XCTAssertEqual(impact.droppedStages, 1)
        XCTAssertTrue(hasImpact(impact))
    }

    func testCountsAPieceLeftOutsideIncludingAMultiDayOneThatStillReachesIn() {
        var doc = trip()
        doc.posts = [
            createTripPost(.reel, "2025-11-03", "gone"),
            createTripPost(.carousel, "2025-11-04", "reaches in", endDate: "2025-11-08"),
            createTripPost(.reel, "2025-11-20", "inside"),
        ]
        XCTAssertEqual(spanImpact(doc, "2025-11-06", "2025-11-30").strandedPosts, 1)
    }
}

final class SpanEditRetimeStagesTests: XCTestCase {
    func testTrimsWhatOverhangsAndDropsWhatFallsOutside() {
        let stages = [
            createTripStage("a", "", "2025-11-02", "2025-11-10"),
            createTripStage("b", "", "2025-11-11", "2025-11-14"),
            createTripStage("c", "", "2025-11-20", "2025-11-30"),
        ]
        let out = retimeStages(stages, "2025-11-05", "2025-11-15")
        XCTAssertEqual(out.map(\.name), ["a", "b"])
        XCTAssertEqual(out[0].startDate, "2025-11-05")
        XCTAssertEqual(out[0].endDate, "2025-11-10")
    }

    func testReturnsTheVerySameStageForALegItDoesNotTouch() {
        let stage = createTripStage("a", "", "2025-11-02", "2025-11-10")
        XCTAssertEqual(retimeStages([stage], "2025-11-01", "2025-11-30")[0], stage)
    }
}

final class SpanEditApplyTripDetailsTests: XCTestCase {
    func testMovesTheDatesAndBringsTheLegsInsideTheNewSpan() {
        let doc = trip([createTripPlace("Perth"), createTripPlace("Cairns")])
        let next = applyTripDetails(doc, TripDetailsEdit(startDate: "2025-11-10", endDate: "2025-11-20"))
        XCTAssertEqual(next.startDate, "2025-11-10")
        XCTAssertEqual(next.stages[0].startDate, "2025-11-10")
        XCTAssertEqual(next.stages[0].endDate, "2025-11-20")
    }

    func testNeverTouchesThePostsEvenOneLeftOutside() {
        var doc = trip()
        doc.posts = [createTripPost(.reel, "2025-11-03", "early")]
        let next = applyTripDetails(doc, TripDetailsEdit(startDate: "2025-11-10", endDate: "2025-11-20"))
        XCTAssertEqual(next.posts, doc.posts)
    }

    func testLeavesThePlacesOfTheLegsItKeepsExactlyAsTheyWere() {
        let doc = trip([createTripPlace("Perth"), createTripPlace("Cairns")])
        let next = applyTripDetails(doc, TripDetailsEdit(startDate: "2025-11-05", endDate: "2025-11-25"))
        XCTAssertEqual(next.stages[0].places.map(\.name), ["Perth", "Cairns"])
    }

    func testDoesNotMutateTheTripItWasGiven() {
        let doc = trip([createTripPlace("Perth"), createTripPlace("Cairns")])
        let before = doc.json.serialized()
        _ = applyTripDetails(doc, TripDetailsEdit(startDate: "2025-11-10", endDate: "2025-11-20"))
        XCTAssertEqual(doc.json.serialized(), before)
    }
}
