// Port of `src/shared/lut/lut-preview.test.ts`.

import XCTest
@testable import AtelierKit

/// Inverts every channel — easy to tell apart from the source in a test.
private func invert() -> CubeLut {
    CubeLut.make(size: 5) { r, g, b in (1 - r, 1 - g, 1 - b) }
}

final class SyntheticPreviewSampleTests: XCTestCase {
    func testFillsTheRequestedSizeFullyOpaque() {
        let sample = syntheticPreviewSample(16)
        XCTAssertEqual(sample.width, 16)
        XCTAssertEqual(sample.height, 16)
        XCTAssertEqual(sample.data.count, 16 * 16 * 4)
        for i in stride(from: 3, to: sample.data.count, by: 4) {
            XCTAssertEqual(sample.data[i], 255)
        }
    }

    func testIsNotASingleFlatColourTheWholePointIsToShowSeveralRegions() {
        let sample = syntheticPreviewSample(32)
        var seen = Set<String>()
        for i in stride(from: 0, to: sample.data.count, by: 4) {
            seen.insert("\(sample.data[i]),\(sample.data[i + 1]),\(sample.data[i + 2])")
        }
        XCTAssertGreaterThan(seen.count, 10)
    }
}

final class BakeLutPreviewTests: XCTestCase {
    private let sample = syntheticPreviewSample(8)

    func testReturnsTheSampleUnchangedWhenLutIsNil() {
        var baked = bakeLutPreview(sample, nil, 1, .tetrahedral)
        XCTAssertEqual(baked.data, sample.data)
        // A distinct buffer, not the same one — callers may hold both. In Swift
        // a bitmap is a value: writing the copy leaves the sample alone.
        baked.data[0] = baked.data[0] &+ 1
        XCTAssertNotEqual(baked.data, sample.data)
    }

    func testAtIntensity0TheLUTHasNoEffectWhateverItDoes() {
        let baked = bakeLutPreview(sample, invert(), 0, .tetrahedral)
        XCTAssertEqual(baked.data, sample.data)
    }

    func testAtIntensity1AnInvertingLUTActuallyInverts() {
        let baked = bakeLutPreview(sample, invert(), 1, .tetrahedral)
        for i in stride(from: 0, to: sample.data.count, by: 4) {
            assertClose(Double(baked.data[i]), 255 - Double(sample.data[i]), -1)
            assertClose(Double(baked.data[i + 1]), 255 - Double(sample.data[i + 1]), -1)
            assertClose(Double(baked.data[i + 2]), 255 - Double(sample.data[i + 2]), -1)
        }
    }

    func testPreservesAlphaAndDimensions() {
        let baked = bakeLutPreview(sample, invert(), 0.5, .trilinear)
        XCTAssertEqual(baked.width, sample.width)
        XCTAssertEqual(baked.height, sample.height)
        for i in stride(from: 3, to: baked.data.count, by: 4) {
            XCTAssertEqual(baked.data[i], 255)
        }
    }

    /// Not in the web spec: a strength past 1 extrapolates past the look and
    /// the byte CLAMPS, as a `Uint8ClampedArray` store does, never wraps.
    func testClampsAnOvershootInsteadOfWrapping() {
        let white = RgbBitmap(width: 1, height: 1, data: [255, 255, 255, 255])
        let black = RgbBitmap(width: 1, height: 1, data: [0, 0, 0, 255])
        XCTAssertEqual(bakeLutPreview(white, invert(), 3, .tetrahedral).data, [0, 0, 0, 255])
        XCTAssertEqual(bakeLutPreview(black, invert(), 3, .tetrahedral).data, [255, 255, 255, 255])
    }
}
