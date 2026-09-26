// Port of `src/shared/sources/winnow/culling.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let pick = Culling(verdict: .pick, star: 3, color: "red")
private let reject = Culling(verdict: .reject, star: 0, color: nil)
private let plain = Culling(verdict: .unrated, star: 0, color: nil)

final class CullingFromRowTests: XCTestCase {
    func testReadsWhatGridSelectJoins() {
        XCTAssertEqual(cullingFromRow(["verdict": "pick", "star": 4, "color_label": "green"]),
                       Culling(verdict: .pick, star: 4, color: "green"))
    }

    func testSaysNothingForARowThatCarriesNoneOfIt() {
        XCTAssertNil(cullingFromRow([:]))
    }

    func testReadsAnUnknownVerdictAsUnratedAndClampsStars() {
        XCTAssertEqual(cullingFromRow(["verdict": "maybe", "star": 9]), Culling(verdict: .unrated, star: 5, color: nil))
        XCTAssertEqual(cullingFromRow(["verdict": "skip", "star": -2, "color_label": "  "]),
                       Culling(verdict: .skip, star: 0, color: nil))
    }

    func testReadsTheSameFromARowAlreadyReadWhereAbsentAndNullDiffer() {
        // An older instance sends none of the three keys: nothing said.
        XCTAssertNil(cullingFromRow(readWinnowAssetRow(["id": 1])!))
        // `null` is an answer: COALESCEd to unrated on Winnow's side.
        XCTAssertEqual(cullingFromRow(readWinnowAssetRow(["id": 1, "verdict": nil])!), plain)
        XCTAssertEqual(cullingFromRow(readWinnowAssetRow(["id": 1, "verdict": "pick", "star": 3, "color_label": "red"])!),
                       pick)
    }
}

final class CullingSaidTests: XCTestCase {
    func testDescribesACullingInALine() {
        XCTAssertEqual(describeCulling(pick), "Pick · ★★★ · red")
        XCTAssertEqual(describeCulling(reject), "Rejected")
        XCTAssertEqual(describeCulling(plain), "")
        XCTAssertEqual(describeCulling(nil), "")
    }

    func testKnowsAnUntouchedRowFromACulledOne() {
        XCTAssertFalse(isCulled(plain))
        XCTAssertFalse(isCulled(nil))
        var starred = plain
        starred.star = 1
        XCTAssertTrue(isCulled(starred))
        XCTAssertTrue(isCulled(reject))
    }

    func testShowsOnlyTheFiveSharedLabelColours() {
        XCTAssertEqual(labelColour("Red"), .red)
        XCTAssertNil(labelColour("teal"))
        XCTAssertNil(labelColour(nil))
    }
}

final class CullingFilterTests: XCTestCase {
    func testKeepsAPictureWinnowSaidNothingOfOnlyWhereNothingIsAskedOfIt() {
        XCTAssertTrue(passesCull(nil, .all))
        XCTAssertTrue(passesCull(nil, .unrejected))
        XCTAssertFalse(passesCull(nil, .picks))
        XCTAssertFalse(passesCull(nil, .stars(min: 1)))
    }

    func testFiltersOnTheVerdictAndTheStars() {
        XCTAssertTrue(passesCull(pick, .picks))
        XCTAssertFalse(passesCull(reject, .unrejected))
        XCTAssertTrue(passesCull(pick, .stars(min: 3)))
        XCTAssertFalse(passesCull(pick, .stars(min: 4)))
    }

    func testRoundTripsEveryFilterThroughItsKeyAndFallsBackToNone() {
        for f in cullFilters { XCTAssertEqual(readCullFilter(.string(cullFilterKey(f))), f) }
        XCTAssertEqual(readCullFilter("stars:9"), .all)
        XCTAssertEqual(cullFilterLabel(.stars(min: 3)), "★★★ and up")
        XCTAssertEqual(cullFilterLabel(.stars(min: 5)), "★★★★★")
    }

    func testCountsWhatWinnowAnsweredFor() {
        XCTAssertEqual(countCulling([pick, reject, plain, nil, nil]), CullCounts(known: 3, picks: 1, rejects: 1, starred: 1))
    }
}
