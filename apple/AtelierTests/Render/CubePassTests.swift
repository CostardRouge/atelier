// The gate for the cube pass — the web's `scripts/check-render.mjs` rows on
// the look, on macOS: a synthetic gradient rendered through `CubePass` and
// compared pixel by pixel against the pure twin (`sampleTetrahedral`, or
// `sampleTrilinear` on request — AtelierKit's `CubeLut.swift`) at the web
// gate's tolerance: ONE 8-bit code, what a cube + passthrough round trip
// through float16 was measured to cost there (`render-core.md`, «At one pass
// it IS the old renderer»; the rows `cube + passthrough … allowed 1`).
//
// Hosted by the Mac app because the kernel lives in its `default.metallib`.
// Rendered on Metal where the runner has a device; on the software renderer
// otherwise, which is said in every failure and — where that renderer will
// not run a Metal kernel at all — turns the row into a skip that names why.
// A kernel that will not LOAD is never a skip: the library did not build.

import AtelierKit
import CoreImage
import Metal
import XCTest
@testable import Atelier

final class CubePassTests: XCTestCase {
    /// One 8-bit code: the web gate's tolerance for the cube.
    static let tolerance = 1.0 / 255.0
    static let hasMetal = MTLCreateSystemDefaultDevice() != nil
    static let context: CIContext = RenderContexts.make(software: !hasMetal)
    static var renderer: String {
        hasMetal ? "Metal" : "the software renderer (no Metal device on this machine)"
    }

    // MARK: - fixtures

    struct Gradient {
        let image: CIImage
        let width: Int
        let height: Int
        /// (r, g, b) per pixel, rows top to bottom — the order the bytes were written in.
        let pixels: [(Double, Double, Double)]
    }

    /// A W×H float picture: red across, green down, blue a stepped diagonal,
    /// every channel scaled by `headroom` so values above white are in it.
    static func gradient(width: Int = 64, height: Int = 48, headroom: Double = 1) -> Gradient {
        var floats = [Float](repeating: 1, count: width * height * 4)
        var pixels: [(Double, Double, Double)] = []
        pixels.reserveCapacity(width * height)
        for y in 0..<height {
            for x in 0..<width {
                let r = Double(x) / Double(width - 1) * headroom
                let g = Double(y) / Double(height - 1) * headroom
                let b = Double((x * 7 + y * 3) % 17) / 16 * headroom
                let o = (y * width + x) * 4
                floats[o] = Float(r)
                floats[o + 1] = Float(g)
                floats[o + 2] = Float(b)
                // The twin is fed what the picture really holds: the float the
                // bytes carry, not the double it was computed from.
                pixels.append((Double(Float(r)), Double(Float(g)), Double(Float(b))))
            }
        }
        let data = floats.withUnsafeBufferPointer { Data(buffer: $0) }
        let image = CIImage(bitmapData: data, bytesPerRow: width * 16,
                            size: CGSize(width: width, height: height), format: .RGBAf, colorSpace: nil)
        return Gradient(image: image, width: width, height: height, pixels: pixels)
    }

    /// A recipe rendered to floats, RGBA per pixel, rows top to bottom — the
    /// same order the gradient was written in, so index i in is index i out.
    static func read(_ image: CIImage, width: Int, height: Int) -> [Float] {
        read(image, bounds: CGRect(x: 0, y: 0, width: width, height: height))
    }

    /// The pixels of `bounds` — in Core Image's own coordinates — as floats.
    static func read(_ image: CIImage, bounds: CGRect) -> [Float] {
        let width = Int(bounds.width)
        let height = Int(bounds.height)
        var out = [Float](repeating: .nan, count: width * height * 4)
        out.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress else { return }
            context.render(image, toBitmap: base, rowBytes: width * 16, bounds: bounds, format: .RGBAf, colorSpace: nil)
        }
        return out
    }

    /// `pass` over `source`, read back — or a skip where this machine's
    /// renderer cannot run the kernel at all (never where it LOADS badly).
    func run(_ pass: CubePass, over source: CIImage, width: Int, height: Int) throws -> [Float] {
        let recipe: CIImage
        do {
            recipe = try pass.graded(source, PassContext(renderSize: source.extent.size))
        } catch KernelError.applyFailed(let name) where !Self.hasMetal {
            throw XCTSkip("no Metal device here, and the software renderer would not run the '\(name)' kernel")
        }
        let got = Self.read(recipe, width: width, height: height)
        if !Self.hasMetal, got.allSatisfy({ $0.isNaN }) {
            throw XCTSkip("no Metal device here, and the software renderer drew nothing through the cube kernel")
        }
        return got
    }

    /// The gradient through `lut` at `intensity`, held to the twin; the worst
    /// channel difference, in [0,1].
    @discardableResult
    func check(_ lut: CubeLut, intensity: Double = 1, headroom: Double = 1,
               interpolation: Interpolation = .tetrahedral,
               file: StaticString = #filePath, line: UInt = #line) throws -> Double {
        let fixture = Self.gradient(headroom: headroom)
        let pass = CubePass(lut: lut, intensity: intensity, interpolation: interpolation)
        let got = try run(pass, over: fixture.image, width: fixture.width, height: fixture.height)
        var worst = 0.0
        var at = 0
        for i in 0..<fixture.pixels.count {
            let (r, g, b) = fixture.pixels[i]
            let looked = sampleWith(lut, r, g, b, interpolation)
            let want = [r + (looked.0 - r) * intensity, g + (looked.1 - g) * intensity, b + (looked.2 - b) * intensity]
            for c in 0..<3 {
                let d = abs(Double(got[i * 4 + c]) - want[c])
                // A NaN is the worst answer there is, never a pass.
                if d.isNaN || d > worst {
                    worst = d.isNaN ? .infinity : d
                    at = i
                }
            }
        }
        XCTAssertLessThanOrEqual(
            worst, Self.tolerance,
            "\(Self.renderer), \(interpolation.rawValue): worst \(worst * 255) codes at pixel (\(at % fixture.width), \(at / fixture.width))",
            file: file, line: line)
        return worst
    }

    // MARK: - the library

    func testTheLibraryVendsTheCubeKernelAndNamesAMissingOne() throws {
        XCTAssertNoThrow(try Kernels.kernel("cubeLookup"), "default.metallib did not build, or the function moved")
        XCTAssertThrowsError(try Kernels.kernel("noSuchKernel")) { error in
            let said = String(describing: error)
            XCTAssertTrue(said.contains("noSuchKernel"), "the error must name the function: \(said)")
        }
    }

    // MARK: - the lattice, packed

    func testThePackedLatticeSitsWhereTheKernelLooks() {
        // Pins the one convention the kernel's reads rest on, by Core Image
        // COORDINATE rather than by memory row: lattice point (r, g, b) is the
        // pixel at x = b·N + r, y = g — y counted UP from the bottom. Each row
        // is read back as a one-row bitmap, which has no row order to get wrong.
        let n = 5
        let lut = CubeLut.make(size: n) { ($0, $1, $2) }
        let packed = CubePass.pack(lut)
        XCTAssertEqual(packed.extent, CGRect(x: 0, y: 0, width: n * n, height: n))
        for g in 0..<n {
            let row = Self.read(packed, bounds: CGRect(x: 0, y: g, width: n * n, height: 1))
            for b in 0..<n {
                for r in 0..<n {
                    let o = (b * n + r) * 4
                    let at = "lattice point (\(r), \(g), \(b))"
                    XCTAssertEqual(Double(row[o]), Double(r) / Double(n - 1), accuracy: 1e-3, "red at \(at)")
                    XCTAssertEqual(Double(row[o + 1]), Double(g) / Double(n - 1), accuracy: 1e-3, "green at \(at)")
                    XCTAssertEqual(Double(row[o + 2]), Double(b) / Double(n - 1), accuracy: 1e-3, "blue at \(at)")
                    XCTAssertEqual(Double(row[o + 3]), 1, accuracy: 1e-3, "alpha at \(at)")
                }
            }
        }
    }

    func testTheCacheRepacksOnlyWhenTheLatticeChanges() {
        let cache = CubeCache(capacity: 2)
        let first = cache.packed(CubeLut.make(size: 9) { ($0, $1, $2) })
        XCTAssertEqual(cache.packs, 1)
        // The same numbers in a new array: nothing to repack.
        XCTAssertTrue(cache.packed(CubeLut.make(size: 9) { ($0, $1, $2) }) === first)
        XCTAssertEqual(cache.packs, 1)
        // A different lattice: packed, and the first is still held.
        let inverted = CubeLut.make(size: 9) { (1 - $0, $1, $2) }
        XCTAssertFalse(cache.packed(inverted) === first)
        XCTAssertEqual(cache.packs, 2)
        XCTAssertTrue(cache.packed(CubeLut.make(size: 9) { ($0, $1, $2) }) === first)
        XCTAssertEqual(cache.packs, 2)
        // A third past the capacity evicts the one used longest ago — the
        // inverted cube, since the identity was just asked for again.
        _ = cache.packed(CubeLut.make(size: 5) { r, _, _ in (r, r, r) })
        XCTAssertEqual(cache.count, 2)
        XCTAssertTrue(cache.packed(CubeLut.make(size: 9) { ($0, $1, $2) }) === first)
        XCTAssertEqual(cache.packs, 3)
        _ = cache.packed(inverted)
        XCTAssertEqual(cache.packs, 4, "the evicted lattice is packed again")
    }

    func testTheGraphPacksALookOnceAcrossRenders() {
        let grader = FrameGrader(lut: CubeLut.make(size: 9) { (1 - $0, $1, $2) })
        let source = Self.gradient().image
        _ = grader.render(source: source)
        _ = grader.render(source: source)
        // A re-baked develop: new array, same numbers.
        grader.setCube(CubeLut.make(size: 9) { (1 - $0, $1, $2) }, intensity: 0.5)
        _ = grader.render(source: source)
        XCTAssertEqual(grader.cubes.packs, 1)
        XCTAssertEqual(grader.cube?.intensity, 0.5)
    }

    // MARK: - the kernel against the twin

    func testAnIdentityCubeLeavesTheGradientUntouched() throws {
        try check(CubeLut.make(size: 33) { ($0, $1, $2) })
    }

    func testAnInvertingCubeMatchesTheTwin() throws {
        try check(CubeLut.make(size: 17) { (1 - $0, 1 - $1, 1 - $2) })
    }

    func testAnAsymmetricCubeIsSampledTetrahedrallyNotTrilinearly() throws {
        // Cross terms are where the two interpolations part: trilinear
        // reproduces r·g exactly (it is bilinear), tetrahedral misses it by
        // h²/4 at a cell's centre — 1/64 on a 5³ lattice, four codes. So the
        // fixture is first proved able to tell them apart, then the GPU is
        // held to the tetrahedral answer — and, asked, to the trilinear one.
        let lut = CubeLut.make(size: 5) { r, g, b in
            (r * g, 2 * g * b, (r + g + b) / 3 + r * b * (1 - g))
        }
        var apart = 0.0
        for (r, g, b) in Self.gradient().pixels {
            let tet = sampleTetrahedral(lut, r, g, b)
            let tri = sampleTrilinear(lut, r, g, b)
            apart = max(apart, abs(tet.0 - tri.0), abs(tet.1 - tri.1), abs(tet.2 - tri.2))
        }
        XCTAssertGreaterThan(apart, 3 * Self.tolerance, "the fixture cannot tell the two interpolations apart")
        try check(lut)
        try check(lut, interpolation: .trilinear)
    }

    func testStrengthMixesTowardTheLookAndKeepsHeadroom() throws {
        let invert = CubeLut.make(size: 9) { (1 - $0, 1 - $1, 1 - $2) }
        // Half strength over a source reaching 1.5: the lookup clamps to the
        // lattice's edge, the mix keeps half the overshoot — nothing clamps
        // the SOURCE, as the web's graph does not.
        try check(invert, intensity: 0.5, headroom: 1.5)
        // Past the look: 0.2 inverts to 0.8 and extrapolates to 1.1, above
        // white — Metal's mix() is undefined out here, the kernel's is not.
        try check(invert, intensity: 1.5)
        // Zero strength is the source, whatever the lattice.
        try check(invert, intensity: 0)
    }

    func testALatticeAboveWhiteKeepsItsHeadroom() throws {
        // A conversion LUT's rolloff lives above 1.0 in the lattice itself
        // (the shipped DJI cube is `#Not-Clipped.`): the half-float table and
        // the half-float chain must carry it, where an 8-bit table would clamp.
        try check(CubeLut.make(size: 17) { ($0 * 1.6, $1 * 1.3 + 0.1, $2 * $2 * 2) })
    }

    func testTheDeclaredDomainIsHonouredAndClampedOutsideIt() throws {
        let lut = CubeLut.make(size: 9, { ($0, $1 * 0.5, 1 - $2) },
                               domainMin: (0.2, 0.2, 0.2), domainMax: (0.8, 0.8, 0.8))
        try check(lut, headroom: 1.25)
        try check(lut, headroom: 1.25, interpolation: .trilinear)
    }

    func testANeutralStaysNeutralThroughAnAsymmetricLook() throws {
        // The reason tetrahedral is the default: every tetrahedron shares the
        // c000→c111 edge, so a grey through a look that is neutral on its axis
        // but tints every colour off it comes out as the look's own grey,
        // never a mix of off-axis corners. This look is the identity on the
        // axis; trilinear tints its greys by about eight codes (measured on
        // the twin, and asserted below so the fixture cannot go blunt).
        let lut = CubeLut.make(size: 9) { r, g, b in
            (r + 4 * (g - b) * (g - b), g, b + 4 * (r - g) * (r - g))
        }
        var trilinearTint = 0.0
        for x in 0..<32 {
            let v = Double(Float(x) / Float(31))
            let tri = sampleTrilinear(lut, v, v, v)
            trilinearTint = max(trilinearTint, abs(tri.0 - tri.1), abs(tri.1 - tri.2))
        }
        XCTAssertGreaterThan(trilinearTint, 3 * Self.tolerance, "the fixture would not tint a grey even trilinearly")
        let w = 32
        var floats = [Float](repeating: 1, count: w * 4)
        for x in 0..<w {
            let v = Float(x) / Float(w - 1)
            floats[x * 4] = v
            floats[x * 4 + 1] = v
            floats[x * 4 + 2] = v
        }
        let data = floats.withUnsafeBufferPointer { Data(buffer: $0) }
        let greys = CIImage(bitmapData: data, bytesPerRow: w * 16, size: CGSize(width: w, height: 1), format: .RGBAf, colorSpace: nil)
        let got = try run(CubePass(lut: lut), over: greys, width: w, height: 1)
        for x in 0..<w {
            let v = Double(Float(x) / Float(w - 1))
            let want = sampleTetrahedral(lut, v, v, v)
            XCTAssertEqual(Double(got[x * 4]), want.0, accuracy: Self.tolerance, "red at \(x)")
            XCTAssertEqual(Double(got[x * 4 + 1]), want.1, accuracy: Self.tolerance, "green at \(x)")
            XCTAssertEqual(Double(got[x * 4 + 2]), want.2, accuracy: Self.tolerance, "blue at \(x)")
            // And the grey came out grey — what trilinear cannot promise here.
            XCTAssertEqual(Double(got[x * 4]), Double(got[x * 4 + 1]), accuracy: Self.tolerance, "red ≠ green at \(x)")
            XCTAssertEqual(Double(got[x * 4 + 1]), Double(got[x * 4 + 2]), accuracy: Self.tolerance, "green ≠ blue at \(x)")
        }
    }
}
