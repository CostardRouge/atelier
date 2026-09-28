// The rules the web's `use-roll-media.ts` keeps inline, pinned: only a
// CONNECTED instance is ever asked; variants share one fetch; the queue is the
// open picture then its neighbours, never what is in hand nor what already
// failed; every picture says where its bytes stand, in the web's order.

import XCTest
@testable import AtelierKit

private func ref(_ name: String, _ assetId: String? = nil) -> SavedMediaRef {
    SavedMediaRef(name: name, size: 10, lastModified: 1, assetId: assetId)
}

private func picture(_ id: String, _ name: String, _ assetId: String? = nil, variant: Int? = nil) -> RollPicture {
    RollPicture(id: id, ref: ref(name, assetId), variant: variant)
}

private let connected: (String) -> Bool = { $0 == "w.example" }

final class RollFetchPlanTests: XCTestCase {
    func testOnlyAConnectedInstanceIsResolvable() {
        XCTAssertEqual(resolvableSourceOf(ref("a.webp", "w.example/12"), connected: connected), "w.example")
        XCTAssertNil(resolvableSourceOf(ref("a.webp", "other.example/12"), connected: connected))
        XCTAssertNil(resolvableSourceOf(ref("a.jpg", "local/12"), connected: { _ in true }))
        XCTAssertNil(resolvableSourceOf(ref("a.jpg"), connected: { _ in true }))
        XCTAssertNil(resolvableSourceOf(nil, connected: { _ in true }))
    }

    func testVariantsAreEachOthersMatesAndALonePictureHasNone() {
        let pictures = [
            picture("a", "A.JPG"),
            picture("b", "B.JPG"),
            picture("b2", "B.JPG", variant: 2),
            picture("b3", "B.JPG", variant: 3),
        ]
        let mates = rollMates(pictures)
        XCTAssertNil(mates["a"])
        XCTAssertEqual(mates["b"], ["b2", "b3"])
        XCTAssertEqual(mates["b2"], ["b", "b3"])
        XCTAssertEqual(mates["b3"], ["b", "b2"])
        XCTAssertTrue(rollMates([picture("a", "A.JPG")]).isEmpty)
    }

    func testAFileIsKeptWhileItOrAVariantIsNear() {
        let mates = ["b": ["b2"], "b2": ["b"]]
        XCTAssertTrue(keptNearOpen("b", ["b2"], mates))
        XCTAssertTrue(keptNearOpen("a", ["a"], mates))
        XCTAssertFalse(keptNearOpen("c", ["a", "b"], mates))
    }

    func testTheQueueSkipsWhatIsInHandAVariantInHandAndWhatFailed() {
        let ids = ["a", "b", "c", "d", "e"]
        let queue = rollFetchQueue(ids, "c", inHand: { $0 == "d" }, mates: ["b": ["x"], "x": ["b"]],
                                   failed: ["e"], radius: 2)
        XCTAssertEqual(queue, ["c", "b", "a"])
        let variantHeld = rollFetchQueue(ids, "c", inHand: { $0 == "x" }, mates: ["b": ["x"]], failed: [], radius: 1)
        XCTAssertEqual(variantHeld, ["c", "d"], "b's twin is in hand: its bytes are b's")
    }

    func testAFailureSaysNotSignedInWithTheSignInPageOrTheInstancesWords() {
        XCTAssertEqual(fetchFailure("w.example", unauthenticated: true, message: "401"),
                       .failed(sourceId: "w.example", problem: "Not signed in to w.example.", loginUrl: "https://w.example/login"))
        XCTAssertEqual(fetchFailure("w.example", unauthenticated: false, message: "The instance answered 500."),
                       .failed(sourceId: "w.example", problem: "The instance answered 500."))
    }

    func testEveryPictureSaysWhereItsBytesStandInTheWebsOrder() {
        let pictures = [
            picture("ready", "R.webp", "w.example/1"),
            picture("fetching", "F.webp", "w.example/2"),
            picture("failed", "X.webp", "w.example/3"),
            picture("waiting", "W.webp", "w.example/4"),
            picture("elsewhere", "E.webp", "other.example/5"),
            picture("here", "H.JPG"),
            picture("gone", "G.webp", "w.example/6"),
        ]
        let failure = fetchFailure("w.example", unauthenticated: false, message: "boom")
        let out = rollAvailability(pictures, inHand: ["ready"], fetching: ["fetching", "failed"],
                                   failures: ["failed": failure, "gone": .gone(sourceId: "w.example")],
                                   connected: connected)
        XCTAssertEqual(out["ready"], .ready)
        XCTAssertEqual(out["fetching"], .fetching(sourceId: "w.example"))
        XCTAssertEqual(out["failed"], .fetching(sourceId: "w.example"), "a new fetch of a failed picture is said as fetching")
        XCTAssertEqual(out["waiting"], .waiting(sourceId: "w.example"))
        XCTAssertEqual(out["elsewhere"], .unconnected(sourceId: "other.example"))
        XCTAssertEqual(out["here"], .local)
        XCTAssertEqual(out["gone"], .gone(sourceId: "w.example"))
    }

    func testAFailureStaysSaidWhenItsInstanceIsForgotten() {
        let pictures = [picture("x", "X.webp", "w.example/3")]
        let out = rollAvailability(pictures, inHand: [], fetching: [],
                                   failures: ["x": .gone(sourceId: "w.example")], connected: { _ in false })
        XCTAssertEqual(out["x"], .gone(sourceId: "w.example"))
    }

    func testTheStatusLineNamesTheFirstInstanceBeingAsked() {
        let availability: [String: PictureAvailability] = ["a": .ready, "b": .fetching(sourceId: "w.example")]
        XCTAssertEqual(fetchingHost(["a", "b"], availability), "w.example")
        XCTAssertEqual(fetchingHost(["a"], availability), "its instance")
    }
}
