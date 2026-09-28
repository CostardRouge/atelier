// Port of `src/shared/projects/project-file.test.ts`, case for case. The
// web's deep-copy cases hold by value semantics here and are kept to say so.

import XCTest
@testable import AtelierKit

/// `Date.parse(iso)`.
private func millis(_ iso: String) -> Double {
    let f = ISO8601DateFormatter()
    return (f.date(from: iso)?.timeIntervalSince1970 ?? 0) * 1000
}

private func sampleDoc() -> ProjectDoc {
    var doc = createProjectDoc("Vol du soir", "9:16", defaultElementsPreset(), .default)
    doc.settings.timeShift = TimeShift(minutes: 90, days: -1)
    doc.lutStack = [SavedLutLayer(id: "l1", source: "custom", name: "Mon look.cube",
                                  customText: "LUT_3D_SIZE 2\n0 0 0\n1 1 1\n", intensity: 0.6, enabled: true)]
    doc.outputTransform = .rec709ToSrgb
    doc.outro = OutroCard(seconds: 4, background: "#100f0d", elements: [],
                          qr: OutroQr(url: "https://x.dev", x: 0.35, y: 0.55, sizeFrac: 0.3, dark: "#fff", light: "#111"))
    doc.exportPrefs = ExportPrefs(fileName: "sunset", variants: [
        ExportVariant(id: "v1", aspectId: "9:16", resolution: .shortSide(1080), frameRate: .fps(30), speed: 1, overlays: true),
    ])
    // Bound half: must never travel. Trims included — in/out points are
    // seconds into THIS footage and mean nothing under another media.
    doc.media = ProjectMedia(
        dirHandle: nil,
        files: [SavedMediaRef(name: "DJI_0001.MP4", size: 12, lastModified: 3)],
        activeId: "DJI_0001",
        trims: ["DJI_0001": SavedTrim(start: 2, end: 9, duration: 12)],
        // A develop is about THIS picture too: it stays home with the trims.
        develops: ["DJI_0001": SavedDevelop(settings: dev { $0.exposure = 0.7 }, hash: "abc")]
    )
    doc.thumbnail = nil
    doc.durationSeconds = 42
    return doc
}

private func parsed(_ text: String, file: StaticString = #filePath, line: UInt = #line) -> ProjectFile? {
    switch parseProjectFile(text) {
    case .success(let f): return f
    case .failure(let e):
        XCTFail(e.message, file: file, line: line)
        return nil
    }
}

private func refusal(_ text: String) -> String? {
    if case .failure(let e) = parseProjectFile(text) { return e.message }
    return nil
}

final class ToProjectFileTests: XCTestCase {
    func testLeavesTheCadenceCorrectionBehindItBelongsToOneClip() {
        var doc = sampleDoc()
        doc.settings.timeScale = TimeScaleSetting(mode: .manual, scale: 0.25, clipId: "dji_0001")
        let file = toProjectFile(doc, exportedAt: millis("2026-08-21T10:00:00Z"))
        XCTAssertNil(file.settings.timeScale)
        XCTAssertFalse(serializeProjectFile(file).contains("timeScale"))
        // …and the document it came from is untouched.
        XCTAssertEqual(doc.settings.timeScale?.scale, 0.25)
    }

    func testCarriesThePortableHalfAndNothingBoundToThisMachine() {
        let file = toProjectFile(sampleDoc(), exportedAt: millis("2026-08-21T10:00:00Z"))
        XCTAssertEqual(file.kind, projectFileKind)
        XCTAssertEqual(file.version, projectDocVersion)
        XCTAssertEqual(file.name, "Vol du soir")
        XCTAssertEqual(file.exportedAt, "2026-08-21T10:00:00.000Z")
        XCTAssertEqual(file.settings.aspectId, "9:16")
        XCTAssertGreaterThan(file.elements.count, 0)
        XCTAssertEqual(file.exportPrefs.fileName, "sunset")
        // No bound field leaks in, whatever the serializer sees.
        let json = serializeProjectFile(file)
        for word in ["DJI_0001", "dirHandle", "thumbnail", "trims", "develops", "exposure"] {
            XCTAssertFalse(json.contains(word), word)
        }
    }

    func testInlinesACustomLookSoTheGradeTravelsWithTheFile() {
        XCTAssertTrue(toProjectFile(sampleDoc()).lutStack[0].customText?.contains("LUT_3D_SIZE") == true)
    }

    func testCopiesSoLaterEditsToTheProjectDoNotMutateTheFile() {
        var doc = sampleDoc()
        let file = toProjectFile(doc)
        doc.elements[0].x = 0.99
        XCTAssertNotEqual(file.elements[0].x, 0.99)
    }
}

final class ParseProjectFileTests: XCTestCase {
    func testRoundTripsASerializedProject() throws {
        let file = toProjectFile(sampleDoc())
        let back = try XCTUnwrap(parsed(serializeProjectFile(file)))
        XCTAssertEqual(back.name, "Vol du soir")
        XCTAssertEqual(back.settings.timeShift, TimeShift(minutes: 90, days: -1))
        XCTAssertEqual(back.lutStack[0].intensity, 0.6)
        XCTAssertEqual(back.outputTransform, .rec709ToSrgb)
        XCTAssertEqual(back.exportPrefs.variants[0].frameRate, .fps(30))
        XCTAssertEqual(back.elements, file.elements)
        // The whole file, not only what the web's case reads.
        XCTAssertEqual(back, file)
    }

    func testRejectsTextThatIsNotJSON() {
        XCTAssertTrue(refusal("not json at all")?.contains("valid JSON") == true)
    }

    func testRejectsAJSONFileThatIsNotOurs() {
        XCTAssertTrue(refusal(#"{"hello":"world"}"#)?.contains("not an Atelier project file") == true)
    }

    func testRejectsAFileFromANewerFormatRatherThanHalfReadingIt() {
        var o = toProjectFile(sampleDoc()).json.objectValue ?? [:]
        o["version"] = .number(Double(projectDocVersion + 1))
        XCTAssertTrue(refusal(JSONValue.object(o).serialized())?.contains("newer version") == true)
    }

    func testRejectsAFileWithNoElementsListOrNoFormat() {
        var noElements = toProjectFile(sampleDoc()).json.objectValue ?? [:]
        noElements["elements"] = nil
        XCTAssertNotNil(refusal(JSONValue.object(noElements).serialized()))
        var noFormat = toProjectFile(sampleDoc()).json.objectValue ?? [:]
        noFormat["settings"] = [:]
        XCTAssertNotNil(refusal(JSONValue.object(noFormat).serialized()))
    }

    func testReplaysTheDocumentMigrationsForAnOlderFile() throws {
        // A v6-era file: variants had no explicit frame rate, and nothing had
        // a capture-time shift before v5.
        var old = toProjectFile(sampleDoc()).json.objectValue ?? [:]
        old["version"] = 4
        old["settings"] = ["aspectId": "16:9"]
        old["exportPrefs"] = [
            "fileName": nil,
            "variants": [["id": "v1", "aspectId": "source", "resolution": "source", "overlays": true]],
        ]
        let back = try XCTUnwrap(parsed(JSONValue.object(old).serialized()))
        XCTAssertEqual(back.version, projectDocVersion)
        XCTAssertEqual(back.settings.timeShift, TimeShift(minutes: 0, days: 0))
        XCTAssertEqual(back.exportPrefs.variants[0].frameRate, .source)
        XCTAssertEqual(back.outputTransform, .rec709ToSrgb)
    }

    func testFillsInOptionalHalvesAFileLeftOut() throws {
        let minimal: JSONValue = [
            "kind": .string(projectFileKind),
            "version": .number(Double(projectDocVersion)),
            "settings": ["aspectId": "1:1"],
            "elements": [],
        ]
        let back = try XCTUnwrap(parsed(minimal.serialized()))
        XCTAssertEqual(back.name, "")
        XCTAssertNil(back.theme)
        XCTAssertEqual(back.lutStack, [])
        XCTAssertEqual(back.outputTransform, OutputTransform.none)
        XCTAssertEqual(back.exportPrefs.variants.count, 1)
        XCTAssertEqual(back.guides, .default)
        // A file from before the outro existed lands on none, like a migrated doc.
        XCTAssertNil(back.outro)
    }
}

final class ApplyProjectFileTests: XCTestCase {
    func testReplacesThePortableHalfAndKeepsIdentityMediaTrimsAndName() {
        let file = toProjectFile(sampleDoc())
        var target = createProjectDoc("Autre projet", "16:9", [], .default)
        target.media = ProjectMedia(
            files: [SavedMediaRef(name: "OTHER.MP4", size: 1, lastModified: 1)],
            activeId: "OTHER",
            trims: ["OTHER": SavedTrim(start: 1, end: 4, duration: 6)],
            develops: ["OTHER": SavedDevelop(settings: dev { $0.contrast = 12 })]
        )
        let next = applyProjectFile(target, file, now: 1000)

        XCTAssertEqual(next.id, target.id)
        XCTAssertEqual(next.name, "Autre projet")
        XCTAssertEqual(next.createdAt, target.createdAt)
        XCTAssertEqual(next.updatedAt, 1000)
        XCTAssertEqual(next.media.files[0].name, "OTHER.MP4")
        // The imported settings say nothing about this footage's in/out points.
        XCTAssertEqual(next.media.trims, ["OTHER": SavedTrim(start: 1, end: 4, duration: 6)])
        XCTAssertEqual(next.media.develops["OTHER"]?.settings.contrast, 12)

        XCTAssertEqual(next.settings.aspectId, "9:16")
        XCTAssertEqual(next.elements, file.elements)
        XCTAssertEqual(next.lutStack[0].name, "Mon look.cube")
        XCTAssertEqual(next.exportPrefs.fileName, "sunset")
        // Scenes and the outro travel too — importing as a new project used to
        // silently drop the intro.
        XCTAssertEqual(next.scenes, file.scenes)
        XCTAssertEqual(next.outro, file.outro)
    }

    func testCopiesSoTheImportedFileCannotBeMutatedThroughTheProject() {
        let file = toProjectFile(sampleDoc())
        var next = applyProjectFile(createProjectDoc("X", "16:9", [], .default), file)
        next.elements[0].x = 0.42
        XCTAssertNotEqual(file.elements[0].x, 0.42)
    }
}

final class ProjectFileNameTests: XCTestCase {
    func testSlugsTheProjectNameAndKeepsTheDoubleExtension() {
        XCTAssertEqual(projectFileName("Vol du soir"), "vol-du-soir.atelier.json")
        XCTAssertEqual(projectFileName("Été — Nice #2"), "ete-nice-2.atelier.json")
    }

    func testFallsBackWhenTheNameHasNothingToSlug() {
        XCTAssertEqual(projectFileName("   "), "project.atelier.json")
        XCTAssertEqual(projectFileName("★"), "project.atelier.json")
    }

    // No web case: the slice comes AFTER the trim, as `.slice(0, 60)` does.
    func testCutsAtSixtyCharactersAfterTheEndsAreTrimmed() {
        let name = "  " + String(repeating: "a", count: 59) + " b"
        XCTAssertEqual(projectFileName(name), String(repeating: "a", count: 59) + "-" + projectFileExtension)
    }
}

final class ProjectFileSourcesTests: XCTestCase {
    func testNeverCarriesASourceIdATemplateComesFromNoSource() {
        let doc = createProjectDoc("mine", "16:9", [], .default)
        let file = toProjectFile(doc.portable, name: doc.name)
        XCTAssertNil(file.json.objectValue?["sourceId"])
        XCTAssertNil(JSONValue.parse(serializeProjectFile(file))?.objectValue?["sourceId"])
    }

    func testKeepsTheReceivingProjectInItsOwnSourceOnImport() {
        var doc = createProjectDoc("mine", "16:9", [], .default)
        doc.sourceId = "winnow.steeve.website"
        let file = toProjectFile(doc.portable, name: doc.name)
        XCTAssertEqual(applyProjectFile(doc, file).sourceId, "winnow.steeve.website")
    }

    // No web case: an element this build cannot read travels in the file, in place.
    func testAnUnreadElementTravelsInTheFileWhereItStood() throws {
        var doc = createProjectDoc("mine", "16:9", [createTextElement("A", id: "a")], .default)
        doc.unreadElements = [UnreadElement(after: "a", json: ["id": "h", "kind": "hologram"])]
        let back = try XCTUnwrap(parsed(serializeProjectFile(toProjectFile(doc))))
        XCTAssertEqual(back.unreadElements, doc.unreadElements)
        let applied = applyProjectFile(createProjectDoc("other", "16:9", [], .default), back)
        XCTAssertEqual(applied.json.objectValue?["elements"]?.arrayValue?.count, 2)
    }
}
