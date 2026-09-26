// Port of `src/tools/composer/overlay.test.ts`, case for case, plus a small
// spec of `draw-readout.ts`'s arithmetic, which the web leaves untested
// inside its paint function.

import Foundation
import XCTest
@testable import AtelierKit

private func composerCue() -> Cue {
    Cue(start: 0, end: 0.03, frame: nil, timestamp: nil,
        data: ["rel_alt": "35.2", "latitude": "48.8566", "longitude": "2.3522"],
        derived: Motion(groundSpeed: 5, verticalSpeed: 0, heading: 90))
}

final class BuildReadoutLinesTests: XCTestCase {
    func testIncludesActiveFieldsSkippingMissingValues() {
        let lines = buildReadoutLines(composerCue(), .default)
        // Labels are off by default → bare values, altitude first.
        XCTAssertEqual(lines.first, "35.2 m")
        XCTAssertTrue(lines.contains("48.8566, 2.3522"))
        // V/S is on by default → present.
        XCTAssertTrue(lines.contains("0.0 m/s"))
    }

    func testAddsThePrefixWhenLabelsAreOn() {
        var cfg = ComposerOverlayConfig.default
        cfg.labels = true
        let lines = buildReadoutLines(composerCue(), cfg)
        XCTAssertEqual(lines.first, "ALT 35.2 m")
        XCTAssertTrue(lines.contains("GPS 48.8566, 2.3522"))
    }

    func testHonoursTheActiveFieldSet() {
        var cfg = ComposerOverlayConfig.default
        cfg.labels = true
        cfg.fields = ["altitude": true, "speed": false, "heading": false, "coords": false]
        XCTAssertEqual(buildReadoutLines(composerCue(), cfg), ["ALT 35.2 m"])
    }

    func testReturnsNothingForAnEmptyCue() {
        XCTAssertEqual(buildReadoutLines(nil, .default), [])
    }
}

final class ReadoutRgbaTests: XCTestCase {
    func testExpandsSixAndThreeDigitHexWithAlpha() {
        XCTAssertEqual(readoutRgba("#ffffff", 0.5), "rgba(255,255,255,0.5)")
        XCTAssertEqual(readoutRgba("#000", 1), "rgba(0,0,0,1)")
        XCTAssertEqual(readoutRgba("#d9442a", 1), "rgba(217,68,42,1)")
    }

    func testFallsBackToBlackOnABadHex() {
        XCTAssertEqual(readoutRgba("nope", 0.3), "rgba(0,0,0,0.3)")
    }
}

final class ReadoutArithmeticTests: XCTestCase {
    func testTheFontIsAShareOfTheFrameHeightWithFloors() {
        // 1920 × 0.03 = 57.6 → 58; the padding is 58 × 0.7 = 40.6 → 41.
        let m = readoutMetrics(frameHeight: 1920, fontScale: 1)
        XCTAssertEqual(m.fontSize, 58)
        XCTAssertEqual(m.pad, 41)
        assertClose(m.lineHeight, 78.3, 6)
        // A tiny frame keeps the 10 px base, a tiny scale the 8 px floor.
        XCTAssertEqual(readoutMetrics(frameHeight: 100, fontScale: 1).fontSize, 10)
        XCTAssertEqual(readoutMetrics(frameHeight: 100, fontScale: 0.6).fontSize, 8)
    }

    func testTheCardIsPushedBackInsideTheFrame() {
        let m = readoutMetrics(frameHeight: 1000, fontScale: 1) // fs 30, pad 21, lh 40.5
        let box = readoutBox(pos: Point(0.95, 0.95), frame: Size(1000, 1000), maxLineWidth: 200,
                             lineCount: 2, metrics: m, radius: 400)
        XCTAssertNotNil(box)
        guard let box else { return }
        // 200 + 2 × 21 = 242 wide; 2 × 40.5 + 42 − 10.5 = 112.5 tall.
        assertClose(box.rect.width, 242, 9)
        assertClose(box.rect.height, 112.5, 9)
        assertClose(box.rect.x, 1000 - 242, 9)
        assertClose(box.rect.y, 1000 - 112.5, 9)
        // The radius never exceeds half the short side.
        assertClose(box.radius, 56.25, 9)
        // First baseline: y + pad + fs × 0.85; the next one line lower.
        assertClose(box.baselines[0], box.rect.y + 21 + 25.5, 9)
        assertClose(box.baselines[1], box.baselines[0] + 40.5, 9)
        assertClose(box.textX, box.rect.x + 21, 9)
    }

    func testNothingToDrawIsNoCard() {
        let m = readoutMetrics(frameHeight: 1000, fontScale: 1)
        XCTAssertNil(readoutBox(pos: Point(0, 0), frame: Size(100, 100), maxLineWidth: 50,
                                lineCount: 0, metrics: m, radius: 0))
    }

    func testADragIsHeldInsideTheFrame() {
        XCTAssertEqual(readoutDragPosition(corner: Point(-20, 50), frame: Size(200, 100)), Point(0, 0.5))
        XCTAssertEqual(readoutDragPosition(corner: Point(300, 150), frame: Size(200, 100)), Point(1, 1))
    }
}
