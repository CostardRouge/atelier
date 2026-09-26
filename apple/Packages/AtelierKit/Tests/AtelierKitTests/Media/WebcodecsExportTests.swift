// Port of the pure cases of `src/shared/media/webcodecs-export.test.ts`:
// `deriveBitrate` and `rotationFromMatrix`. Its `trimWindow` cases pin a
// function the kernel does not carry (the native export reads through
// `AVAssetReader`, which decodes from the sync sample and applies the edit
// list; `WebcodecsExport.swift` says why), and its `drawRotatedFrame` cases
// drive a canvas — both stay with the web.

import Foundation
import XCTest
@testable import AtelierKit

final class WebcodecsExportTests: XCTestCase {
    // MARK: deriveBitrate

    func testSpendsHalfAgainAsMuchOnAGrainedClipAndNeverUnderTheFloor() {
        let plain = deriveBitrate(1920, 1080, 30)
        let grained = deriveBitrate(1920, 1080, 30, true)
        // Film grain is a new, uncorrelated field every frame: there is nothing
        // for a P-frame to predict, so the budget tuned for smooth footage
        // turns the grain the stock asked for into blocking.
        assertClose(Double(grained) / Double(plain), 0.18 / 0.12, 6)
        XCTAssertEqual(deriveBitrate(1920, 1080, 30, false), plain)
        // The floor holds either way — a postage stamp still gets 2 Mbps.
        XCTAssertEqual(deriveBitrate(64, 64, 24, true), 2_000_000)
    }

    // MARK: rotationFromMatrix — tkhd matrices are read via atan2(b, a).

    func testReads0FromTheIdentityMatrix() {
        XCTAssertEqual(rotationFromMatrix([1, 0]), 0)
    }

    func testReads90Clockwise() {
        XCTAssertEqual(rotationFromMatrix([0, 1]), 90)
    }

    func testReads180() {
        XCTAssertEqual(rotationFromMatrix([-1, 0]), 180)
    }

    func testReads270() {
        XCTAssertEqual(rotationFromMatrix([0, -1]), 270)
    }

    func testDefaultsTo0ForADegenerateOrAbsentMatrix() {
        XCTAssertEqual(rotationFromMatrix(nil), 0)
        XCTAssertEqual(rotationFromMatrix([0, 0]), 0)
    }
}
