// Port of `src/shared/develop/develop-route.test.ts`, plus the one divergence
// the port states (a malformed escape reads as the gallery).

import Foundation
import XCTest
@testable import AtelierKit

private struct RouteRoll: Equatable {
    var id: String
    var name: String
}

private let roll = RouteRoll(id: "3b525ba1-0c2d-4e5f-8a9b-0123456789ab", name: "Kimberley, June")

final class DevelopRouteTests: XCTestCase {
    func testReadsTheGalleryFromTheBaseHomeAndAnythingThatIsNotOurs() {
        XCTAssertEqual(parseDevelopPath("/develop"), .nowhere)
        XCTAssertEqual(parseDevelopPath("/develop/home"), .nowhere)
        XCTAssertEqual(parseDevelopPath("/developer/x"), .nowhere)
        XCTAssertEqual(parseDevelopPath("/roadtrip/x"), .nowhere)
    }

    func testRoundTripsARollAndAPictureOnIt() {
        let ref = rollRef(id: roll.id, name: roll.name)
        XCTAssertEqual(ref, "kimberley-june-3b525ba1")
        XCTAssertEqual(parseDevelopPath(developPath(ref)), DevelopRoute(ref: ref, pictureId: nil))
        XCTAssertEqual(parseDevelopPath(developPath(ref, "p 1")), DevelopRoute(ref: ref, pictureId: "p 1"))
        XCTAssertEqual(developPath(nil), developRouteHome)
    }

    func testIgnoresAQueryAndResolvesARenamedRollByItsIdFragment() {
        XCTAssertEqual(parseDevelopPath("/develop/abc-3b525ba1?x=1"), DevelopRoute(ref: "abc-3b525ba1", pictureId: nil))
        XCTAssertEqual(rollFromRef("an-old-name-3b525ba1", [roll], id: \.id), roll)
        XCTAssertNil(rollFromRef("nothing-ffffffff", [roll], id: \.id))
    }

    /// Native only: where the web's `decodeURIComponent` throws, the path is the gallery.
    func testAMalformedEscapeReadsAsTheGallery() {
        XCTAssertEqual(parseDevelopPath("/develop/abc%zz"), .nowhere)
        XCTAssertEqual(parseDevelopPath("/develop/abc/p%"), .nowhere)
    }
}
