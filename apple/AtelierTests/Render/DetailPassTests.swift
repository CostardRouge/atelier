// The gate for the detail passes — the web's `check-render.mjs` rows
// «detail: the four neighbourhood passes against detail.ts», on macOS: the
// same noisy tone edge with a purple fringe on it (64×48, the web's LCG and
// seed), the same settings (Detail at 25 and Masking at 40, so the sharpen
// row holds the damping and the edge mask as well as the plain unsharp
// mask), each pass held to its AtelierKit twin — `chromaBlurAt` (X then Y),
// `bilateralAt`, `defringeAt`, `sharpenAt`, `sharpenMaskAt` — at the web's
// two codes. Every pixel is compared, not the web's 96 probes: a clamp at the
// edge is the twin's `pixelAt` too, and has to agree.
//
// Then what only a native graph needs proving: the kernels are sized in
// SOURCE pixels through `PassContext.sourceScale` (and a smaller decode's
// `decodeScale`), and every kernel's ROI is whole — the recipe read tile by
// tile equals the recipe read at once.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class DetailPassTests: XCTestCase {
    static let width = 64
    static let height = 48

    /// `v` clamped to [0,1] and put on a 1/256 grid. The web quantises to 8
    /// bits because its source is a canvas; here the source is float, and a
    /// value on this grid is held EXACTLY by the half float Core Image may
    /// upload it as — so the gate measures the kernel, never the upload (a
    /// Sobel gate as steep as Masking's would turn an upload's rounding into
    /// codes).
    static func onHalfGrid(_ v: Double) -> Double {
        (min(1, max(0, v)) * 256).rounded() / 256
    }

    /// The web's fixture: deterministic noise over a tone edge (0.25 | 0.75),
    /// a three-pixel purple fringe on it, every value on a 1/256 grid.
    static let picture: DetailImage = {
        var seed: UInt32 = 12345
        func rnd() -> Double {
            seed = seed &* 1_664_525 &+ 1_013_904_223
            return Double(seed) / 4_294_967_296
        }
        let purple = fromYcc(0.5, 0.06, 0.06)
        var data = [Float](repeating: 0, count: DetailPassTests.width * DetailPassTests.height * 3)
        for y in 0..<DetailPassTests.height {
            for x in 0..<DetailPassTests.width {
                let px: [Double]
                if x >= 28 && x < 31 {
                    px = [purple.0, purple.1, purple.2]
                } else {
                    let base = x < 28 ? 0.25 : 0.75
                    let r = base + (rnd() - 0.5) * 0.08
                    let g = base + (rnd() - 0.5) * 0.08
                    let b = base + (rnd() - 0.5) * 0.08
                    px = [r, g, b]
                }
                for c in 0..<3 {
                    data[(y * DetailPassTests.width + x) * 3 + c] = Float(DetailPassTests.onHalfGrid(px[c]))
                }
            }
        }
        return DetailImage(width: DetailPassTests.width, height: DetailPassTests.height, data: data)
    }()

    static let settings = DetailSettings(luminance: 60, colour: 50, defringe: 100, sharpen: 80,
                                         sharpenRadius: 1.2, sharpenDetail: 25, sharpenMasking: 40)

    var source: CIImage { NeighbourhoodGate.image(Self.picture) }

    func context(scale: Double = 1) -> PassContext {
        PassContext(renderSize: CGSize(width: Self.width, height: Self.height), sourceScale: scale)
    }

    /// `draw` over the fixture held to `pure` at the web's tolerance.
    func check(_ label: String, _ pure: DetailImage, file: StaticString = #filePath, line: UInt = #line,
               _ draw: (CIImage) throws -> CIImage) throws {
        let source = self.source
        let got = try NeighbourhoodGate.drawn(width: Self.width, height: Self.height) { try draw(source) }
        let worst = NeighbourhoodGate.worst(got, width: Self.width, height: Self.height, NeighbourhoodGate.want(pure))
        XCTAssertLessThanOrEqual(
            worst.codes, NeighbourhoodGate.codes,
            "\(NeighbourhoodGate.renderer), \(label): worst \(worst.codes) codes at (\(worst.x), \(worst.y)) channel \(worst.channel)",
            file: file, line: line)
    }

    // MARK: - the library

    func testTheLibraryVendsEveryDetailKernel() {
        for name in ["detailChromaBlur", "detailBilateral", "detailDefringe", "detailSharpen"] {
            XCTAssertNoThrow(try Kernels.kernel(name), "default.metallib has no '\(name)': Detail.metal did not build, or the function moved")
        }
    }

    // MARK: - each kernel against its twin

    func testTheChromaBlurMatchesTheTwinXThenY() throws {
        let terms = detailTerms(Self.settings, pixelScale: 1)
        let img = Self.picture
        let pure = applyDetail(applyDetail(img) { chromaBlurAt($0, $1, $2, terms, .x) }) { chromaBlurAt($0, $1, $2, terms, .y) }
        XCTAssertGreaterThan(NeighbourhoodGate.moved(pure, from: img), 0.01, "the twin moved nothing, so the row proves nothing")
        let ctx = context()
        try check("chroma", pure) { src in
            let x = try ChromaBlurPass(axis: .x, detail: Self.settings).drawn(src, ctx)
            return try ChromaBlurPass(axis: .y, detail: Self.settings).drawn(x, ctx)
        }
    }

    func testTheChromaBlurLeavesTheLumaUntouched() throws {
        // The rule the pass exists for: the eye reads edges from luma, so the
        // chroma may blur far and the luma not at all.
        let ctx = context()
        let got = try NeighbourhoodGate.drawn(width: Self.width, height: Self.height) {
            let x = try ChromaBlurPass(axis: .x, detail: Self.settings).drawn(self.source, ctx)
            return try ChromaBlurPass(axis: .y, detail: Self.settings).drawn(x, ctx)
        }
        // Compared on luma: the GPU's luma read back through the same weights.
        var off = 0.0
        for i in 0..<(Self.width * Self.height) {
            let (r, g, b) = (Double(got[i * 4]), Double(got[i * 4 + 1]), Double(got[i * 4 + 2]))
            let before = pixelAt(Self.picture, i % Self.width, i / Self.width)
            off = max(off, abs(lumaOf(r, g, b) - lumaOf(before.0, before.1, before.2)) * 255)
        }
        XCTAssertLessThanOrEqual(off, 0.5, "\(NeighbourhoodGate.renderer): the luma moved by \(off) codes")
    }

    func testTheBilateralMatchesTheTwin() throws {
        let terms = detailTerms(Self.settings, pixelScale: 1)
        let pure = applyDetail(Self.picture) { bilateralAt($0, $1, $2, terms) }
        XCTAssertGreaterThan(NeighbourhoodGate.moved(pure, from: Self.picture), 0.01, "the twin moved nothing")
        let ctx = context()
        try check("denoise", pure) { try DenoisePass(detail: Self.settings).drawn($0, ctx) }
    }

    func testTheDefringeMatchesTheTwin() throws {
        let terms = detailTerms(Self.settings, pixelScale: 1)
        let pure = applyDetail(Self.picture) { defringeAt($0, $1, $2, terms) }
        XCTAssertGreaterThan(NeighbourhoodGate.moved(pure, from: Self.picture), 0.01, "the twin moved nothing")
        let ctx = context()
        try check("defringe", pure) { try DefringePass(detail: Self.settings).drawn($0, ctx) }
    }

    func testTheSharpenMatchesTheTwinWithDetailAndMasking() throws {
        let terms = detailTerms(Self.settings, pixelScale: 1)
        XCTAssertGreaterThan(terms.sharpenDamp, 0, "Detail 25 must damp")
        XCTAssertGreaterThan(terms.sharpenMask, 0, "Masking 40 must mask")
        let pure = applyDetail(Self.picture) { sharpenAt($0, $1, $2, terms) }
        XCTAssertGreaterThan(NeighbourhoodGate.moved(pure, from: Self.picture), 0.01, "the twin moved nothing")
        let ctx = context()
        try check("sharpen", pure) { try SharpenPass(detail: Self.settings).drawn($0, ctx) }
    }

    func testTheMaskViewPaintsTheMaskingWeight() throws {
        let terms = detailTerms(Self.settings, pixelScale: 1)
        let pure = applyDetail(Self.picture) { img, x, y in
            let m = sharpenMaskAt(img, x, y, terms)
            return (m, m, m)
        }
        let ctx = context()
        try check("sharpenMask", pure) { try SharpenPass(detail: Self.settings, showMask: true).drawn($0, ctx) }
    }

    func testTheMaskViewIsWhiteWhenNothingIsMaskedAndDrawsWithNoSharpenAtAll() throws {
        // The stage's view is drawn whatever the record says: with no Amount
        // and no Masking, white everywhere — the web's `detailPasses` rule.
        let bare = DetailSettings()
        let ctx = context()
        let got = try NeighbourhoodGate.drawn(width: Self.width, height: Self.height) {
            try SharpenPass(detail: bare, showMask: true).drawn(self.source, ctx)
        }
        let worst = NeighbourhoodGate.worst(got, width: Self.width, height: Self.height) { _, _ in (1, 1, 1) }
        XCTAssertLessThanOrEqual(worst.codes, 0.5, "\(NeighbourhoodGate.renderer): not white at (\(worst.x), \(worst.y))")
    }

    // MARK: - nothing to do costs nothing

    func testAPassWithNothingToDoHandsThePictureBack() throws {
        let bare = DetailSettings()
        let ctx = context()
        let src = source
        XCTAssertTrue(try ChromaBlurPass(axis: .x, detail: bare).drawn(src, ctx) === src)
        XCTAssertTrue(try DenoisePass(detail: bare).drawn(src, ctx) === src)
        XCTAssertTrue(try DefringePass(detail: bare).drawn(src, ctx) === src)
        XCTAssertTrue(try SharpenPass(detail: bare).drawn(src, ctx) === src)
        XCTAssertEqual(ChromaBlurPass(axis: .x, detail: bare).id, "chroma-x")
        XCTAssertEqual(ChromaBlurPass(axis: .y, detail: bare).id, "chroma-y")
        XCTAssertEqual(DenoisePass(detail: bare).id, "denoise")
        XCTAssertEqual(DefringePass(detail: bare).id, "defringe")
        XCTAssertEqual(SharpenPass(detail: bare).id, "sharpen")
    }

    // MARK: - kernels in SOURCE pixels

    func testKernelsAreSizedInSourcePixelsThroughTheContextsScale() throws {
        // A render at half the source's density: the twin's terms at a pixel
        // scale of 0.5 are what the kernels must take — a stage working to a
        // pixel budget blurs the same part of the scene as the export.
        let half = detailTerms(Self.settings, pixelScale: 0.5)
        let whole = detailTerms(Self.settings, pixelScale: 1)
        XCTAssertNotEqual(half.sharpenSigma, whole.sharpenSigma, "the fixture's radius must scale")
        XCTAssertNotEqual(half.chromaSigma, whole.chromaSigma)
        let ctx = context(scale: 0.5)
        let sharpened = applyDetail(Self.picture) { sharpenAt($0, $1, $2, half) }
        try check("sharpen at scale 0.5", sharpened) { try SharpenPass(detail: Self.settings).drawn($0, ctx) }
        let chroma = applyDetail(applyDetail(Self.picture) { chromaBlurAt($0, $1, $2, half, .x) }) { chromaBlurAt($0, $1, $2, half, .y) }
        try check("chroma at scale 0.5", chroma) { src in
            let x = try ChromaBlurPass(axis: .x, detail: Self.settings).drawn(src, ctx)
            return try ChromaBlurPass(axis: .y, detail: Self.settings).drawn(x, ctx)
        }
        // A source decoded at half its file's size, rendered whole: the same terms.
        let decoded = context(scale: 1)
        try check("sharpen of a half-size decode", sharpened) {
            try SharpenPass(detail: Self.settings, decodeScale: 0.5).drawn($0, decoded)
        }
    }

    // MARK: - the ROI, tile by tile

    func testEveryKernelsROIHoldsTileByTile() throws {
        // 11×7 tiles over 64×48: every tile edge falls inside a kernel's
        // reach (the chroma's 10 taps, the sharpen's 3, the bilateral's 3).
        let ctx = context()
        let cases: [(String, (CIImage) throws -> CIImage)] = [
            ("chroma", { src in
                let x = try ChromaBlurPass(axis: .x, detail: Self.settings).drawn(src, ctx)
                return try ChromaBlurPass(axis: .y, detail: Self.settings).drawn(x, ctx)
            }),
            ("denoise", { try DenoisePass(detail: Self.settings).drawn($0, ctx) }),
            ("defringe", { try DefringePass(detail: Self.settings).drawn($0, ctx) }),
            ("sharpen", { try SharpenPass(detail: Self.settings).drawn($0, ctx) }),
        ]
        for (label, draw) in cases {
            let whole = try NeighbourhoodGate.drawn(width: Self.width, height: Self.height) { try draw(self.source) }
            let recipe = try draw(source)
            let tiled = NeighbourhoodGate.tiled(recipe, width: Self.width, height: Self.height, tile: (11, 7))
            let (difference, at) = NeighbourhoodGate.largest(whole, tiled)
            XCTAssertLessThanOrEqual(
                difference, 1e-3,
                "\(NeighbourhoodGate.renderer), \(label): a tile read differs from the whole by \(difference) at pixel (\(at % Self.width), \(at / Self.width)) — the ROI falls short")
        }
    }
}
