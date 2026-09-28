// Port of `src/shared/roadtrip/gazetteer.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func city(_ name: String, _ lat: Double, _ lon: Double, _ population: Double = 1000,
                  _ section: Bool = false, _ country: String = "AU") -> GazetteerCity {
    GazetteerCity(name: name, country: country, lat: lat, lon: lon, population: population, section: section)
}

private let KALBARRI = city("Kalbarri", -27.7105, 114.165, 2602)
private let BROOME = city("Broome", -17.9554, 122.2392, 5314)
private let PERTH = city("Perth", -31.9522, 115.8614, 1_896_548)

private func at(_ lat: Double, _ lon: Double) -> GeoPoint { GeoPoint(lat: lat, lon: lon) }

final class TripParseGazetteerTests: XCTestCase {
    func testReadsTheCommittedShape() {
        let cities = parseGazetteer([
            "attribution": "Data from GeoNames…",
            "count": 2,
            "cities": [
                ["Kalbarri", "AU", -27.7105, 114.165, 2602, 0],
                ["Cable Beach", "AU", -17.961, 122.2127, 8529, 1],
            ],
        ])
        XCTAssertEqual(cities, [
            GazetteerCity(name: "Kalbarri", country: "AU", lat: -27.7105, lon: 114.165, population: 2602, section: false),
            GazetteerCity(name: "Cable Beach", country: "AU", lat: -17.961, lon: 122.2127, population: 8529, section: true),
        ])
    }

    func testDropsARowItCannotReadRatherThanFailingTheWholeIndex() {
        let cities = parseGazetteer([
            "cities": [
                ["", "AU", -27.7105, 114.165, 2602, 0],
                ["Off the globe", "AU", -91, 114.165, 10, 0],
                ["Not a number", "AU", "south", 114.165, 10, 0],
                "not a row",
                ["Kalbarri", "AU", -27.7105, 114.165, 2602, 0],
            ],
        ])
        XCTAssertEqual(cities.map(\.name), ["Kalbarri"])
    }

    func testHasNothingToSayAboutAFileThatIsNotOne() {
        XCTAssertEqual(parseGazetteer(nil), [])
        XCTAssertEqual(parseGazetteer(.null), [])
        XCTAssertEqual(parseGazetteer(["cities": "lots"]), [])
    }

    /// What the committed file's head really holds, read through `JSONValue.parse`
    /// as the app will read it.
    func testReadsTheFileAsText() {
        let text = #"{"attribution":"Data from GeoNames","count":2,"cities":[["'Ali Sabieh","DJ",11.1558,42.7125,55000,0],["'s-Gravenland","NL",51.9234,4.5531,10000,1]]}"#
        let cities = parseGazetteer(JSONValue.parse(text))
        XCTAssertEqual(cities.map(\.name), ["'Ali Sabieh", "'s-Gravenland"])
        XCTAssertEqual(cities.map(\.section), [false, true])
    }
}

final class TripNearestCityTests: XCTestCase {
    private let index = [KALBARRI, BROOME, PERTH]

    func testNamesAPointSittingOnATown() {
        XCTAssertEqual(nearestCity(index, at(-27.71, 114.16))?.name, "Kalbarri")
    }

    func testNamesAPointAFewKilometresOutWhichIsWhereACentroidLands() {
        // ~22 km south of Kalbarri — a leg's median, not the town square.
        XCTAssertEqual(nearestCity(index, at(-27.91, 114.165))?.name, "Kalbarri")
    }

    func testAnswersNothingRatherThanReachingForATownThatIsNotNear() {
        // The middle of the Nullarbor: hundreds of kilometres from all three.
        XCTAssertNil(nearestCity(index, at(-31.5, 128.9)))
    }

    func testTakesTheReachFromTheCaller() {
        let far = at(-28.5, 114.165)
        XCTAssertNil(nearestCity(index, far, maxKm: 50))
        XCTAssertEqual(nearestCity(index, far, maxKm: 120)?.name, "Kalbarri")
    }

    func testPrefersTheTownPeopleHaveHeardOfWhenTwoAreTheSameAnswer() {
        // Northbridge sits nearer the point than Perth itself does — the real
        // index really is like this, and distance alone names the suburb.
        let suburb = city("Northbridge", -31.9478, 115.8588, 1434, true)
        let point = at(-31.947, 115.858)
        XCTAssertEqual(nearestCity([suburb, PERTH], point)?.name, "Perth")
        XCTAssertEqual(nearestCity([PERTH, suburb], point)?.name, "Perth")
    }

    func testPrefersAPlaceOverASectionOfOneEvenWhenTheSectionIsBigger() {
        // GeoNames gives Cable Beach 8 529 against Broome's 5 314, so population
        // alone names the suburb. Its feature code says it is part of Broome.
        let cableBeach = city("Cable Beach", -17.961, 122.2127, 8529, true)
        let point = at(-17.958, 122.225)
        XCTAssertEqual(nearestCity([cableBeach, BROOME], point)?.name, "Broome")
        XCTAssertEqual(nearestCity([BROOME, cableBeach], point)?.name, "Broome")
    }

    func testStillNamesASectionWhenItIsTheOnlyThingNear() {
        let cableBeach = city("Cable Beach", -17.961, 122.2127, 8529, true)
        XCTAssertEqual(nearestCity([cableBeach], at(-17.961, 122.213))?.name, "Cable Beach")
    }

    func testStillPrefersTheNearerTownOnceTheTwoArePlainlyApart() {
        // 60 km from Perth, 1 km from a hamlet: no longer one answer.
        let hamlet = city("Bullsbrook", -31.67, 116.0, 1400)
        XCTAssertEqual(nearestCity([PERTH, hamlet], at(-31.671, 116.001))?.name, "Bullsbrook")
    }

    func testGivesTheSameAnswerWhateverOrderTheIndexArrivedIn() {
        let point = at(-31.95, 115.86)
        let forward = nearestCity([KALBARRI, BROOME, PERTH], point)?.name
        let backward = nearestCity([PERTH, BROOME, KALBARRI], point)?.name
        XCTAssertEqual(forward, backward)
    }

    func testDoesNotLoseATownAcrossTheAntimeridian() {
        let taveuni = city("Taveuni", -16.8, 179.97, 1200, false, "FJ")
        XCTAssertEqual(nearestCity([taveuni], at(-16.8, -179.98))?.name, "Taveuni")
    }

    func testStillAnswersNearAPoleWhereTheLongitudeWindowStopsMeaningAnything() {
        let longyearbyen = city("Longyearbyen", 78.2232, 15.6469, 2075, false, "SJ")
        XCTAssertEqual(nearestCity([longyearbyen], at(78.25, 15.5))?.name, "Longyearbyen")
    }

    func testHasNothingToSayAboutAnEmptyIndex() {
        XCTAssertNil(nearestCity([], at(-31.95, 115.86)))
    }
}
