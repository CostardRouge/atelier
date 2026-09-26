// The part of `src/shared/lut/lut-pack.test.ts` that reaches what
// `LutPack.swift` ports so far: the reference round trip and
// `familyForLookName`, case for case. The web's «hiding» cases build their
// index with `buildPackIndex` (the lut-pack task's); they are ported here over
// a hand-built index with the same shape — the same node and look ids, the
// same counts — and are to be replaced by the verbatim port when the builder
// lands.

import XCTest
@testable import AtelierKit

final class PackRefTests: XCTestCase {
    func testRoundTripsAReferenceAndRefusesJunk() {
        let ref = PackRef(pack: "pk_1", look: "one-click/dji/d-log", hash: "ab12")
        XCTAssertEqual(readPackRef(writePackRef(ref)), ref)
        XCTAssertLessThan(writePackRef(ref).count, 200)
        XCTAssertNil(readPackRef(nil))
        XCTAssertNil(readPackRef("{\"size\":33}"))
        XCTAssertNil(readPackRef("not json"))
        // A reference written before hashes existed still names its look.
        XCTAssertEqual(readPackRef("{\"pack\":\"pk_1\",\"look\":\"a/b\"}"), PackRef(pack: "pk_1", look: "a/b", hash: ""))
    }

    /// Not in the web spec: the text is the browser's `JSON.stringify`, key
    /// order included, so a grade's key never depends on which client wrote it.
    func testWritesTheTextTheBrowserWrites() {
        XCTAssertEqual(writePackRef(PackRef(pack: "pk_1", look: "one-click/dji/d-log", hash: "ab12")),
                       "{\"pack\":\"pk_1\",\"look\":\"one-click/dji/d-log\",\"hash\":\"ab12\"}")
        XCTAssertNil(readPackRef("[\"pk_1\"]"))
        XCTAssertNil(readPackRef("{\"pack\":\"\",\"look\":\"a\"}"))
    }

    func testRecognisesAPackLayer() {
        XCTAssertTrue(isPackLayer(SavedLutLayer(id: "p", source: "pack", name: "x")))
        XCTAssertFalse(isPackLayer(SavedLutLayer(id: "f", source: "film", name: "x")))
        XCTAssertTrue(isPackLayer(LutLayer(id: "p", source: packSource, lut: CubeLut.identity())))
    }
}

final class FamilyForLookNameTests: XCTestCase {
    func testFamilyForLookNameReadsALookThatHasNoCategoryAboveIt() {
        // Built-ins, verbatim file names.
        XCTAssertEqual(familyForLookName("4_SGamut3CineSLog3_To_Cine+709.cube"), .log)
        XCTAssertEqual(familyForLookName("From_SLog2SGumut_To_LC-709TypeA_.cube"), .log)
        XCTAssertEqual(familyForLookName("Apple-Log-2-Rec709-low-ISO.cube"), .log)
        XCTAssertEqual(familyForLookName("BaseLUT - Apple iPhone - Apple Log to Rec709.cube"), .log)
        XCTAssertEqual(familyForLookName("dji_mini_4_pro_d-log_m-to-rec709.cube"), .log)
        XCTAssertEqual(familyForLookName("dji_mavic_4_pro_d-log_to-rec709_vivid_v1.cube"), .log)
        // The creative built-ins, which must NOT be read on a log frame.
        XCTAssertEqual(familyForLookName("sepia.cube"), .rec709)
        XCTAssertEqual(familyForLookName("filmic-contrast.cube"), .rec709)
        XCTAssertEqual(familyForLookName("black-and-white.cube"), .rec709)
        XCTAssertEqual(familyForLookName("neutral.cube"), .rec709)
        XCTAssertEqual(familyForLookName("warm.cube"), .rec709)
        XCTAssertEqual(familyForLookName("cool.cube"), .rec709)
        // An upload, named the way a person names one.
        XCTAssertEqual(familyForLookName("My Teal Grade.cube"), .rec709)
        XCTAssertEqual(familyForLookName("VLog_to_709.cube"), .log)
        XCTAssertEqual(familyForLookName("CONVERSION - N-Log.cube"), .log)
        XCTAssertEqual(familyForLookName("Sunset.cube"), .rec709)
    }

    /// Not in the web spec: the gallery reads the manifest's prettified NAME,
    /// not the file name — the two must agree.
    func testReadsAPrettifiedBuiltInNameAsItsFileName() {
        XCTAssertEqual(familyForLookName("Dji Mini 4 Pro D Log M To Rec709"), .log)
        XCTAssertEqual(familyForLookName("4 SGamut3CineSLog3 To Cine+709"), .log)
        XCTAssertEqual(familyForLookName("Filmic Contrast"), .rec709)
        XCTAssertEqual(familyForLookName("APPLE_APPLE LOG.cube"), .log)
    }
}

/// The web's `authentic()` cut to what hiding reads: two Canon conversions,
/// three Sony one-clicks, a Canon one-click and a creative look at a category.
private func authenticLike() -> LutPackIndex {
    func l(_ id: String, _ node: String) -> PackLook {
        PackLook(id: id, label: id, node: node, file: "\(id).cube", family: .log)
    }
    return LutPackIndex(
        id: "pk_test",
        name: "AUTHENTIC",
        author: "Victor Jimenes",
        tree: [
            PackNode(id: "conversion", label: "Conversion", children: [
                PackNode(id: "conversion/canon", label: "Canon"),
            ]),
            PackNode(id: "creative", label: "Creative"),
            PackNode(id: "one-click", label: "One Click", children: [
                PackNode(id: "one-click/canon", label: "Canon"),
                PackNode(id: "one-click/sony", label: "Sony"),
            ]),
        ],
        looks: [
            l("conversion/canon/c-log2", "conversion/canon"),
            l("conversion/canon/c-log3", "conversion/canon"),
            l("creative/authentic", "creative"),
            l("one-click/canon/c-log2", "one-click/canon"),
            l("one-click/sony/s-log2", "one-click/sony"),
            l("one-click/sony/s-log3", "one-click/sony"),
            l("one-click/sony/s-log3-s-gamut3", "one-click/sony"),
        ]
    )
}

final class PackHidingTests: XCTestCase {
    func testHidesAWholeNodeOrOneLookAndNeverLosesEither() {
        var index = authenticLike()
        index.hidden = ["conversion/canon", "one-click/sony/s-log2"]
        XCTAssertTrue(isHidden(index, lookIn(index, "conversion/canon/c-log2")!))
        XCTAssertTrue(isHidden(index, lookIn(index, "one-click/sony/s-log2")!))
        XCTAssertFalse(isHidden(index, lookIn(index, "one-click/canon/c-log2")!))
        XCTAssertEqual(index.looks.count, 7)
        XCTAssertEqual(visibleLooks(index).count, 4)
    }

    func testHidesACategoryAndEverythingUnderIt() {
        var index = authenticLike()
        index.hidden = ["one-click"]
        XCTAssertFalse(visibleLooks(index).contains { $0.node.hasPrefix("one-click") })
        XCTAssertEqual(looksUnder(index, "conversion").count, 2)
    }

    func testANodeIdIsNotAPrefixOfItsSiblingsName() {
        // `one-click/can` must not hide `one-click/canon`: the prefix is a PATH.
        var index = authenticLike()
        index.hidden = ["one-click/can"]
        XCTAssertEqual(visibleLooks(index).count, 7)
        XCTAssertNil(lookIn(index, "nope"))
    }

    func testFlattensTheTreeDepthFirstWithEachNodesDepth() {
        let flat = flattenNodes(authenticLike().tree)
        XCTAssertEqual(flat.map(\.node.id), [
            "conversion", "conversion/canon", "creative", "one-click", "one-click/canon", "one-click/sony",
        ])
        XCTAssertEqual(flat.map(\.depth), [0, 1, 0, 0, 1, 1])
    }
}
