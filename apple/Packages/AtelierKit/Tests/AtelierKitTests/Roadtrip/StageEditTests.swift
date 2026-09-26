// Port of `src/shared/roadtrip/stage-edit.test.ts`, case for case. The web's
// `toBe` (the very same object) is value equality here.

import Foundation
import XCTest
@testable import AtelierKit

private func stage(_ start: String, _ end: String, _ name: String = "") -> TripStage {
    createTripStage(name, "", start, end)
}

private func trip(_ stages: [TripStage] = []) -> TripDoc {
    var doc = createTripDoc("Test", "2025-03-01", "2025-03-20")
    doc.stages = stages
    return doc
}

private func newest(_ r: StageEditResult) -> TripStage {
    r.stages.first { $0.id == r.selectedId }!
}

private func span(_ s: TripStage) -> [String] { [s.startDate, s.endDate] }

final class StageEditResizeTests: XCTestCase {
    private let s = stage("2025-03-05", "2025-03-10")

    func testMovesOneEdgeAndHoldsTheOther() {
        XCTAssertEqual(span(resizeStage(trip(), s, .start, "2025-03-03")), ["2025-03-03", "2025-03-10"])
        XCTAssertEqual(span(resizeStage(trip(), s, .end, "2025-03-12")), ["2025-03-05", "2025-03-12"])
    }

    func testCollapsesToOneDayInsteadOfReversingWhenAnEdgeCrossesTheOther() {
        XCTAssertEqual(span(resizeStage(trip(), s, .start, "2025-03-15")), ["2025-03-15", "2025-03-15"])
        XCTAssertEqual(span(resizeStage(trip(), s, .end, "2025-03-02")), ["2025-03-02", "2025-03-02"])
    }

    func testStopsAtTheTripsEdges() {
        XCTAssertEqual(resizeStage(trip(), s, .start, "2025-02-01").startDate, "2025-03-01")
        XCTAssertEqual(resizeStage(trip(), s, .end, "2025-04-01").endDate, "2025-03-20")
    }
}

final class StageEditShiftTests: XCTestCase {
    private let s = stage("2025-03-05", "2025-03-10")

    func testSlidesBothDatesAndKeepsTheLength() {
        XCTAssertEqual(span(shiftStage(trip(), s, 3)), ["2025-03-08", "2025-03-13"])
        XCTAssertEqual(span(shiftStage(trip(), s, -2)), ["2025-03-03", "2025-03-08"])
    }

    func testShortensTheSlideSoTheLegStaysInsideTheTrip() {
        XCTAssertEqual(span(shiftStage(trip(), s, 30)), ["2025-03-15", "2025-03-20"])
        XCTAssertEqual(span(shiftStage(trip(), s, -30)), ["2025-03-01", "2025-03-06"])
    }

    func testReturnsTheSameStageForAZeroOrImpossibleMove() {
        XCTAssertEqual(shiftStage(trip(), s, 0), s)
        XCTAssertEqual(shiftStage(trip(), stage("bad", "2025-03-10"), 2).startDate, "bad")
    }
}

final class StageEditInsertInOrderTests: XCTestCase {
    func testKeepsTheListInLivedOrder() {
        let a = stage("2025-03-01", "2025-03-03")
        let c = stage("2025-03-10", "2025-03-12")
        let b = stage("2025-03-05", "2025-03-08")
        XCTAssertEqual(insertStageInOrder([a, c], b), [a, b, c])
        XCTAssertEqual(insertStageInOrder([a, b], c), [a, b, c])
    }
}

final class StageEditStartAtTests: XCTestCase {
    func testRunsFromTheDayToTheDayBeforeTheNextLeg() {
        let next = stage("2025-03-10", "2025-03-15")
        let result = startStageAt(trip([next]), "2025-03-04")
        XCTAssertEqual(span(newest(result)), ["2025-03-04", "2025-03-09"])
        XCTAssertEqual(result.stages, [newest(result), next])
    }

    func testRunsToTheTripsEndWithNothingAfterIt() {
        XCTAssertEqual(span(newest(startStageAt(trip(), "2025-03-18"))), ["2025-03-18", "2025-03-20"])
    }

    func testCutsTheLegItLandsInsideSoStartingALegIsHowOneIsSplit() {
        let long = stage("2025-03-02", "2025-03-15", "Long")
        let result = startStageAt(trip([long]), "2025-03-08")
        XCTAssertEqual(result.stages.count, 2)
        XCTAssertEqual(result.stages[0].name, "Long")
        XCTAssertEqual(span(result.stages[0]), ["2025-03-02", "2025-03-07"])
        XCTAssertEqual(result.stages[0].id, long.id)
        XCTAssertEqual(span(newest(result)), ["2025-03-08", "2025-03-15"])
    }

    func testLeavesALegThatBeginsOnTheVeryDayAloneAndAddsAOneDayLegBesideIt() {
        let tight = stage("2025-03-05", "2025-03-08")
        let result = startStageAt(trip([tight]), "2025-03-05")
        XCTAssertEqual(span(newest(result)), ["2025-03-05", "2025-03-05"])
        XCTAssertEqual(result.stages.first { $0.id == tight.id }, tight)
    }

    func testDerivesItsLabelNeverAPlaceholderName() {
        XCTAssertEqual(newest(startStageAt(trip(), "2025-03-02")).name, "")
    }
}

final class StageEditOverGapTests: XCTestCase {
    func testCoversExactlyTheGapClampedToTheTrip() {
        XCTAssertEqual(span(stageOverGap(trip(), "2025-02-20", "2025-03-03")), ["2025-03-01", "2025-03-03"])
    }
}

final class StageEditDayActionsTests: XCTestCase {
    func testOffersNothingOffTheTrip() {
        XCTAssertTrue(dayStageActions(trip(), "2025-04-01").isEmpty)
    }

    func testAlwaysOffersToStartALegInsertedInOrderAndSelected() {
        let later = stage("2025-03-10", "2025-03-12", "Later")
        let t = trip([later])
        let start = dayStageActions(t, "2025-03-03")[0]
        XCTAssertEqual(start.id, .start)
        let result = start.apply(t)
        XCTAssertEqual(result.stages.map(\.name), ["", "Later"])
        XCTAssertEqual(result.stages[0].id, result.selectedId)
        XCTAssertEqual(span(result.stages[0]), ["2025-03-03", "2025-03-09"])
    }

    func testOffersToEndTheCoveringLegHereNamingIt() {
        let leg = stage("2025-03-02", "2025-03-10", "The Red Centre")
        let t = trip([leg])
        let actions = dayStageActions(t, "2025-03-06")
        XCTAssertEqual(actions.map(\.id), [.start, .end])
        XCTAssertEqual(actions[1].label, "End “The Red Centre” here")
        let result = actions[1].apply(t)
        XCTAssertEqual(span(result.stages[0]), ["2025-03-02", "2025-03-06"])
        XCTAssertEqual(result.selectedId, leg.id)
    }

    func testNamesAnUnlabelledLegByItsNumberTheWayTheEditorDoes() {
        let first = stage("2025-03-01", "2025-03-03")
        let second = stage("2025-03-05", "2025-03-10")
        XCTAssertEqual(dayStageActions(trip([first, second]), "2025-03-07")[1].label, "End stage 2 here")
    }

    func testDoesNotOfferToEndALegOnTheDayItAlreadyEnds() {
        let leg = stage("2025-03-02", "2025-03-06")
        XCTAssertEqual(dayStageActions(trip([leg]), "2025-03-06").map(\.id), [.start])
    }

    func testOffersToExtendTheLastLegThatEndedBeforeAnUncoveredDay() {
        let early = stage("2025-03-01", "2025-03-03", "Early")
        let leg = stage("2025-03-05", "2025-03-08", "Coast")
        let t = trip([early, leg])
        let actions = dayStageActions(t, "2025-03-12")
        XCTAssertEqual(actions.map(\.id), [.start, .extend])
        XCTAssertEqual(actions[1].label, "Extend “Coast” to here")
        let result = actions[1].apply(t)
        XCTAssertEqual(span(result.stages[1]), ["2025-03-05", "2025-03-12"])
        XCTAssertEqual(result.stages[0], early)
        XCTAssertEqual(result.selectedId, leg.id)
    }

    func testNamesTheCoveringLegByItsDerivedLabelWhenItHasNoName() {
        var leg = stage("2025-03-02", "2025-03-10")
        leg.places = [
            TripPlace(id: "a", name: "Perth", region: "", coords: nil),
            TripPlace(id: "b", name: "Kalbarri", region: "", coords: nil),
        ]
        XCTAssertEqual(dayStageActions(trip([leg]), "2025-03-04")[1].label, "End “Perth → Kalbarri” here")
    }
}

final class StageEditNearerEdgeTests: XCTestCase {
    private let leg = TripSpan(startDate: "2025-08-03", endDate: "2025-09-02")

    func testIsTheSideADayOutsideTheLegLiesOnWhateverTheDistance() {
        XCTAssertEqual(nearerEdge(leg, "2025-03-03"), .start)
        XCTAssertEqual(nearerEdge(leg, "2025-08-02"), .start)
        XCTAssertEqual(nearerEdge(leg, "2025-09-03"), .end)
        XCTAssertEqual(nearerEdge(leg, "2026-02-10"), .end)
    }

    func testIsTheNearerEdgeInsideTheLegTheEndOnATie() {
        XCTAssertEqual(nearerEdge(leg, "2025-08-05"), .start)
        XCTAssertEqual(nearerEdge(leg, "2025-08-30"), .end)
        // 3 Aug + 15 = 18 Aug; 18 Aug + 15 = 2 Sep — equidistant.
        XCTAssertEqual(nearerEdge(leg, "2025-08-18"), .end)
        XCTAssertEqual(nearerEdge(leg, "2025-08-03"), .start)
        XCTAssertEqual(nearerEdge(leg, "2025-09-02"), .end)
    }
}
