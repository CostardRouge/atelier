// Port of `src/shared/lut/lut-pack.test.ts`, case for case, over
// `LutPack.swift` and `LutPackIndex.swift` — the «hiding» cases now on the
// verbatim `buildPackIndex` output of the pack the plan is written against, as
// on the web. The cases marked "Not in the web spec" pin what a port could
// drift on: the reference's exact text, a stored index read back, the order a
// folder's files are sorted in.

import XCTest
@testable import AtelierKit

/// The pack the plan is written against, file for file (`docs/lut-packs.md`
/// §2): three categories, one of them with no camera level, brands written two
/// different ways, and four files that are not looks at all.
private let authenticFiles: [PackFileEntry] = [
    PackFileEntry(path: "Conversion LUTs/Apple/APPLE_APPLE LOG.cube"),
    PackFileEntry(path: "Conversion LUTs/Canon/CANON_CLOG2.cube"),
    PackFileEntry(path: "Conversion LUTs/Canon/CANON_CLOG3.cube"),
    PackFileEntry(path: "Conversion LUTs/DJI/DJI_DLOG.cube"),
    PackFileEntry(path: "Conversion LUTs/Nikon/NIKON_NLOG.cube"),
    PackFileEntry(path: "Conversion LUTs/Panasonic/PANASONIC_VLOG.cube"),
    PackFileEntry(path: "Conversion LUTs/Sony/Sony_SLOG2_SGAMMUT.cube"),
    PackFileEntry(path: "Conversion LUTs/Sony/Sony_SLOG3_SGAMMUT3.CINE.cube"),
    PackFileEntry(path: "Creative LUT/AUTHENTIC_LUT.cube"),
    PackFileEntry(path: "One Click LUT/APPLE/AUTHENTIC_LUT_Apple_LOG.cube"),
    PackFileEntry(path: "One Click LUT/BLACKMAGIC/AUTHENTIC_LUT_FILM_GEN_5.cube"),
    PackFileEntry(path: "One Click LUT/CANON/AUTHENTIC_LUT_C-LOG.cube"),
    PackFileEntry(path: "One Click LUT/CANON/AUTHENTIC_LUT_C-LOG2.cube"),
    PackFileEntry(path: "One Click LUT/CANON/AUTHENTIC_LUT_C-LOG3.cube"),
    PackFileEntry(path: "One Click LUT/DJI/AUTHENTIC_LUT_D-LOG.cube"),
    PackFileEntry(path: "One Click LUT/FUJIFILM/AUTHENTIC_LUT_F-LOG.cube"),
    PackFileEntry(path: "One Click LUT/FUJIFILM/AUTHENTIC_LUT_F-LOG2.cube"),
    PackFileEntry(path: "One Click LUT/INSTA360/AUTHENTIC_LUT_I-LOG(CHAUD).cube"),
    PackFileEntry(path: "One Click LUT/INSTA360/AUTHENTIC_LUT_I-LOG(FROID).cube"),
    PackFileEntry(path: "One Click LUT/NIKON/AUTHENTIC_LUT_N-LOG.cube"),
    PackFileEntry(path: "One Click LUT/PANASONIC/AUTHENTIC_LUT_V-LOG.cube"),
    PackFileEntry(path: "One Click LUT/SAMSUNG/AUTHENTIC_LUT_Samsung_LOG.cube"),
    PackFileEntry(path: "One Click LUT/SONY/AUTHENTIC_LUT_S-LOG2.cube"),
    PackFileEntry(path: "One Click LUT/SONY/AUTHENTIC_LUT_S-LOG3_S-GAMUT3.CINE.cube"),
    PackFileEntry(path: "One Click LUT/SONY/AUTHENTIC_LUT_S-LOG3_S-GAMUT3.cube"),
    PackFileEntry(path: "Overlays/Vision 200T.mp4"),
    PackFileEntry(path: "Overlays/Vision 500T.mp4"),
    PackFileEntry(path: "tutorial.mp4"),
    PackFileEntry(path: ".DS_Store"),
]

private func authentic() -> LutPackIndex {
    buildPackIndex(authenticFiles, BuildPackOptions(
        id: "pk_test",
        name: "AUTHENTIC",
        author: "Victor Jimenes",
        url: "https://victorjim.gumroad.com/l/authentic_lut"
    ))
}

private func withHidden(_ index: LutPackIndex, _ hidden: [String]) -> LutPackIndex {
    var next = index
    next.hidden = hidden
    return next
}

final class BuildPackIndexTests: XCTestCase {
    func testKeepsTheLooksAndLeavesEverythingElseOut() {
        let index = authentic()
        XCTAssertEqual(index.looks.count, 25)
        XCTAssertFalse(index.looks.contains { $0.file.hasSuffix(".mp4") })
    }

    func testReadsThreeCategoriesAndACameraLevelOnlyWhereThereIsOne() {
        let index = authentic()
        XCTAssertEqual(index.tree.map(\.label), ["Conversion", "Creative", "One Click"])
        let conversion = index.tree[0]
        XCTAssertEqual(conversion.children?.map(\.label), ["Apple", "Canon", "DJI", "Nikon", "Panasonic", "Sony"])
        // Creative holds one look and no camera folder: no children at all.
        XCTAssertNil(index.tree[1].children)
        XCTAssertEqual(index.looks.first { $0.node == "creative" }?.label, "AUTHENTIC")
    }

    func testWritesOneBrandPerCameraHoweverTheFoldersSpellIt() {
        let labels = flattenNodes(authentic().tree).map(\.node.label)
        // `Apple` and `APPLE`, `Sony` and `SONY` are the same camera in two
        // categories — and each category has its own node, so two each.
        XCTAssertEqual(labels.filter { $0 == "Apple" }.count, 2)
        XCTAssertEqual(labels.filter { $0 == "Sony" }.count, 2)
        XCTAssertFalse(labels.contains("APPLE"))
        XCTAssertFalse(labels.contains("Insta360x"))
        XCTAssertTrue(labels.contains("Insta360"))
        XCTAssertTrue(labels.contains("Fujifilm"))
        XCTAssertTrue(labels.contains("Blackmagic"))
    }

    func testNamesALookTheWayItsMakerWritesTheFormatWithoutThePackOrTheCamera() {
        let index = authentic()
        func labelOf(_ file: String) -> String? { index.looks.first { $0.file == file }?.label }

        XCTAssertEqual(labelOf("One Click LUT/SONY/AUTHENTIC_LUT_S-LOG3_S-GAMUT3.CINE.cube"), "S-Log3 S-Gamut3.Cine")
        XCTAssertEqual(labelOf("One Click LUT/SONY/AUTHENTIC_LUT_S-LOG2.cube"), "S-Log2")
        XCTAssertEqual(labelOf("Conversion LUTs/Canon/CANON_CLOG3.cube"), "C-Log3")
        XCTAssertEqual(labelOf("Conversion LUTs/Apple/APPLE_APPLE LOG.cube"), "Apple Log")
        XCTAssertEqual(labelOf("One Click LUT/BLACKMAGIC/AUTHENTIC_LUT_FILM_GEN_5.cube"), "Film Gen 5")
        // A parenthesised remark becomes a suffix, in English.
        XCTAssertEqual(labelOf("One Click LUT/INSTA360/AUTHENTIC_LUT_I-LOG(CHAUD).cube"), "I-Log · warm")
        XCTAssertEqual(labelOf("One Click LUT/INSTA360/AUTHENTIC_LUT_I-LOG(FROID).cube"), "I-Log · cold")
        // The camera the file repeats from its folder goes — unless dropping it
        // leaves a word that says nothing, because `Apple Log` IS the format.
        XCTAssertEqual(labelOf("One Click LUT/APPLE/AUTHENTIC_LUT_Apple_LOG.cube"), "Apple Log")
        XCTAssertEqual(labelOf("One Click LUT/SAMSUNG/AUTHENTIC_LUT_Samsung_LOG.cube"), "Samsung Log")
    }

    func testGivesEveryLookAStablePathShapedIdAndKeepsThemDistinct() {
        let ids = authentic().looks.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
        XCTAssertTrue(ids.contains("one-click/dji/d-log"))
        XCTAssertTrue(ids.contains("conversion/sony/s-log3-s-gamut3-cine"))
        // Building the same folder twice gives the same ids — a re-import has
        // to land on the references documents already hold.
        XCTAssertEqual(authentic().looks.map(\.id), ids)
    }

    func testNumbersACollisionRatherThanLosingALook() {
        let index = buildPackIndex(
            [PackFileEntry(path: "Creative/Sunset.cube"), PackFileEntry(path: "Creative/SUNSET.cube")],
            BuildPackOptions(id: "pk", name: "Pack")
        )
        XCTAssertEqual(index.looks.map(\.id), ["creative/sunset", "creative/sunset-2"])
    }

    func testMarksConversionAndOneClickLooksAsLogCreativeOnesAsRec709() {
        let index = authentic()
        XCTAssertEqual(lookIn(index, "conversion/dji/d-log")?.family, .log)
        XCTAssertEqual(lookIn(index, "one-click/sony/s-log2")?.family, .log)
        XCTAssertEqual(index.looks.first { $0.node == "creative" }?.family, .rec709)
    }

    func testCautionsThatThePacksDJILooksAreDLogNotDLogM() {
        let index = authentic()
        let dji = index.tree[0].children?.first { $0.label == "DJI" }
        XCTAssertTrue(dji?.hint?.contains("not D-Log M") ?? false)
        // Nothing is hidden or renamed over it — the looks are all still there.
        XCTAssertEqual(looksUnder(index, "conversion/dji").count, 1)
        XCTAssertNil(index.tree[0].children?.first { $0.label == "Sony" }?.hint)
    }

    func testFlattensAFolderDeeperThanACameraIntoThatCamerasLabel() {
        let index = buildPackIndex([PackFileEntry(path: "Conversion/Sony/A7SIII/SLOG3.cube")],
                                   BuildPackOptions(id: "pk", name: "Pack"))
        XCTAssertEqual(index.looks[0].node, "conversion/sony-a7siii")
        XCTAssertEqual(nodeLabelPath(index.tree, index.looks[0].node), ["Conversion", "Sony · A7SIII"])
    }

    func testTakesALookSittingAtThePacksRoot() {
        let index = buildPackIndex([PackFileEntry(path: "Golden Hour.cube")], BuildPackOptions(id: "pk", name: "Pack"))
        XCTAssertEqual(index.looks[0].node, "")
        XCTAssertEqual(index.looks[0].id, "golden-hour")
        XCTAssertEqual(index.looks[0].family, .rec709)
    }

    func testCarriesWhatTheImporterMeasured() {
        let index = buildPackIndex(
            [PackFileEntry(path: "Creative/Look.cube", bytes: 7_414_899, lattice: 65, hash: "abc")],
            BuildPackOptions(id: "pk", name: "Pack")
        )
        XCTAssertEqual(index.looks[0].bytes, 7_414_899)
        XCTAssertEqual(index.looks[0].lattice, 65)
        XCTAssertEqual(index.looks[0].hash, "abc")
    }

    /// Not in the web spec: the rest of what `buildPackIndex` writes — the
    /// credits, the name trimmed, an empty url left out, the file kept verbatim.
    func testWritesTheCreditsAndKeepsTheFileVerbatim() {
        let index = authentic()
        XCTAssertEqual(index.id, "pk_test")
        XCTAssertEqual(index.name, "AUTHENTIC")
        XCTAssertEqual(index.author, "Victor Jimenes")
        XCTAssertEqual(index.url, "https://victorjim.gumroad.com/l/authentic_lut")
        XCTAssertEqual(index.hidden, [])
        XCTAssertEqual(lookIn(index, "one-click/dji/d-log")?.file, "One Click LUT/DJI/AUTHENTIC_LUT_D-LOG.cube")
        let bare = buildPackIndex([], BuildPackOptions(id: "pk", name: "  Pack  ", author: " ", url: ""))
        XCTAssertEqual(bare.name, "Pack")
        XCTAssertEqual(bare.author, "")
        XCTAssertNil(bare.url)
        XCTAssertTrue(bare.tree.isEmpty)
    }
}

final class PackHidingTests: XCTestCase {
    func testHidesAWholeNodeOrOneLookAndNeverLosesEither() {
        let index = withHidden(authentic(), ["conversion/canon", "one-click/sony/s-log2"])
        XCTAssertTrue(isHidden(index, lookIn(index, "conversion/canon/c-log2")!))
        XCTAssertTrue(isHidden(index, lookIn(index, "one-click/sony/s-log2")!))
        XCTAssertFalse(isHidden(index, lookIn(index, "one-click/canon/c-log2")!))
        XCTAssertEqual(index.looks.count, 25)
        XCTAssertEqual(visibleLooks(index).count, 22)
    }

    func testHidesACategoryAndEverythingUnderIt() {
        let index = withHidden(authentic(), ["one-click"])
        XCTAssertFalse(visibleLooks(index).contains { $0.node.hasPrefix("one-click") })
        XCTAssertEqual(looksUnder(index, "conversion").count, 8)
    }

    /// Not in the web spec: `one-click/can` must not hide `one-click/canon` —
    /// the prefix is a PATH.
    func testANodeIdIsNotAPrefixOfItsSiblingsName() {
        let index = withHidden(authentic(), ["one-click/can"])
        XCTAssertEqual(visibleLooks(index).count, 25)
        XCTAssertNil(lookIn(index, "nope"))
    }

    /// Not in the web spec: the rail's depth-first walk, with each node's depth.
    func testFlattensTheTreeDepthFirstWithEachNodesDepth() {
        let flat = flattenNodes(authentic().tree)
        XCTAssertEqual(Array(flat.map(\.node.id).prefix(8)), [
            "conversion", "conversion/apple", "conversion/canon", "conversion/dji",
            "conversion/nikon", "conversion/panasonic", "conversion/sony", "creative",
        ])
        XCTAssertEqual(Array(flat.map(\.depth).prefix(9)), [0, 1, 1, 1, 1, 1, 1, 0, 0])
        XCTAssertEqual(flat.count, 19)
    }
}

final class WithoutLooksTests: XCTestCase {
    func testDropsTheLookAndLeavesTheRestOfThePackAlone() {
        let next = withoutLooks(authentic(), ["one-click/dji/d-log"])
        XCTAssertEqual(next.looks.count, 24)
        XCTAssertNil(lookIn(next, "one-click/dji/d-log"))
        XCTAssertNotNil(lookIn(next, "conversion/dji/d-log"))
    }

    func testPrunesACategoryLeftHoldingNothing() {
        let index = authentic()
        let creative = index.looks.filter { $0.node == "creative" }.map(\.id)
        XCTAssertEqual(creative.count, 1)
        let next = withoutLooks(index, creative)
        XCTAssertEqual(next.tree.map(\.label), ["Conversion", "One Click"])
    }

    func testKeepsANodeWhoseChildStillHasLooks() {
        let index = authentic()
        // Every DJI look under One Click goes; the category keeps its other cameras.
        let dji = index.looks.filter { $0.node == "one-click/dji" }.map(\.id)
        let next = withoutLooks(index, dji)
        let oneClick = next.tree.first { $0.id == "one-click" }
        XCTAssertNotNil(oneClick)
        XCTAssertFalse(oneClick?.children?.map(\.id).contains("one-click/dji") ?? true)
        XCTAssertGreaterThan(oneClick?.children?.count ?? 0, 0)
    }

    func testDropsAHiddenEntryThatNoLongerNamesAnything() {
        let index = withHidden(authentic(), ["creative", "one-click/sony/s-log2"])
        let creative = index.looks.filter { $0.node == "creative" }.map(\.id)
        let next = withoutLooks(index, creative + ["one-click/sony/s-log2"])
        XCTAssertEqual(next.hidden, [])
    }

    func testKeepsTheHiddenEntriesThatStillDo() {
        let index = withHidden(authentic(), ["conversion/canon"])
        let next = withoutLooks(index, ["creative/authentic"])
        XCTAssertEqual(next.hidden, ["conversion/canon"])
    }

    func testIsPureTheIndexItWasGivenIsUntouched() {
        let index = authentic()
        _ = withoutLooks(index, index.looks.map(\.id))
        XCTAssertEqual(index.looks.count, 25)
        XCTAssertEqual(index.tree.count, 3)
    }

    func testEmptiesAPackAskedForAllOfItsLooks() {
        let index = authentic()
        let next = withoutLooks(index, index.looks.map(\.id))
        XCTAssertEqual(next.looks, [])
        XCTAssertEqual(next.tree, [])
    }
}

final class FlattenPackTests: XCTestCase {
    private func isLook(_ e: PackEntry) -> Bool {
        if case .look = e { return true }
        return false
    }

    func testListsEveryNodeAndEveryLookEachUnderItsOwnNode() {
        let index = authentic()
        let rows = flattenPack(index)
        XCTAssertEqual(rows.filter(isLook).count, 25)
        XCTAssertEqual(rows.filter { !isLook($0) }.count, flattenNodes(index.tree).count)
        // A camera's look sits one level under the camera, which sits under
        // its category: what the sheet indents by.
        let dji = rows.firstIndex { row in
            if case let .node(node, _) = row { return node.id == "one-click/dji" }
            return false
        }!
        guard case let .look(look, depth) = rows[dji + 1] else { return XCTFail("a look under the camera") }
        XCTAssertEqual(depth, 2)
        XCTAssertEqual(look.id, "one-click/dji/d-log")
    }

    func testPutsTheLooksAtThePackRootFirstAnUploadsPackHasNoTreeAtAll() {
        let uploads = buildPackIndex([PackFileEntry(path: "My Teal Grade.cube")], BuildPackOptions(id: "pk_uploads"))
        XCTAssertEqual(uploads.tree.count, 0)
        XCTAssertEqual(flattenPack(uploads), [.look(uploads.looks[0], depth: 0)])
    }

    func testKeepsAHiddenLookBecauseForgettingOneIsADifferentGesture() {
        let index = withHidden(authentic(), ["one-click"])
        XCTAssertEqual(flattenPack(index).filter(isLook).count, 25)
    }

    func testStillReachesALookWhoseNodeIsNotInTheTree() {
        var index = authentic()
        var orphan = index.looks[0]
        orphan.id = "orphan"
        orphan.node = "gone/missing"
        index.looks.append(orphan)
        let rows = flattenPack(index).filter { row in
            if case let .look(look, _) = row { return look.id == "orphan" }
            return false
        }
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.depth, 0)
    }
}

final class PackLabelsAndRefsTests: XCTestCase {
    func testNamesALookForAStackPackAndNodeIncluded() {
        let index = authentic()
        XCTAssertEqual(lookLabel(index, lookIn(index, "one-click/dji/d-log")!), "AUTHENTIC · One Click · DJI · D-Log")
    }

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

    /// Not in the web spec: a pack with no name is named by its author.
    func testNamesALookByItsAuthorWhenThePackHasNoName() {
        var index = authentic()
        index.name = ""
        XCTAssertEqual(lookLabel(index, lookIn(index, "creative/authentic")!), "Victor Jimenes · Creative · AUTHENTIC")
        XCTAssertEqual(nodeLabelPath(index.tree, ""), [])
        XCTAssertEqual(nodeLabelPath(index.tree, "conversion/nope"), ["Conversion"])
    }

    func testRecognisesAPackLayer() {
        XCTAssertTrue(isPackLayer(SavedLutLayer(id: "p", source: "pack", name: "x")))
        XCTAssertFalse(isPackLayer(SavedLutLayer(id: "f", source: "film", name: "x")))
        XCTAssertTrue(isPackLayer(LutLayer(id: "p", source: packSource, lut: CubeLut.identity())))
    }
}

final class PackNameHelperTests: XCTestCase {
    func testPrettyNameDropsFillerAndThePacksOwnName() {
        XCTAssertEqual(prettyName("AUTHENTIC_LUT_D-LOG.cube", ["authentic"]), "D-Log")
        XCTAssertEqual(prettyName("One Click LUT"), "One Click")
        XCTAssertEqual(prettyName("Conversion LUTs"), "Conversion")
    }

    func testStripNodePrefixDropsTheFoldersCameraNeverTheMeaning() {
        XCTAssertEqual(stripNodePrefix("Sony S-Log3 S-Gamut3.Cine", "Sony"), "S-Log3 S-Gamut3.Cine")
        XCTAssertEqual(stripNodePrefix("Apple Log", "Apple"), "Apple Log")
        XCTAssertEqual(stripNodePrefix("C-Log3", "Canon"), "C-Log3")
        XCTAssertEqual(stripNodePrefix("Sony", "Sony"), "Sony")
        XCTAssertEqual(stripNodePrefix("Travel", nil), "Travel")
    }

    func testPrettyNameNeverAnswersWithNothing() {
        XCTAssertEqual(prettyName("LUT.cube"), "LUT")
        XCTAssertEqual(prettyName("  "), "  ")
    }

    func testSlugFoldsPunctuationAndAccents() {
        XCTAssertEqual(packSlug("S-LOG3_S-GAMUT3.CINE.cube"), "s-log3-s-gamut3-cine")
        XCTAssertEqual(packSlug("Été (chaud)"), "ete-chaud")
        XCTAssertEqual(packSlug("///"), "x")
    }

    func testFamilyForReadsTheCategory() {
        XCTAssertEqual(familyFor("Conversion LUTs"), .log)
        XCTAssertEqual(familyFor("One Click LUT"), .log)
        XCTAssertEqual(familyFor("Creative LUT"), .rec709)
        XCTAssertEqual(familyFor("Moody"), .rec709)
    }

    /// The repo's own 28 built-ins and the kind of thing an upload is called.
    /// A wrong answer costs a thumbnail on the wrong reference, so the cases
    /// that matter are the conversions whose log format is buried in a run.
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

    /// Not in the web spec: the terms that carry a group, the words left alone,
    /// and a remark with nothing in front of it.
    func testSpellsEveryTermItsMakersWay() {
        XCTAssertEqual(prettyName("CLOG2"), "C-Log2")
        XCTAssertEqual(prettyName("gen6"), "Gen 6")
        XCTAssertEqual(prettyName("LC709TypeA"), "LC-709")
        XCTAssertEqual(prettyName("rec709_hdr"), "Rec.709 HDR")
        XCTAssertEqual(prettyName("DLOGM"), "D-Log M")
        XCTAssertEqual(prettyName("A7SIII"), "A7SIII")
        XCTAssertEqual(prettyName("gopro_protune"), "GoPro Protune")
        XCTAssertEqual(prettyName("look_v2.cube"), "Look")
        XCTAssertEqual(prettyName("(froid).cube"), "cold")
        XCTAssertEqual(prettyName("Teal (a) b.cube"), "Teal (a) B")
    }
}

final class MigratePackIndexTests: XCTestCase {
    /// Not in the web spec: what is written reads back as the value it was —
    /// the vault stores through this, and a `lutpack` document travels in it.
    func testReadsBackWhatItWrote() {
        var index = authentic()
        index.hidden = ["one-click/sony"]
        index.sourceId = "winnow.example"
        index.looks[0].thumb = "data:image/webp;base64,AAAA"
        index.looks[0].blob = "b1"
        index.looks[0].lattice = 65
        let text = index.json.serialized()
        XCTAssertEqual(migratePackIndex(JSONValue.parse(text)), index)
        // Absent is left out, as `JSON.stringify` leaves out an undefined.
        XCTAssertNil(index.looks[1].json.objectValue?["thumb"])
        XCTAssertNil(index.tree[1].json.objectValue?["children"])
    }

    /// Not in the web spec: a stored index is untrusted input.
    func testRefusesJunkAndLeavesBadLooksBehind() {
        XCTAssertNil(migratePackIndex(nil))
        XCTAssertNil(migratePackIndex(["id": "pk"]))
        XCTAssertNil(migratePackIndex(["id": "", "looks": []]))
        XCTAssertNil(migratePackIndex([["id": "pk", "looks": []]]))
        let raw: JSONValue = [
            "id": "pk",
            "looks": [
                ["id": "a", "file": "a.cube", "family": "log", "lattice": 0, "bytes": 12, "thumb": "javascript:x"],
                ["id": "", "file": "b.cube"],
                ["id": "c"],
                "junk",
                ["id": "d", "file": "d.cube", "label": "", "hash": "", "thumb": "data:image/png;base64,x"],
            ],
            "tree": [["id": "n", "children": [["id": "n/m", "hint": ""], ["label": "no id"]]], ["id": ""]],
            "hidden": ["n", 3, nil],
            "url": "",
            "sourceId": "",
        ]
        let index = migratePackIndex(raw)!
        XCTAssertEqual(index.name, "")
        XCTAssertEqual(index.author, "")
        XCTAssertNil(index.url)
        XCTAssertNil(index.sourceId)
        XCTAssertEqual(index.looks.map(\.id), ["a", "d"])
        XCTAssertEqual(index.looks[0].family, .log)
        XCTAssertEqual(index.looks[0].label, "a")
        XCTAssertNil(index.looks[0].lattice)
        XCTAssertEqual(index.looks[0].bytes, 12)
        XCTAssertNil(index.looks[0].thumb)
        XCTAssertEqual(index.looks[1].label, "d")
        XCTAssertEqual(index.looks[1].family, .rec709)
        XCTAssertNil(index.looks[1].hash)
        XCTAssertEqual(index.looks[1].thumb, "data:image/png;base64,x")
        XCTAssertEqual(index.tree, [PackNode(id: "n", label: "n", children: [PackNode(id: "n/m", label: "n/m")])])
        XCTAssertEqual(index.hidden, ["n"])
    }
}

final class PackLocaleCompareTests: XCTestCase {
    /// Not in the web spec: the order Node's `localeCompare` (ICU) gives, taken
    /// from Node itself — punctuation before digits before letters and never
    /// ignored, accents before case, lowercase first.
    func testSortsAsNodesLocaleCompareDoes() {
        let node = [
            "_z.cube", "1.cube", "a b.cube", "A z.cube", "a_b.cube", "a-b.cube", "A/z.cube", "ab.cube", "aB.cube",
            "Ab.cube", "b.cube", "B.cube", "ete.cube", "Ete.cube", "Été.cube", "x.cube", "x(1).cube", "x10.cube",
            "x9.cube", "Z.cube",
        ]
        XCTAssertEqual(node.reversed().sorted { packLocaleCompare($0, $1) < 0 }, node)
        let paths = [
            "a b/x.cube", "a_b/x.cube", "a-b/x.cube", "a/_1.cube", "a/(1).cube", "a/1.cube", "A/y.cube", "a/z.cube",
            "a/Z.cube", "ete/a.cube", "Été/b.cube", "Ete/c.cube",
        ]
        XCTAssertEqual(paths.shuffled().sorted { packLocaleCompare($0, $1) < 0 }, paths)
        let names = ["alpha", "Arc", "Ärger", "AUTHENTIC", "mid", "Mid", "My looks", "Zeta"]
        XCTAssertEqual(names.reversed().sorted { packLocaleCompare($0, $1) < 0 }, names)
        XCTAssertEqual(packLocaleCompare("same", "same"), 0)
        XCTAssertLessThan(packLocaleCompare("", "a"), 0)
    }

    /// Not in the web spec: the listing of the plan's own pack is already in
    /// `localeCompare` order (checked in Node), and stays so.
    func testKeepsThePlansOwnPackInItsOrder() {
        let paths = authenticFiles.map(\.path).filter { $0.hasSuffix(".cube") }
        XCTAssertEqual(paths.reversed().sorted { packLocaleCompare($0, $1) < 0 }, paths)
    }
}
