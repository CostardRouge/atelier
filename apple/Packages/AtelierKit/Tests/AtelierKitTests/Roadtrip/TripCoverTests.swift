// Port of `src/shared/roadtrip/trip-cover.test.ts`, case for case. The web's
// `toBe` (the very same cover) is value equality here.

import Foundation
import XCTest
@testable import AtelierKit

private final class CoverSeq: @unchecked Sendable {
    var n = 0
    func next() -> Int { n += 1; return n }
}

private let seq = CoverSeq()

private func post(_ date: IsoDate, id: String? = nil, published: Bool = false) -> TripPost {
    TripPost(id: id ?? "p\(seq.next())", kind: .photo, date: date, endDate: nil, title: "piece", media: nil,
             badge: defaultPostBadge(.photo), slides: [], includeCta: false, projectId: nil, grade: nil,
             publishedAt: published ? 1_700_000_000_000 : nil, createdAt: 1_600_000_000_000)
}

private func trip(endDate: IsoDate = "2025-03-10", posts: [TripPost] = [], cover: TripCover = defaultTripCover()) -> TripDoc {
    TripDoc(version: 1, id: "t1", name: "Australie", startDate: "2025-03-01", endDate: endDate, posts: posts,
            theme: nil, cover: cover, createdAt: 0, updatedAt: 0)
}

/// Every piece has a picture unless the test says otherwise.
private let all: (String) -> Bool = { _ in true }
private let none: (String) -> Bool = { _ in false }
private func only(_ ids: String...) -> (String) -> Bool { { ids.contains($0) } }

private func tilesOf(_ doc: TripDoc, _ hasThumb: (String) -> Bool = all, _ limit: Int = 3) -> [String] {
    coverTiles(doc, tripCoverage(doc), hasThumb, limit: limit).map(\.postId)
}

final class CoverRankedDaysTests: XCTestCase {
    func testPutsTheBusiestDayFirst() {
        let doc = trip(posts: [
            post("2025-03-02"), post("2025-03-05"), post("2025-03-05"), post("2025-03-05"), post("2025-03-08"),
            post("2025-03-08"),
        ])
        XCTAssertEqual(rankedCoverDays(tripCoverage(doc)).map(\.date), ["2025-03-05", "2025-03-08", "2025-03-02"])
    }

    func testBreaksATieOnPublishedPiecesThenOnTheLaterDate() {
        let doc = trip(posts: [
            post("2025-03-02"), post("2025-03-02"), post("2025-03-05"), post("2025-03-05", published: true),
            post("2025-03-09"), post("2025-03-09"),
        ])
        XCTAssertEqual(rankedCoverDays(tripCoverage(doc)).map(\.date), ["2025-03-05", "2025-03-09", "2025-03-02"])
    }

    func testLeavesOutTheDaysNothingCameFrom() {
        let doc = trip(posts: [post("2025-03-04")])
        XCTAssertEqual(rankedCoverDays(tripCoverage(doc)).count, 1)
    }
}

final class CoverTilesTests: XCTestCase {
    func testTakesOnePieceFromEachOfTheBusiestDaysNeverTwiceFromOneDay() {
        let doc = trip(posts: [
            post("2025-03-05", id: "a"), post("2025-03-05", id: "b"), post("2025-03-05", id: "c"),
            post("2025-03-08", id: "d"), post("2025-03-02", id: "e"),
        ])
        XCTAssertEqual(tilesOf(doc), ["a", "d", "e"])
    }

    func testPrefersThePieceThatActuallyWentOut() {
        let doc = trip(posts: [post("2025-03-05", id: "draft"), post("2025-03-05", id: "sent", published: true)])
        XCTAssertEqual(tilesOf(doc, all, 1), ["sent"])
    }

    func testLeadsWithThePinnedPiecesInPinOrder() {
        let doc = trip(posts: [post("2025-03-05", id: "busy"), post("2025-03-05", id: "busy2"), post("2025-03-02", id: "quiet")],
                       cover: TripCover(layout: .mosaic, pinned: ["quiet"]))
        XCTAssertEqual(tilesOf(doc), ["quiet", "busy"])
    }

    func testNeverDoublesADayAPinAlreadySpeaksFor() {
        let doc = trip(posts: [post("2025-03-05", id: "a"), post("2025-03-05", id: "b"), post("2025-03-02", id: "c")],
                       cover: TripCover(layout: .mosaic, pinned: ["b"]))
        XCTAssertEqual(tilesOf(doc), ["b", "c"])
    }

    func testSkipsAPinNamingAPieceThatIsGoneAndFillsBehindIt() {
        let doc = trip(posts: [post("2025-03-05", id: "a"), post("2025-03-02", id: "b")],
                       cover: TripCover(layout: .mosaic, pinned: ["deleted", "b"]))
        XCTAssertEqual(tilesOf(doc), ["b", "a"])
    }

    func testKeepsAPinnedPieceTheSpanNoLongerReachesWithoutADayNumber() {
        let doc = trip(endDate: "2025-03-04", posts: [post("2025-03-02", id: "inside"), post("2025-03-09", id: "outside")],
                       cover: TripCover(layout: .mosaic, pinned: ["outside"]))
        let tiles = coverTiles(doc, tripCoverage(doc), all, limit: 3)
        XCTAssertEqual(tiles.map(\.postId), ["outside", "inside"])
        XCTAssertNil(tiles[0].dayNumber)
        XCTAssertEqual(tiles[1].dayNumber, 2)
    }

    func testPassesOverADayWhosePiecesHaveNoPictureYet() {
        let doc = trip(posts: [post("2025-03-05", id: "a"), post("2025-03-05", id: "b"), post("2025-03-02", id: "c")])
        XCTAssertEqual(tilesOf(doc, only("c")), ["c"])
    }

    func testDrawsNothingAtAllWhenNoPictureIsBaked() {
        let doc = trip(posts: [post("2025-03-05"), post("2025-03-02")])
        XCTAssertEqual(tilesOf(doc, none), [])
    }

    func testFallsToTheLatestDaysWhenEveryDayTiesAtOnePiece() {
        let doc = trip(posts: [post("2025-03-02", id: "old"), post("2025-03-05", id: "mid"), post("2025-03-09", id: "new")])
        XCTAssertEqual(tilesOf(doc, all, 2), ["new", "mid"])
    }

    // What lets the cover panel resolve ONCE, at the widest layout, and draw
    // every preview from that one answer: a narrower limit can only be a prefix
    // of a wider one.
    func testAnswersANarrowerLimitWithAPrefixOfTheWiderOne() {
        let doc = trip(posts: [
            post("2025-03-02", id: "a"), post("2025-03-02", id: "a2"), post("2025-03-05", id: "b"),
            post("2025-03-09", id: "c"),
        ], cover: TripCover(layout: .mosaic, pinned: ["c"]))
        let three = tilesOf(doc, all, 3)
        XCTAssertEqual(three.count, 3)
        XCTAssertEqual(tilesOf(doc, all, 1), Array(three.prefix(1)))
        XCTAssertEqual(tilesOf(doc, all, 2), Array(three.prefix(2)))
    }

    func testIsEmptyForALayoutThatDrawsNoPicture() {
        let doc = trip(posts: [post("2025-03-05")], cover: TripCover(layout: .rhythm, pinned: []))
        XCTAssertEqual(coverTiles(doc, tripCoverage(doc), all), [])
    }
}

final class CoverDayNumberOfTests: XCTestCase {
    func testCountsFromOneOnTheFirstDayOfTheTrip() {
        XCTAssertEqual(dayNumberOf(trip(), "2025-03-01"), 1)
        XCTAssertEqual(dayNumberOf(trip(), "2025-03-10"), 10)
    }

    func testIsNilOnEitherSideOfTheSpan() {
        XCTAssertNil(dayNumberOf(trip(), "2025-02-28"))
        XCTAssertNil(dayNumberOf(trip(), "2025-03-11"))
    }
}

final class CoverDroppedPinsTests: XCTestCase {
    func testNamesThePinsThatPointAtNothing() {
        let doc = trip(posts: [post("2025-03-02", id: "here")], cover: TripCover(layout: .mosaic, pinned: ["here", "gone"]))
        XCTAssertEqual(droppedPins(doc), ["gone"])
    }
}

final class CoverTogglePinTests: XCTestCase {
    func testAddsRemovesAndKeepsTheLastThree() {
        XCTAssertEqual(togglePin([], "a"), ["a"])
        XCTAssertEqual(togglePin(["a", "b"], "a"), ["b"])
        XCTAssertEqual(togglePin(["a", "b", "c"], "d"), ["b", "c", "d"])
    }
}

final class CoverRhythmBucketsTests: XCTestCase {
    func testIsOneBarPerDayWhileTheTripFitsTheStrip() {
        let doc = trip(posts: [post("2025-03-04"), post("2025-03-04")])
        let bars = rhythmBuckets(tripCoverage(doc), max: 49)
        XCTAssertEqual(bars.count, 10)
        XCTAssertEqual(bars[3], RhythmBucket(from: "2025-03-04", to: "2025-03-04", days: 1, told: 1, posts: 2))
    }

    func testFoldsALongTripOntoEqualBuckets() {
        let doc = trip(endDate: "2025-12-31", posts: [post("2025-03-02")])
        let bars = rhythmBuckets(tripCoverage(doc), max: 49)
        XCTAssertLessThanOrEqual(bars.count, 49)
        XCTAssertEqual(bars[0].days, 7)
        XCTAssertEqual(bars.reduce(0) { $0 + $1.days }, 306)
        XCTAssertEqual(bars.reduce(0) { $0 + $1.told }, 1)
    }

    func testIsEmptyForATripWithNoDays() {
        var coverage = tripCoverage(trip())
        coverage.days = []
        XCTAssertEqual(rhythmBuckets(coverage), [])
    }
}

final class CoverRhythmLevelTests: XCTestCase {
    func testIsBarePaperWhenNothingWasTold() {
        XCTAssertEqual(rhythmLevel(RhythmBucket(from: "a", to: "b", days: 7, told: 0, posts: 0)), 0)
    }

    func testClimbsTheFourToldRungsOfTheHeatmapWithTheShareOfDaysTold() {
        func bar(_ told: Int, _ days: Int = 7) -> Int {
            rhythmLevel(RhythmBucket(from: "a", to: "b", days: days, told: told, posts: told))
        }
        XCTAssertEqual(bar(1), 1)
        XCTAssertEqual(bar(3), 2)
        XCTAssertEqual(bar(4), 3)
        XCTAssertEqual(bar(7), 4)
        XCTAssertEqual(bar(1, 1), 4)
    }
}

final class CoverCandidateIdsTests: XCTestCase {
    func testAsksForThePinsAndEveryPieceOfTheBusiestDays() {
        let doc = trip(posts: [
            post("2025-03-05", id: "a"), post("2025-03-05", id: "b"), post("2025-03-08", id: "c"),
            post("2025-03-02", id: "quiet"),
        ], cover: TripCover(layout: .mosaic, pinned: ["quiet", "gone"]))
        XCTAssertEqual(coverCandidateIds(doc, tripCoverage(doc), depth: 2).sorted(), ["a", "b", "c", "gone", "quiet"])
    }

    func testStopsAtTheDepthAskedFor() {
        let doc = trip(posts: [post("2025-03-02"), post("2025-03-05"), post("2025-03-08")])
        XCTAssertEqual(coverCandidateIds(doc, tripCoverage(doc), depth: 1).count, 1)
    }
}

final class CoverPrunePinsTests: XCTestCase {
    func testDropsThePinsThatNameNothingAndKeepsTheRestInOrder() {
        let doc = trip(posts: [post("2025-03-02", id: "a"), post("2025-03-05", id: "b")],
                       cover: TripCover(layout: .mosaic, pinned: ["a", "gone", "b"]))
        XCTAssertEqual(prunePins(doc, doc.cover), TripCover(layout: .mosaic, pinned: ["a", "b"]))
    }

    func testReturnsTheSameCoverWhenEveryPinStillNamesAPiece() {
        let doc = trip(posts: [post("2025-03-02", id: "a")], cover: TripCover(layout: .cover, pinned: ["a"]))
        XCTAssertEqual(prunePins(doc, doc.cover), doc.cover)
    }
}
