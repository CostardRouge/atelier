// Port of `src/shared/develop/watermark.test.ts`.

import XCTest
@testable import AtelierKit

final class WatermarkLineTests: XCTestCase {
    func testFillsTheIdentityAndTheCaptureIntoTheTemplate() {
        XCTAssertEqual(resolveWatermarkText("© {year} {creator}", creator: "Steeve Pommier", year: 2025), "© 2025 Steeve Pommier")
        XCTAssertEqual(resolveWatermarkText("{title} — {creator}", creator: "S", title: "  Uluru  "), "Uluru — S")
    }

    func testDropsATokenWithNothingBehindItAndDrawsNothingThatSaysNothing() {
        XCTAssertEqual(resolveWatermarkText("© {year} {creator}", creator: "S"), "© S")
        // A line that names its author and has none signs nothing: not drawn.
        XCTAssertEqual(resolveWatermarkText("© {year} {creator}", year: 2025), "")
        XCTAssertEqual(resolveWatermarkText("{title}", title: ""), "")
        XCTAssertEqual(resolveWatermarkText("steeve.website"), "steeve.website")
        XCTAssertEqual(resolveWatermarkText("   ", creator: "S"), "")
    }
}

final class WatermarkLayoutTests: XCTestCase {
    func testIsAShareOfTheSHORTSideTallSoAWebCopyAndTheFullPictureCarryTheSameMark() {
        let big = watermarkLayout(6000, 4000, position: .bottomRight, size: 2.5)
        let small = watermarkLayout(1620, 1080, position: .bottomRight, size: 2.5)
        assertClose(big.fontPx / 4000, small.fontPx / 1080, 2)
        XCTAssertEqual(big.x, 6000 - 100)
        XCTAssertEqual(big.y, 4000 - 100)
        XCTAssertEqual(big.align, .right)
        XCTAssertEqual(big.baseline, .bottom)
    }

    func testAnchorsEachPositionToItsOwnCornerOrEdge() {
        let topLeft = watermarkLayout(1000, 800, position: .topLeft, size: 3)
        XCTAssertEqual(topLeft.x, 24)
        XCTAssertEqual(topLeft.y, 24)
        XCTAssertEqual(topLeft.align, .left)
        XCTAssertEqual(topLeft.baseline, .top)
        let bottom = watermarkLayout(1000, 800, position: .bottom, size: 3)
        XCTAssertEqual(bottom.x, 500)
        XCTAssertEqual(bottom.align, .center)
        XCTAssertEqual(bottom.baseline, .bottom)
        // The convenience over a whole record is the same arithmetic.
        XCTAssertEqual(watermarkLayout(1000, 800, Watermark(text: "", position: .bottom, size: 3, opacity: 1, tone: .light)), bottom)
    }
}

final class WatermarkRecordTests: XCTestCase {
    func testReadsBackSafelyClampedAndComparesByValue() {
        XCTAssertEqual(readWatermark(nil), .default)
        let read = readWatermark([
            "text": .string(String(repeating: "x", count: 300)), "position": "middle", "size": 40, "opacity": 0, "tone": "dark",
        ])
        XCTAssertEqual(read, Watermark(text: String(repeating: "x", count: 120), position: .bottomRight, size: 8, opacity: 0.1, tone: .dark))
        XCTAssertTrue(sameWatermark(read, read))
        var other = read
        other.tone = .light
        XCTAssertFalse(sameWatermark(read, other))
    }

    func testKeepsTheWebsPositionsInOrderAndWritesTheFiveKeysItReads() {
        XCTAssertEqual(watermarkPositions.map(\.rawValue), ["bottom-right", "bottom-left", "bottom", "top-right", "top-left"])
        XCTAssertEqual(Watermark.default.json.objectValue?.keys.sorted(), ["opacity", "position", "size", "text", "tone"])
        // The round trip through the record's JSON is the identity, junk and all falling back.
        let mark = Watermark(text: "{title}", position: .topRight, size: 4, opacity: 0.5, tone: .dark)
        XCTAssertEqual(readWatermark(mark.json), mark)
        XCTAssertEqual(readWatermark(JSONValue.parse(Watermark.default.json.serialized())), .default)
        XCTAssertEqual(readWatermark("junk"), .default)
        XCTAssertEqual(readWatermark([1, 2]), .default)
    }
}
