// The gate for the lens — the web's `check-render.mjs` rows «the lens: does
// the GPU land a point where lensSampleRadius says?», the vignette on mid and
// dark grey, and «a MEASURED profile», on macOS, at the web's tolerances:
//
// - a marker at a known radius, warped at full barrel (both terms −100, where
//   the radius map is closest to folding), lands within 0.01 of the radius
//   `lensSampleRadius` solves for — and MOVED at least 0.01, or the row would
//   pass on an empty kernel for ever after;
// - a flat frame's corner matches `vignetteEncoded` within 2 codes, on a DARK
//   frame as well, where a gain on the code and a gain on the light are far
//   apart — and the row asserts the two could be told apart;
// - a picture whose red is x and green is y reads back WHERE each channel was
//   sampled, through the profile's distortion (odd terms included) and TCA,
//   within 1.6 codes; the profile's own vignetting within 2.
//
// Radial about the centre, so a y mirror is invisible to it — which is why the
// marker's radius is MEASURED rather than reasoned about.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class LensPassTests: XCTestCase {
    /// A square frame: the corner sits at radius 1.
    static let side = 192
    static let half = 1 / 2.0.squareRoot()

    /// A pixel COORDINATE on the horizontal centre line, as a radius.
    static func toRadius(_ px: Double) -> Double {
        abs(px / Double(side) - 0.5) * 2 * half
    }

    /// The radius of pixel (x, y)'s centre, exactly as the kernel measures it.
    static func radius(_ x: Int, _ y: Int) -> Double {
        let span = 2 * half
        let dx = ((Double(x) + 0.5) / Double(side) - 0.5) * span
        let dy = ((Double(y) + 0.5) / Double(side) - 0.5) * span
        return (dx * dx + dy * dy).squareRoot()
    }

    static func flat(_ value: Double) -> GeometryGate.Picture {
        GeometryGate.picture(width: side, height: side) { _, _ in (value, value, value) }
    }

    func draw(_ pass: LensPass, _ source: GeometryGate.Picture) throws -> [Float] {
        try GeometryGate.run({ try pass.drawn(source.image, GeometryGate.ctx(source)) }, width: source.width, height: source.height)
    }

    func testTheLibraryVendsTheKernel() {
        XCTAssertNoThrow(try Kernels.kernel(LensPass.kernelName), "default.metallib did not build, or the function moved")
    }

    func testNothingToCorrectBuildsNoPass() {
        XCTAssertNil(LensPass.make(nil))
        XCTAssertNil(LensPass.make(.default))
        // A vignette MIDPOINT alone corrects nothing — it only says where a
        // lift would bite — so it must not cost a resample.
        XCTAssertNil(LensPass.make(LensCorrection(vignetteMidpoint: 20)))
        XCTAssertNil(LensPass.make(nil, profile: noProfileTerms))
        XCTAssertNotNil(LensPass.make(LensCorrection(distortion: -30)))
        let profile = LensProfileTerms(distortion: [0.06, -0.25, 0.1, 0.03], tcaRed: [1, 0, 0], tcaBlue: [1, 0, 0], vignette: [0, 0, 0])
        let pass = LensPass.make(nil, aspectRatio: 1.5, profile: profile)
        XCTAssertEqual(pass?.profile, profile, "a profile alone is a pass")
        XCTAssertEqual(pass?.lens, LensCorrection.default)
    }

    func testAMarkerLandsWhereLensSampleRadiusSolves() throws {
        let s = Self.side
        // Out towards the edge: distortion is CUBIC in the radius, so near the
        // middle it barely moves anything; not so far that the warped block
        // clips the frame and drags its centroid back inwards.
        let mark = Int((Double(s) * 0.88).rounded())
        let middle = s / 2
        let marked = GeometryGate.picture(width: s, height: s) { x, y in
            let lit = x >= mark - 3 && x < mark + 3 && y >= middle - 3 && y < middle + 3
            return lit ? (1, 1, 1) : (0, 0, 0)
        }
        let sourceR = Self.toRadius(Double(mark))
        let setting = LensCorrection(distortion: -100, distortion2: -100)
        let (k1, k2) = distortionTerms(setting)
        // Solve lensSampleRadius(ro) = sourceR by bisection — monotone, so it
        // has exactly one answer, which is the property the specs pin.
        var lo = 0.0
        var hi = 2.0
        for _ in 0..<80 {
            let mid = (lo + hi) / 2
            if lensSampleRadius(mid, k1, k2) < sourceR { lo = mid } else { hi = mid }
        }
        let expectedR = (lo + hi) / 2

        let got = try draw(try XCTUnwrap(LensPass.make(setting)), marked)
        var sx = 0.0
        var lit = 0.0
        for y in 0..<s {
            for x in 0..<s where got[(y * s + x) * 4] >= 0.5 {
                sx += Double(x) + 0.5
                lit += 1
            }
        }
        XCTAssertGreaterThan(lit, 0, "nothing was lit at all — the warp threw the marker off the frame")
        guard lit > 0 else { return }
        let gotR = Self.toRadius(sx / lit)
        XCTAssertEqual(gotR, expectedR, accuracy: 0.01, "\(GeometryGate.renderer): the marker at \(sourceR) landed at \(gotR)")
        XCTAssertGreaterThan(abs(gotR - sourceR), 0.01, "the marker did not move, so this row proves nothing")
    }

    /// A flat frame vignetted, its corner held to `vignetteEncoded`, and the
    /// row proved able to tell a gain on light from a gain on the code.
    func checkVignette(fill: Double, amount: Double, midpoint: Double,
                       file: StaticString = #filePath, line: UInt = #line) throws {
        let s = Self.side
        let out = Int((Double(s) * 0.92).rounded())
        let middle = s / 2
        let setting = LensCorrection(vignette: amount, vignetteMidpoint: midpoint)
        let got = try draw(try XCTUnwrap(LensPass.make(setting)), Self.flat(fill))
        let centre = Double(got[(middle * s + middle) * 4])
        let corner = Double(got[(middle * s + out) * 4])
        let r = Self.radius(out, middle)
        let expected = vignetteEncoded(centre, r, amount, midpoint)
        let onCode = min(1, centre * vignetteGain(r, amount, midpoint))
        XCTAssertGreaterThan(abs(expected - onCode) * 255, 2,
                             "light and code agree here, so this row cannot tell them apart", file: file, line: line)
        XCTAssertEqual(corner * 255, expected * 255, accuracy: 2,
                       "\(GeometryGate.renderer): the lift disagrees with vignetteEncoded (a gain on the code would say \(onCode * 255))",
                       file: file, line: line)
    }

    func testTheVignetteLiftIsOnLightOnMidGrey() throws {
        try checkVignette(fill: 128.0 / 255, amount: 60, midpoint: 20)
    }

    func testTheVignetteLiftIsOnLightOnADarkFrame() throws {
        // The full lift from the centre out: where the two readings are furthest apart.
        try checkVignette(fill: 64.0 / 255, amount: 100, midpoint: 0)
    }

    func testAMeasuredProfileMovesEachChannelWhereTheTwinSays() throws {
        let s = Self.side
        let profile = LensProfileTerms(distortion: [0.06, -0.25, 0.1, 0.03],
                                       tcaRed: [1.004, 0, 0.002], tcaBlue: [0.997, 0, -0.001],
                                       vignette: [0, 0, 0])
        // Red is x, green is y: each channel reads back WHERE it was sampled.
        let ramp = GeometryGate.picture(width: s, height: s) { x, y in
            (Double(x) / Double(s - 1), Double(y) / Double(s - 1), 0.5)
        }
        let got = try draw(try XCTUnwrap(LensPass.make(nil, aspectRatio: 1, profile: profile)), ramp)
        let span = 2.0.squareRoot()
        func codeAt(_ uv: Double) -> Double { 255 * (uv * Double(s) - 0.5) / Double(s - 1) }
        var worstG = 0.0
        var worstR = 0.0
        var probes = 0
        var moved = 0.0
        for fx in [0.12, 0.3, 0.5, 0.7, 0.88] {
            for fy in [0.15, 0.4, 0.62, 0.85] {
                let x = Int(fx * Double(s))
                let y = Int(fy * Double(s))
                let u = (Double(x) + 0.5) / Double(s)
                let v = (Double(y) + 0.5) / Double(s)
                let dx = (u - 0.5) * span
                let dy = (v - 0.5) * span
                let r = (dx * dx + dy * dy).squareRoot()
                guard r > 0 else { continue }
                let rs = profileSourceRadius(r, profile.distortion)
                let rr = profileChannelRadius(rs, profile.tcaRed)
                let gv = (dy / r) * rs / span + 0.5
                let ru = (dx / r) * rr / span + 0.5
                if gv <= 0.01 || gv >= 0.99 || ru <= 0.01 || ru >= 0.99 { continue }
                probes += 1
                let i = (y * s + x) * 4
                worstG = max(worstG, abs(Double(got[i + 1]) * 255 - codeAt(gv)))
                worstR = max(worstR, abs(Double(got[i]) * 255 - codeAt(ru)))
                moved = max(moved, abs(codeAt(gv) - codeAt(v)))
            }
        }
        XCTAssertGreaterThanOrEqual(probes, 12, "too few probes stayed inside the picture")
        XCTAssertLessThanOrEqual(worstG, 1.6, "\(GeometryGate.renderer): green (distortion) worst \(worstG) codes")
        XCTAssertLessThanOrEqual(worstR, 1.6, "\(GeometryGate.renderer): red (distortion + TCA) worst \(worstR) codes")
        XCTAssertGreaterThan(moved, 3, "the profile moved nothing, so this row proves nothing")
    }

    func testAProfilesOwnVignettingLiftsTheCornerInLight() throws {
        let s = Self.side
        let out = Int((Double(s) * 0.92).rounded())
        let middle = s / 2
        let k = [-0.9, 0.3, -0.1]
        let profile = LensProfileTerms(distortion: [0, 0, 0, 0], tcaRed: [1, 0, 0], tcaBlue: [1, 0, 0], vignette: k)
        let got = try draw(try XCTUnwrap(LensPass.make(nil, profile: profile)), Self.flat(128.0 / 255))
        let centre = Double(got[(middle * s + middle) * 4])
        let corner = Double(got[(middle * s + out) * 4])
        let expected = fromLinear(toLinear(centre, .srgb) * profileVignetteGain(Self.radius(out, middle), k), .srgb)
        XCTAssertEqual(corner * 255, expected * 255, accuracy: 2, "\(GeometryGate.renderer): the measured vignetting")
        XCTAssertGreaterThan(corner * 255, centre * 255 + 10, "the profile's vignetting lifted nothing")
    }

    func testTilesAgree() throws {
        let source = GeometryGate.picture(width: 96, height: 64) { x, y in
            (Double(x) / 95, Double(y) / 63, Double((x * 7 + y * 3) % 17) / 16)
        }
        let pass = try XCTUnwrap(LensPass.make(LensCorrection(distortion: -60, chromaRed: 40, vignette: 50), aspectRatio: 1.5))
        let recipe = try pass.drawn(source.image, GeometryGate.ctx(source))
        _ = try GeometryGate.run({ recipe }, width: 96, height: 64)
        GeometryGate.assertTilesAgree(recipe, width: 96, height: 64, pass: pass.id)
    }
}
