// The gate for the camera warp — the web's `check-render.mjs` row «the camera
// warp: WarpRectilinear against camera-warp.ts», on macOS: a grid of hard
// squares warped by the DJI's own shape (a magnification, the planes a hair
// apart) with an OFF-CENTRE optical centre and real k1/k2 — which is what
// makes the normalising radius, and the y convention, observable at all —
// held plane by plane to `warpSourceUv` over a bilinear read, at the web's
// tolerance: 3 codes.
//
// The web ran the row from a canvas AND an ImageBitmap because the two hand
// its shader opposite y conventions. Here there is one source kind and one
// convention, derived in the kernel (`CameraWarp.metal`); what stands in for
// the second source is a row proving the fixture could tell the optical centre
// from its MIRROR, so a flipped kernel cannot pass.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class CameraWarpPassTests: XCTestCase {
    static let width = 120
    static let height = 80
    /// The web gate's tolerance for this row.
    static let tolerance = 3.0

    static let warp = DngWarp(planes: [
        DngWarpPlane(radial: [1.0495, 0.012, -0.004, 0.001], tangential: [0.0005, -0.0004]),
        DngWarpPlane(radial: [1.0493, 0.012, -0.004, 0.001], tangential: [0.0005, -0.0004]),
        DngWarpPlane(radial: [1.0491, 0.012, -0.004, 0.001], tangential: [0.0005, -0.0004]),
    ], centerH: 0.47, centerV: 0.52)

    /// 10-pixel squares, red/green swapping between them, blue a ramp across.
    static func checker() -> GeometryGate.Picture {
        GeometryGate.picture(width: width, height: height) { x, y in
            let on = (x / 10 + y / 10) % 2 == 0
            let b = (20 + Double(x) / Double(width) * 200).rounded()
            return ((on ? 220 : 40) / 255, (on ? 60 : 200) / 255, b / 255)
        }
    }

    /// Well inside, so the pass's own refusal at the edge is not what is measured.
    static var probes: [(Int, Int)] {
        var out: [(Int, Int)] = []
        for y in stride(from: 10, to: height - 10, by: 3) {
            for x in stride(from: 10, to: width - 10, by: 4) { out.append((x, y)) }
        }
        return out
    }

    func testTheLibraryVendsTheKernel() {
        XCTAssertNoThrow(try Kernels.kernel(CameraWarpPass.kernelName), "default.metallib did not build, or the function moved")
    }

    func testAnIdentityWarpBuildsNoPass() {
        let identity = DngWarp(planes: [DngWarpPlane(radial: [1, 0, 0, 0], tangential: [0, 0])], centerH: 0.5, centerV: 0.5)
        XCTAssertNil(CameraWarpPass.make(identity, 120, 80), "an IDENTITY warp still built a pass")
        XCTAssertNil(CameraWarpPass.make(nil, 120, 80))
        XCTAssertNil(CameraWarpPass.make(Self.warp, 0, 80), "no pixels to normalise by")
        XCTAssertNotNil(CameraWarpPass.make(Self.warp, 1.5, 1), "only the aspect is needed")
    }

    func testTheFixtureTellsTheOpticalCentreFromItsMirror() {
        // A kernel with the y convention upside down would read (u, 1 − v) and
        // map back the same way. On this fixture that answer is more than the
        // tolerance away from the right one, so it cannot pass the row below.
        let source = Self.checker()
        let w = Double(Self.width)
        let h = Double(Self.height)
        var apart = 0.0
        for (x, y) in Self.probes {
            let u = (Double(x) + 0.5) / w
            let v = (Double(y) + 0.5) / h
            for c in 0..<3 {
                let right = warpSourceUv(Self.warp, c, u, v, w, h)
                let flipped = warpSourceUv(Self.warp, c, u, 1 - v, w, h)
                let want = source.bilinear(right.0, right.1, c)
                let mirror = source.bilinear(flipped.0, 1 - flipped.1, c)
                apart = max(apart, abs(want - mirror) * 255)
            }
        }
        XCTAssertGreaterThan(apart, 3 * Self.tolerance, "the fixture cannot tell the optical centre from its mirror")
    }

    func testTheWarpMatchesWarpSourceUvPlaneByPlane() throws {
        let source = Self.checker()
        let w = Self.width
        let h = Self.height
        let pass = try XCTUnwrap(CameraWarpPass.make(Self.warp, Double(w), Double(h)))
        let got = try GeometryGate.run({ try pass.drawn(source.image, GeometryGate.ctx(source)) }, width: w, height: h)
        var worst = 0.0
        var moved = 0.0
        var at = ""
        for (x, y) in Self.probes {
            let i = (y * w + x) * 4
            for c in 0..<3 {
                let (u, v) = warpSourceUv(Self.warp, c, (Double(x) + 0.5) / Double(w), (Double(y) + 0.5) / Double(h), Double(w), Double(h))
                let d = abs(Double(got[i + c]) - source.bilinear(u, v, c)) * 255
                if d.isNaN || d > worst {
                    worst = d.isNaN ? .infinity : d
                    at = "(\(x), \(y)) channel \(c)"
                }
            }
            moved = max(moved, abs(Double(got[i]) - source.value(x, y, 0)) * 255)
        }
        XCTAssertLessThanOrEqual(worst, Self.tolerance, "\(GeometryGate.renderer): worst \(worst) codes at \(at)")
        // A pass that drew nothing proves nothing.
        XCTAssertGreaterThan(moved, 30, "the warp moved the picture by only \(moved) codes")
    }

    func testTheWarpIsEmptyWhereThePictureRanOut() throws {
        // A ratio above 1 reads each corrected point from FURTHER out, so the
        // output's corners ask for picture that does not exist: the top-left
        // pixel's green would be read at u ≈ −0.05. Empty — all four channels —
        // never the edge pixel smeared outwards.
        let grow = DngWarp(planes: [DngWarpPlane(radial: [1.1, 0, 0, 0], tangential: [0, 0])], centerH: 0.5, centerV: 0.5)
        let source = Self.checker()
        let pass = try XCTUnwrap(CameraWarpPass.make(grow, Double(Self.width), Double(Self.height)))
        let got = try GeometryGate.run({ try pass.drawn(source.image, GeometryGate.ctx(source)) }, width: Self.width, height: Self.height)
        for k in 0..<4 {
            XCTAssertEqual(Double(got[k]), 0, accuracy: 1e-6, "channel \(k) of the corner is not empty")
        }
        // The centre is a fixed point of a pure scale about it, and opaque.
        let centre = ((Self.height / 2) * Self.width + Self.width / 2) * 4
        XCTAssertEqual(Double(got[centre + 3]), 1, accuracy: 1e-3, "the centre lost its alpha")
    }

    func testTilesAgree() throws {
        let source = Self.checker()
        let pass = try XCTUnwrap(CameraWarpPass.make(Self.warp, Double(Self.width), Double(Self.height)))
        let recipe = try pass.drawn(source.image, GeometryGate.ctx(source))
        _ = try GeometryGate.run({ recipe }, width: Self.width, height: Self.height)
        GeometryGate.assertTilesAgree(recipe, width: Self.width, height: Self.height, pass: pass.id)
    }
}
