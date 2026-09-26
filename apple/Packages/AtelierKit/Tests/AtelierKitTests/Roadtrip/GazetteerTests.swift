// Port of `src/shared/roadtrip/gazetteer.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func city(_ name: String, _ lat: Double, _ lon: Double, _ population: Double = 1000,
                  _ section: Bool = false, _ country: String = "AU") -> GazetteerCity {
    GazetteerCity(name: name, country: country, lat: lat, lon: lon, population: population, section: section)
}

private let kalbarri = city("Kalbarri", -27.7105, 114.165, 2602)
private let broome = city("Broome", -17.9554, 122.2392, 5314)
private let perth = city("Perth", -31.9522, 115.8614, 1_896_548)

private func row(_ cells: JSONValue...) -> JSONValue { .array(cells) }

final class ParseGazetteerTests: XCTestCase {
    func testReadsTheCommittedShape() {
        let cities = parseGazetteer(.object([
            "attribution": .string("Data from GeoNames…"),
            "count": .number(2),
            "cities": .array([
                row(.string("Kalbarri"), .string("AU"), .number(-27.7105), .number(114.165), .number(2602), .number(0)),
                row(.string("Cable Beach"), .string("AU"), .number(-17.961), .number(122.2127), .number(8529), .number(1)),
            ]),
        ]))
        XCTAssertEqual(cities, [
            GazetteerCity(name: "Kalbarri", country: "AU", lat: -27.7105, lon: 114.165, population: 2602, section: false),
            GazetteerCity(name: "Cable Beach", country: "AU", lat: -17.961, lon: 122.2127, population: 8529, section: true),
        ])
    }

    func testDropsARowItCannotReadRatherThanFailingTheWholeIndex() {
        let cities = parseGazetteer(.object([
            "cities": .array([
                row(.string(""), .string("AU"), .number(-27.7105), .number(114.165), .number(2602), .number(0)),
                row(.string("Off the globe"), .string("AU"), .number(-91), .number(114.165), .number(10), .number(0)),
                row(.string("Not a number"), .string("AU"), .string("south"), .number(114.165), .number(10), .number(0)),
                .string("not a row"),
                row(.string("Kalbarri"), .string("AU"), .number(-27.7105), .number(114.165), .number(2602), .number(0)),
            ]),
        ]))
        XCTAssertEqual(cities.map { $0.name }, ["Kalbarri"])
    }

    func testHasNothingToSayAboutAFileThatIsNotOne() {
        XCTAssertEqual(parseGazetteer(.null), [])
        XCTAssertEqual(parseGazetteer(.object(["cities": .string("lots")])), [])
    }
}

final class NearestCityTests: XCTestCase {
    private let index = [kalbarri, broome, perth]

    func testNamesAPointSittingOnATown() {
        XCTAssertEqual(nearestCity(index, GpsCoord(lat: -27.71, lon: 114.16))?.name, "Kalbarri")
    }

    func testNamesAPointAFewKilometresOutWhichIsWhereACentroidLands() {
        // ~22 km south of Kalbarri — a leg's median, not the town square.
        XCTAssertEqual(nearestCity(index, GpsCoord(lat: -27.91, lon: 114.165))?.name, "Kalbarri")
    }

    func testAnswersNothingRatherThanReachingForATownThatIsNotNear() {
        // The middle of the Nullarbor: hundreds of kilometres from all three.
        XCTAssertNil(nearestCity(index, GpsCoord(lat: -31.5, lon: 128.9)))
    }

    func testTakesTheReachFromTheCaller() {
        let far = GpsCoord(lat: -28.5, lon: 114.165)
        XCTAssertNil(nearestCity(index, far, maxKm: 50))
        XCTAssertEqual(nearestCity(index, far, maxKm: 120)?.name, "Kalbarri")
    }

    func testPrefersTheTownPeopleHaveHeardOfWhenTwoAreTheSameAnswer() {
        // Northbridge sits nearer the point than Perth itself does.
        let suburb = city("Northbridge", -31.9478, 115.8588, 1434, true)
        let point = GpsCoord(lat: -31.947, lon: 115.858)
        XCTAssertEqual(nearestCity([suburb, perth], point)?.name, "Perth")
        XCTAssertEqual(nearestCity([perth, suburb], point)?.name, "Perth")
    }

    func testPrefersAPlaceOverASectionOfOneEvenWhenTheSectionIsBigger() {
        // GeoNames gives Cable Beach 8 529 against Broome's 5 314.
        let cableBeach = city("Cable Beach", -17.961, 122.2127, 8529, true)
        let point = GpsCoord(lat: -17.958, lon: 122.225)
        XCTAssertEqual(nearestCity([cableBeach, broome], point)?.name, "Broome")
        XCTAssertEqual(nearestCity([broome, cableBeach], point)?.name, "Broome")
    }

    func testStillNamesASectionWhenItIsTheOnlyThingNear() {
        let cableBeach = city("Cable Beach", -17.961, 122.2127, 8529, true)
        XCTAssertEqual(nearestCity([cableBeach], GpsCoord(lat: -17.961, lon: 122.213))?.name, "Cable Beach")
    }

    func testStillPrefersTheNearerTownOnceTheTwoArePlainlyApart() {
        // 60 km from Perth, 1 km from a hamlet: no longer one answer.
        let hamlet = city("Bullsbrook", -31.67, 116.0, 1400)
        XCTAssertEqual(nearestCity([perth, hamlet], GpsCoord(lat: -31.671, lon: 116.001))?.name, "Bullsbrook")
    }

    func testGivesTheSameAnswerWhateverOrderTheIndexArrivedIn() {
        let point = GpsCoord(lat: -31.95, lon: 115.86)
        let forward = nearestCity([kalbarri, broome, perth], point)?.name
        let backward = nearestCity([perth, broome, kalbarri], point)?.name
        XCTAssertEqual(forward, backward)
    }

    func testDoesNotLoseATownAcrossTheAntimeridian() {
        let taveuni = city("Taveuni", -16.8, 179.97, 1200, false, "FJ")
        XCTAssertEqual(nearestCity([taveuni], GpsCoord(lat: -16.8, lon: -179.98))?.name, "Taveuni")
    }

    func testStillAnswersNearAPoleWhereTheLongitudeWindowStopsMeaningAnything() {
        let longyearbyen = city("Longyearbyen", 78.2232, 15.6469, 2075, false, "SJ")
        XCTAssertEqual(nearestCity([longyearbyen], GpsCoord(lat: 78.25, lon: 15.5))?.name, "Longyearbyen")
    }

    func testHasNothingToSayAboutAnEmptyIndex() {
        XCTAssertNil(nearestCity([], GpsCoord(lat: -31.95, lon: 115.86)))
    }
}
