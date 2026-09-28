// Port of `src/shared/roadtrip/hooks/picture-pool.test.ts`.

import XCTest
@testable import AtelierKit

/// `total` days from 2025-03-01, the first one starting a leg.
private func calendar(_ total: Int) -> [HookDay] {
    (0..<total).map { i in
        HookDay(date: addDays("2025-03-01", i)!, dayNumber: i + 1, told: false, legStart: i == 0, pieces: [])
    }
}

private func ref(_ name: String, assetId: String? = nil, hash: String? = nil, size: Int = 100) -> SavedMediaRef {
    SavedMediaRef(name: name, size: size, lastModified: 0, assetId: assetId, hash: hash)
}

private func cand(_ key: String, _ date: String, _ origin: PoolOrigin, assetId: String? = nil,
                  takenAt: Double = 0) -> PoolCandidate {
    PoolCandidate(key: key, ref: ref("\(key).jpg", assetId: assetId), date: date, takenAt: takenAt, origin: origin)
}

final class PicturePoolSameRefTests: XCTestCase {
    func testTrustsASourceIdThenAHashThenNameAndSize() {
        XCTAssertTrue(sameRef(ref("a", assetId: "w/1"), ref("b", assetId: "w/1")))
        XCTAssertFalse(sameRef(ref("a", assetId: "w/1"), ref("a", assetId: "w/2")))
        XCTAssertTrue(sameRef(ref("a", hash: "h"), ref("b", hash: "h")))
        XCTAssertTrue(sameRef(ref("IMG.JPG"), ref("img.jpg")))
        XCTAssertFalse(sameRef(ref("img.jpg"), ref("img.jpg", size: 101)))
    }
}

final class PicturePoolMergeTests: XCTestCase {
    func testOffersAPictureHeldInBothPlacesOnceFromTheLibrary() {
        let library = [cand("a", "2025-03-02", .library, assetId: "w/7")]
        var c = cand("c", "2025-03-01", .instance, assetId: "w/8")
        c.ref = ref("a.jpg", assetId: "w/8")
        let instance = [
            cand("b", "2025-03-02", .instance, assetId: "w/7"),
            c,
            cand("d", "2025-03-01", .instance, assetId: "w/9"),
        ]
        let pool = mergePool(library, instance)
        XCTAssertEqual(pool.map(\.key), ["d", "a"])
    }

    func testOrdersByDayThenByInstant() {
        let pool = mergePool(
            [cand("late", "2025-03-02", .library, takenAt: 20), cand("early", "2025-03-02", .library, takenAt: 10)],
            [cand("first", "2025-03-01", .instance, assetId: "w/1", takenAt: 99)]
        )
        XCTAssertEqual(pool.map(\.key), ["first", "early", "late"])
    }
}

final class PicturePoolSpansTests: XCTestCase {
    private let cal = calendar(20)

    func testReachesFromTheFirstDayToThePiecesOwn() {
        XCTAssertEqual(reachSpan(cal, cal[9].date), DateSpan(from: cal[0].date, to: cal[9].date))
        XCTAssertNil(reachSpan(cal, "2031-01-01"))
    }

    func testSpansTheWholeTripFirstDayToLast() {
        XCTAssertEqual(tripSpan(cal), DateSpan(from: cal[0].date, to: cal[19].date))
        XCTAssertNil(tripSpan([]))
    }

    func testOpensOnTheDaysBeforeThisOneOrOnTheDaysAHeldListCovers() {
        XCTAssertEqual(defaultSpan(cal, cal[9].date, []), DateSpan(from: cal[0].date, to: cal[8].date))
        XCTAssertEqual(defaultSpan(cal, cal[0].date, []), DateSpan(from: cal[0].date, to: cal[0].date))
        let held = [
            HookPickedPicture(ref: ref("x"), date: cal[6].date),
            HookPickedPicture(ref: ref("y"), date: cal[2].date),
            HookPickedPicture(ref: ref("z"), date: "2031-01-01"),
        ]
        XCTAssertEqual(defaultSpan(cal, cal[9].date, held), DateSpan(from: cal[2].date, to: cal[6].date))
    }

    func testReopensOnAHeldPictureShotAfterThePieceSoConfirmingDoesNotDropIt() {
        let held = [
            HookPickedPicture(ref: ref("x"), date: cal[3].date),
            HookPickedPicture(ref: ref("z"), date: cal[15].date),
        ]
        XCTAssertEqual(defaultSpan(cal, cal[9].date, held), DateSpan(from: cal[3].date, to: cal[15].date))
    }

    func testMarksALaterPictureOnlyForAVariantThatLeavesItOff() {
        XCTAssertTrue(laterLeftOff(cal[12].date, cal[9].date, false))
        XCTAssertFalse(laterLeftOff(cal[12].date, cal[9].date, true))
        XCTAssertFalse(laterLeftOff(cal[9].date, cal[9].date, false))
    }

    func testOffersTheLegOnlyWhenItSaysSomethingTheTripDoesNot() {
        let stages = [
            HookStage(startDate: cal[0].date, endDate: cal[4].date, label: "", places: []),
            HookStage(startDate: cal[5].date, endDate: cal[19].date, label: "", places: []),
        ]
        XCTAssertEqual(quickSpans(cal, cal[15].date, stages).map(\.id), [.whole, .trip, .leg, .week, .day])
        XCTAssertEqual(quickSpans(cal, cal[3].date, stages).map(\.id), [.whole, .trip, .day])
        let leg = quickSpans(cal, cal[15].date, stages).first { $0.id == .leg }
        XCTAssertEqual(leg?.from, cal[5].date)
        XCTAssertEqual(leg?.to, cal[14].date)
        // A week that starts where the leg does says nothing new.
        XCTAssertEqual(quickSpans(cal, cal[12].date, stages).map(\.id), [.whole, .trip, .leg, .day])
        // On the trip's first day, "the trip so far" IS that day.
        XCTAssertEqual(quickSpans(cal, cal[0].date, stages).map(\.id), [.whole, .trip])
    }

    func testReachesPastThisPieceWithTheWholeTripAndDropsItOnAOneDayTrip() {
        let whole = quickSpans(cal, cal[9].date).first { $0.id == .whole }
        XCTAssertEqual(whole?.from, cal[0].date)
        XCTAssertEqual(whole?.to, cal[19].date)
        let one = calendar(1)
        XCTAssertEqual(quickSpans(one, one[0].date).map(\.id), [.whole])
    }

    func testKeepsOnlyWhatWasShotInsideTheSpanBothEndsIncluded() {
        let items = [
            cand("a", cal[1].date, .library),
            cand("b", cal[2].date, .library),
            cand("c", cal[3].date, .library),
        ]
        XCTAssertEqual(inSpan(items, DateSpan(from: cal[2].date, to: cal[3].date)).map(\.key), ["b", "c"])
    }
}

final class PicturePoolGroupByDayTests: XCTestCase {
    func testGroupsInCalendarOrderAndNamesTheTripDay() {
        let cal = calendar(5)
        let groups = groupByDay(
            [cand("b", cal[3].date, .library), cand("a", cal[1].date, .library), cand("c", cal[3].date, .library)],
            cal
        )
        XCTAssertEqual(groups.map { $0.day?.dayNumber }, [2, 4])
        XCTAssertEqual(groups.map { $0.items.map(\.key) }, [["a"], ["b", "c"]])
    }
}

final class PicturePoolInitialExclusionsTests: XCTestCase {
    private let pool = [
        cand("a", "2025-03-01", .library),
        cand("b", "2025-03-01", .instance, assetId: "w/2"),
    ]

    func testTakesEverythingWhenNothingIsHeldYet() {
        XCTAssertEqual(initialExclusions(pool, []).count, 0)
    }

    func testTicksWhatTheHeldListNamesAndNothingElse() {
        let excluded = initialExclusions(pool, [HookPickedPicture(ref: ref("other", assetId: "w/2"), date: "2025-03-01")])
        XCTAssertEqual(excluded, ["a"])
    }
}
