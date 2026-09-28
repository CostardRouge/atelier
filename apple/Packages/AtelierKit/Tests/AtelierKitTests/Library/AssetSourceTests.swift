// Port of `src/shared/library/asset-source.test.ts`. The web registers an
// identity per `File`; a kernel ref carries it — `assetId` set only where a
// source vouched for the file.

import Foundation
import XCTest
@testable import AtelierKit

private func pooled(_ name: String, _ size: Int = 10, vouched assetId: String? = nil, hash: String? = nil) -> SavedMediaRef {
    SavedMediaRef(name: name, size: size, lastModified: 1_000, assetId: assetId, hash: hash)
}

final class AssetSourceTests: XCTestCase {
    func testReadsAFileNobodyVouchedForAsLocal() {
        let asset = buildAssets([pooled("IMG_0001.JPG")])[0]
        XCTAssertEqual(assetSourceId(asset), "local")
        XCTAssertNil(assetRemoteId(asset))
    }

    func testReadsTheSourceAndTheRemoteIdAFetchedFileWasVouchedWith() {
        let clip = pooled("DJI_0042.mp4", vouched: "winnow.example/42", hash: "abc")
        // The log shares the identity — the clip speaks.
        let log = pooled("DJI_0042.SRT", 3, vouched: "winnow.example/42", hash: "abc")
        let asset = buildAssets([clip, log])[0]
        XCTAssertEqual(asset.kind, .videoTelemetry)
        XCTAssertEqual(assetSourceId(asset), "winnow.example")
        XCTAssertEqual(assetRemoteId(asset), "winnow.example/42")
    }

    func testSplitsThePoolBySourceLocalFirstPoolOrderKeptInsideEachGroup() {
        let a = pooled("A.JPG")
        let b = pooled("B.webp", vouched: "winnow.example/2")
        let c = pooled("C.JPG")
        let d = pooled("D.webp", vouched: "other.example/4")
        let split = splitAssetsBySource(buildAssets([a, b, c, d]))
        XCTAssertEqual(split.local.map(\.baseName), ["A", "C"])
        XCTAssertEqual(split.remote.map(\.sourceId), ["winnow.example", "other.example"])
        XCTAssertEqual(split.assets(of: "winnow.example").map(\.baseName), ["B"])
        XCTAssertEqual(split.assets(of: "nowhere.example"), [])
    }

    func testAPictureSpeaksBeforeItsClipAndAnEmptyIdIsNoIdentity() {
        let asset = buildAssets([pooled("X.JPG", vouched: "")])[0]
        XCTAssertEqual(assetMainFile(asset)?.name, "X.JPG")
        XCTAssertNil(assetRemoteId(asset))
        XCTAssertEqual(assetSourceId(asset), "local")
    }
}
