// Port of `src/shared/lut/pack-weight.test.ts`. The web's `formatBytes` of
// that module is `formatPackBytes` here (the kernel's `formatBytes` is
// `shared/lib/format.ts`'s, a different function).

import XCTest
@testable import AtelierKit

private func look(_ id: String, hash: String? = nil, blob: String? = nil, lattice: Int? = nil) -> PackLook {
    PackLook(id: id, label: id, node: "", file: "\(id).cube", family: .rec709, lattice: lattice, hash: hash, blob: blob)
}

private func pack(_ id: String, sourceId: String? = nil, looks: [PackLook] = []) -> LutPackIndex {
    LutPackIndex(id: id, name: id, author: "", tree: [], looks: looks, hidden: [], sourceId: sourceId)
}

/// A 65³ look, the size the maintainer's own pack ships.
private let sixtyFive = encodedBytes(65)
/// A 33³ one, the size of an uploaded cube.
private let thirtyThree = encodedBytes(33)

final class LookBytesTests: XCTestCase {
    func testMeasuresTheStoredBufferWhenThisDeviceHoldsIt() {
        let l = look("a", hash: "h1", lattice: 65)
        XCTAssertEqual(lookBytes(l, ["h1": 12345]), 12345)
    }

    func testDerivesTheSizeFromTheGridWhenTheBytesAreNotHere() {
        let l = look("a", hash: "h1", lattice: 65)
        XCTAssertEqual(lookBytes(l, [:]), sixtyFive)
        XCTAssertEqual(sixtyFive, 40 + 65 * 65 * 65 * 6)
    }

    func testSaysNothingRatherThanGuessingWhenTheIndexRecordsNoGrid() {
        XCTAssertNil(lookBytes(look("a", hash: "h1"), [:]))
    }
}

final class LookWeightTests: XCTestCase {
    private let kept = pack("pk", sourceId: "winnow.example", looks: [look("a", hash: "h1", blob: "b1", lattice: 65)])

    func testIsMeasuredAndHereWhenTheVaultHoldsTheBytes() {
        XCTAssertEqual(lookWeight(kept, kept.looks[0], ["h1": sixtyFive]),
                       LookWeight(bytes: sixtyFive, measured: true, where: .here))
    }

    func testIsOnTheInstanceWhenABlobSaysThePushSentItThere() {
        XCTAssertEqual(lookWeight(kept, kept.looks[0], [:]),
                       LookWeight(bytes: sixtyFive, measured: false, where: .instance))
    }

    func testIsNowhereWhenThePackIsLocalOnlyAndTheBytesAreGone() {
        let local = pack("pk", looks: [look("a", hash: "h1", lattice: 65)])
        XCTAssertEqual(lookWeight(local, local.looks[0], [:]).where, .nowhere)
    }

    func testIsNowhereWhenALookWasNeverPushedEvenOnAKeptPack() {
        let half = pack("pk", sourceId: "winnow.example", looks: [look("a", hash: "h1", lattice: 65)])
        XCTAssertEqual(lookWeight(half, half.looks[0], [:]).where, .nowhere)
    }
}

final class LooksBytesTests: XCTestCase {
    func testWeighsABranchCountingASharedLatticeOnce() {
        let looks = [
            look("a", hash: "h1", lattice: 65),
            look("b", hash: "h1", lattice: 65),
            look("c", hash: "h2", lattice: 33),
        ]
        XCTAssertEqual(looksBytes(looks, ["h1": sixtyFive]), sixtyFive + thirtyThree)
    }

    func testAddsNothingForALookNothingCanWeigh() {
        XCTAssertEqual(looksBytes([look("a")], [:]), 0)
    }

    func testKeepsTwoHashlessLooksApartRatherThanFoldingThemTogether() {
        let looks = [look("a", lattice: 33), look("b", lattice: 33)]
        XCTAssertEqual(looksBytes(looks, [:]), thirtyThree * 2)
    }
}

final class PackWeightTests: XCTestCase {
    func testAddsUpWhatIsHereAndWhatTheInstanceHolds() {
        let p = pack("pk", sourceId: "winnow.example", looks: [
            look("a", hash: "h1", blob: "b1", lattice: 65),
            look("b", hash: "h2", blob: "b2", lattice: 33),
        ])
        XCTAssertEqual(packWeight(p, ["h1": sixtyFive]), Weight(
            here: sixtyFive, hereLooks: 1, instance: sixtyFive + thirtyThree, instanceLooks: 2, looks: 2, unweighed: 0
        ))
    }

    func testCountsALatticeTwoLooksShareExactlyOnceOnBothSides() {
        let p = pack("pk", sourceId: "winnow.example", looks: [
            look("a", hash: "h1", blob: "b1", lattice: 65),
            look("b", hash: "h1", blob: "b1", lattice: 65),
        ])
        let w = packWeight(p, ["h1": sixtyFive])
        XCTAssertEqual(w.here, sixtyFive)
        XCTAssertEqual(w.hereLooks, 1)
        XCTAssertEqual(w.instance, sixtyFive)
        XCTAssertEqual(w.looks, 2)
    }

    func testNothingIsOnAnInstanceWhileThePackIsKeptNowhere() {
        let p = pack("pk", looks: [look("a", hash: "h1", blob: "b1", lattice: 65)])
        XCTAssertEqual(packWeight(p, [:]).instance, 0)
    }

    func testCountsALookItCannotWeighRatherThanTreatingItAsEmpty() {
        let p = pack("pk", looks: [look("a", hash: "h1"), look("b")])
        let w = packWeight(p, [:])
        XCTAssertEqual(w.unweighed, 2)
        XCTAssertEqual(w.here, 0)
    }
}

final class VaultWeightTests: XCTestCase {
    func testIsNotTheSumOfThePacksWhenTwoOfThemShareALook() {
        let shared = look("a", hash: "h1", blob: "b1", lattice: 65)
        var other = shared
        other.id = "b"
        let one = pack("p1", looks: [shared])
        let two = pack("p2", looks: [other])
        let sizes: LatticeSizes = ["h1": sixtyFive]
        XCTAssertEqual(packWeight(one, sizes).here + packWeight(two, sizes).here, sixtyFive * 2)
        XCTAssertEqual(vaultWeight([one, two], sizes).here, sixtyFive)
    }
}

final class InstanceWeightsTests: XCTestCase {
    func testAnswersPerInstanceAndLeavesALocalOnlyPackOut() {
        let packs = [
            pack("p1", sourceId: "a.example", looks: [look("a", hash: "h1", blob: "b1", lattice: 65)]),
            pack("p2", sourceId: "b.example", looks: [look("b", hash: "h2", blob: "b2", lattice: 33)]),
            pack("p3", looks: [look("c", hash: "h3", blob: "b3", lattice: 65)]),
        ]
        let weights = instanceWeights(packs, [:])
        XCTAssertEqual(weights.map(\.sourceId), ["a.example", "b.example"])
        XCTAssertEqual(weights.map(\.bytes), [sixtyFive, thirtyThree])
    }
}

final class FreedHashesTests: XCTestCase {
    private func two() -> [LutPackIndex] {
        [
            pack("p1", looks: [look("a", hash: "h1"), look("b", hash: "h2"), look("c", hash: "h2")]),
            pack("p2", looks: [look("x", hash: "h1")]),
        ]
    }

    func testFreesAHashNothingElseNames() {
        let packs = [pack("p1", looks: [look("a", hash: "h1")])]
        XCTAssertEqual(freedHashes(packs, "p1", ["a"]), Freed(free: ["h1"], shared: []))
    }

    func testKeepsALatticeAnotherPackNamesTheRuleTheFeatureTurnsOn() {
        XCTAssertEqual(freedHashes(two(), "p1", ["a"]), Freed(free: [], shared: ["h1"]))
    }

    func testKeepsALatticeAnotherLookOfTheSamePackNames() {
        XCTAssertEqual(freedHashes(two(), "p1", ["b"]), Freed(free: [], shared: ["h2"]))
    }

    func testFreesItOnceBothLooksNamingItGo() {
        XCTAssertEqual(freedHashes(two(), "p1", ["b", "c"]), Freed(free: ["h2"], shared: []))
    }

    func testFreesEverythingTheWholePackAloneNames() {
        let freed = freedHashes(two(), "p1", ["a", "b", "c"])
        XCTAssertEqual(freed.free, ["h2"])
        XCTAssertEqual(freed.shared, ["h1"])
    }

    func testAnswersNothingForALookWithNoHashAtAll() {
        let packs = [pack("p1", looks: [look("a")])]
        XCTAssertEqual(freedHashes(packs, "p1", ["a"]), Freed(free: [], shared: []))
    }
}

final class FreedBlobsTests: XCTestCase {
    func testSpeaksInBlobsNeverInSourceHashes() {
        let packs = [pack("p1", sourceId: "a.example", looks: [look("a", hash: "h1", blob: "b1")])]
        XCTAssertEqual(freedBlobs(packs, "p1", ["a"], "a.example"), Freed(free: ["b1"], shared: []))
    }

    func testOnlyThePacksKeptOnThatInstanceHaveASayOverItsFiles() {
        let packs = [
            pack("p1", sourceId: "a.example", looks: [look("a", hash: "h1", blob: "b1")]),
            // Same lattice, kept somewhere else: another file store, so it
            // cannot hold this instance's copy alive.
            pack("p2", sourceId: "b.example", looks: [look("x", hash: "h1", blob: "b1")]),
        ]
        XCTAssertEqual(freedBlobs(packs, "p1", ["a"], "a.example"), Freed(free: ["b1"], shared: []))
        // Kept on the SAME instance, and the bytes stay.
        let together = packs.map { p -> LutPackIndex in
            var q = p
            q.sourceId = "a.example"
            return q
        }
        XCTAssertEqual(freedBlobs(together, "p1", ["a"], "a.example"), Freed(free: [], shared: ["b1"]))
    }

    func testAsksForNothingWhenTheLookWasNeverPushed() {
        let packs = [pack("p1", sourceId: "a.example", looks: [look("a", hash: "h1")])]
        XCTAssertEqual(freedBlobs(packs, "p1", ["a"], "a.example"), Freed(free: [], shared: []))
    }
}

final class WhatAForgetGivesBackTests: XCTestCase {
    func testWeighsTheFreedHashesOffTheMeasuredSizes() {
        let sizes: LatticeSizes = ["h1": sixtyFive, "h2": thirtyThree]
        XCTAssertEqual(hashBytes(["h1", "h2"], sizes), sixtyFive + thirtyThree)
        // A hash this device does not hold gives nothing back here.
        XCTAssertEqual(hashBytes(["h3"], sizes), 0)
    }

    func testWeighsTheFreedBlobsOffTheGridSizesTheIndexesRecord() {
        let packs = [pack("p1", sourceId: "a.example", looks: [
            look("a", hash: "h1", blob: "b1", lattice: 65),
            look("b", hash: "h2", blob: "b2"),
        ])]
        XCTAssertEqual(blobBytes(["b1"], packs), sixtyFive)
        // No grid recorded: nothing is invented for it.
        XCTAssertEqual(blobBytes(["b2"], packs), 0)
        XCTAssertEqual(blobBytes(["nope"], packs), 0)
    }
}

final class ForgottenTests: XCTestCase {
    func testReportsBothFiguresWhenBothGaveSomethingBack() {
        XCTAssertEqual(forgotten(ForgetResult(here: sixtyFive, instance: sixtyFive, keptOn: "winnow.example", shared: 0)),
                       "1.6 MB back here and 1.6 MB on winnow.example.")
    }

    func testNamesOnlyThisDeviceForALocalOnlyPack() {
        XCTAssertEqual(forgotten(ForgetResult(here: thirtyThree, instance: 0, keptOn: nil, shared: 0)), "211 KB back here.")
    }

    func testSaysWhyNothingCameBackRatherThanPrintingAZero() {
        XCTAssertEqual(forgotten(ForgetResult(here: 0, instance: 0, keptOn: nil, shared: 1)),
                       "no bytes came back: another look holds the same lattice.")
        XCTAssertEqual(forgotten(ForgetResult(here: 0, instance: 0, keptOn: nil, shared: 0)), "it held no bytes here.")
    }
}

final class LookWeightLabelTests: XCTestCase {
    func testSaysTheSizeAndAWordForBytesThatAreNotOnThisDevice() {
        XCTAssertEqual(lookWeightLabel(LookWeight(bytes: sixtyFive, measured: true, where: .here)), "1.6 MB")
        XCTAssertEqual(lookWeightLabel(LookWeight(bytes: sixtyFive, measured: false, where: .instance)), "1.6 MB there")
        XCTAssertEqual(lookWeightLabel(LookWeight(bytes: sixtyFive, measured: false, where: .nowhere)), "1.6 MB missing")
    }

    func testDrawsADashRatherThanAZeroWhenNothingCanWeighIt() {
        XCTAssertEqual(lookWeightLabel(LookWeight(bytes: nil, measured: false, where: .nowhere)), "—")
    }

    func testNamesTheInstanceInTheNoteAndNeverInventsOne() {
        let away = LookWeight(bytes: 1, measured: false, where: .instance)
        XCTAssertTrue(lookWeightNote(away, "winnow.example").contains("winnow.example"))
        XCTAssertTrue(lookWeightNote(away, nil).contains("the instance"))
        XCTAssertEqual(lookWeightNote(LookWeight(bytes: 1, measured: true, where: .here), nil), "In this browser’s vault.")
    }
}

final class FormatPackBytesTests: XCTestCase {
    func testReadsTheWayAnOSPrintsIt() {
        XCTAssertEqual(formatPackBytes(0), "0 KB")
        XCTAssertEqual(formatPackBytes(512), "512 B")
        XCTAssertEqual(formatPackBytes(1024), "1 KB")
        XCTAssertEqual(formatPackBytes(thirtyThree), "211 KB")
        XCTAssertEqual(formatPackBytes(sixtyFive), "1.6 MB")
        XCTAssertEqual(formatPackBytes(sixtyFive * 25), "39.3 MB")
        XCTAssertEqual(formatPackBytes(2 * 1_073_741_824), "2.00 GB")
    }

    func testNeverPrintsANegativeOrANaNWeight() {
        XCTAssertEqual(formatPackBytes(-1), "0 KB")
        XCTAssertEqual(formatPackBytes(Double.nan), "0 KB")
    }
}
