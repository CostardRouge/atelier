// Port of `src/shared/roadtrip/car-spec.test.ts`, case for case, plus the
// writer's round trip (the web writes the record as it is; here `json` does).

import XCTest
@testable import AtelierKit

private func car(_ change: (inout CarSpec) -> Void) -> CarSpec {
    var c = defaultCarSpec()
    change(&c)
    return c
}

/// `/^#[0-9a-f]{6}$/` — lower case only, as the spec's regex has no `i`.
private func isLowerHex(_ s: String) -> Bool {
    let bytes = Array(s.utf8)
    guard bytes.count == 7, bytes[0] == UInt8(ascii: "#") else { return false }
    return bytes[1...].allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }
}

final class CarSpecDefaultTests: XCTestCase {
    func testIsThePradoInRaptorBlackMatteWithEveryPieceOfGearOn() {
        let c = defaultCarSpec()
        XCTAssertEqual(c.model.rawValue, "prado-j120")
        XCTAssertEqual(c.finish, .matte)
        XCTAssertEqual(colourName(c.color), "Raptor black")
        XCTAssertTrue(CarGear.keys.allSatisfy { c.gear[$0] })
    }

    func testIsAFreshValueEachTimeNeverTheFrozenConstant() {
        // The web asks `a !== b` and `Object.isFrozen(DEFAULT_CAR)`; a value
        // type answers the same question by editing one copy and watching the
        // other and the constant stay put.
        var a = defaultCarSpec()
        let b = defaultCarSpec()
        XCTAssertEqual(a, CarSpec.default)
        a.gear.spare = false
        a.color = "#123456"
        XCTAssertEqual(b, CarSpec.default)
        XCTAssertTrue(CarSpec.default.gear.spare)
        XCTAssertEqual(CarSpec.default.color, "#232326")
    }
}

final class CarSpecPresetTests: XCTestCase {
    func testAreAllReadableHexesWithDistinctNamesAndTheCoatingCarriesItsFinish() {
        for c in carColours { XCTAssertTrue(isLowerHex(c.hex), c.hex) }
        XCTAssertEqual(Set(carColours.map(\.name)).count, carColours.count)
        XCTAssertEqual(carColours.first { $0.id == "raptor-black" }?.finish, .matte)
        XCTAssertFalse((carColours.first { $0.id == "dark-green" }?.note ?? "").isEmpty)
    }

    func testNamesAColourByItsHexWhateverTheCaseAndCallsTheRestCustom() {
        XCTAssertEqual(colourName("#1F3B2F"), "Dark green")
        XCTAssertEqual(colourName("#123456"), "Custom")
    }
}

final class ReadCarSpecTests: XCTestCase {
    func testLandsJunkOnTheDefault() {
        XCTAssertEqual(readCarSpec(.null), CarSpec.default)
        XCTAssertEqual(readCarSpec(nil), CarSpec.default)
        XCTAssertEqual(readCarSpec("black"), CarSpec.default)
        XCTAssertEqual(readCarSpec(["model": "delorean", "color": "red", "finish": "chrome", "gear": 3]), CarSpec.default)
    }

    func testKeepsWhatAPartialSpecSaysAndFillsTheRest() {
        let c = readCarSpec(["color": "#FF0000", "gear": ["bullBar": false, "solar": "yes"]])
        XCTAssertEqual(c.color, "#ff0000")
        XCTAssertEqual(c.finish, .matte)
        XCTAssertEqual(c.gear.bullBar, false)
        XCTAssertEqual(c.gear.solar, true)
        XCTAssertEqual(c.gear.spare, true)
    }

    func testReadsAFullSpecBackUnchanged() {
        var gear = CarGear.default
        gear.rack = false
        let spec = CarSpec(model: .pradoJ120, color: "#1f3b2f", finish: .gloss, gear: gear)
        let raw: JSONValue = [
            "model": "prado-j120",
            "color": "#1f3b2f",
            "finish": "gloss",
            "gear": .object(Dictionary(uniqueKeysWithValues: CarGear.keys.map { ($0.rawValue, JSONValue.bool(gear[$0])) })),
        ]
        XCTAssertEqual(readCarSpec(raw), spec)
    }

    func testWritesTheRecordTheReaderReadsBackAndEveryFlagOnIt() {
        var gear = CarGear.default
        gear.awning = false
        let spec = CarSpec(model: .pradoJ120, color: "#5c1b21", finish: .gloss, gear: gear)
        XCTAssertEqual(readCarSpec(spec.json), spec)
        XCTAssertEqual(spec.json.objectValue?["gear"]?.objectValue?.count, CarGear.keys.count)
        XCTAssertEqual(
            CarSpec.default.json.serialized(),
            ##"{"color":"#232326","finish":"matte","gear":{"awning":true,"box":true,"bullBar":true,"jerryCans":true,"## +
                ##""mirrors":true,"mudFlaps":true,"rack":true,"solar":true,"spare":true,"spotLights":true,"visors":true},"## +
                ##""model":"prado-j120"}"##
        )
    }
}

final class EffectiveGearTests: XCTestCase {
    func testDrawsTheSpotLightsOnlyWithTheBarAndTheRoofLoadOnlyWithTheBasketLeavingTheFlagsStored() {
        var gear = CarGear.default
        gear.bullBar = false
        gear.rack = false
        let shown = effectiveGear(gear)
        XCTAssertEqual(shown.spotLights, false)
        XCTAssertEqual(shown.solar, false)
        XCTAssertEqual(shown.box, false)
        XCTAssertEqual(shown.jerryCans, false)
        XCTAssertEqual(shown.awning, false)
        XCTAssertEqual(shown.mudFlaps, true)
        XCTAssertEqual(gear.spotLights, true)
        XCTAssertEqual(gear.solar, true)
    }
}

final class DescribeCarTests: XCTestCase {
    func testSaysTheModelTheColourAndFinishAndTheGearThatIsOn() {
        XCTAssertEqual(
            describeCar(defaultCarSpec(), "Toyota Land Cruiser Prado"),
            "Toyota Land Cruiser Prado · Raptor black, matte · bull bar, spot lights, roof basket, solar panel, "
                + "storage box, jerry cans, awning bag, mud flaps, window visors, spare wheel, door mirrors"
        )
    }

    func testSaysSoWhenNothingIsFittedAndListsOnlyWhatIsDrawn() {
        let bare = car { $0.gear = .bare }
        XCTAssertEqual(describeCar(bare, "Prado"), "Prado · Raptor black, matte · no gear")
        var noRack = CarGear.default
        noRack.rack = false
        XCTAssertEqual(gearWords(noRack), ["bull bar", "spot lights", "mud flaps", "window visors", "spare wheel", "door mirrors"])
    }
}

final class SameCarSpecTests: XCTestCase {
    func testIsTrueForTheSameCarWhateverTheCaseOfItsHexFalseForOneFlagApart() {
        let a = defaultCarSpec()
        XCTAssertTrue(sameCarSpec(a, defaultCarSpec()))
        XCTAssertTrue(sameCarSpec(a, car { $0.color = a.color.uppercased() }))
        XCTAssertFalse(sameCarSpec(a, car { $0.gear.spare = false }))
        XCTAssertFalse(sameCarSpec(a, car { $0.finish = .gloss }))
        XCTAssertFalse(sameCarSpec(a, car { $0.color = "#1f3b2f" }))
    }
}
