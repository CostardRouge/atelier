// Port of `src/shared/sources/winnow/browse-state.test.ts`. The web's specs
// drive a fake `localStorage`; here the stored TEXT is the storage — read
// with `JSONValue.parse`, written with `serialized()` — exactly what the app
// keeps under `browseStateKey`.

import Foundation
import XCTest
@testable import AtelierKit

private func place(_ change: (inout BrowseState) -> Void = { _ in }) -> BrowseState {
    var s = BrowseState(view: .day, filter: FilterQuery(mediaType: .video, ext: "mp4", device: "DJI Mini 4 Pro"),
                        month: "2025-07", day: "2025-07-09", sessionId: nil, chapterId: nil, fidelity: .proxy)
    change(&s)
    return s
}

/// One stored text, the way the app keeps it.
private final class Store {
    var text: String?

    func read(_ sourceId: String) -> BrowseState? {
        readBrowseState(text.flatMap { JSONValue.parse($0) } ?? .object([:]), sourceId: sourceId)
    }

    func write(_ sourceId: String, _ state: BrowseState) {
        text = writeBrowseState(text.flatMap { JSONValue.parse($0) }, sourceId: sourceId, state: state).serialized()
    }

    func forget(_ sourceId: String) {
        if let next = forgetBrowseState(text.flatMap { JSONValue.parse($0) } ?? .object([:]), sourceId: sourceId) {
            text = next.serialized()
        }
    }

    /// A raw object written straight in, as the web's specs do with `setItem`.
    func put(_ sourceId: String, _ raw: JSONValue) {
        text = JSONValue.object([sourceId: raw]).serialized()
    }
}

private func stored(_ change: [String: JSONValue]) -> JSONValue {
    .object((place().json.objectValue ?? [:]).merging(change) { _, new in new })
}

final class BrowseStateTests: XCTestCase {
    func testStartsWithNothingToRestore() {
        XCTAssertNil(Store().read("winnow.example"))
    }

    func testRoundTripsAPlace() {
        let s = Store()
        s.write("winnow.example", place())
        XCTAssertEqual(s.read("winnow.example"), place())
    }

    func testKeepsInstancesApart() {
        let s = Store()
        s.write("a.example", place { $0.month = "2025-07" })
        s.write("b.example", place { $0.month = "2024-01"; $0.view = .session; $0.sessionId = 9 })
        XCTAssertEqual(s.read("a.example")?.month, "2025-07")
        XCTAssertEqual(s.read("b.example")?.month, "2024-01")
        XCTAssertEqual(s.read("b.example")?.sessionId, 9)
    }

    func testRemembersTheOpenChapterAndAViewItDoesNotKnowFallsBackToTheDay() {
        let s = Store()
        s.write("a.example", place { $0.view = .chapter; $0.chapterId = "42" })
        XCTAssertEqual(s.read("a.example")?.view, .chapter)
        XCTAssertEqual(s.read("a.example")?.chapterId, "42")
        s.put("b.example", stored(["view": "galaxy", "chapterId": 7]))
        XCTAssertEqual(s.read("b.example")?.view, .day)
        XCTAssertNil(s.read("b.example")?.chapterId)
    }

    func testRejectsAMonthThatIsNotOneItWouldBuildACalendarOfNothing() {
        let s = Store()
        s.put("a.example", stored(["month": "banana"]))
        XCTAssertNil(s.read("a.example"))
    }

    func testDropsAMalformedDayRatherThanTheWholePlace() {
        let s = Store()
        s.put("a.example", stored(["day": "9 July"]))
        XCTAssertEqual(s.read("a.example")?.month, "2025-07")
        XCTAssertNil(s.read("a.example")?.day)
    }

    func testKeepsOnlyFilterValuesItRecognises() {
        let s = Store()
        s.put("a.example", stored(["filter": ["mediaType": "audio", "ext": "", "device": "DJI", "junk": 1]]))
        XCTAssertEqual(s.read("a.example")?.filter, FilterQuery(device: "DJI"))
    }

    func testRemembersTheHalfOfTheLibraryAndOnlyTheTwoWordsWinnowTakes() {
        let s = Store()
        s.write("a.example", place { $0.filter = FilterQuery(half: .final) })
        XCTAssertEqual(s.read("a.example")?.filter, FilterQuery(half: .final))
        s.put("b.example", stored(["filter": ["half": "gallery"]]))
        XCTAssertEqual(s.read("b.example")?.filter, FilterQuery())
    }

    func testSurvivesGarbageInStorage() {
        let s = Store()
        s.text = "{not json"
        XCTAssertNil(s.read("a.example"))
        // …and writing over it still works.
        s.write("a.example", place())
        XCTAssertEqual(s.read("a.example")?.month, "2025-07")
    }

    func testDegradesToNoMemoryWhenStorageIsUnavailable() {
        // No store at all is nothing to read, and a write needs none to start from.
        XCTAssertNil(readBrowseState(nil, sourceId: "a.example"))
        XCTAssertNotNil(writeBrowseState(nil, sourceId: "a.example", state: place()).objectValue?["a.example"])
        XCTAssertNil(forgetBrowseState(nil, sourceId: "a.example"))
    }

    func testForgetsOneInstanceWithoutTouchingTheOthers() {
        let s = Store()
        s.write("a.example", place())
        s.write("b.example", place { $0.month = "2024-01" })
        s.forget("a.example")
        XCTAssertNil(s.read("a.example"))
        XCTAssertEqual(s.read("b.example")?.month, "2024-01")
    }

    func testWritesThePlaceTheWayTheWebWritesIt() {
        XCTAssertEqual(place().json.serialized(),
                       #"{"chapterId":null,"day":"2025-07-09","fidelity":"proxy","filter":{"device":"DJI Mini 4 Pro","ext":"mp4","mediaType":"video"},"month":"2025-07","sessionId":null,"view":"day"}"#)
    }
}
