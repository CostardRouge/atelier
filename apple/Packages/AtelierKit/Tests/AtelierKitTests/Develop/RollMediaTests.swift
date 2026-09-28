// Port of `src/shared/develop/roll-media.test.ts`.

import XCTest
@testable import AtelierKit

private let ids = ["a", "b", "c", "d", "e", "f", "g"]

/// Milliseconds of a LOCAL wall-clock time — the web's `new Date(y, m, d, h).getTime()`.
private func localMillis(_ year: Int, _ month: Int, _ day: Int, _ hour: Int) -> Double {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .current
    let date = calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour))!
    return date.timeIntervalSince1970 * 1000
}

final class FetchOrderTests: XCTestCase {
    func testAsksForTheOpenPictureFirstThenItsNeighboursTheNextBeforeThePrevious() {
        XCTAssertEqual(fetchOrder(ids, "d", radius: 2), ["d", "e", "c", "f", "b"])
    }

    func testStaysInsideTheStripAtItsEnds() {
        XCTAssertEqual(fetchOrder(ids, "a", radius: 2), ["a", "b", "c"])
        XCTAssertEqual(fetchOrder(ids, "g", radius: 2), ["g", "f", "e"])
    }

    func testStartsFromTheFirstPictureWhenNoneIsNamedAndAsksNothingOfAnEmptyRoll() {
        XCTAssertEqual(fetchOrder(ids, nil, radius: 1), ["a", "b"])
        XCTAssertEqual(fetchOrder(ids, "unknown", radius: 1), ["a", "b"])
        XCTAssertEqual(fetchOrder([], "a"), [])
    }
}

final class KeepWindowTests: XCTestCase {
    func testKeepsWhatIsWithinReachOfTheOpenPicture() {
        XCTAssertEqual(keepWindow(ids, "d", radius: 1), ["c", "d", "e"])
        XCTAssertEqual(keepWindow(ids, "a", radius: 2), ["a", "b", "c"])
        XCTAssertEqual(keepWindow([], "a").count, 0)
    }
}

final class SummarizeAvailabilityTests: XCTestCase {
    func testCountsEachStateAndKeepsTheFirstProblemWorthSaying() {
        let map: [String: PictureAvailability] = [
            "a": .ready,
            "b": .fetching(sourceId: "w.example"),
            "c": .failed(sourceId: "w.example", problem: "Not signed in to w.example.", loginUrl: "https://w.example/login"),
            "d": .failed(sourceId: "w.example", problem: "later problem"),
            "e": .gone(sourceId: "w.example"),
            "f": .unconnected(sourceId: "other.example"),
            "g": .local,
        ]
        var want = AvailabilitySummary()
        want.fetching = 1
        want.failed = 2
        want.gone = 1
        want.unconnected = 1
        want.local = 1
        want.sourceId = "w.example"
        want.unconnectedSourceId = "other.example"
        want.problem = "Not signed in to w.example."
        want.loginUrl = "https://w.example/login"
        XCTAssertEqual(summarizeAvailability(ids, map), want)
    }

    func testSaysNothingAboutARollWhosePicturesAreAllInHand() {
        let s = summarizeAvailability(["a"], ["a": .ready])
        XCTAssertEqual(s.fetching + s.previewed + s.failed + s.gone + s.unconnected + s.local, 0)
        XCTAssertEqual(summarizeAvailability(["a"], ["a": .preview]).previewed, 1)
        XCTAssertNil(s.sourceId)
    }
}

final class AvailabilityTextTests: XCTestCase {
    func testNamesThePictureAndTheInstanceInEveryState() {
        XCTAssertEqual(availabilityText("A.webp", .fetching(sourceId: "w.example")), "Fetching A.webp from w.example…")
        XCTAssertTrue(availabilityText("A.webp", .gone(sourceId: "w.example")).contains("no longer has A.webp"))
        XCTAssertTrue(availabilityText("A.webp", .unconnected(sourceId: "w.example")).contains("connect it in Sources"))
        XCTAssertTrue(availabilityText("A.jpg", .local).contains("from this computer"))
        XCTAssertTrue(availabilityText("A.jpg", nil).contains("from this computer"))
    }
}

final class PictureDayTests: XCTestCase {
    func testReadsTheLocalCalendarDayOfTheCaptureElseOfNow() {
        let noon = localMillis(2026, 6, 10, 12)
        XCTAssertEqual(pictureDay(noon), "2026-06-10")
        XCTAssertEqual(pictureDay(0, now: localMillis(2026, 1, 2, 9)), "2026-01-02")
    }
}

final class PhotoFilesTests: XCTestCase {
    func testKeepsThePhotographsARAWYieldingToItsJPEGAndDropsClipsAndLogs() {
        let f = { (name: String) in SavedMediaRef(name: name, size: 1, lastModified: 0) }
        let names = photoFiles([f("A.ARW"), f("A.JPG"), f("B.jpg"), f("C.MP4"), f("C.SRT"), f(".hidden.jpg")]).map(\.name)
        XCTAssertEqual(names, ["A.JPG", "B.jpg"])
        // The RAW that lost the slot is the capture's sibling, never a picture of its own.
        XCTAssertEqual(captureSiblings([f("A.ARW"), f("A.JPG"), f("B.jpg")]).map(\.name), ["A.ARW"])
    }
}

final class SplitByRollTests: XCTestCase {
    private func ref(_ name: String, _ hash: String? = nil) -> SavedMediaRef {
        SavedMediaRef(name: name, size: 10, lastModified: 1, hash: hash)
    }

    func testCountsWhatTheRollHoldsAndKeepsEachNewPictureOnce() {
        let held = [ref("A.jpg", "ha"), ref("B.jpg", "hb")]
        let out = splitByRoll(held, [ref("renamed.jpg", "ha"), ref("C.jpg", "hc"), ref("C-copy.jpg", "hc"), ref("D.jpg", "hd")])
        XCTAssertEqual(out.found, 1)
        XCTAssertEqual(out.fresh.map(\.name), ["C.jpg", "D.jpg"])
    }
}
