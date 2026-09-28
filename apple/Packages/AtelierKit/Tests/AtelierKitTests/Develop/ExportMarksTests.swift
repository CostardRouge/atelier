// Port of `src/shared/develop/export-marks.test.ts`, case for case, and one
// case of its own: the key is the WEB's to the byte, pinned against values the
// web's own `exportKey` printed for the same pictures (run through node on
// 2026-09-25, fixtures below).

import XCTest
@testable import AtelierKit

private var n = 0

private func roll() -> RollDoc {
    addPictures(createRollDoc(name: "R", sourceId: "local", now: 1, id: "r1"),
                [SavedMediaRef(name: "a.jpg", size: 1, lastModified: 1), SavedMediaRef(name: "b.jpg", size: 1, lastModified: 1)],
                now: 2) {
        n += 1
        return "p\(n)"
    }
}

final class ExportMarksTests: XCTestCase {
    func testReadsAPictureAsNewCurrentAfterItLeavesChangedAfterAnEdit() {
        let doc = roll()
        let a = doc.pictures[0]
        let b = doc.pictures[1]
        XCTAssertEqual(exportState(a, [:]), .new)
        let marks = withExported([:], [a], at: 100)
        XCTAssertEqual(marks[a.id], ExportMark(at: 100, key: exportKey(a)))
        XCTAssertEqual(exportState(a, marks), .current)
        XCTAssertTrue(needsExport(b, marks))
        let edited = patchPicture(doc, a.id, now: 3) { $0.develop = dev { $0.exposure = 0.5 } }.pictures[0]
        XCTAssertEqual(exportState(edited, marks), .changed)
        let titled = setPictureWords(doc, a.id, title: "Pinnacles", now: 3).pictures[0]
        XCTAssertEqual(exportState(titled, marks), .changed)
    }

    func testIgnoresWhatDoesNotChangeTheFileTheDeliveryStateKeyOrderEmptySpellings() {
        let doc = roll()
        let a = doc.pictures[0]
        let marks = withExported([:], [a], at: 1)
        XCTAssertEqual(exportState(setDelivery(doc, [a.id], .yes, now: 2).pictures[0], marks), .current)
        var spelled = a
        spelled.carried["repair"] = []
        spelled.carried["lens"] = .null
        var other = a
        other.carried["layers"] = []
        XCTAssertEqual(exportKey(spelled), exportKey(other))
        // A record's keys in any order are one record — and so is a develop,
        // whatever its fields were set in.
        var ordered = a
        ordered.carried["lens"] = .object(["distortion": 0.1, "chromaRed": 0.2])
        var reordered = a
        reordered.carried["lens"] = .object(Dictionary(uniqueKeysWithValues: [("chromaRed", JSONValue.number(0.2)), ("distortion", 0.1)]))
        XCTAssertEqual(exportKey(ordered), exportKey(reordered))
        var one = a
        one.develop = dev { $0.exposure = 1; $0.contrast = 10 }
        var two = a
        two.develop = dev { $0.contrast = 10; $0.exposure = 1 }
        XCTAssertEqual(exportKey(one), exportKey(two))
        var original = a
        original.aspect = "original"
        var uncropped = original
        uncropped.framing = nil
        XCTAssertEqual(exportKey(original), exportKey(uncropped))
        var portrait = a
        portrait.aspect = "4:5"
        XCTAssertNotEqual(exportKey(portrait), exportKey(a))
    }

    func testReadsStoredMarksDefensivelyAndDropsARemovedPicturesMark() {
        XCTAssertEqual(readExportMarks(["p": ["at": 1, "key": "k"], "q": ["at": "x", "key": "k"], "r": nil]),
                       ["p": ExportMark(at: 1, key: "k")])
        XCTAssertEqual(readExportMarks("junk"), [:])
        let marks: ExportMarks = ["p": ExportMark(at: 1, key: "k"), "q": ExportMark(at: 2, key: "k")]
        XCTAssertEqual(pruneMarks(marks, ["p"]), ["p": ExportMark(at: 1, key: "k")])
        XCTAssertEqual(pruneMarks(marks, ["p", "q"]), marks)
        // What the side file keeps reads back as itself.
        XCTAssertEqual(readExportMarks(JSONValue.parse(marks.json.serialized())), marks)
    }

    func testTheKeyIsTheWebsToTheByte() {
        let a = createRollPicture(SavedMediaRef(name: "a.jpg", size: 1, lastModified: 1), id: "p1")
        XCTAssertEqual(exportKey(a), "5465b825e3e97a6c")
        var exposure = a
        exposure.develop = dev { $0.exposure = 0.5 }
        XCTAssertEqual(exportKey(exposure), "8c23fa4603e89307")
        var titled = a
        titled.title = "Pinnacles"
        XCTAssertEqual(exportKey(titled), "15ef6fd042288b67")

        // Every writer at once: a develop with a curve, a mixer and a grading;
        // a look; a crop; a rendition; numbers JavaScript writes with an
        // exponent; escapes; keys sorted by UTF-16 unit; an emptiness nested
        // inside a list; the words.
        var full = a
        full.develop = normaliseDevelop([
            "exposure": -1.25, "contrast": 12,
            "curves": ["luma": [["x": 0, "y": 0], ["x": 0.25, "y": 0.18], ["x": 0.75, "y": 0.82], ["x": 1, "y": 1]]],
            "mixer": ["hue": [0, 0, 10, 0, 0, 0, 0, 0], "saturation": [0, 0, 0, 0, 0, 0, 0, 0], "luminance": [0, 0, 0, 0, 0, -40, 0, 0]],
            "grading": ["shadows": ["hue": 220, "saturation": 20, "luminance": 0], "balance": 10],
        ])
        full.grade = RollGrade(layers: [SavedLutLayer(id: "L1", source: "builtin", name: "Kodak", intensity: 0.8, enabled: true)],
                               output: .rec709ToSrgb, film: nil)
        full.aspect = "4:5"
        full.framing = Framing(scale: 1.2, x: 0.1, y: 0, rotation: 2, flipX: false, flipY: true, fit: .cover)
        full.rendition = "DJI_0101.DNG"
        full.carried["lens"] = [
            "distortion": 1e-7, "big": 1.2345678901234568e20, "tiny": -0.000001,
            "name": "Zeiss \"Batis\"\n\u{01} é 😀", "é": 1, "z": 2, "Z": 3, "😀": 4, "ｅ": 5,
        ]
        full.carried["repair"] = []
        full.carried["layers"] = [["id": "l1", "kind": "linear", "nested": ["empty": [], "nothing": nil, "keep": [0]]]]
        full.title = "Café"
        full.caption = "Line one\tTabbed"
        XCTAssertEqual(exportKey(full), "57c6496a6f751085")
    }
}
