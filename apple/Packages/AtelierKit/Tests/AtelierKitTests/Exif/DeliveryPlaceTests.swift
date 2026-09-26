// Port of `src/shared/exif/delivery-place.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func city(_ name: String, _ country: String, _ lat: Double, _ lon: Double, _ population: Double = 1000) -> GazetteerCity {
    GazetteerCity(name: name, country: country, lat: lat, lon: lon, population: population, section: false)
}

private let index = [
    city("Cervantes", "AU", -30.4986, 115.0661),
    city("Jurien Bay", "AU", -30.3059, 115.0383),
    city("Reykjavik", "IS", 64.1355, -21.8954, 118_918),
]

final class PlaceForTests: XCTestCase {
    func testNamesTheTownAPictureWasTakenNearWithItsCountry() {
        // The Pinnacles, 17 km south of Cervantes.
        XCTAssertEqual(
            placeFor(index, GpsCoord(lat: -30.6056, lon: 115.1575)),
            DeliveryPlace(city: "Cervantes", country: "Australia", countryCode: "AU")
        )
        XCTAssertEqual(placeFor(index, GpsCoord(lat: 64.1466, lon: -21.9426))?.country, "Iceland")
    }

    func testNamesNoTownPastItsReachButStillTheCountryOfOneWithin90Km() {
        XCTAssertLessThan(placeMaxKm, 90)
        // The real index has no Cervantes: the Pinnacles are 35 km from Jurien Bay.
        let real = index.filter { $0.name != "Cervantes" }
        XCTAssertEqual(
            placeFor(real, GpsCoord(lat: -30.6056, lon: 115.1575)),
            DeliveryPlace(city: "", country: "Australia", countryCode: "AU")
        )
        // Kalbarri, 300 km north: nothing in this index is near, not even a country.
        XCTAssertNil(placeFor(index, GpsCoord(lat: -27.71, lon: 114.16)))
        XCTAssertNil(placeFor(index, nil))
        XCTAssertNil(placeFor([], GpsCoord(lat: -30.5, lon: 115)))
    }
}

final class CountryNameTests: XCTestCase {
    func testReadsAnIsoCodeInEnglishAndHandsBackACodeItCannot() {
        XCTAssertEqual(countryName("fr"), "France")
        XCTAssertEqual(countryName(""), "")
        // This port's own: a code no runtime names comes back as the code.
        XCTAssertEqual(countryName("xx"), "XX")
    }
}
