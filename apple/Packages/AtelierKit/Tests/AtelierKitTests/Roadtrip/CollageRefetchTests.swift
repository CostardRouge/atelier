// Port of `src/tools/roadtrip/collage-refetch.test.ts`, case for case.

import Foundation
import XCTest
@testable import AtelierKit

private func mediaRef(_ name: String, _ assetId: String? = nil) -> SavedMediaRef {
    SavedMediaRef(name: name, size: 1, lastModified: 1, assetId: assetId)
}

private let connected: (SavedMediaRef) -> String? = { ref in
    (ref.assetId ?? "").hasPrefix("winnow.test/") ? "winnow.test" : nil
}

final class CollageRefetchRefsTests: XCTestCase {
    func testFetchesEveryInstanceHeldPictureThePoolLacksInCellOrder() {
        let refs: [SavedMediaRef?] = [mediaRef("a.jpg", "winnow.test/1"), nil, mediaRef("b.jpg", "winnow.test/2")]
        XCTAssertEqual(refsToFetch(refs, poolNames: [], sourceOf: connected).map(\.key),
                       ["winnow.test/1", "winnow.test/2"])
        XCTAssertEqual(refsToFetch(refs, poolNames: [], sourceOf: connected)[0].sourceId, "winnow.test")
    }

    func testSkipsWhatThePoolHoldsByNameAndCaseBlind() {
        let refs: [SavedMediaRef?] = [mediaRef("A.JPG", "winnow.test/1"), mediaRef("b.jpg", "winnow.test/2")]
        XCTAssertEqual(refsToFetch(refs, poolNames: poolNameSet(["a.jpg"]), sourceOf: connected).map(\.key),
                       ["winnow.test/2"])
    }

    func testNeverNamesAServerThatWasNotConnectedNorALocalFile() {
        let refs: [SavedMediaRef?] = [mediaRef("a.jpg", "elsewhere.test/1"), mediaRef("b.jpg"), mediaRef("c.jpg", "local/3")]
        XCTAssertEqual(refsToFetch(refs, poolNames: [], sourceOf: connected), [])
    }

    func testAsksOncePerPictureAndNotAgainOnceTried() {
        let refs: [SavedMediaRef?] = [mediaRef("a.jpg", "winnow.test/1"), mediaRef("a.jpg", "winnow.test/1"),
                                      mediaRef("b.jpg", "winnow.test/2")]
        XCTAssertEqual(refsToFetch(refs, poolNames: [], sourceOf: connected).count, 2)
        XCTAssertEqual(refsToFetch(refs, poolNames: [], sourceOf: connected, attempted: ["winnow.test/1"]).map(\.key),
                       ["winnow.test/2"])
    }
}

final class CollageRefetchKeyTests: XCTestCase {
    func testKeysARefByItsAssetIdOnly() {
        XCTAssertNil(refetchKey(mediaRef("a.jpg")))
        XCTAssertNil(refetchKey(nil))
        XCTAssertEqual(refetchKey(mediaRef("a.jpg", "h/1")), "h/1")
    }

    func testIgnoresEmptySlots() {
        XCTAssertEqual(Array(poolNameSet([nil, "X.jpg"])), ["x.jpg"])
    }
}

final class CollageRefetchSummaryTests: XCTestCase {
    func testSaysWhatIsRunningFirstThenWhatFailedElseNothing() {
        XCTAssertNil(refetchSummary([]))
        let failed = RefetchState(state: .failed, sourceId: "w")
        let fetching = RefetchState(state: .fetching, sourceId: "w")
        XCTAssertTrue(refetchSummary([(key: "1", value: failed)])?.hasPrefix("1 picture could not") ?? false)
        XCTAssertEqual(refetchSummary([(key: "1", value: failed), (key: "2", value: fetching), (key: "3", value: fetching)]),
                       "Fetching 2 pictures back from w…")
    }
}
