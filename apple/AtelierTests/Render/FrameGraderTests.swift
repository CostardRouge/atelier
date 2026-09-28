// The graph's assembly and its context, pinned apart from any kernel: the
// order of the slots (before → cube → after → film), the swap, the identity
// when there is nothing to draw, and the working-space rules the shared
// context is made under — including what leaves it: the codes, untouched,
// tagged sRGB. Nothing here runs a Core Image kernel of ours.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class FrameGraderTests: XCTestCase {
    final class Log {
        var ids: [String] = []
    }

    /// A pass that writes its id down and changes nothing.
    struct Recording: RenderPass {
        let id: String
        let log: Log

        func apply(_ image: CIImage, _ ctx: PassContext) -> CIImage {
            log.ids.append(id)
            return image
        }
    }

    /// A flat mid-grey square from untagged float bytes: codes, as a decode
    /// hands the graph, with no colour space for anything to convert from.
    private func square(_ side: Int = 4) -> CIImage {
        var floats = [Float](repeating: 1, count: side * side * 4)
        for i in 0..<(side * side) {
            floats[i * 4] = 0.5
            floats[i * 4 + 1] = 0.5
            floats[i * 4 + 2] = 0.5
        }
        let data = floats.withUnsafeBufferPointer { Data(buffer: $0) }
        return CIImage(bitmapData: data, bytesPerRow: side * 16,
                       size: CGSize(width: side, height: side), format: .RGBAf, colorSpace: nil)
    }

    private func ids(_ grader: FrameGrader) -> [String] {
        grader.passes.map { $0.id }
    }

    func testTheOrderIsBeforeCubeAfterFilmAndNoCallerChoosesIt() {
        let log = Log()
        let grader = FrameGrader(
            lut: CubeLut.identity(),
            before: [Recording(id: "repair", log: log), Recording(id: "denoise", log: log)],
            after: [Recording(id: "lens", log: log), Recording(id: "sharpen", log: log)],
            film: Recording(id: "film", log: log))
        XCTAssertEqual(ids(grader), ["repair", "denoise", "cube", "lens", "sharpen", "film"])
        // No lattice: the cube costs no node, the order of the rest holds.
        grader.setCube(nil)
        XCTAssertNil(grader.cube)
        XCTAssertEqual(ids(grader), ["repair", "denoise", "lens", "sharpen", "film"])
        _ = grader.render(source: square())
        XCTAssertEqual(log.ids, ["repair", "denoise", "lens", "sharpen", "film"])
    }

    func testTheSwapsReplaceTheirSlotsInPlace() {
        let log = Log()
        let grader = FrameGrader()
        grader.setExtraPasses([Recording(id: "b", log: log)], before: [Recording(id: "a", log: log)])
        XCTAssertEqual(ids(grader), ["a", "b"])
        grader.setExtraPasses([])
        XCTAssertEqual(ids(grader), [])
        grader.setFilm(Recording(id: "film", log: log))
        XCTAssertEqual(ids(grader), ["film"])
        grader.setCube(CubeLut.identity(), intensity: 0.25, interpolation: .trilinear)
        XCTAssertEqual(ids(grader), ["cube", "film"])
        XCTAssertEqual(grader.cube?.intensity, 0.25)
        XCTAssertEqual(grader.cube?.interpolation, .trilinear)
        grader.setFilm(nil)
        XCTAssertEqual(ids(grader), ["cube"])
    }

    func testARecipeHandedOutIsNotChangedByTheNextSwap() {
        // A render is a recipe built from the passes held AT THAT MOMENT: a
        // stage render in flight and the next slider step cannot interfere.
        let log = Log()
        let grader = FrameGrader(after: [Recording(id: "first", log: log)])
        let source = square()
        _ = grader.render(source: source)
        grader.setExtraPasses([Recording(id: "second", log: log)])
        _ = grader.render(source: source)
        XCTAssertEqual(log.ids, ["first", "second"])
    }

    func testNoLookAndNoPassHandsTheSourceBack() {
        let source = square()
        XCTAssertTrue(FrameGrader().render(source: source) === source)
    }

    func testTheContextCarriesTheRenderSizeTheScaleTheSourceInstantAndTheCubes() {
        let grader = FrameGrader()
        let ctx = PassContext(renderSize: CGSize(width: 1280, height: 720), sourceScale: 0.5,
                              sourceSeconds: 2.5, cubes: grader.cubes)
        XCTAssertEqual(ctx.renderSize, CGSize(width: 1280, height: 720))
        // A radius of 8 source pixels on a half-size render is 4.
        XCTAssertEqual(ctx.scaled(8), 4)
        XCTAssertEqual(ctx.sourceSeconds, 2.5)
        XCTAssertTrue(ctx.cubes === grader.cubes)
        // A still passes nothing and stays on field 0.
        XCTAssertNil(PassContext(renderSize: .zero).sourceSeconds)
        XCTAssertEqual(PassContext(renderSize: .zero).sourceScale, 1)
    }

    func testTheContextOptionsAreTheWebsWorkingSpace() {
        let options = RenderContexts.options()
        XCTAssertEqual((options[.workingFormat] as? NSNumber)?.int32Value, CIFormat.RGBAh.rawValue)
        XCTAssertTrue(options[.workingColorSpace] is NSNull, "no colour management in")
        XCTAssertTrue(options[.outputColorSpace] is NSNull, "no colour management out")
        XCTAssertEqual(options[.cacheIntermediates] as? Bool, false)
        XCTAssertNil(options[.useSoftwareRenderer], "the app renders on the GPU")
        XCTAssertEqual(RenderContexts.options(software: true)[.useSoftwareRenderer] as? Bool, true)
    }

    func testTheContextKeepsHeadroomAboveWhite() {
        // A float source at 1.5 comes back at 1.5, which a half float holds
        // exactly: the chain is float16 and nothing clamps at white — the
        // rule every ported formula rests on.
        let w = 4
        let h = 2
        var floats = [Float](repeating: 1, count: w * h * 4)
        for i in 0..<(w * h) {
            floats[i * 4] = 1.5
            floats[i * 4 + 1] = 0.25
            floats[i * 4 + 2] = 0.75
        }
        let data = floats.withUnsafeBufferPointer { Data(buffer: $0) }
        let image = CIImage(bitmapData: data, bytesPerRow: w * 16, size: CGSize(width: w, height: h), format: .RGBAf, colorSpace: nil)
        let got = CubePassTests.read(image, width: w, height: h)
        for i in 0..<(w * h) {
            XCTAssertEqual(got[i * 4], 1.5, accuracy: 1e-3, "red at \(i)")
            XCTAssertEqual(got[i * 4 + 1], 0.25, accuracy: 1e-3, "green at \(i)")
            XCTAssertEqual(got[i * 4 + 2], 0.75, accuracy: 1e-3, "blue at \(i)")
            XCTAssertEqual(got[i * 4 + 3], 1, accuracy: 1e-3, "alpha at \(i)")
        }
    }

    func testTheDeliveredBytesAreTheCodesTaggedSRGBNeverConverted() throws {
        // What leaves the graph: an 8-bit picture whose bytes ARE the codes
        // that went in, the sRGB tag a statement about them rather than a
        // conversion into it. A colour-managed context would have moved every
        // mid-tone here; this one must not move any by more than rounding.
        let fixture = CubePassTests.gradient()
        let cg = try XCTUnwrap(FrameGrader.cgImage(fixture.image, context: CubePassTests.context))
        XCTAssertEqual(cg.width, fixture.width)
        XCTAssertEqual(cg.height, fixture.height)
        XCTAssertEqual(cg.colorSpace?.name.map { $0 as String }, CGColorSpace.sRGB as String)
        XCTAssertEqual(cg.bitsPerComponent, 8)
        let data = try XCTUnwrap(cg.dataProvider?.data)
        let bytes = try XCTUnwrap(CFDataGetBytePtr(data))
        var worst = 0.0
        for y in 0..<fixture.height {
            for x in 0..<fixture.width {
                let (r, g, b) = fixture.pixels[y * fixture.width + x]
                let o = y * cg.bytesPerRow + x * 4
                worst = max(worst,
                            abs(Double(bytes[o]) - r * 255),
                            abs(Double(bytes[o + 1]) - g * 255),
                            abs(Double(bytes[o + 2]) - b * 255))
            }
        }
        XCTAssertLessThanOrEqual(worst, 1, "\(CubePassTests.renderer): worst \(worst) codes from the codes that went in")
    }

    func testFitNeverEnlargesAndReportsItsScale() {
        let source = square(400)
        let down = FrameGrader.fit(source, longEdge: 100)
        XCTAssertEqual(down.scale, 0.25)
        XCTAssertEqual(down.image.extent, CGRect(x: 0, y: 0, width: 100, height: 100))
        let same = FrameGrader.fit(source, longEdge: 800)
        XCTAssertEqual(same.scale, 1)
        XCTAssertTrue(same.image === source)
        let boxed = FrameGrader.fit(source, within: CGSize(width: 50, height: 200))
        XCTAssertEqual(boxed.scale, 0.125)
        XCTAssertEqual(boxed.image.extent, CGRect(x: 0, y: 0, width: 50, height: 50))
    }

    func testAResampledEdgeStaysOpaque() {
        // The filter reads past the picture's edge; clamped first, it reads
        // the edge's own colour back, never the clear outside.
        let down = FrameGrader.fit(square(400), longEdge: 100).image
        let got = CubePassTests.read(down, width: 100, height: 100)
        for i in [0, 99, 99 * 100, 100 * 100 - 1] {
            XCTAssertEqual(got[i * 4 + 3], 1, accuracy: 1e-3, "alpha at corner pixel \(i)")
            XCTAssertEqual(got[i * 4], 0.5, accuracy: 2e-3, "red at corner pixel \(i)")
        }
    }
}
