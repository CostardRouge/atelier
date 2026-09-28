// The gate for the keystone — the web's `check-render.mjs` row «the keystone:
// does the GPU warp agree with the pure module?», on macOS, and more.
//
// The question no reasoning settles is the Y CONVENTION. On the web `v_uv`'s y
// runs with the picture for a canvas and against it for an ImageBitmap, which
// is how a mirrored keystone once shipped on every decoded photograph. Here
// Core Image's working space is y UP, the twin's image space y DOWN, and the
// kernel converts (`Keystone.metal`). So, as there:
//
// - the HARNESS first: an untouched marker must read back where it was drawn,
//   or every row here measures an upside-down page;
// - a marker in a KNOWN corner, turned 90°, must land where `keystoneMatrix`
//   says (within 0.02) — and the row asserts that a missing or doubled flip
//   would have landed it somewhere else;
// - then, beyond the web: a real keystone pixel by pixel against
//   `keystoneSampleMatrix` over a bilinear read (2 codes), EMPTY where the
//   picture ran out, and the exact region of interest proven by tiles.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class KeystonePassTests: XCTestCase {
    static let side = 128

    /// One bright block up and to the LEFT of centre: source point
    /// (−0.25, −0.25) in the twin's y-DOWN centred space.
    static func marked() -> GeometryGate.Picture {
        let s = side
        let at = Int(Double(s) * 0.25)
        return GeometryGate.picture(width: s, height: s) { x, y in
            let lit = x >= at - 6 && x < at + 6 && y >= at - 6 && y < at + 6
            return lit ? (1, 1, 1) : (0, 0, 0)
        }
    }

    /// The CENTROID of what is lit, in centred image coordinates (y down), so
    /// the answer is the middle of the marker rather than its first pixel.
    static func centroid(_ data: [Float], _ n: Int) -> (Double, Double)? {
        var sx = 0.0
        var sy = 0.0
        var w = 0.0
        for y in 0..<n {
            for x in 0..<n where data[(y * n + x) * 4] >= 0.5 {
                sx += (Double(x) + 0.5) / Double(n) - 0.5
                sy += (Double(y) + 0.5) / Double(n) - 0.5
                w += 1
            }
        }
        return w > 0 ? (sx / w, sy / w) : nil
    }

    static func away(_ a: (Double, Double), _ b: (Double, Double)) -> Double {
        max(abs(a.0 - b.0), abs(a.1 - b.1))
    }

    func testTheLibraryVendsTheKernel() {
        XCTAssertNoThrow(try Kernels.kernel(KeystonePass.kernelName), "default.metallib did not build, or the function moved")
    }

    func testTheHarnessReadsAnUntouchedMarkerWhereItWasDrawn() throws {
        let s = Self.side
        let source = Self.marked()
        let rest = try XCTUnwrap(Self.centroid(GeometryGate.read(source.image, width: s, height: s), s))
        XCTAssertLessThanOrEqual(Self.away(rest, (-0.25, -0.25)), 0.02,
                                 "untouched, the marker reads at \(rest): the harness itself is upside down")
        // And through an IDENTITY sample matrix: both conversions in the kernel
        // are exercised, and must cancel.
        let passthrough = KeystonePass(sample: .identity)
        let got = try GeometryGate.run({ try passthrough.drawn(source.image, GeometryGate.ctx(source)) }, width: s, height: s)
        let through = try XCTUnwrap(Self.centroid(got, s))
        XCTAssertLessThanOrEqual(Self.away(through, (-0.25, -0.25)), 0.02, "an identity keystone moved the marker to \(through)")
    }

    func testAQuarterTurnLandsTheMarkerWhereTheMatrixSays() throws {
        let s = Self.side
        let keystone = Keystone(rotation: 90)
        let forward = keystoneMatrix(keystone, 1)
        // A 90° turn sends the upper-left to the upper-RIGHT in a y-down space:
        // an unambiguous, sign-revealing answer.
        let expected = try XCTUnwrap(applyMatrix3(forward, -0.25, -0.25))
        // What a kernel that forgot the flip (or made it twice) would draw: the
        // map conjugated by the mirror, M ∘ F ∘ M.
        let mirrored = try XCTUnwrap(applyMatrix3(forward, -0.25, 0.25))
        let wrong = (mirrored.0, -mirrored.1)
        XCTAssertGreaterThan(Self.away(expected, wrong), 0.2, "the fixture cannot tell the right flip from the wrong one")

        let source = Self.marked()
        let pass = try XCTUnwrap(KeystonePass.make(keystone, aspectRatio: 1))
        let got = try GeometryGate.run({ try pass.drawn(source.image, GeometryGate.ctx(source)) }, width: s, height: s)
        let landed = try XCTUnwrap(Self.centroid(got, s), "nothing was lit: the turn threw the marker off the frame")
        XCTAssertLessThanOrEqual(Self.away(landed, expected), 0.02,
                                 "\(GeometryGate.renderer): the marker landed at \(landed); the matrix says \(expected)")
    }

    func testARealKeystoneMatchesTheTwinPixelByPixel() throws {
        let w = 96
        let h = 64
        let source = GeometryGate.picture(width: w, height: h) { x, y in
            let b = 0.5 + 0.4 * sin(Double(x) * 0.3) * cos(Double(y) * 0.2)
            return (Double(x) / Double(w - 1), Double(y) / Double(h - 1), b)
        }
        let keystone = Keystone(vertical: 40, horizontal: -20, rotation: 7, aspect: 10, scale: 1.25)
        let ar = Double(w) / Double(h)
        let sample = try XCTUnwrap(keystoneSampleMatrix(keystone, ar))
        let pass = try XCTUnwrap(KeystonePass.make(keystone, aspectRatio: ar))
        let got = try GeometryGate.run({ try pass.drawn(source.image, GeometryGate.ctx(source)) }, width: w, height: h)
        // One pixel of margin either side of the edge, where a bilinear read
        // and the refusal to read meet.
        let marginU = 1.0 / Double(w)
        let marginV = 1.0 / Double(h)
        var worst = 0.0
        var at = ""
        var inside = 0
        var empty = 0
        var moved = 0.0
        for y in 0..<h {
            for x in 0..<w {
                let u = (Double(x) + 0.5) / Double(w) - 0.5
                let v = (Double(y) + 0.5) / Double(h) - 0.5
                guard let p = applyMatrix3(sample, u, v) else { continue }
                let su = p.0 + 0.5
                let sv = p.1 + 0.5
                let i = (y * w + x) * 4
                if su > marginU, su < 1 - marginU, sv > marginV, sv < 1 - marginV {
                    inside += 1
                    for c in 0..<3 {
                        let d = abs(Double(got[i + c]) - source.bilinear(su, sv, c)) * 255
                        if d.isNaN || d > worst {
                            worst = d.isNaN ? .infinity : d
                            at = "(\(x), \(y)) channel \(c)"
                        }
                    }
                    moved = max(moved, abs(Double(got[i]) - source.value(x, y, 0)) * 255)
                } else if su < -marginU || su > 1 + marginU || sv < -marginV || sv > 1 + marginV {
                    // Where the picture ran out it is EMPTY — never the edge
                    // pixel smeared outwards.
                    empty += 1
                    for k in 0..<4 {
                        XCTAssertEqual(Double(got[i + k]), 0, accuracy: 1e-6, "(\(x), \(y)) channel \(k) is not empty")
                    }
                }
            }
        }
        XCTAssertGreaterThan(inside, w * h / 2, "most of the frame should still be picture")
        XCTAssertGreaterThan(empty, 0, "the fixture never reaches past the picture, so emptiness is untested")
        XCTAssertLessThanOrEqual(worst, 2, "\(GeometryGate.renderer): worst \(worst) codes at \(at)")
        XCTAssertGreaterThan(moved, 10, "the keystone moved the picture by only \(moved) codes")
    }

    func testTheRegionOfInterestCoversEveryRead() {
        // The exact inverse ROI is the one this pass is allowed to claim, so it
        // is held to the reads it must cover: every pixel of an output rect,
        // mapped through the sample matrix, lands inside the region (with the
        // bilinear read's own pixel) — or outside the picture, where nothing
        // is read at all.
        let w = 96.0
        let h = 64.0
        let extent = CGRect(x: 0, y: 0, width: w, height: h)
        let keystone = Keystone(vertical: 40, horizontal: -20, rotation: 7, aspect: 10, scale: 1.25)
        guard let sample = keystoneSampleMatrix(keystone, w / h) else { return XCTFail("the fixture folds") }
        let rects = [
            CGRect(x: 0, y: 0, width: 48, height: 32), CGRect(x: 48, y: 32, width: 48, height: 32),
            CGRect(x: 10, y: 40, width: 7, height: 9), CGRect(x: 80, y: 3, width: 16, height: 20),
        ]
        for rect in rects {
            let region = KeystonePass.sourceRegion(of: rect, sample: sample, extent: extent)
            for py in Int(rect.minY)..<Int(rect.maxY) {
                for px in Int(rect.minX)..<Int(rect.maxX) {
                    // A working-space pixel centre, as the kernel sees it.
                    let centre = CGPoint(x: Double(px) + 0.5, y: Double(py) + 0.5)
                    let (u, v) = GeometryPassSupport.imagePoint(centre, in: extent)
                    guard let p = applyMatrix3(sample, u - 0.5, v - 0.5) else { continue }
                    let su = p.0 + 0.5
                    let sv = p.1 + 0.5
                    guard su >= 0, su <= 1, sv >= 0, sv <= 1 else { continue }
                    let read = GeometryPassSupport.workingPoint(u: su, v: sv, in: extent)
                    let needed = CGRect(x: read.x - 1, y: read.y - 1, width: 2, height: 2)
                    XCTAssertTrue(region.contains(needed), "rect \(rect): the read at \(read) falls outside \(region)")
                }
            }
        }
    }

    func testTilesAgree() throws {
        let w = 96
        let h = 64
        let source = GeometryGate.picture(width: w, height: h) { x, y in
            (Double(x) / Double(w - 1), Double(y) / Double(h - 1), Double((x * 7 + y * 3) % 17) / 16)
        }
        let pass = try XCTUnwrap(KeystonePass.make(Keystone(vertical: 40, horizontal: -20, rotation: 7, aspect: 10, scale: 1.25),
                                                   aspectRatio: Double(w) / Double(h)))
        let recipe = try pass.drawn(source.image, GeometryGate.ctx(source))
        _ = try GeometryGate.run({ recipe }, width: w, height: h)
        GeometryGate.assertTilesAgree(recipe, width: w, height: h, pass: pass.id)
    }
}
