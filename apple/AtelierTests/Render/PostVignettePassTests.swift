// The gate for the post-crop vignette — the web's `check-render.mjs` row «the
// post-crop vignette, from BOTH source kinds», on macOS: a crop OFF-CENTRE and
// TURNED, so a flip cannot hide in a symmetry, the vignette shaped in the
// delivered frame through `frameAffine` and held to `postVignetteAt` at the
// web's tolerance: 2 codes — and it must have darkened by more than 20.
//
// The web ran it from a canvas and an ImageBitmap, whose y conventions differ;
// here the one convention is derived in the kernel (`PostVignette.metal`), and
// a row proves the fixture could tell the frame from its mirror image.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class PostVignettePassTests: XCTestCase {
    static let width = 180
    static let height = 120
    static let ratio = 0.8
    static let tolerance = 2.0
    static let framing = Framing(scale: 1.3, x: 0.25, y: -0.2, rotation: 15)
    static let vignette = PostCropVignette(amount: -80, midpoint: 20, roundness: 40, feather: 30, highlights: 50)

    static var affine: FrameAffine {
        frameAffine(Double(width), Double(height), ratio, framing)
    }

    static func picture() -> GeometryGate.Picture {
        GeometryGate.picture(width: width, height: height) { x, y in
            let r = 90 + (Double(x) / Double(width) * 120).rounded()
            let b = 60 + (Double(y) / Double(height) * 150).rounded()
            return (r / 255, 150.0 / 255, b / 255)
        }
    }

    static var probes: [(Int, Int)] {
        var out: [(Int, Int)] = []
        for y in stride(from: 4, to: height, by: 9) {
            for x in stride(from: 3, to: width, by: 11) { out.append((x, y)) }
        }
        return out
    }

    /// The twin at image pixel (x, y): where it lands in the frame, then the vignette there.
    static func want(_ source: GeometryGate.Picture, _ x: Int, _ y: Int, _ v: PostCropVignette,
                     mirrored: Bool = false) -> (Double, Double, Double) {
        let u = (Double(x) + 0.5) / Double(width)
        let yy = (Double(y) + 0.5) / Double(height)
        let (fu, fv) = toFrame(affine, u, mirrored ? 1 - yy : yy)
        return postVignetteAt(source.value(x, y, 0), source.value(x, y, 1), source.value(x, y, 2),
                              fu, fv, ratio, postVignetteTerms(v))
    }

    func testTheLibraryVendsTheKernel() {
        XCTAssertNoThrow(try Kernels.kernel(PostVignettePass.kernelName), "default.metallib did not build, or the function moved")
    }

    func testOnlyAmountMakesAPass() {
        XCTAssertNil(PostVignettePass.make(PostCropVignette(midpoint: 10, roundness: 40), affine: .identity, frameAspect: 1))
        XCTAssertNil(PostVignettePass.make(nil, affine: .identity, frameAspect: 1))
        XCTAssertNil(PostVignettePass.make(Self.vignette, sourceWidth: 0, sourceHeight: 120, frameRatio: 0.8, framing: nil))
        let pass = PostVignettePass.make(Self.vignette, sourceWidth: 180, sourceHeight: 120, frameRatio: 0.8, framing: Self.framing)
        XCTAssertEqual(pass?.affine, Self.affine, "the frame is the crop's own affine")
        XCTAssertEqual(pass?.frameAspect, 0.8)
    }

    func testTheFixtureTellsTheFrameFromItsMirror() {
        let source = Self.picture()
        var apart = 0.0
        for (x, y) in Self.probes {
            let right = Self.want(source, x, y, Self.vignette)
            let wrong = Self.want(source, x, y, Self.vignette, mirrored: true)
            apart = max(apart, abs(right.0 - wrong.0) * 255, abs(right.1 - wrong.1) * 255, abs(right.2 - wrong.2) * 255)
        }
        XCTAssertGreaterThan(apart, 3 * Self.tolerance, "the fixture cannot tell the frame from its mirror")
    }

    func check(_ vignette: PostCropVignette, file: StaticString = #filePath, line: UInt = #line) throws -> [Float] {
        let source = Self.picture()
        let pass = try XCTUnwrap(PostVignettePass.make(vignette, affine: Self.affine, frameAspect: Self.ratio), file: file, line: line)
        let got = try GeometryGate.run({ try pass.drawn(source.image, GeometryGate.ctx(source)) }, width: Self.width, height: Self.height)
        var worst = 0.0
        var at = ""
        for (x, y) in Self.probes {
            let want = Self.want(source, x, y, vignette)
            let i = (y * Self.width + x) * 4
            for (c, value) in [want.0, want.1, want.2].enumerated() {
                let d = abs(Double(got[i + c]) - value) * 255
                if d.isNaN || d > worst {
                    worst = d.isNaN ? .infinity : d
                    at = "(\(x), \(y)) channel \(c)"
                }
            }
        }
        XCTAssertLessThanOrEqual(worst, Self.tolerance, "\(GeometryGate.renderer): worst \(worst) codes at \(at)", file: file, line: line)
        return got
    }

    func testADarkVignetteMatchesTheTwinInItsDeliveredFrame() throws {
        let got = try check(Self.vignette)
        // How much it darkened somewhere — a pass that drew nothing proves nothing.
        let source = Self.picture()
        var moved = 0.0
        for y in 0..<Self.height {
            for x in 0..<Self.width {
                moved = max(moved, (source.value(x, y, 1) - Double(got[(y * Self.width + x) * 4 + 1])) * 255)
            }
        }
        XCTAssertGreaterThan(moved, 20, "it darkened by only \(moved) codes")
    }

    func testALightVignetteMatchesTheTwinToo() throws {
        // Above zero the other branch: toward white, in light, no Highlights.
        _ = try check(PostCropVignette(amount: 60, midpoint: 35, roundness: -50, feather: 60, highlights: 0))
    }

    func testTilesAgree() throws {
        let source = Self.picture()
        let pass = try XCTUnwrap(PostVignettePass.make(Self.vignette, affine: Self.affine, frameAspect: Self.ratio))
        let recipe = try pass.drawn(source.image, GeometryGate.ctx(source))
        _ = try GeometryGate.run({ recipe }, width: Self.width, height: Self.height)
        GeometryGate.assertTilesAgree(recipe, width: Self.width, height: Self.height, pass: pass.id)
    }
}
