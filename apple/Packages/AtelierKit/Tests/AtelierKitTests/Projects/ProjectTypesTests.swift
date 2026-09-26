// Port of `src/shared/projects/project-types.test.ts`, case for case. The web
// hands `migrateProjectDoc` a cast object with fields MISSING; here a missing
// field only exists in JSON, so those cases go through `readProjectDoc` — the
// store's read, which is `migrateProjectDoc(stored)` — and the cases that set
// a typed field on an old version call `migrateProjectDoc` directly. A block
// with no web twin pins the reader and the writer.

import XCTest
@testable import AtelierKit

/// A phase-2 document as JSON: version 1, no theme field at all, and guides
/// that predate the safe zone's quarter-turn mode.
private func v1DocJSON() -> [String: JSONValue] {
    let doc = createProjectDoc("legacy", "16:9", defaultElementsPreset(), .default)
    var o = doc.json.objectValue ?? [:]
    var guides = o["guides"]?.objectValue ?? [:]
    guides["safeZoneOrientation"] = nil
    o["guides"] = .object(guides)
    o["version"] = 1
    o["theme"] = nil
    return o
}

/// The same document typed, on an old version — what a typed migration takes.
private func v1Doc() -> ProjectDoc {
    var doc = createProjectDoc("legacy", "16:9", defaultElementsPreset(), .default)
    doc.version = 1
    return doc
}

private func read(_ o: [String: JSONValue], file: StaticString = #filePath, line: UInt = #line) -> ProjectDoc? {
    let doc = readProjectDoc(.object(o))
    XCTAssertNotNil(doc, "a project", file: file, line: line)
    return doc
}

final class MigrateProjectDocTests: XCTestCase {
    func testBringsAV1DocumentToTheCurrentVersionWithANullTheme() throws {
        let migrated = try XCTUnwrap(read(v1DocJSON()))
        XCTAssertEqual(migrated.version, projectDocVersion)
        XCTAssertNil(migrated.theme)
        // v3: the export matrix defaults to the one source-faithful variant.
        XCTAssertNil(migrated.exportPrefs.fileName)
        XCTAssertEqual(migrated.exportPrefs.variants.count, 1)
        XCTAssertEqual(migrated.exportPrefs.variants[0].aspectId, "source")
        // v4: no look was set, so the grade stack is empty.
        XCTAssertEqual(migrated.lutStack, [])
        // v5: no correction, which is exactly what an old project meant.
        XCTAssertEqual(migrated.settings.timeShift, TimeShift(minutes: 0, days: 0))
        // v6: no output transform, so the grade is delivered exactly as authored.
        XCTAssertEqual(migrated.outputTransform, OutputTransform.none)
        // v7: the source cadence, the only one an old export could produce.
        XCTAssertEqual(migrated.exportPrefs.variants[0].frameRate, .source)
        // v8: no trim, so every clip reopens at its full length.
        XCTAssertEqual(migrated.media.trims, [:])
        // v15: no develop, so every media reopens as shot.
        XCTAssertEqual(migrated.media.develops, [:])
        // v9: the safe zone follows the frame's orientation.
        XCTAssertEqual(migrated.guides.safeZoneOrientation, .auto)
        // v12/v13: no intro and no outro — an old export ends on the footage.
        XCTAssertEqual(migrated.scenes, [])
        XCTAssertNil(migrated.outro)
    }

    func testKeepsASafeZoneRotationTheAuthorPinned() throws {
        var stored = v1DocJSON()
        stored["version"] = 8
        var guides = GuidesState.default.json.objectValue ?? [:]
        guides["safeZone"] = "reels"
        guides["safeZoneOrientation"] = "upright"
        stored["guides"] = .object(guides)
        let migrated = try XCTUnwrap(read(stored))
        XCTAssertEqual(migrated.guides.safeZoneOrientation, .upright)
        XCTAssertEqual(migrated.guides.safeZone, "reels")
    }

    func testGivesAPreV7VariantTheSourceFrameRateKeepingItsOtherChoices() throws {
        var stored = v1DocJSON()
        stored["version"] = 6
        stored["exportPrefs"] = [
            "fileName": "vol",
            "variants": [["id": "a", "aspectId": "9:16", "resolution": 1080, "overlays": false]],
        ]
        let v = try XCTUnwrap(read(stored)?.exportPrefs.variants.first)
        XCTAssertEqual(v.frameRate, .source)
        XCTAssertEqual(v.aspectId, "9:16")
        XCTAssertEqual(v.resolution, .shortSide(1080))
        XCTAssertFalse(v.overlays)
    }

    func testGivesAPreV9VariantTheSpeedItWasExportedAtNormal() throws {
        var stored = v1DocJSON()
        stored["version"] = 8
        stored["exportPrefs"] = [
            "fileName": nil,
            "variants": [["id": "a", "aspectId": "source", "resolution": "source", "frameRate": 30, "overlays": true]],
        ]
        let v = try XCTUnwrap(read(stored)?.exportPrefs.variants.first)
        XCTAssertEqual(v.speed, 1)
        XCTAssertEqual(v.frameRate, .fps(30))
    }

    func testKeepsACaptureTimeCorrectionThatIsAlreadySet() {
        var doc = v1Doc()
        doc.settings.timeShift = TimeShift(minutes: -90, days: 1)
        XCTAssertEqual(migrateProjectDoc(doc).settings.timeShift, TimeShift(minutes: -90, days: 1))
    }

    func testCarriesAV3SingleLookIntoAOneLayerStack() {
        var doc = v1Doc()
        doc.lut = SavedLut(selected: "kodak-2383", customName: nil, customText: nil, intensity: 0.6)
        let migrated = migrateProjectDoc(doc)
        XCTAssertEqual(migrated.lutStack.count, 1)
        XCTAssertEqual(migrated.lutStack[0].source, "builtin:kodak-2383")
        XCTAssertEqual(migrated.lutStack[0].intensity, 0.6)
        XCTAssertTrue(migrated.lutStack[0].enabled)
    }

    func testCarriesAV3CustomLookAndDropsOneWhoseTextIsGone() {
        var withText = v1Doc()
        withText.lut = SavedLut(selected: "custom", customName: "mine.cube", customText: "LUT_3D_SIZE 2", intensity: 1)
        XCTAssertEqual(migrateProjectDoc(withText).lutStack.first?.source, "custom")

        var orphan = v1Doc()
        orphan.lut = SavedLut(selected: "custom", customName: "gone.cube", customText: nil, intensity: 1)
        XCTAssertEqual(migrateProjectDoc(orphan).lutStack, [])
    }

    func testLeavesAnOlderDocumentsGradeUntouchedTransformOff() throws {
        // A saved project must look on reopen exactly as it did when it was closed.
        var stored = createProjectDoc("pre-transform", "16:9", [], .default).json.objectValue ?? [:]
        stored["version"] = 5
        stored["outputTransform"] = nil
        let migrated = try XCTUnwrap(read(stored))
        XCTAssertEqual(migrated.version, projectDocVersion)
        XCTAssertEqual(migrated.outputTransform, OutputTransform.none)
    }

    func testKeepsAnOutputTransformADocumentAlreadyCarries() {
        var doc = createProjectDoc("graded", "16:9", [], .default)
        doc.outputTransform = .rec709ToSrgb
        doc.version = 5
        XCTAssertEqual(migrateProjectDoc(doc).outputTransform, .rec709ToSrgb)
    }

    func testFilesAPreV14DocumentUnderThisDeviceTheOnlyPlaceItCanBe() throws {
        var stored = createProjectDoc("here", "16:9", [], .default).json.objectValue ?? [:]
        stored["version"] = 13
        stored["sourceId"] = nil
        XCTAssertEqual(try XCTUnwrap(read(stored)).sourceId, "local")
    }

    func testNeverReassignsADocumentThatAlreadyNamesItsSource() {
        var doc = createProjectDoc("remote", "16:9", [], .default)
        doc.sourceId = "winnow.steeve.website"
        XCTAssertEqual(migrateProjectDoc(doc).sourceId, "winnow.steeve.website")
    }

    func testIsIdempotentAndLeavesCurrentDocumentsUntouched() {
        var doc = createProjectDoc("now", "9:16", [], .default)
        doc.theme = themeFromPreset("or-cine")
        let migrated = migrateProjectDoc(doc)
        XCTAssertEqual(migrated, doc)
        XCTAssertEqual(migrated.theme?.presetId, "or-cine")
        let once = migrateProjectDoc(v1Doc())
        XCTAssertEqual(migrateProjectDoc(once), once)
    }
}

final class CreateProjectDocTemplateTests: XCTestCase {
    func testCopiesThePortableHalfIncludingTheThemeButNeverTheMedia() throws {
        var source = createProjectDoc("src", "9:16", defaultElementsPreset(), .default)
        source.theme = themeFromPreset("pixel-crt")
        source.media = ProjectMedia(
            files: [SavedMediaRef(name: "a.mp4", size: 1, lastModified: 1)],
            activeId: "a",
            trims: ["a": SavedTrim(start: 5, end: 12, duration: 15)],
            develops: ["a": SavedDevelop(settings: dev { $0.exposure = 1 }, hash: "h")]
        )
        var copy = createProjectDoc("copy", "1:1", [], .default, template: source)
        XCTAssertEqual(copy.theme?.presetId, "pixel-crt")
        XCTAssertEqual(copy.elements.count, source.elements.count)
        XCTAssertEqual(copy.media.files.count, 0)
        // In/out points are the footage's, not the template's — and so is a develop.
        XCTAssertEqual(copy.media.trims, [:])
        XCTAssertEqual(copy.media.develops, [:])
        XCTAssertEqual(copy.settings.aspectId, "1:1") // the modal's choice wins
        // A copy — mutating the copy's theme never touches the source.
        copy.theme?.style.color = "#000001"
        XCTAssertNotEqual(source.theme?.style.color, "#000001")
    }
}

// No web spec: the reader and the writer — the port's own contract with the
// documents the web app writes.
final class ProjectDocJSONTests: XCTestCase {
    private func sample() -> ProjectDoc {
        var doc = createProjectDoc("Vol du soir", "9:16", defaultElementsPreset(), .default, now: 1000, id: "p1")
        doc.settings.timeScale = TimeScaleSetting(mode: .manual, scale: 0.25, clipId: "dji_0001")
        doc.lutStack = [SavedLutLayer(id: "l1", source: "builtin:kodak-2383", name: "Kodak", intensity: 0.6)]
        doc.outputTransform = .rec709ToSrgb
        doc.theme = themeFromPreset("or-cine")
        doc.scenes = [createIntroScene()]
        doc.outro = createOutroCard("See you")
        doc.media = ProjectMedia(
            dirHandle: Data([1, 2, 3]),
            files: [SavedMediaRef(name: "DJI_0001.MP4", size: 12, lastModified: 3, hash: "abc")],
            activeId: "DJI_0001",
            trims: ["DJI_0001": SavedTrim(start: 2, end: 9, duration: 12)],
            develops: ["DJI_0001": SavedDevelop(settings: dev { $0.exposure = 0.7 }, hash: "abc")]
        )
        doc.thumbnail = Data([0xFF, 0xD8, 0xFF])
        doc.durationSeconds = 42
        return doc
    }

    func testReadingBackWhatWasWrittenIsTheIdentity() throws {
        let doc = sample()
        let back = try XCTUnwrap(readProjectDoc(doc.json))
        XCTAssertEqual(back, doc)
        XCTAssertEqual(back.json, doc.json)
        // …and through text, as a store on disk holds it.
        XCTAssertEqual(readProjectDoc(JSONValue.parse(doc.json.serialized())), doc)
    }

    func testWritesTheWebsShapeWithTheMachineBoundFieldsAsBase64() throws {
        let o = try XCTUnwrap(sample().json.objectValue)
        XCTAssertEqual(Set(o.keys), [
            "version", "id", "name", "createdAt", "updatedAt", "settings", "elements", "guides", "lut", "lutStack",
            "outputTransform", "lutFilm", "theme", "scenes", "outro", "exportPrefs", "sourceId", "media", "thumbnail",
            "durationSeconds",
        ])
        XCTAssertEqual(o["lut"], ["selected": "none", "customName": nil, "customText": nil, "intensity": 1])
        XCTAssertEqual(o["lutFilm"], JSONValue.null)
        XCTAssertEqual(o["thumbnail"], .string(Data([0xFF, 0xD8, 0xFF]).base64EncodedString()))
        XCTAssertEqual(o["media"]?.objectValue?["dirHandle"], .string(Data([1, 2, 3]).base64EncodedString()))
        // An absent shift or scale is left out, as `JSON.stringify` leaves an undefined.
        var bare = sample()
        bare.settings.timeShift = nil
        bare.settings.timeScale = nil
        XCTAssertEqual(bare.settings.json, ["aspectId": "9:16"])
    }

    func testCarriesWhatThisBuildDoesNotKnowAndAnElementItCannotRead() throws {
        var o = try XCTUnwrap(sample().json.objectValue)
        o["future"] = ["x": 1]
        var settings = o["settings"]?.objectValue ?? [:]
        settings["futureSetting"] = true
        o["settings"] = .object(settings)
        var media = o["media"]?.objectValue ?? [:]
        media["futureMedia"] = "kept"
        o["media"] = .object(media)
        // A kind a newer build added, between the first and the second element.
        var elements = o["elements"]?.arrayValue ?? []
        let hologram: JSONValue = ["id": "h1", "kind": "hologram", "x": 0.5]
        elements.insert(hologram, at: 1)
        o["elements"] = .array(elements)

        let doc = try XCTUnwrap(readProjectDoc(.object(o)))
        XCTAssertEqual(doc.carried["future"], ["x": 1])
        XCTAssertEqual(doc.settings.carried["futureSetting"], true)
        XCTAssertEqual(doc.media.carried["futureMedia"], "kept")
        XCTAssertEqual(doc.elements.count, elements.count - 1)
        XCTAssertEqual(doc.unreadElements, [UnreadElement(after: doc.elements[0].id, json: hologram)])
        // Written back where it stood.
        XCTAssertEqual(doc.json, .object(o))
    }

    func testAnUnreadElementWhoseNeighbourIsGoneKeepsItsPlaceAtTheEnd() {
        let a = createTextElement("A", id: "a")
        let b = createTextElement("B", id: "b")
        let x: JSONValue = ["id": "x", "kind": "hologram"]
        let head: JSONValue = 7
        let list = readProjectElements(.array([head, a.json, x, b.json]))
        XCTAssertEqual(list.elements.map(\.id), ["a", "b"])
        XCTAssertEqual(list.unread, [UnreadElement(after: nil, json: head), UnreadElement(after: "a", json: x)])
        XCTAssertEqual(projectElementsJSON(list.elements, list.unread), .array([head, a.json, x, b.json]))
        XCTAssertEqual(projectElementsJSON([b], list.unread), .array([head, b.json, x]))
    }

    func testADocumentWithNoVersionRunsNoStepAndANewerOneIsKeptAsItIs() throws {
        var o = createProjectDoc("x", "16:9", [], .default).json.objectValue ?? [:]
        o["version"] = nil
        o["lut"] = ["selected": "kodak-2383", "customName": nil, "customText": nil, "intensity": 1]
        o["settings"] = ["aspectId": "16:9"]
        let unversioned = try XCTUnwrap(read(o))
        // `undefined < 4` is false on the web: the legacy look stays legacy.
        XCTAssertEqual(unversioned.lutStack, [])
        XCTAssertNil(unversioned.settings.timeShift)
        XCTAssertEqual(unversioned.version, projectDocVersion)

        o["version"] = 17
        let newer = try XCTUnwrap(read(o))
        XCTAssertEqual(newer.version, 17)
        XCTAssertEqual(newer.json.objectValue?["version"], 17)
    }

    func testRefusesWhatIsNotAProjectAndListsTheRestNewestFirst() {
        XCTAssertNil(readProjectDoc(nil))
        XCTAssertNil(readProjectDoc(["name": "no id"]))
        XCTAssertNil(readProjectDoc([1, 2]))
        let old = createProjectDoc("old", "16:9", [], .default, now: 1, id: "a")
        let new = createProjectDoc("new", "16:9", [], .default, now: 5, id: "b")
        let tie = createProjectDoc("tie", "16:9", [], .default, now: 1, id: "c")
        XCTAssertEqual(readProjectList([old.json, "junk", new.json, tie.json]).map(\.id), ["b", "a", "c"])
    }
}
