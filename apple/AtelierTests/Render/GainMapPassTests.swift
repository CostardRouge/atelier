// The gate for the gain map — the web's `check-render.mjs` row «the gain map:
// the camera's own shading, against gain-map.ts», on macOS: mid grey
// everywhere, so every output code IS the gain at that point in light, under
// the DJI's own corner gains (5.93 / 5.06 / 4.97 against 1.00 at the far
// corner, so a plane read out of order shows as a colour cast), held to
// `gainAt` + `gainEncoded` at the web's tolerance: 2 codes.
//
// The two corners are ALSO read as absolute facts: a grid flipped in both the
// kernel and its packing would agree with a twin read the same wrong way and
// still lift the wrong corner — the worst outcome, because it looks like a
// correction.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class GainMapPassTests: XCTestCase {
    static let width = 96
    static let height = 64
    static let grey = 128.0 / 255.0
    /// The web gate's tolerance for this row.
    static let tolerance = 2.0

    static let maps = [DngGainMap(
        rect: DngRect(top: 0, left: 0, bottom: height, right: width),
        plane: 0, planes: 3, rows: 3, cols: 3,
        originV: 0, originH: 0, spacingV: 0.5, spacingH: 0.5, mapPlanes: 3,
        gains: [
            5.93, 5.06, 4.97, 2.4, 2.2, 2.1, 4.0, 3.6, 3.4,
            2.0, 1.9, 1.8, 1.0, 1.0, 1.0, 1.6, 1.5, 1.4,
            3.0, 2.8, 2.7, 1.5, 1.4, 1.3, 1.0, 1.0, 1.0,
        ])]

    static var field: GainField {
        gainFieldFrom(maps, Double(width), Double(height))!
    }

    static func flat() -> GeometryGate.Picture {
        GeometryGate.picture(width: width, height: height) { _, _ in (grey, grey, grey) }
    }

    func testTheLibraryVendsTheKernel() {
        XCTAssertNoThrow(try Kernels.kernel(GainMapPass.kernelName), "default.metallib did not build, or the function moved")
    }

    func testAFlatFieldBuildsNoPass() {
        var flat = Self.maps[0]
        flat.gains = [Float](repeating: 1, count: 27)
        XCTAssertNil(GainMapPass.make(gainFieldFrom([flat], Double(Self.width), Double(Self.height))),
                     "a FLAT field still built a pass")
        XCTAssertNil(GainMapPass.make(nil))
        XCTAssertNotNil(GainMapPass.make(Self.field))
    }

    func testThePackedGridSitsWhereTheKernelLooks() {
        // Node (j, i) — row i counted DOWN from the top of the picture — is the
        // pixel at x = j, y = i in Core Image's own coordinates (y UP). Each row
        // is read back as a one-row bitmap, which has no row order to get wrong.
        let field = Self.field
        let packed = GainMapPass.pack(field)
        XCTAssertEqual(packed.extent, CGRect(x: 0, y: 0, width: field.cols, height: field.rows))
        for i in 0..<field.rows {
            let row = GeometryGate.read(packed, bounds: CGRect(x: 0, y: i, width: field.cols, height: 1))
            for j in 0..<field.cols {
                for c in 0..<3 {
                    let want = Double(field.gains[(i * field.cols + j) * 4 + c])
                    XCTAssertEqual(Double(row[j * 4 + c]), want, accuracy: 1e-2, "node (\(j), \(i)) channel \(c)")
                }
            }
        }
    }

    func testTheGainMatchesGainAtInLight() throws {
        let source = Self.flat()
        let field = Self.field
        let pass = try XCTUnwrap(GainMapPass.make(field))
        let w = Self.width
        let h = Self.height
        let got = try GeometryGate.run({ try pass.drawn(source.image, GeometryGate.ctx(source)) }, width: w, height: h)
        var worst = 0.0
        var at = ""
        for y in stride(from: 1, to: h - 1, by: 3) {
            for x in stride(from: 1, to: w - 1, by: 5) {
                let g = gainAt(field, (Double(x) + 0.5) / Double(w), (Double(y) + 0.5) / Double(h))
                let gains = [g.0, g.1, g.2]
                for c in 0..<3 {
                    // The web compares 8-bit reads, so its twin is clamped; the
                    // kernel keeps the headroom, so the read is clamped here.
                    let want = clamp01(gainEncoded(source.value(x, y, c), gains[c]))
                    let d = abs(clamp01(Double(got[(y * w + x) * 4 + c])) - want) * 255
                    if d.isNaN || d > worst {
                        worst = d.isNaN ? .infinity : d
                        at = "(\(x), \(y)) channel \(c)"
                    }
                }
            }
        }
        XCTAssertLessThanOrEqual(worst, Self.tolerance, "\(GeometryGate.renderer): worst \(worst) codes at \(at)")
        // The corner the file asks 5.93× for is the BRIGHT one, and the far
        // corner is untouched — as absolute facts. The far one is not exactly
        // 128 because its pixel sits a whisker inside the ×1.00 node.
        let lifted = clamp01(Double(got[(1 * w + 1) * 4])) * 255
        let untouched = Double(got[((h - 2) * w + (w - 2)) * 4]) * 255
        XCTAssertGreaterThanOrEqual(lifted, 250, "the ×5.93 corner reads \(lifted): the grid is upside down or the gain is on the code")
        XCTAssertLessThanOrEqual(untouched, 133, "the ×1.00 corner reads \(untouched)")
    }

    func testTheHeadroomAboveWhiteSurvives() throws {
        // Mid grey × 5.93 in light is ≈ 1.11 encoded: past white. The web's
        // float16 chain keeps it for a later pass, and so must this one —
        // nothing in the kernel clamps.
        let source = Self.flat()
        let pass = try XCTUnwrap(GainMapPass.make(Self.field))
        let got = try GeometryGate.run({ try pass.drawn(source.image, GeometryGate.ctx(source)) }, width: Self.width, height: Self.height)
        let red = Double(got[(1 * Self.width + 1) * 4])
        XCTAssertGreaterThan(red, 1.05, "the lifted corner was clamped at white (\(red))")
    }

    func testTilesAgree() throws {
        let source = Self.flat()
        let pass = try XCTUnwrap(GainMapPass.make(Self.field))
        let recipe = try pass.drawn(source.image, GeometryGate.ctx(source))
        _ = try GeometryGate.run({ recipe }, width: Self.width, height: Self.height)
        GeometryGate.assertTilesAgree(recipe, width: Self.width, height: Self.height, pass: pass.id)
    }
}
