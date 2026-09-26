// Port of `src/shared/overlay/style-preview.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func appearance(_ glowAmount: Double) -> PreviewAppearance {
    var style = presetById("or-cine")!.style
    style.glowAmount = glowAmount
    return PreviewAppearance(style, glow: glowAmount > 0 ? glowLayersFor(style) : nil)
}

final class PreviewTextShadowTests: XCTestCase {
    func testPaintsNothingWithoutGlow() {
        XCTAssertEqual(previewTextShadow(appearance(0)), "none")
    }

    func testPaintsABrightHaloAndAWarmBleedInEm() throws {
        let shadow = previewTextShadow(appearance(0.5))
        let stops = shadow.components(separatedBy: "), ")
        XCTAssertEqual(stops.count, 2)
        XCTAssertTrue(shadow.contains("em rgba(255,255,255,")) // halo keeps to white
        XCTAssertEqual(shadow.components(separatedBy: "em").count - 1, 2) // radii scale with font size
        // The bleed drifts warm: blue collapses against the gold ink.
        let rgba = try XCTUnwrap(stops[1].range(of: "rgba("))
        let channels = stops[1][rgba.upperBound...].split(separator: ",").prefix(3).compactMap { Int($0) }
        XCTAssertEqual(channels.count, 3)
        XCTAssertLessThan(channels[2], channels[0])
    }
}

final class PreviewGlowFilterTests: XCTestCase {
    func testIsNilWithoutGlowADropShadowWithIt() {
        XCTAssertNil(previewGlowFilter(appearance(0)))
        XCTAssertTrue(previewGlowFilter(appearance(0.5))?.contains("drop-shadow(") ?? false)
    }
}

final class PreviewTextStyleTests: XCTestCase {
    func testMapsTheCanvasFamilyToACssStackAndCarriesTheSizeThrough() {
        let style = previewTextStyle(appearance(0), "0.62rem")
        XCTAssertEqual(style.fontFamily, previewFontStack[.instrumentSerif])
        XCTAssertEqual(style.fontSize, "0.62rem")
        XCTAssertEqual(style.textTransform, "none")
    }
}
