// The Winnow browser's lines — `WinnowBrowser.tsx` has no spec of its own, so
// these pin what the sheet says, one rule per case.

import XCTest
@testable import AtelierKit

private func leg(_ id: String = "c1", title: String? = nil, from: String? = "2025-11-05", to: String? = "2025-11-08",
                 places: [String] = [], count: Int = 42, videos: Int? = nil, tz: Double? = 8) -> WinnowChapter {
    WinnowChapter(id: id, title: title, startDate: from, endDate: to, places: places.map { WinnowChapterPlace(name: $0) },
                  revision: nil, assetCount: count, videoCount: videos, coverId: nil, tzOffsetHours: tz,
                  placeInferred: false, authored: false)
}

final class BrowseWordsTests: XCTestCase {
    func testALegIsCalledByItsTitleElseItsRouteElseItsId() {
        XCTAssertEqual(chapterLabel(leg(title: "  Kalbarri  ", places: ["Perth"])), "Kalbarri")
        XCTAssertEqual(chapterLabel(leg(title: " ", places: ["Perth", " ", "Kalbarri"])), "Perth → Kalbarri")
        XCTAssertEqual(chapterLabel(leg(places: ["Perth", "Perth"])), "Perth")
        XCTAssertEqual(chapterLabel(leg("c9", places: [])), "chapter c9")
    }

    func testALegsRouteJoinsItsNamedPlaces() {
        XCTAssertEqual(chapterRoute(leg(places: ["Perth", "", "Geraldton", "Kalbarri"])), "Perth → Geraldton → Kalbarri")
        XCTAssertEqual(chapterRoute(leg(places: [])), "")
    }

    func testALegsLineSaysItsTwoDaysItsCountAndItsClips() {
        XCTAssertEqual(chapterFactsLine(leg(from: "2025-11-05T08:00:00Z", to: "2025-11-08", videos: 3)),
                       "2025-11-05 → 2025-11-08 · 42 media · 3 ▶")
        XCTAssertEqual(chapterFactsLine(leg(from: "2025-11-05", to: "2025-11-05", videos: 0)), "2025-11-05 · 42 media")
        XCTAssertEqual(chapterFactsLine(leg(from: nil, to: "2025-11-06")), "2025-11-06 · 42 media")
        XCTAssertEqual(chapterFactsLine(leg(from: nil, to: nil, count: 0)), "— · 0 media")
    }

    func testAFoldersLineSaysItsDaysItsCountAndItsDevice() {
        let one = WinnowSession(id: 1, name: "DCIM", deviceHint: "FC8482", capturedAtMin: "2025-11-05T09:00:00Z",
                                capturedAtMax: "2025-11-05T18:00:00Z", assetCount: 120)
        XCTAssertEqual(sessionFactsLine(one), "2025-11-05 · 120 media · FC8482")
        let two = WinnowSession(id: 2, name: "A7C", deviceHint: "", capturedAtMin: "2025-11-05T09:00:00Z",
                                capturedAtMax: "2025-11-06T01:00:00Z", assetCount: 8)
        XCTAssertEqual(sessionFactsLine(two), "2025-11-05 → 2025-11-06 · 8 media")
        XCTAssertEqual(sessionFactsLine(WinnowSession(id: 3, name: "x")), "— · 0 media")
    }

    func testALegsNoteSaysItsZoneAndWhyTheCountsDiffer() {
        XCTAssertEqual(legNote(leg(count: 10, tz: 8), rows: 10),
                       LegNote(text: "days as lived · UTC+8", why: "days as lived · UTC+8"))
        XCTAssertEqual(legNote(leg(count: 10, tz: -3.5), rows: 10).text, "days as lived · UTC-3.5")
        XCTAssertEqual(legNote(leg(count: 10, tz: 0), rows: 10).text, "days as lived · UTC+0")
        let shared = legNote(leg(count: 10, tz: nil), rows: 14)
        XCTAssertEqual(shared.text, "the leg holds 10 · days read at UTC — nothing in this leg carries a position")
        XCTAssertEqual(shared.why, "This instance filters by calendar day, not by leg, so a day this leg shares with its neighbour brings that leg's media too.")
    }

    func testTheFidelityLineSaysWhatBringingThemCosts() {
        XCTAssertEqual(browseFidelityLine(.proxy, picked: 3, bytes: 0),
                       "proxies are what you edit on; exports can fetch originals later")
        XCTAssertEqual(browseFidelityLine(.original, picked: 0, bytes: 0), "full-size files")
        XCTAssertEqual(browseFidelityLine(.original, picked: 2, bytes: 148_000_000), "148 MB to download")
    }

    func testAProblemIsOneLineWithTheSignInWhenThatIsTheAnswer() {
        let base = "https://winnow.example"
        let login = "https://winnow.example/login"
        XCTAssertEqual(browseProblem(WinnowError(.unauthenticated, "401"), baseUrl: base, loginUrl: login),
                       BrowseProblem(text: "Not signed in to https://winnow.example.", login: login))
        XCTAssertEqual(browseProblem(WinnowError(.notfound, "404"), baseUrl: base, loginUrl: login),
                       BrowseProblem(text: "https://winnow.example does not serve a timeline — it has no legs to read."))
        XCTAssertEqual(browseProblem(WinnowError(.unreachable, "The instance did not answer."), baseUrl: base, loginUrl: login),
                       BrowseProblem(text: "The instance did not answer."))
    }

    func testARowsFetchIsNamedAsMaterializeNamesIt() {
        let row = WinnowAssetRow(id: 7, filename: "DJI_0101.JPG")
        XCTAssertEqual(materializeTaskLabel(row, .proxy), "Fetching DJI_0101.JPG’s proxy")
        XCTAssertEqual(materializeTaskLabel(row, .original), "Fetching DJI_0101.JPG")
    }
}
