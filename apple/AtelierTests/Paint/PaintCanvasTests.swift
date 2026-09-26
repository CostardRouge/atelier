// The canvas layer under every painter, held to what a browser's canvas does:
// its colour strings, its shadow (measured in the frame, DOWN is down, and
// never scaled by the transform), its text (the brand faces, the fallback a
// missing glyph takes, letter spacing, the em-box baselines) and its image
// orientation. A wrong answer here is wrong in every overlay at once.

import AtelierKit
import CoreGraphics
import XCTest
@testable import Atelier

final class PaintCanvasTests: XCTestCase {
    override func setUp() {
        super.setUp()
        Brand.registerFonts()
    }

    // MARK: colours

    private func components(_ css: String) -> [Double]? {
        CSSColor.parse(css).flatMap { $0.components?.map { Double($0) } }
    }

    func testCssColoursReadAsTheWebWritesThem() {
        XCTAssertEqual(components("#fff"), [1, 1, 1, 1])
        XCTAssertEqual(components("#000000"), [0, 0, 0, 1])
        let accent = components("#e2542f")!
        XCTAssertEqual(accent[0], 226.0 / 255, accuracy: 1e-9)
        XCTAssertEqual(accent[1], 84.0 / 255, accuracy: 1e-9)
        XCTAssertEqual(accent[2], 47.0 / 255, accuracy: 1e-9)
        let veil = components("rgba(0,0,0,0.65)")!
        XCTAssertEqual(veil[3], 0.65, accuracy: 1e-9)
        let modern = components("rgb(255 0 0 / 50%)")!
        XCTAssertEqual(modern, [1, 0, 0, 0.5])
        XCTAssertEqual(components("transparent")?[3], 0)
        XCTAssertNil(CSSColor.parse("not a colour"), "a canvas ignores what it cannot parse")
        XCTAssertNil(CSSColor.parse("#12"))
    }

    // MARK: shadows

    func testAShadowOffsetGoesDownTheFrameWhateverTheDeviceSpace() {
        let raster = PaintRaster.render(200, 200) { cg, size in
            let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
            c.setShadow(color: "#000000", blur: 0, offsetX: 0, offsetY: 30)
            c.setFill("#ffffff")
            c.fillRect(50, 50, 40, 40)
            c.finish()
        }
        XCTAssertEqual(raster.pixel(70, 70), .init(r: 255, g: 255, b: 255, a: 255), "the shape where it was put")
        XCTAssertEqual(raster.pixel(70, 110).a, 255, "its shadow 30 px BELOW it")
        XCTAssertEqual(raster.pixel(70, 110).r, 0)
        XCTAssertEqual(raster.pixel(70, 30).a, 0, "nothing above it")
    }

    func testAShadowIsNotScaledByTheTransformAsOnACanvas() {
        let raster = PaintRaster.render(200, 200) { cg, size in
            let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
            c.scale(2, 2)
            c.setShadow(color: "#000000", blur: 0, offsetX: 0, offsetY: 30)
            c.setFill("#ffffff")
            c.fillRect(25, 25, 20, 20) // 50…90 in the frame
            c.finish()
        }
        XCTAssertEqual(raster.pixel(70, 110).a, 255, "30 frame pixels down, not 60")
        XCTAssertEqual(raster.pixel(70, 135).a, 0)
    }

    func testNoColourOrNoBlurAndNoOffsetDrawsNoShadow() {
        let raster = PaintRaster.render(100, 100) { cg, size in
            let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
            c.setShadow(color: "rgba(0,0,0,0)", blur: 10, offsetY: 10)
            c.setFill("#ffffff")
            c.fillRect(40, 40, 20, 20)
            c.finish()
        }
        XCTAssertEqual(raster.pixel(50, 68).a, 0)
    }

    // MARK: images

    func testAnImageIsDrawnWithItsTopRowAtTheTop() {
        var rgba = [UInt8](repeating: 255, count: 2 * 2 * 4)
        // Row 0 red, row 1 blue.
        for i in 0..<2 { rgba[i * 4 + 1] = 0; rgba[i * 4 + 2] = 0 }
        for i in 2..<4 { rgba[i * 4] = 0; rgba[i * 4 + 1] = 0 }
        let image = OverlayRaster.image(rgba: rgba, width: 2, height: 2)!
        let raster = PaintRaster.render(20, 20) { cg, size in
            let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
            c.imageSmoothing = .none
            c.drawImage(image, 0, 0, 20, 20)
            c.finish()
        }
        XCTAssertEqual(raster.pixel(10, 2), .init(r: 255, g: 0, b: 0, a: 255))
        XCTAssertEqual(raster.pixel(10, 17), .init(r: 0, g: 0, b: 255, a: 255))
    }

    // MARK: text

    func testTheBrandFacesAreTheBundledFiles() {
        let grotesk = PaintFonts.resolve(PaintFont(["Space Grotesk", "sans-serif"], size: 40, weight: 600))
        XCTAssertTrue(grotesk.postScriptName.hasPrefix("SpaceGrotesk"), grotesk.postScriptName)
        XCTAssertFalse(grotesk.syntheticBold, "600 is on the variable file's axis, not synthesised")
        let mono = PaintFonts.resolve(PaintFont(["JetBrains Mono", "monospace"], size: 40))
        XCTAssertTrue(mono.postScriptName.hasPrefix("JetBrainsMono"), mono.postScriptName)
        let serif = PaintFonts.resolve(PaintFont(["Instrument Serif", "serif"], size: 40, weight: 700))
        XCTAssertTrue(serif.postScriptName.hasPrefix("InstrumentSerif"), serif.postScriptName)
        XCTAssertTrue(serif.syntheticBold, "a single-weight face is emboldened as Chrome does")
        let pixel = PaintFonts.resolve(PaintFont(["VT323", "monospace"], size: 40))
        XCTAssertTrue(pixel.postScriptName.hasPrefix("VT323"), pixel.postScriptName)
    }

    func testAMissingFamilyFallsToTheNextOfItsStack() {
        let resolved = PaintFonts.resolve(PaintFont(["No Such Face", "sans-serif"], size: 40))
        XCTAssertEqual(resolved.postScriptName, "Helvetica")
    }

    func testAGlyphNoBrandFaceHasStillDraws() {
        // The memory's trap: an emoji default drew NOTHING where no face had it.
        let raster = PaintRaster.render(200, 120) { cg, size in
            let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
            c.font = PaintFont(["Space Grotesk", "sans-serif"], size: 64)
            c.setFill("#ffffff")
            c.fillText("\u{1F642}", 20, 90)
            c.finish()
        }
        XCTAssertGreaterThan(raster.points { $0.a > 0 }.count, 200)
    }

    func testLetterSpacingIsAddedBetweenEveryCharacter() {
        // Core Text's kern and Chrome's letterSpacing both space every gap;
        // whether the LAST character carries one too is measured, not assumed.
        let font = PaintFont(["Space Grotesk", "sans-serif"], size: 50)
        let plain = PaintFonts.line("ABCD", font).width
        let spaced = PaintFonts.line("ABCD", font, letterSpacing: 10).width
        XCTAssertGreaterThanOrEqual(spaced - plain, 29.5)
        XCTAssertLessThanOrEqual(spaced - plain, 40.5)
    }

    func testTheInkBoxSitsOnTheBaselineAndTheTopBaselineIsTheEmBoxs() {
        let font = PaintFont(["Space Grotesk", "sans-serif"], size: 100)
        let line = PaintFonts.line("H", font)
        XCTAssertGreaterThan(line.inkAscent, 50)
        XCTAssertLessThan(line.inkAscent, 100)
        XCTAssertEqual(line.inkDescent, 0, accuracy: 2, "an H has no descender")
        XCTAssertEqual(line.emAscent + line.emDescent, 100, accuracy: 1e-9)

        let raster = PaintRaster.render(200, 300) { cg, size in
            let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
            c.font = font
            c.setFill("#ffffff")
            c.textBaseline = .top
            c.fillText("H", 20, 100)
            c.finish()
        }
        let ink = raster.bounds { $0.a > 128 }!
        XCTAssertGreaterThanOrEqual(ink.minY, 99, "a top baseline hangs the em box from y")
        XCTAssertEqual(Double(ink.maxY), 100 + line.emAscent, accuracy: 2, "the H stands on the baseline")
    }

    func testAMaxWidthSqueezesTheRunToFit() {
        let raster = PaintRaster.render(400, 120) { cg, size in
            let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
            c.font = PaintFont(["Space Grotesk", "sans-serif"], size: 60)
            c.setFill("#ffffff")
            c.textAlign = .center
            c.fillText("A very long caption", 200, 80, maxWidth: 100)
            c.finish()
        }
        let ink = raster.bounds { $0.a > 64 }!
        XCTAssertGreaterThanOrEqual(ink.minX, 148)
        XCTAssertLessThanOrEqual(ink.maxX, 252)
    }
}
