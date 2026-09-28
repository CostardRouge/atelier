// Port of `src/shared/roadtrip/trip-file.test.ts`, case for case. The web's
// "a key is absent" (`'sourceId' in file`) is read on the file's JSON here,
// and its "does not share structure" holds by construction — every record is
// a value — so it is kept as written, mutating the copy.

import Foundation
import XCTest
@testable import AtelierKit

private func trip() -> TripDoc {
    var doc = createTripDoc("Australie", "2025-07-01", "2025-07-10")
    var post = createTripPost(.reel, "2025-07-03", "Sunset over the gorge")
    post.title = "Sunset over the gorge"
    post.projectId = "studio-project-in-this-browser"
    post.media = SavedMediaRef(name: "DJI_0001.MP4", size: 100, lastModified: 5, hash: "abc")
    doc.posts = [post]
    return doc
}

private func roundTrip(_ doc: TripDoc, file: StaticString = #filePath, line: UInt = #line) -> TripFile {
    switch parseTripFile(serializeTripFile(toTripFile(doc))) {
    case .success(let parsed): return parsed
    case .failure(let error):
        XCTFail(error.message, file: file, line: line)
        return toTripFile(doc)
    }
}

private func parsed(_ json: JSONValue, file: StaticString = #filePath, line: UInt = #line) -> TripFile? {
    switch parseTripFile(json.serialized()) {
    case .success(let f): return f
    case .failure(let error):
        XCTFail(error.message, file: file, line: line)
        return nil
    }
}

private func refusal(_ text: String) -> String? {
    if case .failure(let error) = parseTripFile(text) { return error.message }
    return nil
}

/// The file's JSON as a record, for the cases that delete or change a key.
private func tripRecord(_ file: TripFile) -> [String: JSONValue] { file.json.objectValue ?? [:] }

/// `posts.forEach((p) => …)` on a file's JSON.
private func eachPost(_ o: inout [String: JSONValue], _ f: (inout [String: JSONValue]) -> Void) {
    o["posts"] = .array((o["posts"]?.arrayValue ?? []).map { post in
        var p = post.objectValue ?? [:]
        f(&p)
        return .object(p)
    })
}

private func withoutBadgeKey(_ p: inout [String: JSONValue], _ key: String) {
    var badge = p["badge"]?.objectValue ?? [:]
    badge[key] = nil
    p["badge"] = .object(badge)
}

final class TripFileBackupTests: XCTestCase {
    func testRoundTripsATripThroughText() {
        let file = roundTrip(trip())
        XCTAssertEqual(file.name, "Australie")
        XCTAssertEqual(file.startDate, "2025-07-01")
        XCTAssertEqual(file.endDate, "2025-07-10")
        XCTAssertEqual(file.posts.count, 1)
        XCTAssertEqual(file.posts[0].title, "Sunset over the gorge")
    }

    func testCarriesTheMediaReferenceHashIncludedThatIsHowATripFindsItsPicturesElsewhere() {
        XCTAssertEqual(roundTrip(trip()).posts[0].media,
                       SavedMediaRef(name: "DJI_0001.MP4", size: 100, lastModified: 5, hash: "abc"))
    }

    func testDropsProjectIdWhichAddressesAStudioProjectInThisBrowser() {
        XCTAssertNil(roundTrip(trip()).posts[0].projectId)
    }

    func testNeverWritesSourceIdAnImportedTripBelongsToTheSourceThatImportsIt() {
        var doc = trip()
        doc.sourceId = "winnow.example"
        XCTAssertNil(tripRecord(toTripFile(doc))["sourceId"])
        XCTAssertFalse(serializeTripFile(toTripFile(doc)).contains("sourceId"))
    }

    func testCarriesAStageOriginTheOnePointerOutsideTheBrowserKeptOnPurpose() {
        var doc = trip()
        var stage = createTripStage("", "", "2025-07-02", "2025-07-04", places: [createTripPlace("Kalbarri")])
        stage.origin = StageOrigin(sourceId: "winnow.example", chapterId: "42", importedAt: 1)
        doc.stages = [stage]
        XCTAssertEqual(roundTrip(doc).stages[0].origin, StageOrigin(sourceId: "winnow.example", chapterId: "42", importedAt: 1))
    }

    func testCarriesTheGradeACustomCubeAsTextInsideItsLayer() {
        var doc = trip()
        doc.grade = SavedGrade(layers: [
            SavedLutLayer(id: "l1", source: "builtin:dji-d-log-to-rec709", name: "D-Log", customText: nil, intensity: 1,
                          enabled: true),
            SavedLutLayer(id: "l2", source: "custom", name: "mine.cube",
                          customText: "TITLE \"mine\"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n",
                          intensity: 0.6, enabled: false),
        ], output: .rec709ToSrgb)
        doc.posts[0].grade = SavedGrade(layers: [], output: .none)
        let file = roundTrip(doc)
        XCTAssertEqual(file.grade, doc.grade)
        XCTAssertEqual(file.posts[0].grade, SavedGrade(layers: [], output: .none))
        XCTAssertEqual(tripDocFromFile(file).grade, doc.grade)
    }

    func testLandsAFileWrittenBeforeGradesExistedOnAnEmptyGrade() throws {
        var o = tripRecord(toTripFile(trip()))
        o["version"] = 9
        o["grade"] = nil
        eachPost(&o) { $0["grade"] = nil }
        let file = try XCTUnwrap(parsed(.object(o)))
        XCTAssertEqual(file.grade, SavedGrade(layers: [], output: .none, film: nil))
        XCTAssertNil(file.posts[0].grade)
    }

    func testCarriesASlidesDevelopAndTheTripsPresetsAndLandsAnOlderFileOnNone() throws {
        var doc = trip()
        doc.posts[0].badge.develop = dev { $0.exposure = 0.7; $0.highlights = -40 }
        doc.developPresets = [DevelopPreset(id: "p1", name: "Desert noon", settings: dev { $0.whites = -20 })]
        let file = roundTrip(doc)
        XCTAssertEqual(file.posts[0].badge.develop, doc.posts[0].badge.develop)
        XCTAssertEqual(file.developPresets, doc.developPresets)
        // `tripDocFromFile` starts from `createTripDoc`, so a field forgotten
        // there compiles and drops silently — this line is what catches it.
        XCTAssertEqual(tripDocFromFile(file).developPresets, doc.developPresets)
        XCTAssertEqual(tripDocFromFile(file).posts[0].badge.develop, doc.posts[0].badge.develop)

        var old = tripRecord(toTripFile(trip()))
        old["version"] = 14
        old["developPresets"] = nil
        eachPost(&old) { withoutBadgeKey(&$0, "develop") }
        let back = try XCTUnwrap(parsed(.object(old)))
        XCTAssertEqual(back.developPresets, [])
        XCTAssertNil(back.posts[0].badge.develop)
    }

    func testCarriesAPicturesOwnGradeAndLandsAnOlderFileOnFollowThePiece() throws {
        let own = SavedGrade(layers: [], output: .rec709ToSrgb)
        var doc = trip()
        doc.posts[0].badge.grade = own
        doc.posts[0].slides = [createPostSlide(SavedMediaRef(name: "b.jpg", size: 1, lastModified: 1))]
        doc.posts[0].slides[0].grade = own
        let file = roundTrip(doc)
        XCTAssertEqual(file.posts[0].badge.grade, own)
        XCTAssertEqual(file.posts[0].slides[0].grade, own)
        XCTAssertEqual(tripDocFromFile(file).posts[0].badge.grade, own)
        XCTAssertEqual(tripDocFromFile(file).posts[0].slides[0].grade, own)

        var old = tripRecord(toTripFile(trip()))
        old["version"] = 21
        eachPost(&old) { withoutBadgeKey(&$0, "grade") }
        XCTAssertNil(try XCTUnwrap(parsed(.object(old))).posts[0].badge.grade)
    }

    func testCarriesTheTripsCarItsColourFinishAndGearAndLandsAnOlderFileOnTheDefault() throws {
        var doc = trip()
        var gear = defaultCarSpec().gear
        gear.rack = false
        doc.car = CarSpec(model: defaultCarSpec().model, color: "#1f3b2f", finish: .gloss, gear: gear)
        let file = roundTrip(doc)
        XCTAssertEqual(file.car.color, "#1f3b2f")
        XCTAssertEqual(file.car.finish, .gloss)
        XCTAssertFalse(file.car.gear.rack)
        XCTAssertEqual(tripDocFromFile(file).car, doc.car)

        var older = try XCTUnwrap(JSONValue.parse(serializeTripFile(toTripFile(trip())))?.objectValue)
        older["car"] = nil
        older["version"] = 18
        XCTAssertEqual(try XCTUnwrap(parsed(.object(older))).car, CarSpec.default)

        var junk = try XCTUnwrap(JSONValue.parse(serializeTripFile(toTripFile(trip())))?.objectValue)
        junk["car"] = "black"
        XCTAssertEqual(try XCTUnwrap(parsed(.object(junk))).car, CarSpec.default)
    }

    func testWritesReadableNewlineTerminatedJson() {
        let text = serializeTripFile(toTripFile(trip()))
        XCTAssertTrue(text.hasSuffix("\n"))
        XCTAssertTrue(text.contains("\n  \"kind\": \"atelier/road-trip\""))
    }

    func testNamesTheFileFromTheTripAccentsFlattened() {
        XCTAssertEqual(tripFileName("Été en Corse"), "ete-en-corse.roadtrip.json")
        XCTAssertEqual(tripFileName("  "), "trip.roadtrip.json")
    }
}

final class TripFileParseRefusalTests: XCTestCase {
    func testRejectsTextThatIsNotJson() {
        XCTAssertEqual(parseTripFile("not json at all"), .failure(TripFileError("That file is not valid JSON.")))
    }

    func testRejectsJsonThatIsNotOurs() {
        XCTAssertTrue(refusal(#"{"hello":"world"}"#)?.contains("road-trip file") == true)
    }

    func testRefusesAFileFromANewerAtelierRatherThanHalfReadingIt() {
        var o = tripRecord(toTripFile(trip()))
        o["version"] = .number(Double(tripDocVersion + 1))
        XCTAssertTrue(refusal(JSONValue.object(o).serialized())?.contains("newer version") == true)
    }

    func testRefusesATripWithNoDatesTheyAreTheSpineOfTheModel() {
        var o = tripRecord(toTripFile(trip()))
        o["startDate"] = "someday"
        XCTAssertEqual(parseTripFile(JSONValue.object(o).serialized()), .failure(TripFileError("The file has no trip dates.")))
    }

    func testFillsWhatAnOlderFileNeverWroteWithTheDefaultsANewTripGets() throws {
        var o = tripRecord(toTripFile(trip()))
        o["badgeWords"] = nil
        o["cta"] = nil
        o["hookDefaults"] = nil
        let file = try XCTUnwrap(parsed(.object(o)))
        let fresh = createTripDoc("x", "2025-07-01", "2025-07-10")
        XCTAssertEqual(file.badgeWords, fresh.badgeWords)
        XCTAssertEqual(file.cta, fresh.cta)
    }

    func testDropsTheDestinationAFileWrittenBeforeV27Carries() throws {
        // The route is the legs' business now. An older backup still parses, and
        // the line it used to hold is simply not read back — the legs it carries
        // are what says where the trip went.
        var o = tripRecord(toTripFile(trip()))
        o["version"] = 26
        o["destination"] = "Perth \u{2192} Cairns"
        let file = try XCTUnwrap(parsed(.object(o)))
        XCTAssertNil(tripRecord(file)["destination"])
        let doc = tripDocFromFile(file)
        XCTAssertNil(doc.json.objectValue?["destination"])
        XCTAssertNil(doc.carried["destination"])
    }

    func testStripsAHandEditedProjectIdOnTheWayIn() throws {
        var file = toTripFile(trip())
        file.posts[0].projectId = "smuggled"
        XCTAssertNil(try XCTUnwrap(parsed(file.json)).posts[0].projectId)
    }

    func testIgnoresAHandEditedSourceIdOnTheWayIn() throws {
        var o = tripRecord(toTripFile(trip()))
        o["sourceId"] = "smuggled.example"
        let file = try XCTUnwrap(parsed(.object(o)))
        XCTAssertNil(tripRecord(file)["sourceId"])
        XCTAssertEqual(tripDocFromFile(file).sourceId, "local")
    }

    func testReadsAFileWrittenBeforeTheDocumentHadASource() throws {
        var o = tripRecord(toTripFile(trip()))
        o["version"] = 9
        XCTAssertEqual(try XCTUnwrap(parsed(.object(o))).version, tripDocVersion)
    }
}

final class TripFileDocFromFileTests: XCTestCase {
    func testMintsAFreshIdSoImportingTwiceGivesTwoTrips() {
        let file = roundTrip(trip())
        let a = tripDocFromFile(file)
        let b = tripDocFromFile(file)
        XCTAssertNotEqual(a.id, b.id)
        XCTAssertNotEqual(a.id, trip().id)
    }

    func testStampsItsOwnTimestampsAndCarriesTheContentAcross() {
        let doc = tripDocFromFile(roundTrip(trip()), now: 1234)
        XCTAssertEqual(doc.createdAt, 1234)
        XCTAssertEqual(doc.updatedAt, 1234)
        XCTAssertEqual(doc.version, tripDocVersion)
        XCTAssertEqual(doc.name, "Australie")
        XCTAssertEqual(doc.posts[0].media?.hash, "abc")
        XCTAssertNil(doc.posts[0].projectId)
    }

    func testDoesNotShareStructureWithTheFileItCameFrom() {
        let file = roundTrip(trip())
        var doc = tripDocFromFile(file)
        doc.posts[0].title = "changed"
        XCTAssertEqual(file.posts[0].title, "Sunset over the gorge")
    }

    func testBelongsToTheSourceThatImportsItThisBrowserByDefault() {
        let file = roundTrip(trip())
        XCTAssertEqual(tripDocFromFile(file).sourceId, "local")
        XCTAssertEqual(tripDocFromFile(file, now: 1, sourceId: "winnow.example").sourceId, "winnow.example")
    }
}

final class TripFileKindTests: XCTestCase {
    func testIsStableAStrayJsonIsRejectedOnIt() {
        XCTAssertEqual(tripFileKind, "atelier/road-trip")
        XCTAssertEqual(toTripFile(trip()).kind, tripFileKind)
    }
}

// No web case: the serialiser writes numbers and strings as `JSON.stringify` does.
final class TripFileTextTests: XCTestCase {
    func testWritesNumbersAndEscapesAsJavaScriptDoes() throws {
        var doc = trip()
        doc.name = "Tab\there \"quoted\" / slash"
        doc.posts[0].badge.hookSeconds = 0.0000015
        doc.posts[0].badge.videoSpeed = 1e21
        doc.posts[0].badge.durationSeconds = 2.5
        let file = toTripFile(doc)
        let text = serializeTripFile(file)
        XCTAssertTrue(text.contains(#""name": "Tab\there \"quoted\" / slash""#))
        XCTAssertTrue(text.contains(#""hookSeconds": 0.0000015"#))
        XCTAssertTrue(text.contains(#""videoSpeed": 1e+21"#))
        XCTAssertTrue(text.contains(#""durationSeconds": 2.5"#))
        XCTAssertTrue(text.contains("\"version\": \(tripDocVersion)"))
        // And it reads back as it was written.
        let back = try XCTUnwrap(JSONValue.parse(text))
        XCTAssertEqual(back, file.json)
    }
}
