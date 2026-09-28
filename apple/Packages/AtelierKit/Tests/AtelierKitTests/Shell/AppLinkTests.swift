// The app's links (`Shell/AppLink.swift`). No web twin: the web reads its hash
// in `App.tsx`, `tools.tsx`, `SourcesScreen.tsx`, `StudioTool.tsx` and
// `RoadTripTool.tsx`, inside components; these pin that reading, one rule
// per case, with the web's own words for each.

import Foundation
import XCTest
@testable import AtelierKit

private func path(_ s: String) -> String? { appLinkPath(URL(string: s)!) }

final class AppLinkPathTests: XCTestCase {
    func testReadsTheSchemesHostAndPathAsTheWebPath() {
        XCTAssertEqual(path("atelier://roadtrip/new?source=winnow.steeve.website"),
                       "/roadtrip/new?source=winnow.steeve.website")
        XCTAssertEqual(path("atelier://studio/open/abc"), "/studio/open/abc")
        XCTAssertEqual(path("atelier:///develop/kimberley-3b525ba1/p1"), "/develop/kimberley-3b525ba1/p1")
    }

    func testReadsTheWebsHashWholeWhereverAUrlCarriesOne() {
        XCTAssertEqual(path("https://atelier.steeve.website/#/connect?instance=https%3A%2F%2Fw.example"),
                       "/connect?instance=https%3A%2F%2Fw.example")
        XCTAssertEqual(path("atelier://open#/roadtrip/x-3b525ba1/2026-01-05"), "/roadtrip/x-3b525ba1/2026-01-05")
    }

    func testKeepsTheEscapesForTheRoutesToDecodeThemselves() {
        XCTAssertEqual(path("atelier://develop/r-3b525ba1/p%201"), "/develop/r-3b525ba1/p%201")
    }

    func testAnEmptyLinkIsHomeAndAForeignUrlIsNothing() {
        XCTAssertEqual(path("atelier://"), "/")
        XCTAssertNil(path("https://example.com/page"))
        XCTAssertNil(path("mailto:someone@example.com"))
    }

    func testTheHostIsReadCaseBlind() {
        XCTAssertEqual(path("ATELIER://Studio/home"), "/studio/home")
    }
}

final class ParseAppLinkTests: XCTestCase {
    func testSourcesAndItsOlderNameConnectAreTheShells() {
        XCTAssertEqual(parseAppLink("/sources"), .sources(SourcesLink(proposed: "", back: "")))
        XCTAssertEqual(parseAppLink("/connect?instance=https%3A%2F%2Fwinnow.example&return=%2Froadtrip%2Fnew%3Fsource%3Dwinnow.example"),
                       .sources(SourcesLink(proposed: "https://winnow.example", back: "/roadtrip/new?source=winnow.example")))
        // Not a sub-route: `/sources/x` belongs to nothing.
        XCTAssertEqual(parseAppLink("/sources/x"), .home)
    }

    func testTheStudioTakesAProjectHandedOverAndEveryOtherSubRoute() {
        XCTAssertEqual(parseAppLink("/studio/open/p%201"), .studio(openId: "p 1"))
        XCTAssertEqual(parseAppLink("/studio/open/"), .studio(openId: nil))
        XCTAssertEqual(parseAppLink("/studio/home"), .studio(openId: nil))
        XCTAssertEqual(parseAppLink("/studio"), .studio(openId: nil))
    }

    func testTripsAndDevelopReadTheirOwnRoutes() {
        XCTAssertEqual(parseAppLink("/roadtrip/australia-3b525ba1/2026-01-05/post-1"),
                       .roadtrip(RoadtripRoute(ref: "australia-3b525ba1", date: "2026-01-05", postId: "post-1")))
        XCTAssertEqual(parseAppLink("/roadtrip/new?source=winnow.example&chapters=a,b"),
                       .roadtrip(RoadtripRoute(ref: nil, date: nil, postId: nil,
                                               link: TimelineLink(kind: .seed, source: "winnow.example", chapters: ["a", "b"]))))
        XCTAssertEqual(parseAppLink("/develop/kimberley-3b525ba1/p1"),
                       .develop(DevelopRoute(ref: "kimberley-3b525ba1", pictureId: "p1")))
        XCTAssertEqual(parseAppLink("/develop/home"), .develop(.nowhere))
    }

    func testAnInstrumentIsItsSlug() {
        XCTAssertEqual(parseAppLink("/lut"), .instrument("lut"))
        XCTAssertEqual(parseAppLink("/map/anything"), .instrument("map"))
    }

    func testAToolOwnsItsBaseAndItsSubRoutesAndNothingThatMerelyStartsLikeIt() {
        XCTAssertEqual(parseAppLink("/roadtrip-notes"), .home)
        XCTAssertEqual(parseAppLink("/developer"), .home)
        XCTAssertEqual(parseAppLink("/"), .home)
        XCTAssertEqual(parseAppLink(""), .home)
    }
}

final class SourcesLinkTests: XCTestCase {
    func testAReturnIsHonouredOnlyAsAPathOfOurs() {
        XCTAssertEqual(SourcesLink(proposed: "", back: "/roadtrip/home").after, "/roadtrip/home")
        XCTAssertEqual(SourcesLink(proposed: "", back: "//evil.example/x").after, sourcesAfterConnect)
        XCTAssertEqual(SourcesLink(proposed: "", back: "https://evil.example").after, sourcesAfterConnect)
        XCTAssertEqual(SourcesLink(proposed: "https://w.example", back: "").after, "/studio/home")
    }

    func testALinkThatAskedAnythingIsSentByLink() {
        XCTAssertFalse(SourcesLink(proposed: "", back: "").sentByLink)
        XCTAssertTrue(SourcesLink(proposed: "https://w.example", back: "").sentByLink)
        XCTAssertTrue(SourcesLink(proposed: "", back: "/studio").sentByLink)
    }
}

final class TimelineLinkLandingTests: XCTestCase {
    private let seedPath = "/roadtrip/new?source=winnow.example&chapters=c1"
    private let completePath = "/roadtrip/australia-3b525ba1/import?source=winnow.example"

    func testAnOrdinaryRouteIsNoLink() {
        let route = parseRoadtripPath("/roadtrip/australia-3b525ba1")
        XCTAssertNil(timelineLinkLanding(route, path: "/roadtrip/australia-3b525ba1", isConnected: { _ in true }))
    }

    /// The web's switch is off, and so is the kernel's: a link is consumed and
    /// lands on the ordinary screen, and no instance is asked.
    func testWhileTheSwitchIsOffALinkLandsOnTheOrdinaryScreen() {
        XCTAssertFalse(timelineSyncEnabled)
        let seed = parseRoadtripPath(seedPath)
        XCTAssertEqual(timelineLinkLanding(seed, path: seedPath, isConnected: { _ in true }), .land(.nowhere))
        let complete = parseRoadtripPath(completePath)
        XCTAssertEqual(timelineLinkLanding(complete, path: completePath, isConnected: { _ in true }),
                       .land(RoadtripRoute(ref: "australia-3b525ba1", date: nil, postId: nil)))
    }

    func testOnAHostNotConnectedGoesToSourcesAndComesBack() {
        let seed = parseRoadtripPath(seedPath)
        XCTAssertEqual(timelineLinkLanding(seed, path: seedPath, enabled: true, isConnected: { _ in false }),
                       .connectFirst(SourcesLink(proposed: "https://winnow.example", back: seedPath)))
    }

    func testOnAConnectedHostOpensTheImportOverTheOrdinaryScreen() {
        let complete = parseRoadtripPath(completePath)
        let landing = timelineLinkLanding(complete, path: completePath, enabled: true, isConnected: { $0 == "winnow.example" })
        XCTAssertEqual(landing, .open(TimelineLink(kind: .complete, source: "winnow.example", chapters: []),
                                      over: RoadtripRoute(ref: "australia-3b525ba1", date: nil, postId: nil)))
        let seed = parseRoadtripPath(seedPath)
        XCTAssertEqual(timelineLinkLanding(seed, path: seedPath, enabled: true, isConnected: { _ in true }),
                       .open(TimelineLink(kind: .seed, source: "winnow.example", chapters: ["c1"]), over: .nowhere))
    }
}
