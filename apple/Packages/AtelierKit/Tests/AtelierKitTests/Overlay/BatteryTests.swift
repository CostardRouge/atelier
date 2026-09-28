// Port of `src/shared/overlay/battery.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func cue(_ data: [String: String]) -> Cue {
    Cue(start: 0, end: 1, frame: 1, timestamp: nil, data: data, derived: Motion())
}

final class ParseBatteryValueTests: XCTestCase {
    func testReadsPlainPercentagesWithOrWithoutTheSign() {
        XCTAssertEqual(parseBatteryValue("87"), 87)
        XCTAssertEqual(parseBatteryValue("87%"), 87)
        XCTAssertEqual(parseBatteryValue(" 100 "), 100)
        XCTAssertEqual(parseBatteryValue("0"), 0)
    }

    func testReadsA0To1FractionAsAPercentage() throws {
        assertClose(try XCTUnwrap(parseBatteryValue("0.42")), 42, 6)
        // 1 is a nearly-flat pack on a 0..100 scale, not a full one.
        XCTAssertEqual(parseBatteryValue("1"), 1)
    }

    func testRefusesAnythingThatIsNotAPercentage() {
        XCTAssertNil(parseBatteryValue(nil))
        XCTAssertNil(parseBatteryValue(""))
        XCTAssertNil(parseBatteryValue("n/a"))
        XCTAssertNil(parseBatteryValue("-5"))
        XCTAssertNil(parseBatteryValue("130"))
    }
}

final class BatteryFromCueTests: XCTestCase {
    func testFindsABatteryKeyWhateverItsSpelling() {
        XCTAssertEqual(batteryFromCue(cue(["battery": "64"])), 64)
        XCTAssertEqual(batteryFromCue(cue(["battery_percent": "64"])), 64)
        XCTAssertEqual(batteryFromCue(cue(["BatteryLevel": "64"])), 64)
        XCTAssertEqual(batteryFromCue(cue(["remain-battery": "64"])), 64)
    }

    func testHonoursAnExplicitlyNamedKeyAndIgnoresTheRest() {
        let c = cue(["battery": "10", "my_pack": "90"])
        XCTAssertEqual(batteryFromCue(c, "my_pack"), 90)
        XCTAssertNil(batteryFromCue(c, "nothing_here"))
    }

    func testYieldsNothingForARealDjiCueTheSidecarCarriesNoBattery() {
        let dji = cue(["iso": "100", "shutter": "1/500.0", "fnum": "1.7", "rel_alt": "35.200", "latitude": "16.056870"])
        XCTAssertNil(batteryFromCue(dji))
        XCTAssertNil(batteryFromCue(nil))
    }
}

final class BatteryLevelTests: XCTestCase {
    func testUsesTheAuthoredValueInManualModeClamped() {
        let el = createBatteryElement()
        XCTAssertEqual(batteryLevel(el, nil), el.batteryPercent)
        var over = el
        over.batteryPercent = 140
        XCTAssertEqual(batteryLevel(over, nil), 100)
        var under = el
        under.batteryPercent = -3
        XCTAssertEqual(batteryLevel(under, nil), 0)
        var unset = el
        unset.batteryPercent = nil
        XCTAssertNil(batteryLevel(unset, nil))
    }

    func testNeverFallsBackToAMadeUpLevelWhenTelemetryHasNone() {
        var el = createBatteryElement()
        el.batterySource = .telemetry
        XCTAssertNil(batteryLevel(el, cue(["iso": "100"])))
        XCTAssertEqual(batteryLevel(el, cue(["battery": "55"])), 55)
    }
}
