// Port of the «the project setting» block of
// `src/shared/telemetry/time-scale.test.ts` — the manual override the Studio
// keeps beside the capture-time shift. `TelemetryTests.swift` ports the
// measuring half of the same spec.

import XCTest
@testable import AtelierKit

private let measured: TimeScaleReading = {
    var r = TimeScaleReading.realtime
    r.basis = .timestamps
    r.scale = 0.25
    r.mediaFps = 30
    r.captureFps = 120
    return r
}()

final class TimeScaleSettingTests: XCTestCase {
    func testFollowsTheMeasurementOnAutoAndTheAuthorOnManual() {
        XCTAssertEqual(resolveTimeScale(autoTimeScale, measured), 0.25)
        XCTAssertEqual(resolveTimeScale(TimeScaleSetting(mode: .manual, scale: 0.5), measured), 0.5)
        XCTAssertEqual(resolveTimeScale(nil, measured), 0.25)
    }

    func testIgnoresAManualFigureThatIsNotAPositiveNumber() {
        XCTAssertEqual(resolveTimeScale(TimeScaleSetting(mode: .manual, scale: 0), measured), 0.25)
        XCTAssertEqual(resolveTimeScale(TimeScaleSetting(mode: .manual, scale: .nan), measured), 0.25)
    }

    func testAppliesAnOverrideOnlyToTheClipItWasSetFor() {
        let forB = TimeScaleSetting(mode: .manual, scale: 0.25, clipId: "dji_0002")
        XCTAssertEqual(resolveTimeScale(forB, .realtime, "dji_0002"), 0.25)
        // Stepping to another clip must not inherit a cadence measured elsewhere.
        var realtimeOne = TimeScaleReading.realtime
        realtimeOne.scale = 1
        XCTAssertEqual(resolveTimeScale(forB, realtimeOne, "dji_0001"), 1)
        XCTAssertFalse(overrideApplies(forB, "dji_0001"))
        XCTAssertTrue(overrideApplies(forB, "dji_0002"))
        // No clip recorded: an old document meant "whatever is open".
        XCTAssertTrue(overrideApplies(TimeScaleSetting(mode: .manual, scale: 0.5), "anything"))
        XCTAssertFalse(overrideApplies(autoTimeScale, "anything"))
    }

    func testReImpliesTheCaptureRateFromAnOverrideInsteadOfContradictingIt() {
        let shown = withScale(measured, 0.5)
        XCTAssertEqual(shown.captureFps, 60)
        XCTAssertEqual(formatCadence(shown), "60 → 30 fps")
        XCTAssertEqual(withScale(measured, 0.25), measured)
    }

    // No web spec: the reader and writer the project document goes through.
    func testReadsAndWritesTheStoredSettingAsTheWebWritesIt() {
        XCTAssertNil(readTimeScaleSetting(nil))
        XCTAssertNil(readTimeScaleSetting("auto"))
        XCTAssertEqual(readTimeScaleSetting(["mode": "auto", "scale": 1]), .auto)
        let manual: JSONValue = ["mode": "manual", "scale": 0.25, "clipId": "dji_0001"]
        XCTAssertEqual(readTimeScaleSetting(manual), TimeScaleSetting(mode: .manual, scale: 0.25, clipId: "dji_0001"))
        XCTAssertEqual(readTimeScaleSetting(manual)?.json, manual)
        XCTAssertEqual(TimeScaleSetting.auto.json, ["mode": "auto", "scale": 1])
        // An unknown mode is auto; a missing scale is 1.
        XCTAssertEqual(readTimeScaleSetting(["mode": "sideways"]), .auto)
    }
}
