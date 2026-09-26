// Port of `src/shared/roadtrip/house-style.test.ts` — every case. Two are
// split along what this build registers: the Itinerary (`map`) is not in the
// kernel's opener registry until `map-plan.ts` lands, so the half of "puts back
// what an opener was given" that reads its stops is its own test, skipped with
// its reason until `hookVariantById("map")` answers — it then runs as written.
// "reads the committed file" reads `house-style.json` from the web tree beside
// this package, as the web's `import.meta.glob` does: absent, it checks nothing.

import XCTest
@testable import AtelierKit

private let pictureJSON: JSONValue = [
    "ref": ["name": "DJI_0042.JPG", "size": 10, "lastModified": 1, "hash": "h42"],
    "date": "2025-07-03",
]

/// A trip with a look worth keeping, and a journey that must not travel with it.
private func styledTrip() -> TripDoc {
    var doc = createTripDoc("Australie", "2025-07-01", "2025-07-10")
    var reelBadge = defaultPostBadge(.reel)
    reelBadge.shades = [createShade(strength: 0.4), createShade(direction: .top)]
    reelBadge.hook = [HookLayer(id: "scrub", options: ["picked": [pictureJSON], "sweepSeconds": 2.5])]
    var photoBadge = defaultPostBadge(.photo)
    photoBadge.hook = [HookLayer(id: "map", options: [
        "stops": [["id": "s1", "name": "Uluru", "lat": -25.3, "lon": 131, "picture": pictureJSON]],
        "size": 0.6,
    ])]
    doc.badgeWords = frenchBadgeWords
    doc.theme = themeFromPreset("or-cine")
    doc.cta.headline = "Suivez la route"
    doc.hookDefaults = [.reel: hookDefaultsFrom(reelBadge), .photo: hookDefaultsFrom(photoBadge)]
    doc.grade = SavedGrade(layers: [
        SavedLutLayer(id: "l1", source: "classic-warm", name: "Warm", customText: nil, intensity: 0.7, enabled: true),
        SavedLutLayer(id: "l2", source: "upload", name: "Mine.cube", customText: "LUT_3D_SIZE 2", intensity: 1, enabled: true),
        SavedLutLayer(id: "l3", source: "film", name: "Negative · portrait",
                      customText: #"{"stock":"negative-portrait","response":{}}"#, intensity: 0.8, enabled: true),
    ], output: .none)
    doc.car.color = "#1f3a2c"
    doc.stages = [createTripStage("Red Centre", "NT", "2025-07-02", "2025-07-05")]
    doc.posts = [createTripPost(.reel, "2025-07-03", "Sunset")]
    doc.developPresets = [DevelopPreset(id: "p1", name: "Noon", settings: dev { $0.exposure = 1 })]
    return doc
}

private func text(_ trip: TripDoc) -> String {
    serializeHouseStyle(houseStyleFrom(trip).file)
}

/// `expect(options).toMatchObject(want)` over a layer's options.
private func assertOptions(_ options: HookOptions?, contain want: HookOptions, file: StaticString = #filePath, line: UInt = #line) {
    for (key, value) in want { XCTAssertEqual(options?[key], value, key, file: file, line: line) }
}

final class HouseStyleTests: XCTestCase {
    func testCarriesTheLookOfATripAndNothingOfItsJourney() {
        let style = houseStyleFrom(styledTrip()).file.style
        XCTAssertEqual(style.json.objectValue?.keys.sorted(),
                       ["badgeWords", "car", "cta", "grade", "hookDefaults", "theme"].sorted())
        XCTAssertEqual(style.badgeWords, frenchBadgeWords)
        XCTAssertEqual(style.theme?.presetId, "or-cine")
        XCTAssertEqual(style.cta.headline, "Suivez la route")
        XCTAssertEqual(style.car.color, "#1f3a2c")
        let written = text(styledTrip())
        for journey in ["Australie", "Red Centre", "Sunset", "Noon"] {
            XCTAssertFalse(written.contains(journey), journey)
        }
    }

    func testPutsBackWhatAnOpenerWasGivenForOnePieceAndKeepsHowItDraws() {
        let style = houseStyleFrom(styledTrip()).file.style
        assertOptions(style.hookDefaults[.reel]?.hook.first?.options, contain: ["picked": [], "sweepSeconds": 2.5])
    }

    func testPutsBackTheItinerarysStopsOnceTheMapOpenerIsRegistered() throws {
        guard hookVariantById("map") != nil else {
            throw XCTSkip("the Itinerary (`map`) joins the opener registry with the rest of map-plan.ts (trips-06)")
        }
        let style = houseStyleFrom(styledTrip()).file.style
        assertOptions(style.hookDefaults[.photo]?.hook.first?.options, contain: ["stops": [], "size": 0.6])
        XCTAssertFalse(text(styledTrip()).contains("DJI_0042"))
    }

    func testDeclaresEveryListAnOpenerStoresAsContentSoNoneCanSmuggleAPicture() {
        // A look option is a number, a word or a colour; a LIST in a variant's
        // defaults is something picked for a piece.
        for variant in hookVariants {
            let lists = variant.defaults.filter { $0.value.arrayValue != nil }.map(\.key)
            let declared = Set(variant.contentKeys ?? [])
            for key in lists { XCTAssertTrue(declared.contains(key), "\(variant.id).\(key)") }
        }
    }

    func testLeavesAnUploadedLookOutOfTheGradeAndSaysWhich() {
        let snapshot = houseStyleFrom(styledTrip())
        XCTAssertEqual(snapshot.file.style.grade.layers.map(\.name), ["Warm", "Negative · portrait"])
        XCTAssertEqual(snapshot.uploadedLooks, ["Mine.cube"])
        // A film stock carries text too — settings, not a cube — and stays.
        XCTAssertEqual(snapshot.file.style.grade.layers.map(\.id), ["l1", "l3"])
    }

    func testWritesTheSameTextForTheSameTripShadesIncluded() {
        let trip = styledTrip()
        XCTAssertEqual(text(trip), text(trip))
        XCTAssertEqual(houseStyleFrom(trip).file.style.hookDefaults[.reel]?.shades.map(\.id), ["shade-1", "shade-2"])
    }

    func testReadsBackWhatItWrote() {
        let file = houseStyleFrom(styledTrip()).file
        XCTAssertEqual(file.kind, houseStyleKind)
        XCTAssertEqual(file.version, tripDocVersion)
        XCTAssertEqual(readHouseStyle(JSONValue.parse(serializeHouseStyle(file))), file.style)
    }

    func testRefusesWhatIsNotAHouseStyleOrOneFromANewerBuild() {
        let file = houseStyleFrom(styledTrip()).file
        func with(_ key: String, _ value: JSONValue) -> JSONValue {
            var o = file.json.objectValue ?? [:]
            o[key] = value
            return .object(o)
        }
        XCTAssertNil(readHouseStyle(nil))
        XCTAssertNil(readHouseStyle(.null))
        XCTAssertNil(readHouseStyle(with("kind", "atelier.trip")))
        XCTAssertNil(readHouseStyle(with("version", .number(Double(tripDocVersion + 1)))))
        XCTAssertNil(readHouseStyle(with("version", "20")))
        XCTAssertNil(readHouseStyle(with("style", [])))
    }

    func testMigratesAFileWrittenByAnOlderBuild() throws {
        // v19 still had the Route trace; v20 converts it into an Itinerary.
        let file = houseStyleFrom(styledTrip()).file
        var style = try XCTUnwrap(file.style.json.objectValue)
        var reel = try XCTUnwrap(file.style.hookDefaults[.reel]?.json.objectValue)
        reel["hook"] = [["id": "route", "options": [:]]]
        style["hookDefaults"] = ["reel": .object(reel)]
        let old: JSONValue = ["kind": .string(file.kind), "version": 19, "style": .object(style)]
        let read = readHouseStyle(JSONValue.parse(old.serialized()))
        XCTAssertEqual(read?.hookDefaults[.reel]?.hook.first?.id, "map")
    }

    func testKeepsTheFactoryForABlockTheFileDoesNotCarry() throws {
        let file = houseStyleFrom(styledTrip()).file
        var rest = try XCTUnwrap(file.style.json.objectValue)
        rest["car"] = nil
        let style = readHouseStyle(["kind": .string(file.kind), "version": .number(Double(file.version)), "style": .object(rest)])
        XCTAssertEqual(style?.car, createTripDoc("", "2000-01-01", "2000-01-01").car)
        XCTAssertEqual(style?.badgeWords, frenchBadgeWords)
    }

    func testDressesANewTripAndOnlyItsLook() {
        let style = houseStyleFrom(styledTrip()).file.style
        let doc = createTripDoc("Islande", "2026-06-01", "2026-06-12")
        var dressed = applyHouseStyle(doc, style)
        XCTAssertEqual(dressed.id, doc.id)
        XCTAssertEqual(dressed.name, "Islande")
        XCTAssertEqual(dressed.startDate, "2026-06-01")
        XCTAssertEqual(dressed.theme?.presetId, "or-cine")
        XCTAssertEqual(dressed.hookDefaults[.reel]?.hook.first?.id, "scrub")
        // A copy: composing in the new trip must not rewrite the style it came from.
        dressed.badgeWords.day = "Tag"
        XCTAssertNotEqual(style.badgeWords.day, "Tag")
        XCTAssertEqual(applyHouseStyle(doc, nil), doc)
    }

    func testReadsTheCommittedFileWhenThereIsOne() throws {
        // …/apple/Packages/AtelierKit/Tests/AtelierKitTests/Roadtrip/ → the repository.
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { root.deleteLastPathComponent() }
        let url = root.appendingPathComponent(houseStylePath)
        guard let data = FileManager.default.contents(atPath: url.path) else { return }
        XCTAssertNotNil(readHouseStyle(JSONValue.parse(data)))
    }
}
