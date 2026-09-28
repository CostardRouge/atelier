// Port of `src/shared/develop/roll-file.test.ts` against the web's own two
// steps (`toRollFile` → `serializeRollFile` → `readRollFile` →
// `rollDocFromFile`) and the wire (`toWireDoc` / `fromWireDoc`, from
// `roll-remote.ts`). `RollTests.swift` ports the same cases against
// `Roll.swift`'s one-step `parseRollFile`.

import XCTest
@testable import AtelierKit

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

private func parsed(_ text: String, file: StaticString = #filePath, line: UInt = #line) -> RollFile? {
    switch readRollFile(text) {
    case .success(let f): return f
    case .failure(let e):
        XCTFail(e.message, file: file, line: line)
        return nil
    }
}

final class RollFilePortableTests: XCTestCase {
    func testNamesTheFileAfterTheRoll() {
        XCTAssertEqual(rollFileName("Islande — jour 3"), "islande-jour-3.roll.json")
        XCTAssertEqual(rollFileName("   "), "roll.roll.json")
    }

    func testCarriesEverythingButTheIdTheSourceAndTheTimestamps() {
        let file = toRollFile(sample(), exportedAt: 0)
        XCTAssertEqual(file.kind, rollFileKind)
        XCTAssertEqual(file.version, rollDocVersion)
        XCTAssertEqual(file.exportedAt, "1970-01-01T00:00:00.000Z")
        XCTAssertEqual(file.json.objectValue?.keys.sorted(), ["export", "exportedAt", "kind", "name", "pictures", "version"])
        XCTAssertEqual(file.pictures[0].ref.hash, "h1")
        XCTAssertTrue(serializeRollFile(file).hasSuffix("}\n"))
    }

    func testComesBackAsANewRollOnTheImportingSourceHoldingExactlyWhatWasWritten() {
        let original = sample()
        guard let file = parsed(serializeRollFile(toRollFile(original, exportedAt: 0))) else { return }
        let imported = rollDocFromFile(file, now: 9000, sourceId: "local")
        XCTAssertNotEqual(imported.id, original.id)
        XCTAssertEqual(imported.sourceId, "local")
        XCTAssertEqual(imported.createdAt, 9000)
        XCTAssertEqual(imported.updatedAt, 9000)
        XCTAssertEqual(imported.name, original.name)
        // Each picture's look travels with it — under a fresh id (below).
        func withoutIds(_ pictures: [RollPicture]) -> [RollPicture] { pictures.map { var p = $0; p.id = ""; return p } }
        XCTAssertEqual(withoutIds(imported.pictures), withoutIds(original.pictures))
        XCTAssertNotEqual(imported.pictures[0].id, original.pictures[0].id)
        XCTAssertEqual(imported.pictures[0].grade?.output, .rec709ToSrgb)
        XCTAssertEqual(imported.export, original.export)
    }

    func testGivesEveryPictureAFreshIdSoOneFileImportedTwiceIsTwoRollsThatShareNothing() {
        guard let file = parsed(serializeRollFile(toRollFile(sample(), exportedAt: 0))) else { return }
        var n = 0
        let first = rollDocFromFile(file, now: 1, sourceId: "local") { n += 1; return "a\(n)" }
        let second = rollDocFromFile(file, now: 2, sourceId: "local") { n += 1; return "b\(n)" }
        XCTAssertEqual(first.pictures.map(\.id), ["a1"])
        XCTAssertEqual(second.pictures.map(\.id), ["b2"])
        XCTAssertEqual(file.pictures[0].id, "p1")
    }

    func testHandsAPreV5FilesOneLookToEveryPicture() {
        let text = JSONValue.object([
            "kind": .string(rollFileKind), "version": 4, "name": "Old",
            "pictures": [["id": "a", "ref": ["name": "a.jpg", "size": 1]], ["id": "b", "ref": ["name": "b.jpg", "size": 1]]],
            "grade": ["layers": [], "output": "rec709-to-srgb"],
        ]).serialized()
        guard let file = parsed(text) else { return }
        XCTAssertEqual(file.pictures.map { $0.grade?.output }, [.rec709ToSrgb, .rec709ToSrgb])
        XCTAssertNil(file.json.objectValue?["grade"])
    }

    func testRefusesWhatItCannotReadSayingWhy() {
        XCTAssertEqual(readRollFile("{nope"), .failure(.notJSON))
        XCTAssertEqual(RollFileError.notJSON.message, "That file is not valid JSON.")
        guard case .failure = readRollFile("[]") else { return XCTFail("a list is not a roll") }
        guard case .failure = readRollFile(JSONValue.object(["kind": "atelier/road-trip", "pictures": []]).serialized()) else {
            return XCTFail("a trip is not a roll")
        }
        let newer = readRollFile(JSONValue.object(["kind": .string(rollFileKind), "version": .number(Double(rollDocVersion + 1)), "pictures": []]).serialized())
        guard case .failure(let error) = newer else { return XCTFail("a newer file was read") }
        XCTAssertTrue(error.message.contains("newer version"), error.message)
        guard case .failure = readRollFile(JSONValue.object(["kind": .string(rollFileKind), "version": 1]).serialized()) else {
            return XCTFail("a file with no pictures was read")
        }
    }
}

final class RollWireTests: XCTestCase {
    func testLeavesWithoutItsSourceAndComesBackStampedFromTheRequest() throws {
        let doc = sample()
        let wire = toWireDoc(doc)
        XCTAssertNil(wire.objectValue?["sourceId"])
        let back = try fromWireDoc(JSONValue.parse(wire.serialized()), "r1", "winnow.example")
        XCTAssertEqual(back, doc)
        var forged = wire.objectValue!
        forged["id"] = "forged"
        let stamped = try fromWireDoc(.object(forged), "r1", "other.host")
        XCTAssertEqual(stamped.id, "r1")
        XCTAssertEqual(stamped.sourceId, "other.host")
    }

    func testRefusesAStoredBodyThatIsNotARoll() {
        XCTAssertThrowsError(try fromWireDoc(["name": "a trip"], "r1", "winnow.example")) { error in
            XCTAssertTrue((error as? WireDocError)?.message.contains("not a roll") == true, "\(error)")
        }
        XCTAssertThrowsError(try fromWireDoc("text", "r1", "winnow.example")) { error in
            XCTAssertTrue((error as? WireDocError)?.message.contains("not a roll") == true, "\(error)")
            XCTAssertEqual((error as? WireDocError)?.kind, .protocol)
        }
    }
}
