// Port of `src/shared/develop/picture-sections.test.ts`.
//
// The fixture's carried records are written in the KERNEL's own keys
// (`Roll.swift`'s `isDefaultDetail` reads `luminance`, where the web's spec
// wrote a stale `noise` that counted as an edit only because `undefined !== 0`).

import XCTest
@testable import AtelierKit

private var n = 0

private func roll() -> RollDoc {
    addPictures(createRollDoc(name: "R", sourceId: "local", now: 1, id: "r"),
                ["a.jpg", "b.jpg", "c.jpg"].map { SavedMediaRef(name: $0, size: 1, lastModified: 1) }, now: 2) {
        n += 1
        return "p\(n)"
    }
}

/// A picture with something in every section.
private func everything(_ doc: RollDoc, _ id: String) -> RollDoc {
    patchPicture(doc, id, now: 2) { p in
        p.develop = dev { $0.exposure = 1 }
        p.grade = RollGrade(layers: [], output: .rec709ToSrgb, film: nil)
        p.aspect = "4:5"
        p.framing = Framing(scale: 1.2, x: 0.1, y: 0, rotation: 2, flipX: false, flipY: false, fit: .cover)
        p.carried["border"] = ["format": "none", "color": "#fff", "blur": false, "margin": ["top": 0.05, "right": 0.05, "bottom": 0.05, "left": 0.05]]
        p.carried["keystone"] = ["vertical": 0.2, "horizontal": 0, "rotation": 0, "aspect": 0, "scale": 1]
        p.carried["lens"] = ["distortion": 0.1, "distortion2": 0, "chromaRed": 0, "chromaBlue": 0, "vignette": 0]
        p.carried["detail"] = ["luminance": 0.3, "colour": 0, "defringe": 0, "sharpen": 0, "texture": 0, "clarity": 0, "dehaze": 0]
        p.carried["vignette"] = ["amount": -30, "midpoint": 50, "roundness": 0, "feather": 50, "highlights": 0]
        p.carried["repair"] = [["id": "x", "x": 0.5, "y": 0.5, "r": 0.02, "dx": 0.03, "dy": 0, "mode": "heal", "feather": 0.5]]
        p.carried["layers"] = [["id": "l1", "kind": "linear"]]
    }
}

final class PictureSectionsTests: XCTestCase {
    func testNameExactlyWhatEditedNamesOneVocabulary() {
        let doc = everything(roll(), "p\(n - 2)")
        let p = doc.pictures[0]
        XCTAssertEqual(pictureEdits(p), pictureSections.map(\.id))
        XCTAssertEqual(pictureSections.map(\.id), PictureEdit.allCases)
        // What a copy would carry and a reset would clear is that same list.
        XCTAssertEqual(sectionsWithEdits(p), Set(PictureEdit.allCases))
        XCTAssertEqual(sectionsWithEdits(doc.pictures[1]), [])
    }

    func testCopyOnlyTheTickedSectionsAsCopiesAndNeverTheFileTheBaseOrTheWords() {
        let doc = everything(roll(), "p\(n - 2)")
        let src = doc.pictures[0]
        var target = setPictureWords(doc, doc.pictures[1].id, title: "mine", now: 3).pictures[1]
        target.rendition = "proxy"
        target.develop = dev { $0.base = .gain; $0.rawGain = 1.3 }
        let out = withSections(target, src, [.develop, .lens])
        XCTAssertEqual(out.develop?.exposure, 1)
        XCTAssertEqual(out.develop?.base, .gain)
        XCTAssertEqual(out.develop?.rawGain, 1.3)
        XCTAssertEqual(out.carried["lens"], src.carried["lens"])
        XCTAssertEqual(out.grade, target.grade)
        XCTAssertNil(out.grade)
        XCTAssertEqual(out.aspect, "original")
        XCTAssertNil(out.carried["detail"])
        XCTAssertEqual(out.rendition, "proxy")
        XCTAssertEqual(out.title, "mine")
        XCTAssertEqual(out.deliver, .auto)
    }

    func testApplyOntoSeveralPicturesAtOnceSkippingTheSourceAndSayingWhenNothingChanged() {
        let doc = everything(roll(), "p\(n - 2)")
        let src = doc.pictures[0]
        let b = doc.pictures[1]
        let c = doc.pictures[2]
        let out = applySections(doc, src, [src.id, b.id, c.id], [.crop, .repair], now: 9)
        XCTAssertEqual(out.pictures[1].aspect, "4:5")
        XCTAssertEqual(out.pictures[1].carried["repair"], src.carried["repair"])
        XCTAssertEqual(out.pictures[2].framing, src.framing)
        XCTAssertEqual(out.pictures[0], src)
        XCTAssertEqual(out.updatedAt, 9)
        XCTAssertEqual(applySections(out, src, [b.id], [.crop], now: 10), out)
        XCTAssertEqual(applySections(doc, src, [b.id], [], now: 10), doc)
    }

    func testResetTheTickedSectionsToAsShotKeepingARAWBaseAndThePicturesWords() {
        let doc = everything(roll(), "p\(n - 2)")
        var src = doc.pictures[0]
        src.develop = dev { $0.exposure = 1; $0.base = .gain; $0.rawGain = 2 }
        src.title = "T"
        let all = pictureSections.map(\.id)
        let cleared = withoutSections(src, all)
        // The RAW base is material, not an edit to throw away: it survives, and is all that does.
        XCTAssertEqual(pictureEdits(cleared), [.develop])
        XCTAssertEqual(cleared.develop?.base, .gain)
        XCTAssertEqual(cleared.develop?.rawGain, 2)
        XCTAssertEqual(cleared.develop?.exposure, 0)
        var plain = src
        plain.develop = dev { $0.exposure = 1 }
        XCTAssertFalse(isEdited(withoutSections(plain, all)))
        XCTAssertEqual(cleared.title, "T")
        let partial = resetSections(doc, doc.pictures[0].id, [.layers], now: 5)
        XCTAssertFalse(pictureEdits(partial.pictures[0]).contains(.layers))
        XCTAssertTrue(pictureEdits(partial.pictures[0]).contains(.develop))
        XCTAssertEqual(partial.updatedAt, 5)
        XCTAssertEqual(resetSections(partial, doc.pictures[0].id, [.layers], now: 6), partial)
    }

    func testReadAStoredChoiceInTheInspectorsOrderAndHoldACopyThatLaterEditsDoNotTouch() {
        XCTAssertEqual(readSections(["lens", "develop", "nope"]), [.develop, .lens])
        XCTAssertEqual(readSections("junk"), [.develop, .look, .lens, .detail])
        XCTAssertEqual(readSections(nil, fallback: [.crop]), [.crop])
        let doc = everything(roll(), "p\(n - 2)")
        var p = doc.pictures[0]
        var ticks = 0
        let off = subscribeCopiedSettings { ticks += 1 }
        copySettings(p, [.develop])
        p.develop?.exposure = 3
        XCTAssertEqual(copiedSettings()?.from.develop?.exposure, 1)
        XCTAssertEqual(copiedSettings()?.sections, [.develop])
        copySettings(p, [])
        XCTAssertNil(copiedSettings())
        off()
        copySettings(p, [.look])
        XCTAssertEqual(ticks, 2)
        copySettings(p, [])
    }
}
