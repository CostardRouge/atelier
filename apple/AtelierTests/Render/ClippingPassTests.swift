// The gate for the clipping view (J) — the web's `clip-pass.ts` held to the
// rule its overlay, its strip and its readout share (`clipping.ts`): a strip
// of crafted pixels on both sides of each line — including headroom above
// white and values below black, which the half-float chain carries — drawn
// through the kernel and compared with `clipOf` over the 8-bit value each
// pixel WILL hold. The web has no GPU row for this pass; this one is its gate.
//
// It also ties the three readers together, as the rule promises: every pixel
// painted white is one `luminanceHistogram` counts as clipped, and the readout
// under the pointer reads a painted pixel as the clip it marks.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class ClippingPassTests: XCTestCase {
    /// Straight RGB, in [0,1] — or past it.
    static let strip: [(Double, Double, Double)] = [
        (253.2 / 255, 100.0 / 255, 50.0 / 255),   // rounds to 253: untouched
        (253.8 / 255, 100.0 / 255, 50.0 / 255),   // rounds to 254: white
        (1.2 / 255, 1.3 / 255, 0.2 / 255),        // every channel ≤ 1: black
        (1.8 / 255, 0, 0),                        // red rounds to 2: untouched
        (0, 0, 200.0 / 255),                      // a saturated blue is a colour, not a shadow
        (1.3, 0.5, 0.5),                          // headroom: white
        (-0.1, -0.2, -0.05),                      // below black: black
        (0.5, 0.5, 0.5),                          // mid grey: untouched
        (1, 0, 0),                                // the white mark itself, photographed: white
        (0, 128.0 / 255, 1),                      // the black mark photographed: its blue is white
    ]

    /// The 8-bit value a float WILL hold: clamped, then rounded.
    static func byte(_ v: Double) -> Int {
        Int((min(1, max(0, v)) * 255).rounded())
    }

    func testTheLibraryVendsTheColourKernel() {
        XCTAssertNoThrow(try Kernels.colorKernel(ClippingPass.kernelName), "default.metallib did not build, or the function moved")
    }

    func testTheMarksAreClipOfPaintedAndTheReadersAgree() throws {
        let n = Self.strip.count
        let source = GeometryGate.picture(width: n, height: 1) { x, _ in Self.strip[x] }
        let got = try GeometryGate.run({ try ClippingPass.shared.drawn(source.image, GeometryGate.ctx(source)) }, width: n, height: 1)
        var bytes: [UInt8] = []
        var paintedWhite = 0
        var clipped = 0
        for x in 0..<n {
            let r = source.value(x, 0, 0)
            let g = source.value(x, 0, 1)
            let b = source.value(x, 0, 2)
            let want = clipOf(Self.byte(r), Self.byte(g), Self.byte(b))
            bytes.append(contentsOf: [UInt8(Self.byte(r)), UInt8(Self.byte(g)), UInt8(Self.byte(b)), 255])
            let out = (Double(got[x * 4]), Double(got[x * 4 + 1]), Double(got[x * 4 + 2]))
            if let want {
                let mark = try XCTUnwrap(clipMarks[want])
                XCTAssertEqual(out.0 * 255, Double(mark.r), accuracy: 0.5, "pixel \(x) red: not the \(want) mark")
                XCTAssertEqual(out.1 * 255, Double(mark.g), accuracy: 0.5, "pixel \(x) green: not the \(want) mark")
                XCTAssertEqual(out.2 * 255, Double(mark.b), accuracy: 0.5, "pixel \(x) blue: not the \(want) mark")
                // The readout knows a painted pixel for the clip it marks.
                let readout = readoutOf(out.0 * 255, out.1 * 255, out.2 * 255, clipping: true)
                XCTAssertEqual(readout, .clip(want), "pixel \(x): the readout says \(readout)")
                clipped += 1
            } else {
                XCTAssertEqual(out.0, r, accuracy: 1e-3, "pixel \(x) red was painted")
                XCTAssertEqual(out.1, g, accuracy: 1e-3, "pixel \(x) green was painted")
                XCTAssertEqual(out.2, b, accuracy: 1e-3, "pixel \(x) blue was painted")
            }
            XCTAssertEqual(Double(got[x * 4 + 3]), 1, accuracy: 1e-3, "pixel \(x) lost its alpha")
            // Counted off the GPU's own output, as the readout would read it.
            if readoutOf(out.0 * 255, out.1 * 255, out.2 * 255, clipping: true) == .clip(.white) { paintedWhite += 1 }
        }
        XCTAssertGreaterThan(clipped, 2, "the strip clips too little to prove anything")
        XCTAssertLessThan(clipped, n, "the strip clips everything, so untouched pixels are untested")
        // The strip counts the same pixels the overlay paints.
        let histogram = luminanceHistogram(bytes)
        XCTAssertEqual(Int((histogram.clippedHighlights * Double(histogram.total)).rounded()), paintedWhite,
                       "the histogram's clipped share and the painted pixels disagree")
    }

    func testThePassHoldsNoParameterAndOneServesEveryGraph() {
        XCTAssertEqual(ClippingPass.shared.id, "clipping")
        let white = ClippingPass.mark(.white)
        let black = ClippingPass.mark(.black)
        XCTAssertEqual([Double(white.x), Double(white.y), Double(white.z)], [1, 0, 0])
        XCTAssertEqual(Double(black.x), 0)
        XCTAssertEqual(Double(black.y), 128.0 / 255, accuracy: 1e-9)
        XCTAssertEqual(Double(black.z), 1)
    }
}
