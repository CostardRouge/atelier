// A spec of its own for `CarRegistry.swift` — `car-registry.ts` has no web
// twin. It pins the registry's observable rules: one line per model, the
// footprint read off the model file, the builder being the model's own, and
// an unknown id landing on the Prado.

import XCTest
@testable import AtelierKit

final class CarRegistryTests: XCTestCase {
    func testListsThePradoWithTheModelsOwnFootprint() {
        XCTAssertEqual(carModels.map(\.id), [.pradoJ120])
        let prado = carModel(.pradoJ120)
        XCTAssertEqual(prado.name, "Toyota Land Cruiser Prado")
        XCTAssertEqual(prado.series, "J120 · 2003–2009")
        XCTAssertEqual(prado.length, carLength)
        XCTAssertEqual(prado.width, carWidth)
        XCTAssertEqual(prado.wheelRadius, wheelRadius)
    }

    func testBuildsTheSameCarAsTheModelFileWithTheGearAsked() {
        var asked = CarGear.default
        asked.rack = false
        asked.spare = false
        XCTAssertEqual(carModel(.pradoJ120).build(asked), buildCar(asked))
        XCTAssertEqual(carModel(.pradoJ120).build(.default), buildCar())
    }

    func testFallsBackToThePradoForAModelThisBuildDoesNotKnow() {
        XCTAssertEqual(carModel("delorean").id, .pradoJ120)
        XCTAssertEqual(carModel("").id, .pradoJ120)
    }

    func testDescribesTheTripsCarUnderTheModelsName() {
        // The sentence the web writes for the same stored spec, checked against
        // its own output when this port was made.
        let spec = readCarSpec(["model": "prado-j120", "color": "#F2F1EA", "finish": "gloss",
                                "gear": ["rack": false, "bullBar": false]])
        XCTAssertEqual(describeCar(spec, carModel(spec.model).name),
                       "Toyota Land Cruiser Prado · Glacier white, gloss · mud flaps, window visors, spare wheel, door mirrors")
    }
}
