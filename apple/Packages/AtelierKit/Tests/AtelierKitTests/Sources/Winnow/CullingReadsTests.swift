// The rules the web's `use-roll-culling.ts` keeps inline, pinned: a roll asks
// only connected instances, once per id, in chunks of two hundred; an answer is
// believed for a minute; an id the instance did not send back is kept as "no
// culling"; a picture's word is read by its ref's own asset id.

import Foundation
import XCTest
@testable import AtelierKit

private func picture(_ id: String, _ assetId: String?) -> RollPicture {
    RollPicture(id: id, ref: SavedMediaRef(name: "\(id).webp", size: 1, lastModified: 1, assetId: assetId))
}

final class CullingReadsTests: XCTestCase {
    func testAsksOnlyConnectedInstancesEachIdOnceInTheStripsOrder() {
        let pictures = [
            picture("a", "w.example/3"),
            picture("b", "other.example/9"),
            picture("c", "w.example/1"),
            picture("c2", "w.example/1"),
            picture("d", nil),
            picture("e", "local/4"),
            picture("f", "x.example/2"),
        ]
        let wanted = cullingWanted(pictures, connected: { $0 != "other.example" })
        XCTAssertEqual(wanted.map(\.host), ["w.example", "x.example"])
        XCTAssertEqual(wanted.first?.ids, [3, 1])
        XCTAssertEqual(wanted.last?.ids, [2])
    }

    func testAsksAgainWhatIsMissingOrOlderThanTheAgeAllowed() {
        let kept: [String: KeptCulling] = [
            "w.example/1": KeptCulling(culling: nil, at: 1_000),
            "w.example/2": KeptCulling(culling: nil, at: 50_000),
        ]
        XCTAssertEqual(staleCullIds("w.example", [1, 2, 3], kept: kept, now: 70_000, maxAge: cullFreshMs), [1, 3])
        XCTAssertEqual(staleCullIds("w.example", [1, 2, 3], kept: kept, now: 70_000, maxAge: 0), [1, 2, 3])
    }

    func testCutsTheIdsIntoRequestsOfTwoHundred() {
        let ids = Array(1...450)
        let chunks = cullChunks(ids)
        XCTAssertEqual(chunks.map(\.count), [200, 200, 50])
        XCTAssertEqual(chunks.flatMap { $0 }, ids)
        XCTAssertEqual(cullChunks([]), [])
    }

    func testKeepsEveryRowsWordAndNoneForAnIdNotSentBack() throws {
        let row = try XCTUnwrap(readWinnowAssetRow(["id": 1, "verdict": "pick", "star": 2]))
        let kept = keptAfterAnswer("w.example", asked: [1, 2], rows: [row], at: 9)
        XCTAssertEqual(kept["w.example/1"], KeptCulling(culling: Culling(verdict: .pick, star: 2, color: nil), at: 9))
        XCTAssertEqual(kept["w.example/2"], KeptCulling(culling: nil, at: 9))
    }

    func testReadsEachPicturesWordByItsOwnAssetId() {
        let kept: [String: KeptCulling] = [
            "w.example/1": KeptCulling(culling: Culling(verdict: .reject, star: 0, color: nil), at: 1),
            "w.example/2": KeptCulling(culling: nil, at: 1),
        ]
        let out = cullingByPicture([picture("a", "w.example/1"), picture("b", "w.example/2"), picture("c", nil)], kept: kept)
        XCTAssertEqual(out, ["a": Culling(verdict: .reject, star: 0, color: nil)])
    }
}
