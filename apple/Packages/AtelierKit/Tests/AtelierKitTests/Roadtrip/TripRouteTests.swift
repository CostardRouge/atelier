// Port of `src/shared/roadtrip/trip-route.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private struct RouteTrip: Equatable {
    var id: String
    var name: String
}

private let trip = RouteTrip(id: "3b525ba1-3167-4efb-a4a5-1dc1e77399a1", name: "Australia")
private let other = RouteTrip(id: "02f09b86-b62e-4aa0-877f-4720fcd28143", name: "Australia")

private func refOf(_ t: RouteTrip) -> String { tripRef(id: t.id, name: t.name) }
private func find(_ ref: String, _ trips: [RouteTrip]) -> RouteTrip? { tripFromRef(ref, trips, id: \.id) }

/// `encodeURIComponent`, for building the test paths the web builds with it.
private func uriComponent(_ s: String) -> String {
    let keep = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
    return s.addingPercentEncoding(withAllowedCharacters: keep)!
}

final class TripSlugTests: XCTestCase {
    func testIsReadable() {
        XCTAssertEqual(tripSlug("Australia"), "australia")
        XCTAssertEqual(tripSlug("Australie / Ouest"), "australie-ouest")
    }

    func testStripsAccentsRatherThanEscapingThemIntoNoise() {
        XCTAssertEqual(tripSlug("Été à Sydney"), "ete-a-sydney")
    }

    func testIsEmptyForANamelessTripRatherThanARowOfDashes() {
        XCTAssertEqual(tripSlug("   "), "")
        XCTAssertEqual(tripSlug("!!!"), "")
    }

    func testDoesNotRunAwayWithAVeryLongName() {
        XCTAssertLessThanOrEqual(tripSlug(String(repeating: "a", count: 200)).count, 40)
    }
}

final class TripRefFromRefTests: XCTestCase {
    func testReadsAsTheTripAndResolvesBackToIt() {
        let ref = refOf(trip)
        XCTAssertTrue(ref.hasPrefix("australia-"))
        XCTAssertEqual(find(ref, [trip, other]), trip)
    }

    func testTellsTwoTripsOfTheSameNameApart() {
        XCTAssertEqual(find(refOf(other), [trip, other]), other)
        XCTAssertNotEqual(refOf(trip), refOf(other))
    }

    func testSurvivesARenameTheIdFragmentIsWhatResolves() {
        let ref = refOf(trip)
        var renamed = trip
        renamed.name = "One lap of the country"
        XCTAssertEqual(find(ref, [renamed, other]), renamed)
    }

    func testStillAcceptsABareId() {
        XCTAssertEqual(find(trip.id, [trip, other]), trip)
    }

    func testIsNilForATripThatIsGone() {
        XCTAssertNil(find("australia-deadbeef", [trip, other]))
        XCTAssertNil(find("", [trip]))
    }

    func testWorksForANamelessTrip() {
        let nameless = RouteTrip(id: trip.id, name: "")
        XCTAssertEqual(find(refOf(nameless), [nameless]), nameless)
    }
}

final class TripRoadtripPathTests: XCTestCase {
    private let ref = refOf(trip)

    func testRoundTripsEveryDepth() {
        XCTAssertEqual(parseRoadtripPath(roadtripPath(ref)), RoadtripRoute(ref: ref, date: nil, postId: nil))
        XCTAssertEqual(parseRoadtripPath(roadtripPath(ref, "2025-07-09")),
                       RoadtripRoute(ref: ref, date: "2025-07-09", postId: nil))
        XCTAssertEqual(parseRoadtripPath(roadtripPath(ref, "2025-07-09", "p1")),
                       RoadtripRoute(ref: ref, date: "2025-07-09", postId: "p1"))
    }

    func testShowsTheDayInThePathBecauseThatIsWhatGetsRead() {
        XCTAssertEqual(roadtripPath(ref, "2025-07-09"), "/roadtrip/\(ref)/2025-07-09")
    }

    func testReadsTheGalleryAsNowhereInParticular() {
        for path in ["/roadtrip", "/roadtrip/", "/roadtrip/home"] {
            XCTAssertEqual(parseRoadtripPath(path), RoadtripRoute(ref: nil, date: nil, postId: nil), path)
        }
    }

    func testIgnoresAnotherToolsRouteEntirely() {
        XCTAssertEqual(parseRoadtripPath("/studio/open/abc"), RoadtripRoute(ref: nil, date: nil, postId: nil))
    }

    func testDropsADayThatIsNotARealOneAndEverythingAfterIt() {
        // Half a route is worse than none: a piece under a nonexistent day would
        // open with the wrong day selected behind it.
        XCTAssertEqual(parseRoadtripPath("/roadtrip/\(ref)/2025-02-30/p1"), RoadtripRoute(ref: ref, date: nil, postId: nil))
        XCTAssertNil(parseRoadtripPath("/roadtrip/\(ref)/nonsense/p1").date)
    }

    func testSurvivesAPieceIdThatNeedsEscaping() {
        let path = roadtripPath(ref, "2025-07-09", "a/b c")
        XCTAssertEqual(parseRoadtripPath(path).postId, "a/b c")
    }
}

final class TripTimelineLinkTests: XCTestCase {
    private let ref = refOf(trip)

    func testReadsASeedLinkWithTheLegsItNames() {
        XCTAssertEqual(parseRoadtripPath("/roadtrip/new?source=Winnow.Example&chapters=3,7"),
                       RoadtripRoute(ref: nil, date: nil, postId: nil,
                                     link: TimelineLink(kind: .seed, source: "winnow.example", chapters: ["3", "7"])))
    }

    func testReadsACompleteLinkAgainstATrip() {
        XCTAssertEqual(parseRoadtripPath("/roadtrip/\(ref)/import?source=winnow.example"),
                       RoadtripRoute(ref: ref, date: nil, postId: nil,
                                     link: TimelineLink(kind: .complete, source: "winnow.example", chapters: [])))
    }

    func testRoundTripsThroughTheBuilder() {
        let seed = TimelineLink(kind: .seed, source: "winnow.example", chapters: ["42"])
        XCTAssertEqual(parseRoadtripPath(timelineLinkPath(seed)).link, seed)
        let complete = TimelineLink(kind: .complete, source: "winnow.example", chapters: [])
        let path = timelineLinkPath(complete, ref: ref)
        XCTAssertEqual(path, "/roadtrip/\(ref)/import?source=winnow.example")
        let parsed = parseRoadtripPath(path)
        XCTAssertEqual(parsed.ref, ref)
        XCTAssertEqual(parsed.link, complete)
    }

    func testRefusesASourceThatIsNotABareHostTheUrlNeverSaysWhereToFetchFrom() {
        for bad in ["https://winnow.example", "winnow.example/api", "a b", ""] {
            let path = "/roadtrip/new?source=\(uriComponent(bad))"
            XCTAssertNil(parseRoadtripPath(path).link, bad)
        }
        // …and the complete link then reads as the plain trip route.
        XCTAssertEqual(parseRoadtripPath("/roadtrip/\(ref)/import?source="), RoadtripRoute(ref: ref, date: nil, postId: nil))
    }

    func testLeavesTheOrdinaryRoutesUntouched() {
        XCTAssertNil(parseRoadtripPath("/roadtrip/\(ref)/2025-07-09").link)
        XCTAssertNil(parseRoadtripPath("/roadtrip/home?source=winnow.example").link)
    }
}

/// The encodings are JavaScript's, byte for byte — pinned here because a link
/// made by one client is opened by the other.
final class TripRouteEncodingTests: XCTestCase {
    func testEncodesAPieceIdAsEncodeURIComponentDoes() {
        XCTAssertEqual(roadtripPath("r", "2025-07-09", "a/b c"), "/roadtrip/r/2025-07-09/a%2Fb%20c")
        XCTAssertEqual(roadtripPath("r", "2025-07-09", "it's (é)!~*"), "/roadtrip/r/2025-07-09/it's%20(%C3%A9)!~*")
    }

    func testSerialisesALinksQueryAsURLSearchParamsDoes() {
        let link = TimelineLink(kind: .seed, source: "winnow.example:8443", chapters: ["3", "7"])
        XCTAssertEqual(timelineLinkPath(link), "/roadtrip/new?source=winnow.example%3A8443&chapters=3%2C7")
        XCTAssertEqual(parseRoadtripPath(timelineLinkPath(link)).link, link)
    }

    func testReadsAMalformedEscapeAsNowhereWhereTheWebWouldThrow() {
        XCTAssertEqual(parseRoadtripPath("/roadtrip/abc%zz/2025-07-09"), .nowhere)
        XCTAssertEqual(parseRoadtripPath("/roadtrip/abc%C3/2025-07-09"), .nowhere)
    }
}
