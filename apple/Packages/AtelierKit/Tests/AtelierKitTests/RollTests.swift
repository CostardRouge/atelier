// Port of `src/shared/develop/roll-types.test.ts` and `roll-file.test.ts` — the
// half of them the kernel carries (the batch verbs `copyGradeTo`, `copyCropTo`,
// `copyBorderTo` and the wire adapter are the next commit's).

import XCTest
@testable import AtelierKit

private func ref(_ name: String, size: Int = 100, assetId: String? = nil, hash: String? = nil) -> SavedMediaRef {
    SavedMediaRef(name: name, size: size, lastModified: 1, assetId: assetId, hash: hash)
}

private func refJSON(_ name: String, hash: String? = nil, extra: [String: JSONValue] = [:]) -> JSONValue {
    var o: [String: JSONValue] = ["name": .string(name), "size": 100, "lastModified": 1]
    if let hash { o["hash"] = .string(hash) }
    for (k, v) in extra { o[k] = v }
    return .object(o)
}

private func roll(_ names: [String]) -> RollDoc {
    var n = 0
    return addPictures(createRollDoc(name: "Iceland — day 3", sourceId: "local", now: 1000, id: "r1"), names.map { ref($0) }, now: 2000) {
        n += 1
        return "p\(n)"
    }
}

/// The roll `roll-file.test.ts` writes and reads back.
private func sample() -> RollDoc {
    var doc = createRollDoc(name: "Islande — jour 3", sourceId: "winnow.example", now: 1000, id: "r1")
    doc = addPictures(doc, [SavedMediaRef(name: "a.dng", size: 5, lastModified: 1, assetId: "winnow.example/7", hash: "h1")], now: 2000) { "p1" }
    doc = patchPicture(doc, "p1", now: 3000) { p in
        p.develop = dev { $0.highlights = -40 }
        p.aspect = "4:5"
        p.grade = RollGrade(
            layers: [SavedLutLayer(id: "l1", source: "custom", name: "Mine", customText: "LUT_3D_SIZE 2", intensity: 0.6, enabled: true)],
            output: .rec709ToSrgb,
            film: ["grain": 0.35, "halation": 0.2]
        )
    }
    doc.export = RollExport(
        targets: [
            ExportTarget(name: "", size: ExportSize(mode: .long, value: 2048), quality: 0.85, sharpen: .off, watermark: false),
            ExportTarget(name: "Web", size: ExportSize(mode: .short, value: 1080), quality: 0.8, sharpen: .standard, watermark: true),
        ],
        replace: true, hdr: true, hdrStops: 3,
        metadata: ["position": false],
        watermark: ["text": "© {creator}", "position": "bottom-left", "size": 3, "opacity": 0.5, "tone": "dark"]
    )
    return doc
}

final class RollDocTests: XCTestCase {
    func testCreateRollDocStartsEmptyOnItsSourceWithTheDefaultExport() {
        let doc = createRollDoc(name: "  Sony tests ", sourceId: "winnow.example", now: 5, id: "r9")
        XCTAssertEqual(doc, RollDoc(id: "r9", version: rollDocVersion, name: "Sony tests", sourceId: "winnow.example",
                                    createdAt: 5, updatedAt: 5, pictures: [], export: .default))
    }

    func testAddPicturesAppendsEachPictureOnceInOrderAsShotAndUncropped() {
        let doc = roll(["a.jpg", "b.jpg"])
        XCTAssertEqual(doc.pictures.map(\.id), ["p1", "p2"])
        XCTAssertEqual(doc.pictures.map(\.ref.name), ["a.jpg", "b.jpg"])
        XCTAssertTrue(doc.pictures.allSatisfy { $0.develop == nil && $0.framing == nil && $0.aspect == "original" })
        XCTAssertEqual(doc.updatedAt, 2000)
    }

    func testAddPicturesNeverAddsAPictureAlreadyOnTheRollHoweverItIsNamed() {
        var n = 0
        let ids = { () -> String in n += 1; return "p\(n)" }
        let doc = addPictures(createRollDoc(name: "x", sourceId: "local", now: 0, id: "r"),
                              [ref("A.JPG", hash: "h1"), ref("renamed.jpg", hash: "h1"), ref("a.jpg", hash: "h1")], now: 1, makeId: ids)
        XCTAssertEqual(doc.pictures.count, 1)
        XCTAssertEqual(addPictures(doc, [ref("a.jpg", hash: "h1")], now: 2, makeId: ids), doc)
    }

    func testSameMediaRefTellsPicturesApartBySourceIdFirstThenByContentThenByNameAndSize() {
        XCTAssertTrue(sameMediaRef(ref("a", assetId: "w/1"), ref("b", assetId: "w/1")))
        XCTAssertFalse(sameMediaRef(ref("a", assetId: "w/1"), ref("a", assetId: "w/2")))
        XCTAssertTrue(sameMediaRef(ref("a", hash: "h"), ref("b", hash: "h")))
        XCTAssertTrue(sameMediaRef(ref("IMG.JPG"), ref("img.jpg")))
        XCTAssertFalse(sameMediaRef(ref("img.jpg"), ref("img.jpg", size: 101)))
    }

    func testMovesOnePictureClampingTheTarget() {
        let doc = roll(["a", "b", "c"])
        XCTAssertEqual(movePicture(doc, from: 0, to: 2, now: 3).pictures.map(\.ref.name), ["b", "c", "a"])
        XCTAssertEqual(movePicture(doc, from: 2, to: -5, now: 3).pictures.map(\.ref.name), ["c", "a", "b"])
        XCTAssertEqual(movePicture(doc, from: 1, to: 1, now: 3), doc)
        XCTAssertEqual(movePicture(doc, from: 9, to: 0, now: 3), doc)
    }

    func testRemovesPicturesByIdAndHandsBackTheSameRollWhenNoneMatch() {
        let doc = roll(["a", "b", "c"])
        XCTAssertEqual(removePictures(doc, ["p1", "p3"], now: 3).pictures.map(\.id), ["p2"])
        XCTAssertEqual(removePictures(doc, ["nope"], now: 3), doc)
    }

    func testPatchesOnePictureAndNeverItsIdOrRef() {
        let doc = roll(["a", "b"])
        let lifted = dev { $0.exposure = 0.5 }
        let next = patchPicture(doc, "p2", now: 9) { $0.develop = lifted; $0.aspect = "4:5" }
        XCTAssertEqual(next.pictures[1].id, "p2")
        XCTAssertEqual(next.pictures[1].ref.name, "b")
        XCTAssertEqual(next.pictures[1].develop, lifted)
        XCTAssertEqual(next.pictures[1].aspect, "4:5")
        XCTAssertEqual(next.pictures[0], doc.pictures[0])
        XCTAssertEqual(next.updatedAt, 9)
        XCTAssertEqual(patchPicture(doc, "nope", now: 9) { $0.aspect = "1:1" }, doc)
    }

    func testCountsAPictureAsDevelopedWhenItHasADevelopALookOrACrop() {
        var doc = roll(["a", "b", "c", "d", "e"])
        doc = patchPicture(doc, "p5") { $0.grade = RollGrade(layers: [], output: .rec709ToSrgb) }
        doc = patchPicture(doc, "p1") { $0.develop = dev { $0.contrast = 10 } }
        doc = patchPicture(doc, "p3") { $0.framing = framing { $0.scale = 1.4 } }
        doc = patchPicture(doc, "p4") { $0.aspect = "free:1.5" }
        let progress = rollProgress(doc)
        XCTAssertEqual(progress.total, 5)
        XCTAssertEqual(progress.developed, 4)
        XCTAssertEqual(progress.ignored, 0)
        // An ignored picture is out of both numbers, and counted apart.
        let aside = rollProgress(setDelivery(doc, ["p1", "p2"], .ignore))
        XCTAssertEqual(aside.total, 3)
        XCTAssertEqual(aside.developed, 3)
        XCTAssertEqual(aside.ignored, 2)
    }

    func testPictureEditsNamesEveryKindOfEditAndNothingOnAPictureAsItCame() {
        let bare = roll(["a"]).pictures[0]
        XCTAssertEqual(pictureEdits(bare), [])
        XCTAssertFalse(isEdited(bare))
        var all = bare
        all.develop = dev { $0.exposure = 1 }
        all.grade = RollGrade(layers: [], output: .rec709ToSrgb)
        all.aspect = "4:5"
        all.carried["border"] = ["aspect": nil, "fill": "#ffffff", "margin": ["x": 0.1, "y": 0.1]]
        all.carried["keystone"] = ["vertical": 20, "horizontal": 0, "rotation": 0, "aspect": 0, "scale": 1]
        all.carried["lens"] = ["distortion": 10]
        all.carried["detail"] = ["sharpen": 40]
        all.carried["repair"] = [["id": "h1", "kind": "heal", "x": 0.5, "y": 0.5, "radius": 0.02, "feather": 0.5, "dx": 0.05, "dy": 0]]
        all.carried["layers"] = [["id": "l1", "kind": "radial"]]
        XCTAssertEqual(pictureEdits(all), [.develop, .look, .crop, .border, .perspective, .lens, .detail, .repair, .layers])
    }

    func testDoesNotCountAValueDraggedBackToItsDefaultNorWhichFileThePictureIsDevelopedFrom() {
        var p = roll(["a"]).pictures[0]
        p.develop = .default
        p.framing = .default
        p.carried["keystone"] = ["vertical": 0, "horizontal": 0, "rotation": 0, "aspect": 0, "scale": 1]
        p.carried["lens"] = ["distortion": 0, "distortion2": 0, "chromaRed": 0, "chromaBlue": 0, "vignette": 0, "vignetteMidpoint": 50]
        p.carried["detail"] = ["luminance": 0, "colour": 0, "defringe": 0, "sharpen": 0, "sharpenRadius": 1]
        p.carried["vignette"] = ["amount": 0, "midpoint": 50]
        p.carried["lensProfile"] = ["lens": "DJI 24mm"]
        p.rendition = "delivered:a.JPG"
        XCTAssertFalse(isEdited(p))
    }
}

final class DeliveryTests: XCTestCase {
    private func edited() -> RollDoc {
        patchPicture(roll(["a", "b"]), "p1") { $0.develop = dev { $0.exposure = 1 } }
    }

    func testLeavesWhenEditedByDefaultAndTheAuthorsCallWins() {
        let doc = edited()
        XCTAssertEqual(doc.pictures.map(delivers), [true, false])
        let flipped = setDelivery(setDelivery(doc, ["p1"], .no), ["p2"], .yes)
        XCTAssertEqual(flipped.pictures.map(delivers), [false, true])
        let gone = setDelivery(doc, ["p1"], .ignore)
        XCTAssertFalse(delivers(gone.pictures[0]))
        XCTAssertTrue(isIgnored(gone.pictures[0]))
    }

    func testTogglesToTheOtherAnswerStoredAsAutoWhenTheRuleAlreadySaysIt() {
        let pictures = edited().pictures
        let ed = pictures[0]
        let bare = pictures[1]
        XCTAssertEqual(toggledDelivery(ed), .no)
        var held = ed
        held.deliver = .no
        XCTAssertEqual(toggledDelivery(held), .auto)
        XCTAssertEqual(toggledDelivery(bare), .yes)
        var sent = bare
        sent.deliver = .yes
        XCTAssertEqual(toggledDelivery(sent), .auto)
        var ignored = ed
        ignored.deliver = .ignore
        XCTAssertEqual(toggledDelivery(ignored), .auto)
    }

    func testFiltersTheTableLeavingAnIgnoredPictureToItsOwnGroup() {
        let doc = setDelivery(setDelivery(roll(["a", "b", "c"]), ["p2"], .yes), ["p3"], .ignore)
        let withEdit = patchPicture(doc, "p1") { $0.develop = dev { $0.exposure = 1 } }
        func ids(_ f: DeliveryFilter) -> [String] { withEdit.pictures.filter { matchesDeliveryFilter($0, f) }.map(\.id) }
        XCTAssertEqual(ids(.all), ["p1", "p2"])
        XCTAssertEqual(ids(.edited), ["p1"])
        XCTAssertEqual(ids(.leaving), ["p1", "p2"])
        XCTAssertEqual(ids(.held), [])
    }

    func testWritesAStateOntoSeveralPicturesTheSameRollWhenNothingChanges() {
        let doc = roll(["a", "b"])
        XCTAssertEqual(setDelivery(doc, ["p1"], .auto), doc)
        XCTAssertEqual(setDelivery(doc, ["p1", "p2"], .ignore, now: 9).pictures.map(\.deliver), [.ignore, .ignore])
    }

    func testReadsAnAbsentOrUnknownStateAsAutoAndIsNeverAnEdit() {
        let doc = readRollDoc([
            "id": "r",
            "pictures": [["id": "a", "ref": refJSON("a.jpg")], ["id": "b", "ref": refJSON("b.jpg"), "deliver": "maybe"], ["id": "c", "ref": refJSON("c.jpg"), "deliver": "ignore"]],
        ])!
        XCTAssertEqual(doc.pictures.map(\.deliver), [.auto, .auto, .ignore])
        XCTAssertFalse(isEdited(doc.pictures[2]))
    }

    func testAPicturesWordsAreItsOwnTrimmedAnEmptiedOneTakenOff() {
        let doc = roll(["a.jpg", "b.jpg"])
        let titled = setPictureWords(doc, "p1", title: "  Pinnacles  ", caption: "At dawn, Nambung.", now: 5)
        XCTAssertEqual(titled.pictures[0].title, "Pinnacles")
        XCTAssertEqual(titled.pictures[0].caption, "At dawn, Nambung.")
        XCTAssertEqual(titled.pictures[1], doc.pictures[1])
        XCTAssertEqual(titled.updatedAt, 5)
        XCTAssertEqual(setPictureWords(titled, "p1", title: "Pinnacles"), titled)
        let cleared = setPictureWords(titled, "p1", caption: "  ")
        XCTAssertEqual(cleared.pictures[0].title, "Pinnacles")
        XCTAssertNil(cleared.pictures[0].caption)
        XCTAssertEqual(setPictureWords(doc, "nope", title: "x"), doc)
        // The words survive the round trip; a roll written before them reads with none.
        let back = readRollDoc(titled.json)!
        XCTAssertEqual(back.pictures[0].title, "Pinnacles")
        XCTAssertEqual(back.pictures[0].caption, "At dawn, Nambung.")
        XCTAssertNil(back.pictures[1].title)
        // An emptied caption is not written blank: the key is gone from the file.
        XCTAssertNil(cleared.pictures[0].json.objectValue?["caption"])
    }
}

final class VariantTests: XCTestCase {
    private func base() -> RollDoc {
        var n = 0
        var doc = addPictures(createRollDoc(name: "R", sourceId: "local", now: 1, id: "r1"), [ref("a.jpg", size: 10), ref("b.jpg", size: 10)], now: 2) {
            n += 1
            return "p\(n)"
        }
        doc = patchPicture(doc, "p1") { $0.develop = dev { $0.exposure = 1 }; $0.deliver = .no }
        doc = setPictureWords(doc, "p1", title: "Dawn")
        return doc
    }

    func testClonesAPictureRightAfterItNumberedTwoItsDeliveryBackOnTheRule() {
        let doc = addVariant(base(), "p1", .clone, newId: "v1", now: 5)
        XCTAssertEqual(doc.pictures.map(\.id), ["p1", "v1", "p2"])
        let v = doc.pictures[1]
        XCTAssertEqual(v.variant, 2)
        XCTAssertEqual(v.develop?.exposure, 1)
        XCTAssertEqual(v.title, "Dawn")
        XCTAssertEqual(v.deliver, .auto)
        XCTAssertEqual(v.ref, doc.pictures[0].ref)
        XCTAssertEqual(pictureLabel(v), "a.jpg · 2")
        XCTAssertEqual(pictureLabel(doc.pictures[0]), "a.jpg")
        XCTAssertEqual(variantFolder(v), "Variant 2")
        XCTAssertEqual(variantFolder(doc.pictures[0]), "")
    }

    func testStartsAFreshVariantAsShotKeepingWhatBelongsToTheFile() {
        var doc = patchPicture(base(), "p1") {
            $0.develop = normaliseDevelop(["exposure": 1, "base": "gain", "rawGain": 1.5, "rawWb": ["kelvin": 3000, "tint": 0, "matrix": [1, 0, 0, 0, 1, 0, 0, 0, 1]]])
            $0.rendition = "delivered:a.jpg"
            $0.carried["lensProfile"] = ["lens": "DJI 24mm"]
        }
        doc = addVariant(doc, "p1", .fresh, newId: "v1")
        let v = doc.pictures[1]
        XCTAssertEqual(v.develop, dev { $0.base = .gain; $0.rawGain = 1.5 })
        XCTAssertEqual(v.rendition, "delivered:a.jpg")
        XCTAssertEqual(v.carried["lensProfile"], ["lens": "DJI 24mm"])
        XCTAssertNil(v.title)
        XCTAssertFalse(isEdited(addVariant(base(), "p1", .fresh, newId: "v2").pictures[1]))
    }

    func testNumbersPastTheHighestOfItsCaptureAndGoesAfterTheLastOfThem() {
        var doc = addVariant(base(), "p1", .clone, newId: "v1")
        doc = addVariant(doc, "p1", .fresh, newId: "v2")
        XCTAssertEqual(doc.pictures.map { "\($0.id):\(variantNumber($0))" }, ["p1:1", "v1:2", "v2:3", "p2:1"])
        doc = removePictures(doc, ["v1"])
        doc = addVariant(doc, "v2", .clone, newId: "v3")
        XCTAssertEqual(doc.pictures.first { $0.id == "v3" }?.variant, 4)
    }

    func testNeverLetsAFileBeAddedTwiceAndSurvivesBeingReadBack() {
        let doc = addVariant(base(), "p1", .clone, newId: "v1")
        XCTAssertEqual(addPictures(doc, [ref("a.jpg", size: 10)]), doc)
        let read = readRollDoc(JSONValue.parse(doc.json.serialized()))
        XCTAssertEqual(read?.pictures.map(\.variant), [nil, 2, nil])
        XCTAssertEqual(addVariant(doc, "nope", .clone), doc)
    }
}

final class ReadRollDocTests: XCTestCase {
    func testRefusesWhatIsNotARoll() {
        XCTAssertNil(readRollDoc(nil))
        XCTAssertNil(readRollDoc(["id": "r", "pictures": "many"]))
        XCTAssertNil(readRollDoc(["pictures": []]))
    }

    func testDropsPicturesThatNameNothingAndRepeatsOfOneIdAndNormalisesTheRest() {
        let p1: JSONValue = ["id": "p1", "ref": refJSON("a.jpg"), "develop": ["exposure": 0], "framing": Framing.default.json, "aspect": "wide"]
        let p1Again: JSONValue = ["id": "p1", "ref": refJSON("b.jpg")]
        let p2: JSONValue = ["id": "p2", "ref": ["size": 3]]
        let p3: JSONValue = ["id": "p3", "ref": refJSON("c.jpg", hash: "h", extra: ["junk": true]),
                             "develop": ["exposure": 1], "framing": ["scale": 2], "aspect": "4:5"]
        let raw: JSONValue = [
            "id": "r", "name": "Stored", "sourceId": "winnow.example",
            "pictures": [p1, p1Again, p2, p3],
            "grade": ["layers": [], "output": "none"],
            "export": ["longEdge": 99999, "quality": 3, "originals": "maybe"],
            "future": "ignored",
        ]
        let doc = readRollDoc(raw, fallbackSourceId: "local")!
        XCTAssertEqual(doc.pictures.map(\.id), ["p1", "p3"])
        XCTAssertNil(doc.pictures[0].develop)
        XCTAssertNil(doc.pictures[0].framing)
        XCTAssertEqual(doc.pictures[0].aspect, "original")
        XCTAssertEqual(doc.pictures[1].ref, SavedMediaRef(name: "c.jpg", size: 100, lastModified: 1, hash: "h"))
        XCTAssertEqual(doc.pictures[1].develop?.exposure, 1)
        XCTAssertEqual(doc.pictures[1].framing?.scale, 2)
        XCTAssertEqual(doc.pictures.map(\.grade), [nil, nil])
        // v5's one long edge and quality become the one target (v6), through their limits.
        XCTAssertEqual(doc.export, RollExport(targets: [ExportTarget(name: "", size: ExportSize(mode: .long, value: 16384), quality: 1)],
                                              replace: false, hdr: false, hdrStops: 2))
        XCTAssertEqual(doc.sourceId, "winnow.example")
        XCTAssertEqual(doc.version, rollDocVersion)
    }

    func testHandsAPreV5RollsOneLookToEveryPictureAndNeverAV5RollsStrayKey() {
        let look: JSONValue = ["layers": [["id": "l", "source": "builtin:x", "intensity": 0.5]], "output": "rec709-to-srgb"]
        let old = readRollDoc([
            "id": "r", "version": 4,
            "pictures": [["id": "a", "ref": refJSON("a.jpg")], ["id": "b", "ref": refJSON("b.jpg")]],
            "grade": look,
        ])!
        XCTAssertEqual(old.version, rollDocVersion)
        XCTAssertEqual(old.pictures.map { $0.grade?.layers.first?.source }, ["builtin:x", "builtin:x"])
        // Idempotent: reading the migrated roll again changes nothing.
        XCTAssertEqual(readRollDoc(old.json), old)
        XCTAssertEqual(readRollDoc(JSONValue.parse(old.json.serialized())), old)

        let bare = readRollDoc([
            "id": "r", "version": 5,
            "pictures": [["id": "a", "ref": refJSON("a.jpg"), "grade": nil], ["id": "b", "ref": refJSON("b.jpg"), "grade": look]],
            "grade": look,
        ])!
        XCTAssertEqual(bare.pictures.map { $0.grade?.output }, [nil, .rec709ToSrgb])
    }

    func testKeepsALookWithLayersOrATransformAndReadsItsLayersSafely() {
        XCTAssertEqual(
            readRollGrade(["layers": [["id": "l", "source": "builtin:x", "intensity": 7]], "output": "bogus"]),
            RollGrade(layers: [SavedLutLayer(id: "l", source: "builtin:x", name: "l", customText: nil, intensity: 3, enabled: true)], output: OutputTransform.none, film: nil)
        )
        XCTAssertEqual(readRollGrade(["layers": [["id": "l", "source": "builtin:x", "intensity": 1.5]], "output": "none"])?.layers[0].intensity, 1.5)
        XCTAssertEqual(readRollGrade(["layers": [["nope": 1]], "output": "rec709-to-srgb"]), RollGrade(layers: [], output: .rec709ToSrgb, film: nil))
        // A TEXTURE alone is a look.
        let grainy = readRollGrade(["layers": [], "output": "none", "film": ["grain": 0.5]])
        XCTAssertEqual(grainy?.film?.objectValue?["grain"], .number(0.5))
        XCTAssertNil(readRollGrade(["layers": [], "output": "none", "film": "nope"]))
    }

    func testReadsTheExportThroughItsLimitsAndTheSourceSizeAsNil() {
        XCTAssertEqual(readRollExport(["longEdge": 1920.4, "quality": 0.8, "originals": "proxies", "replace": true]),
                       RollExport(targets: [ExportTarget(size: ExportSize(mode: .long, value: 1920), quality: 0.8)], replace: true))
        let hdr = readRollExport(["hdr": true, "hdrStops": 9.6])
        XCTAssertTrue(hdr.hdr)
        XCTAssertEqual(hdr.hdrStops, 4)
        let notHdr = readRollExport(["hdr": "yes", "hdrStops": 0])
        XCTAssertFalse(notHdr.hdr)
        XCTAssertEqual(notHdr.hdrStops, 1)
        XCTAssertEqual(readRollExport(["longEdge": nil]), .default)
        XCTAssertEqual(readRollExport("junk"), .default)
        XCTAssertFalse(readRollExport(["quality": 0.9]).replace)
        XCTAssertFalse(readRollExport(["replace": "yes"]).replace)
        // What leaves, and the watermark, are carried as the web wrote them.
        XCTAssertEqual(readRollExport(["metadata": ["position": false]]).metadata, ["position": false])
        XCTAssertNil(readRollExport(["metadata": "all"]).metadata)
    }

    func testReadsTheTargetsThroughTheirLimitsCappedAndNeverEmpty() {
        let read = readTargets([
            ["name": "Web", "size": ["mode": "short", "value": 1080.4], "quality": 0.85, "sharpen": "standard", "watermark": true],
            ["name": "Mail", "size": ["mode": "megapixels", "value": 2.06], "quality": 3, "sharpen": "loud"],
            ["size": ["mode": "sideways", "value": 9]],
            "junk",
        ])
        XCTAssertEqual(read.count, 3)
        XCTAssertEqual(read[0], ExportTarget(name: "Web", size: ExportSize(mode: .short, value: 1080), quality: 0.85, sharpen: .standard, watermark: true))
        XCTAssertEqual(read[1], ExportTarget(name: "Mail", size: ExportSize(mode: .megapixels, value: 2.1), quality: 1, sharpen: .off, watermark: false))
        XCTAssertEqual(read[2], ExportTarget(name: "", size: nil, quality: 0.92))
        XCTAssertEqual(readTargets(nil), [ExportTarget.default])
        XCTAssertEqual(readTargets([], legacyLongEdge: 2048, legacyQuality: 0.7), [ExportTarget(size: ExportSize(mode: .long, value: 2048), quality: 0.7)])
        XCTAssertEqual(readTargets(.array(Array(repeating: ["name": "x"], count: 6))).count, maxTargets)
    }

    func testASizeIsACapThatNeverUpscales() {
        XCTAssertEqual(longEdgeFor(nil, width: 6000, height: 4000), nil)
        XCTAssertEqual(longEdgeFor(ExportSize(mode: .long, value: 2048), width: 6000, height: 4000), 2048)
        XCTAssertEqual(longEdgeFor(ExportSize(mode: .long, value: 8000), width: 6000, height: 4000), nil)
        XCTAssertEqual(longEdgeFor(ExportSize(mode: .short, value: 1080), width: 6000, height: 4000), 1620)
        XCTAssertEqual(longEdgeFor(ExportSize(mode: .percent, value: 50), width: 6000, height: 4000), 3000)
        XCTAssertEqual(longEdgeFor(ExportSize(mode: .megapixels, value: 6), width: 6000, height: 4000), 3000)
        XCTAssertEqual(describeSize(nil), "full size")
        XCTAssertEqual(describeSize(ExportSize(mode: .long, value: 2048)), "2048 px long edge")
        XCTAssertEqual(describeSize(ExportSize(mode: .megapixels, value: 2)), "2 MP")
        XCTAssertEqual(targetFolder("Web", index: 1), "Web")
        XCTAssertEqual(targetFolder("  ../Web: two  ", index: 1), "Web two")
        XCTAssertEqual(targetFolder("", index: 1), "Target 2")
    }

    func testReadsTheRenditionAPictureIsDevelopedFromAndNothingAsNil() {
        let doc = readRollDoc([
            "id": "r",
            "pictures": [
                ["id": "p1", "ref": refJSON("a.jpg"), "rendition": "delivered:dji_0101.jpg"],
                ["id": "p2", "ref": refJSON("b.jpg"), "rendition": ""],
                ["id": "p3", "ref": refJSON("c.jpg")],
            ],
        ])!
        XCTAssertEqual(doc.pictures.map(\.rendition), ["delivered:dji_0101.jpg", nil, nil])
        XCTAssertEqual(patchPicture(doc, "p3") { $0.rendition = "proxy" }.pictures[2].rendition, "proxy")
    }

    func testCarriesWhatThisPortDoesNotInterpretThroughUntouched() {
        let keystone: JSONValue = ["tl": ["x": 0.1, "y": 0.2], "strength": 1]
        let doc = readRollDoc([
            "id": "r",
            "pictures": [["id": "p1", "ref": refJSON("a.jpg"), "keystone": keystone, "repair": [], "layers": [["id": "L1"]], "border": nil]],
        ])!
        XCTAssertEqual(doc.pictures[0].carried["keystone"], keystone)
        XCTAssertEqual(doc.pictures[0].carried["layers"], [["id": "L1"]])
        XCTAssertNil(doc.pictures[0].carried["repair"])
        XCTAssertNil(doc.pictures[0].carried["border"])
        // A lens profile taken OFF by the author is a null that means something: kept.
        let off = readRollDoc(["id": "r", "pictures": [["id": "p1", "ref": refJSON("a.jpg"), "lensProfile": nil, "future": 7]]])!
        XCTAssertEqual(off.pictures[0].carried["lensProfile"], .null)
        XCTAssertEqual(off.pictures[0].carried["future"], 7)
        XCTAssertEqual(off.pictures[0].json.objectValue?["lensProfile"], .null)
        XCTAssertEqual(readRollDoc(off.json), off)
        let written = doc.pictures[0].json.objectValue!
        XCTAssertEqual(written["keystone"], keystone)
        XCTAssertEqual(written["repair"], [])
        XCTAssertEqual(written["border"], .null)
        XCTAssertEqual(readRollDoc(doc.json), doc)
    }
}

final class RollFileTests: XCTestCase {
    func testNamesTheFileAfterTheRoll() {
        XCTAssertEqual(rollFileName("Islande — jour 3"), "islande-jour-3.roll.json")
        XCTAssertEqual(rollFileName("   "), "roll.roll.json")
    }

    func testCarriesEverythingButTheIdTheSourceAndTheTimestamps() {
        let file = rollFileJSON(sample(), exportedAt: Date(timeIntervalSince1970: 0)).objectValue!
        XCTAssertEqual(file["kind"], .string(rollFileKind))
        XCTAssertEqual(file["version"], .number(Double(rollDocVersion)))
        XCTAssertEqual(file.keys.sorted(), ["export", "exportedAt", "kind", "name", "pictures", "version"])
        XCTAssertEqual(file["pictures"]?.arrayValue?.first?.objectValue?["ref"]?.objectValue?["hash"], "h1")
    }

    func testComesBackAsANewRollOnTheImportingSourceHoldingExactlyWhatWasWritten() {
        let original = sample()
        let text = rollFileJSON(original).serialized(pretty: true)
        guard case .success(let imported) = parseRollFile(text, sourceId: "local", now: 9000) else {
            return XCTFail("the file did not parse")
        }
        XCTAssertNotEqual(imported.id, original.id)
        XCTAssertEqual(imported.sourceId, "local")
        XCTAssertEqual(imported.createdAt, 9000)
        XCTAssertEqual(imported.updatedAt, 9000)
        XCTAssertEqual(imported.name, original.name)
        // Each picture's look travels with it — under a fresh id.
        func withoutIds(_ pictures: [RollPicture]) -> [RollPicture] {
            pictures.map { var p = $0; p.id = ""; return p }
        }
        XCTAssertEqual(withoutIds(imported.pictures), withoutIds(original.pictures))
        XCTAssertNotEqual(imported.pictures[0].id, original.pictures[0].id)
        XCTAssertEqual(imported.pictures[0].grade?.output, .rec709ToSrgb)
        XCTAssertEqual(imported.export, original.export)
    }

    func testHandsAPreV5FilesOneLookToEveryPicture() {
        let text = JSONValue.object([
            "kind": .string(rollFileKind), "version": 4, "name": "Old",
            "pictures": [["id": "a", "ref": ["name": "a.jpg", "size": 1]], ["id": "b", "ref": ["name": "b.jpg", "size": 1]]],
            "grade": ["layers": [], "output": "rec709-to-srgb"],
        ]).serialized()
        guard case .success(let doc) = parseRollFile(text) else { return XCTFail("the file did not parse") }
        XCTAssertEqual(doc.pictures.map { $0.grade?.output }, [.rec709ToSrgb, .rec709ToSrgb])
    }

    func testGivesEveryPictureAFreshIdSoOneFileImportedTwiceIsTwoRollsThatShareNothing() {
        let text = rollFileJSON(sample()).serialized()
        var n = 0
        guard case .success(let first) = parseRollFile(text, now: 1, makeId: { n += 1; return "a\(n)" }),
              case .success(let second) = parseRollFile(text, now: 2, makeId: { n += 1; return "b\(n)" }) else {
            return XCTFail("the file did not parse")
        }
        XCTAssertEqual(first.id, "a1")
        XCTAssertEqual(first.pictures.map(\.id), ["a2"])
        XCTAssertEqual(second.id, "b3")
        XCTAssertEqual(second.pictures.map(\.id), ["b4"])
    }

    func testRefusesWhatItCannotReadSayingWhy() {
        XCTAssertEqual(parseRollFile("{nope"), .failure(.notJSON))
        guard case .failure = parseRollFile("[]") else { return XCTFail("a list is not a roll") }
        guard case .failure = parseRollFile(JSONValue.object(["kind": "atelier/road-trip", "pictures": []]).serialized()) else {
            return XCTFail("a trip is not a roll")
        }
        let newer = parseRollFile(JSONValue.object(["kind": .string(rollFileKind), "version": .number(Double(rollDocVersion + 1)), "pictures": []]).serialized())
        XCTAssertEqual(newer, .failure(.newerVersion(rollDocVersion + 1)))
        if case .failure(let error) = newer { XCTAssertTrue(error.message.contains("newer version"), error.message) }
        XCTAssertEqual(parseRollFile(JSONValue.object(["kind": .string(rollFileKind), "version": 1]).serialized()), .failure(.noPictures))
    }
}
