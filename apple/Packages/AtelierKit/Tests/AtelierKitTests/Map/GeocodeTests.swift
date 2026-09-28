// Port of `src/shared/map/geocode.test.ts`, case for case, plus the two
// sentences the web's `searchPlaces` owns and the line a candidate reads.

import XCTest
@testable import AtelierKit

/// `new URL(url).searchParams.get(name)` — form-decoded (`+` is a space).
private func searchParam(_ url: String, _ name: String) -> String? {
    guard let q = url.split(separator: "?", maxSplits: 1).dropFirst().first else { return nil }
    for pair in q.split(separator: "&") {
        let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
        guard kv.count == 2, kv[0] == name else { continue }
        return String(kv[1]).replacingOccurrences(of: "+", with: " ").removingPercentEncoding
    }
    return nil
}

final class GeocodeNominatimUrlTests: XCTestCase {
    func testIsTheOnlyUrlThisModuleCanBuildAssertItInFull() {
        XCTAssertEqual(
            nominatimUrl("Kalbarri"),
            "https://nominatim.openstreetmap.org/search"
                + "?q=Kalbarri&format=jsonv2&addressdetails=0&limit=\(placeResultLimit)"
        )
    }

    func testEscapesWhatTheAuthorTypedInsteadOfPastingItIntoAUrl() {
        let url = nominatimUrl("Saint-Étienne & co / 100%")
        XCTAssertTrue(url.contains("q=Saint-%C3%89tienne+%26+co+%2F+100%25"), url)
        XCTAssertEqual(searchParam(url, "q"), "Saint-Étienne & co / 100%")
    }

    func testTrimsSoAStraySpaceIsNotADifferentQuery() {
        XCTAssertEqual(searchParam(nominatimUrl("  Perth  "), "q"), "Perth")
    }

    func testNeverAsksForFewerThanOneResult() {
        XCTAssertEqual(searchParam(nominatimUrl("Perth", limit: 0), "limit"), "1")
        XCTAssertEqual(searchParam(nominatimUrl("Perth", limit: -4), "limit"), "1")
    }
}

final class GeocodeRegionFromDisplayNameTests: XCTestCase {
    func testDropsThePlaceItselfAndThePostcodeKeepingTheOuterTwoLevels() {
        XCTAssertEqual(
            regionFromDisplayName("Kalbarri, Shire of Northampton, Western Australia, 6536, Australia"),
            "Western Australia, Australia"
        )
    }

    func testCopesWithADisplayNameThatIsOnlyThePlace() {
        XCTAssertEqual(regionFromDisplayName("Uluru"), "")
    }

    func testCopesWithNothingAtAll() {
        XCTAssertEqual(regionFromDisplayName(""), "")
    }
}

final class GeocodeParsePlaceResultsTests: XCTestCase {
    private func row(_ change: (inout [String: JSONValue]) -> Void = { _ in }) -> JSONValue {
        var o: [String: JSONValue] = [
            "place_id": 1,
            "name": "Kalbarri",
            "display_name": "Kalbarri, Shire of Northampton, Western Australia, 6536, Australia",
            "lat": "-27.7099",
            "lon": "114.1650",
        ]
        change(&o)
        return .object(o)
    }

    func testReadsARealResponse() {
        XCTAssertEqual(parsePlaceResults(.array([row()])), [
            PlaceResult(name: "Kalbarri", region: "Western Australia, Australia", lat: -27.7099, lon: 114.165),
        ])
    }

    func testFallsBackToTheHeadOfTheDisplayNameWhenNameIsAbsent() {
        XCTAssertEqual(parsePlaceResults(.array([row { $0["name"] = "  " }])).first?.name, "Kalbarri")
    }

    func testAccepts00UnlikeADjiFixItIsARealAnswerHere() {
        XCTAssertEqual(parsePlaceResults(.array([row { $0["lat"] = 0; $0["lon"] = 0 }])).count, 1)
    }

    func testDropsARowWhoseCoordinatesAreMissingOrUnreadable() {
        XCTAssertEqual(parsePlaceResults(.array([row { $0.removeValue(forKey: "lat") }])), [])
        XCTAssertEqual(parsePlaceResults(.array([row { $0["lon"] = "nowhere" }])), [])
    }

    func testDropsARowOutsideTheGlobe() {
        XCTAssertEqual(parsePlaceResults(.array([row { $0["lat"] = "91" }])), [])
        XCTAssertEqual(parsePlaceResults(.array([row { $0["lon"] = "-181" }])), [])
    }

    func testDropsARowThatNamesNothing() {
        XCTAssertEqual(parsePlaceResults(.array([["lat": "1", "lon": "2", "display_name": ""]])), [])
    }

    func testKeepsTheGoodRowsOfAMixedResponse() {
        let results = parsePlaceResults(.array([row { $0["lat"] = "x" }, row(), .null, "nonsense"]))
        XCTAssertEqual(results.map(\.name), ["Kalbarri"])
    }

    func testNeverThrowsOnSomethingThatIsNotAListOfRows() {
        XCTAssertEqual(parsePlaceResults(.null), [])
        XCTAssertEqual(parsePlaceResults(["error": "rate limited"]), [])
        XCTAssertEqual(parsePlaceResults("<html>429</html>"), [])
        XCTAssertEqual(parsePlaceResults(.array([])), [])
        XCTAssertEqual(parsePlaceResults(nil), [])
    }
}

final class GeocodeSentencesTests: XCTestCase {
    func testA429IsSaidAsARateLimitAnythingElseByItsStatus() {
        XCTAssertEqual(placeSearchRefusal(429),
                       "The place search is rate-limited right now — wait a moment, or type the place by hand.")
        XCTAssertEqual(placeSearchRefusal(503), "The place search answered 503. You can type the place by hand instead.")
    }

    func testACandidateReadsItsRegionAndItsCoordinatesToFourPlaces() {
        let kalbarri = PlaceResult(name: "Kalbarri", region: "Western Australia, Australia", lat: -27.7099, lon: 114.165)
        XCTAssertEqual(placeResultLine(kalbarri), "Western Australia, Australia · -27.7099, 114.1650")
        let bare = PlaceResult(name: "Uluru", region: "", lat: -25.3444, lon: 131.0369)
        XCTAssertEqual(placeResultLine(bare), "-25.3444, 131.0369")
    }

    func testTheConsentKeyIsTheWebsOwn() {
        XCTAssertEqual(placeSearchPrefKey, "atelier.roadtrip.placeSearch")
    }
}
