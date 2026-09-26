// The gate for the adjustment layers — the web's `scripts/check-render.mjs`
// mask rows, on macOS: a synthetic source through `LayerRenderPass`, read
// back in floats, held to the pure twins in AtelierKit — `maskAt`
// (`Render/Mask.swift`) for each shape (a painted one through the map it is
// rasterised into, read as the GPU reads it), `layerWeight` (`Develop/Layer.swift`)
// for a combination and a subtraction, `sampleTetrahedral` for the develop's
// own cube — at the web gate's tolerance: 0.006 of the weight for a mask
// (the web's `worst <= 0.006`, measured there at 0.0008–0.0054), one 8-bit
// code for a colour.
//
// The mask is MEASURED the way the web measures it: through a cube that maps
// every colour to black, so a pixel comes back as `source × (1 − weight)` and
// the weight is `1 − out / source`, compared at the very texel centre the
// read comes from (the web's harness fault, recorded in `render-layers.md`:
// a point probed off-centre is several codes off on a steep feather). And
// every shape asserts a SPREAD, or a row could pass on a mask that does
// nothing.
//
// Rendered on Metal where the runner has a device, on the software renderer
// otherwise, which is said in every failure and turned into a skip where that
// renderer will not run the kernel at all. A kernel that will not LOAD is
// never a skip: the library did not build.

import AtelierKit
import CoreImage
import CoreVideo
import XCTest
@testable import Atelier

final class LayerPassTests: XCTestCase {
    /// The web gate's tolerance on a mask weight.
    static let maskTolerance = 0.006
    static let W = 120
    static let H = 80
    static var aspect: Double { Double(W) / Double(H) }

    /// Every colour to black: the pixel comes back as `source × (1 − weight)`.
    static let toBlack = CubeLut(size: 2, data: [Float](repeating: 0, count: 24), title: "to black")

    // MARK: - fixtures

    struct Picture {
        let image: CIImage
        let width: Int
        let height: Int
        /// (r, g, b) per pixel, rows from the TOP — the order written and read back.
        let pixels: [(Double, Double, Double)]
    }

    /// A float picture from a function of (x, y), y counted from the TOP.
    static func picture(width: Int = LayerPassTests.W, height: Int = LayerPassTests.H, _ at: (Int, Int) -> (Double, Double, Double)) -> Picture {
        var floats = [Float](repeating: 1, count: width * height * 4)
        var pixels: [(Double, Double, Double)] = []
        pixels.reserveCapacity(width * height)
        for y in 0..<height {
            for x in 0..<width {
                let (r, g, b) = at(x, y)
                let o = (y * width + x) * 4
                floats[o] = Float(r)
                floats[o + 1] = Float(g)
                floats[o + 2] = Float(b)
                pixels.append((Double(Float(r)), Double(Float(g)), Double(Float(b))))
            }
        }
        let data = floats.withUnsafeBufferPointer { Data(buffer: $0) }
        let image = CIImage(bitmapData: data, bytesPerRow: width * 16,
                            size: CGSize(width: width, height: height), format: .RGBAf, colorSpace: nil)
        return Picture(image: image, width: width, height: height, pixels: pixels)
    }

    static let white = LayerPassTests.picture { _, _ in (1, 1, 1) }
    /// A grey ramp, dark to light across — so a luma band varies over it.
    static let ramp = LayerPassTests.picture { x, _ in
        let t = Double(x) / Double(LayerPassTests.W - 1)
        return (t, t, t)
    }

    /// The colour channels of a read-back, alpha left out.
    static func colours(_ got: [Float]) -> [Double] {
        var out: [Double] = []
        out.reserveCapacity(got.count / 4 * 3)
        for i in 0..<(got.count / 4) {
            out.append(Double(got[i * 4]))
            out.append(Double(got[i * 4 + 1]))
            out.append(Double(got[i * 4 + 2]))
        }
        return out
    }

    /// The texel centre of pixel `i`, as the frame coordinates a mask reads.
    static func uv(_ i: Int, width: Int = LayerPassTests.W, height: Int = LayerPassTests.H) -> (Double, Double) {
        ((Double(i % width) + 0.5) / Double(width), (Double(i / width) + 0.5) / Double(height))
    }

    /// `pass` over `source`, read back — or a skip where this machine's
    /// renderer cannot run the kernels at all (never where they LOAD badly).
    func drawn(_ pass: LayerRenderPass, over source: Picture, ctx: PassContext? = nil) throws -> [Float] {
        let recipe: CIImage
        do {
            recipe = try pass.drawn(source.image, ctx ?? PassContext(renderSize: source.image.extent.size))
        } catch KernelError.applyFailed(let name) where !CubePassTests.hasMetal {
            throw XCTSkip("no Metal device here, and the software renderer would not run the '\(name)' kernel")
        }
        let got = CubePassTests.read(recipe, width: source.width, height: source.height)
        if !CubePassTests.hasMetal, got.allSatisfy({ $0.isNaN }) {
            throw XCTSkip("no Metal device here, and the software renderer drew nothing through the layer kernels")
        }
        return got
    }

    /// A layer that blackens where its weight is — the kit's record, as the pass takes it.
    static func blackening(_ mask: Mask?, invert: Bool = false, opacity: Double = 1, except: BrushRaster? = nil,
                           parts: [MaskPart] = [], finish: LayerPassFinish = .grade,
                           width: Int = LayerPassTests.W, height: Int = LayerPassTests.H) -> LayerPass {
        LayerPass(lut: toBlack, mask: mask, invert: invert, opacity: opacity,
                  aspectRatio: Double(width) / Double(height), except: except, parts: parts, finish: finish,
                  id: "layer:test")!
    }

    /// The weight measured at every pixel bright enough to divide by, held to
    /// `want`; the worst difference, and the spread of what was wanted.
    @discardableResult
    func checkWeights(_ got: [Float], _ source: Picture, _ label: String,
                      file: StaticString = #filePath, line: UInt = #line,
                      want: (Int) -> Double) -> (worst: Double, spread: Double) {
        var worst = 0.0
        var at = 0
        var lo = Double.infinity
        var hi = -Double.infinity
        for i in 0..<source.pixels.count {
            let (r, g, b) = source.pixels[i]
            // The brightest channel is the one divided by.
            let (base, c) = r >= g && r >= b ? (r, 0) : (g >= b ? (g, 1) : (b, 2))
            guard base >= 0.15 else { continue }
            let measured = 1 - Double(got[i * 4 + c]) / base
            let expected = want(i)
            lo = min(lo, expected)
            hi = max(hi, expected)
            let d = abs(measured - expected)
            if d.isNaN || d > worst {
                worst = d.isNaN ? .infinity : d
                at = i
            }
        }
        XCTAssertLessThanOrEqual(
            worst, LayerPassTests.maskTolerance,
            "\(CubePassTests.renderer), \(label): worst \(worst) at pixel (\(at % source.width), \(at / source.width))",
            file: file, line: line)
        let spread = hi - lo
        XCTAssertGreaterThan(spread, 0.05, "\(label): the weight is FLAT over the frame, so this row proves nothing",
                             file: file, line: line)
        return (worst, spread)
    }

    // MARK: - the library

    func testTheLibraryVendsEveryLayerKernel() throws {
        for name in ["layerMaskFlat", "layerMaskLinear", "layerMaskRadial", "layerMaskLuma", "layerMaskColour",
                     "layerMaskRaster", "layerMix", "layerOutline"] {
            XCTAssertNoThrow(try Kernels.kernel(name), "default.metallib has no '\(name)': Layers.metal did not build")
        }
    }

    // MARK: - the shapes, against maskAt

    func testALinearMaskMatchesMaskAt() throws {
        let mask = Mask.linear(LinearMask(x: 0.5, y: 0.45, angle: 25, feather: 0.4))
        let got = try drawn(LayerRenderPass(Self.blackening(mask)), over: Self.white)
        checkWeights(got, Self.white, "linear") { i in
            let (u, v) = Self.uv(i)
            return maskAt(mask, u, v, 1, Self.aspect)
        }
    }

    func testARadialMaskMatchesMaskAt() throws {
        let mask = Mask.radial(RadialMask(x: 0.4, y: 0.55, radiusX: 0.45, radiusY: 0.25, angle: 30, feather: 0.35))
        let got = try drawn(LayerRenderPass(Self.blackening(mask)), over: Self.white)
        checkWeights(got, Self.white, "radial") { i in
            let (u, v) = Self.uv(i)
            return maskAt(mask, u, v, 1, Self.aspect)
        }
    }

    func testALumaBandMatchesMaskAtOverARamp() throws {
        // Over a RAMP: a luma mask over a flat frame is one value everywhere,
        // and would pass on a kernel that ignored the pixel.
        let mask = Mask.luma(LumaMask(from: 0.25, to: 0.6, feather: 0.2))
        let got = try drawn(LayerRenderPass(Self.blackening(mask)), over: Self.ramp)
        checkWeights(got, Self.ramp, "luma") { i in
            let (u, v) = Self.uv(i)
            let (r, g, b) = Self.ramp.pixels[i]
            return maskAt(mask, u, v, lumaOf(r, g, b), Self.aspect)
        }
    }

    func testAPaintedMaskIsSampledTheRightWayUp() throws {
        // The one kind rasterised on the CPU, so this row checks what the
        // others do not: that the map is uploaded the right way up and read in
        // image coordinates. A y flip would put the stroke at the other end
        // of the frame and nothing else would notice.
        let strokes = [
            BrushStroke(points: [AtelierKit.Point(0.25, 0.3), AtelierKit.Point(0.7, 0.45)], radius: 0.22, hardness: 0.4),
            BrushStroke(points: [AtelierKit.Point(0.5, 0.38)], radius: 0.08, hardness: 1, erase: true),
        ]
        let mask = Mask.brush(BrushMask(strokes: strokes))
        // No map handed over: the pass rasterises the strokes itself.
        let got = try drawn(LayerRenderPass(Self.blackening(mask)), over: Self.white)
        // The expectation is that MAP as the kernel reads it — the kit's own
        // `rasteriseBrush`, sampled by the kit's GL LINEAR + CLAMP_TO_EDGE
        // twin (`sampleAt`) at the pixel's centre — and not `maskAt` itself.
        // The map is `maskAt` at its own texel centres (the kit's
        // `BrushRasterTests` pins that to one code); between them the GPU
        // interpolates, and on this row's eraser that is not `maskAt`: at
        // hardness 1 its fall spans 5 % of its radius, 0.004 of the centred
        // space, which is 2.5 texels of the 1024 × 683 map (0.00163 a texel
        // across) and 0.29 of one of these 120 × 80 pixels. A smoothstep
        // over 2.5 texels, read linearly between them, is off by up to 0.08 —
        // the 0.0804 the Metal run measured at (65, 30), where `maskAt` says
        // 0.014 and the map read bilinearly says 0.095 (and the same at its
        // mirror, (54, 30)). The web's pass samples the same map the same
        // way; its gate reads 20 probes and none lands on that rim.
        //
        // Against the map the tolerance is the web gate's again, with room:
        // the map's bytes are exact k/255, filter weights held to 8 bits of
        // a texel move the read by at most 0.0002 here, and a half float
        // carries the rest to 0.0005. A y flip is still caught — read upside
        // down this map is off by 1.0 — and so is a half-texel slip, which on
        // this rim moves the read by up to 0.28.
        //
        // The very call `MaskRasterImage.painted` makes, at the layer's aspect.
        let raster = rasteriseBrush(strokes, Self.aspect)
        let map = DetailImage(width: raster.width, height: raster.height) { x, y in
            let v = Double(raster.data[y * raster.width + x]) / 255
            return (v, v, v)
        }
        checkWeights(got, Self.white, "brush") { i in
            let (u, v) = Self.uv(i)
            return sampleAt(map, u, v).0
        }
    }

    // MARK: - the order of layerWeight

    func testASubtractedSubjectHolesTheMaskAfterTheInvert() throws {
        // The subtracted map is a soft left-to-right ramp at the render's own
        // size, so every pixel reads one texel centre of it exactly — a map
        // uploaded the wrong way round would put the hole at the other end.
        var bytes = [UInt8](repeating: 0, count: Self.W * Self.H)
        for y in 0..<Self.H {
            for x in 0..<Self.W {
                bytes[y * Self.W + x] = UInt8((255 * max(0, 1 - Double(x) / (Double(Self.W) * 0.6))).rounded())
            }
        }
        let cut = BrushRaster(data: bytes, width: Self.W, height: Self.H)
        let line = Mask.linear(LinearMask(x: 0.5, y: 0.5, angle: 180, feather: 0.6))
        for invert in [false, true] {
            let got = try drawn(LayerRenderPass(Self.blackening(line, invert: invert, except: cut)), over: Self.white)
            checkWeights(got, Self.white, "except, \(invert ? "inverted" : "plain")") { i in
                let (u, v) = Self.uv(i)
                return layerWeight(maskAt(line, u, v, 1, Self.aspect), invert, Double(bytes[i]) / 255, 1)
            }
        }
    }

    func testCombinedPartsFollowLayerWeight() throws {
        // A linear, minus a painted part, intersected with an inverted
        // ellipse, plus a band of brightness — every op, an invert, a part's
        // raster — over the ramp so the band varies.
        let base = Mask.linear(LinearMask(x: 0.5, y: 0.5, angle: 70, feather: 0.9))
        let parts = [
            MaskPart(op: .subtract, mask: .brush(BrushMask(strokes: [
                BrushStroke(points: [AtelierKit.Point(0.3, 0.3), AtelierKit.Point(0.55, 0.7)], radius: 0.18, hardness: 0.3),
            ]))),
            MaskPart(op: .intersect, mask: .radial(RadialMask(x: 0.75, y: 0.4, radiusX: 0.2, radiusY: 0.15, angle: 10,
                                                               feather: 0.3)), invert: true),
            MaskPart(op: .add, mask: .luma(LumaMask(from: 0.8, to: 1, feather: 0.1))),
        ]
        let got = try drawn(LayerRenderPass(Self.blackening(base, parts: parts)), over: Self.ramp)
        checkWeights(got, Self.ramp, "combined") { i in
            let (u, v) = Self.uv(i)
            let (r, g, b) = Self.ramp.pixels[i]
            let luma = lumaOf(r, g, b)
            let values = parts.map { MaskPartValue(op: $0.op, invert: $0.invert, value: maskAt($0.mask, u, v, luma, Self.aspect)) }
            return layerWeight(maskAt(base, u, v, luma, Self.aspect), false, 0, 1, values)
        }
    }

    func testAColourRangeMatchesMaskAtOnThePixel() throws {
        // Hue across, lightness down; two samples taken from the picture's own
        // pixels, so the range is full at those two and falls off elsewhere —
        // a range sampled away from every pixel would be flat and prove nothing.
        let colours = Self.picture { x, y in
            let t = Double(x) / Double(Self.W)
            let s = Double(y) / Double(Self.H)
            return (0.2 + 0.7 * t, 0.2 + 0.6 * s, 0.5 + 0.3 * sin(Double(x) * 0.13 + Double(y) * 0.07))
        }
        func sampled(_ x: Int, _ y: Int) -> ColourSample {
            let (r, g, b) = colours.pixels[y * Self.W + x]
            return ColourSample(x: 0, y: 0, r: r, g: g, b: b)
        }
        let mask = Mask.colour(ColourMask(samples: [sampled(30, 20), sampled(90, 60)], range: 0.3))
        let got = try drawn(LayerRenderPass(Self.blackening(mask)), over: colours)
        checkWeights(got, colours, "colour") { i in
            let (u, v) = Self.uv(i)
            let (r, g, b) = colours.pixels[i]
            return maskAt(mask, u, v, lumaOf(r, g, b), Self.aspect, rgb: (r, g, b))
        }
    }

    // MARK: - the empties

    func testNoMaskIsTheWholePictureAndAnEmptyPaintingIsNone() throws {
        let whole = try Self.colours(drawn(LayerRenderPass(Self.blackening(nil)), over: Self.white))
        XCTAssertLessThanOrEqual(whole.max() ?? 1, 1e-3, "no mask must be the WHOLE picture")
        // An empty painting covers NOTHING — a fresh brush layer must not
        // apply to the whole frame.
        let empty = try Self.colours(drawn(LayerRenderPass(Self.blackening(.brush(BrushMask()))), over: Self.white))
        XCTAssertGreaterThanOrEqual(empty.min() ?? 0, 1 - 1e-3, "an empty painting must cover nothing")
        // And a subject whose map has not arrived draws NOTHING, never the whole.
        let point = AtelierKit.Point(0.5, 0.5)
        let waiting = try Self.colours(drawn(LayerRenderPass(Self.blackening(.subject(SubjectMask(points: [point])))),
                                             over: Self.white))
        XCTAssertGreaterThanOrEqual(waiting.min() ?? 0, 1 - 1e-3, "a subject with no map must draw nothing")
    }

    func testALayerAtNearlyZeroOpacityLeavesThePictureAlone() throws {
        // What lets a parked layer be skipped rather than mixed by zero.
        let got = try Self.colours(drawn(LayerRenderPass(Self.blackening(nil, opacity: 0.0001)), over: Self.white))
        let off = 1 - (got.min() ?? 0)
        XCTAssertLessThanOrEqual(off, 0.002, "a layer at opacity ~0 changed the picture by \(off)")
    }

    // MARK: - the develop, through the cube

    func testTheDevelopIsTheCubeMixedByTheMaskAndTheOpacity() throws {
        // A real develop, baked by the kernel's own `layerCube` — no look, no
        // transform — mixed by a radial mask at 60 %: the whole formula of a
        // layer, `src + (cube(src) − src) × mask × opacity`, per channel.
        var develop = DevelopSettings.default
        develop.exposure = -1
        develop.saturation = 30
        let cube = try XCTUnwrap(layerCube(develop))
        let mask = Mask.radial(RadialMask(x: 0.45, y: 0.5, radiusX: 0.35, radiusY: 0.3, angle: 0, feather: 0.4))
        let fixture = CubePassTests.gradient()
        let source = Picture(image: fixture.image, width: fixture.width, height: fixture.height, pixels: fixture.pixels)
        let ar = Double(fixture.width) / Double(fixture.height)
        let layer = try XCTUnwrap(LayerPass(lut: cube, mask: mask, opacity: 0.6, aspectRatio: ar, id: "layer:develop"))
        let got = try drawn(LayerRenderPass(layer), over: source)
        var worst = 0.0
        var at = 0
        for i in 0..<fixture.pixels.count {
            let (r, g, b) = fixture.pixels[i]
            let (u, v) = Self.uv(i, width: fixture.width, height: fixture.height)
            let w = maskAt(mask, u, v, lumaOf(r, g, b), ar) * 0.6
            let looked = sampleTetrahedral(cube, r, g, b)
            let want = [r + (looked.0 - r) * w, g + (looked.1 - g) * w, b + (looked.2 - b) * w]
            for c in 0..<3 {
                let d = abs(Double(got[i * 4 + c]) - want[c])
                if d.isNaN || d > worst {
                    worst = d.isNaN ? .infinity : d
                    at = i
                }
            }
        }
        XCTAssertLessThanOrEqual(worst, CubePassTests.tolerance,
                                 "\(CubePassTests.renderer): worst \(worst * 255) codes at pixel (\(at % fixture.width), \(at / fixture.width))")
    }

    // MARK: - show the mask as a line

    func testTheOutlineIsDrawnOnMaskAtsHalfLine() throws {
        // Ink or paper only where the mask crosses one half, the picture
        // untouched wherever the mask is plainly in or out. The expectation is
        // the kernel's own test run on `maskAt`: a pixel is an edge when the
        // mask at it and 1.5 pixels either side straddles one half.
        let w = 160
        let h = 120
        let ar = Double(w) / Double(h)
        let grey = Self.picture(width: w, height: h) { _, _ in (0.5, 0.5, 0.5) }
        let mask = Mask.radial(RadialMask(x: 0.5, y: 0.5, radiusX: 0.35, radiusY: 0.3, angle: 0, feather: 0.1))
        let pass = LayerRenderPass(Self.blackening(mask, finish: .outline, width: w, height: h))
        let got = try drawn(pass, over: grey)
        func m(_ x: Double, _ y: Double) -> Double {
            maskAt(mask, (x + 0.5) / Double(w), (y + 0.5) / Double(h), 0.5, ar)
        }
        func edgeAt(_ x: Int, _ y: Int) -> Bool {
            let fx = Double(x)
            let fy = Double(y)
            let v = [m(fx, fy), m(fx + 1.5, fy), m(fx - 1.5, fy), m(fx, fy + 1.5), m(fx, fy - 1.5)]
            return v.min()! < 0.5 && v.max()! >= 0.5
        }
        func near(_ x: Int, _ y: Int) -> Bool {
            for dy in -1...1 {
                for dx in -1...1 where edgeAt(x + dx, y + dy) { return true }
            }
            return false
        }
        var drawnCount = 0
        var stray = 0
        var edges = 0
        var missed = 0
        for y in 0..<h {
            for x in 0..<w {
                let isDrawn = abs(Double(got[(y * w + x) * 4]) - 0.5) > 0.05
                if isDrawn {
                    drawnCount += 1
                    if !near(x, y) { stray += 1 }
                }
                if edgeAt(x, y) {
                    edges += 1
                    if !isDrawn { missed += 1 }
                }
            }
        }
        XCTAssertGreaterThan(drawnCount, 60, "\(CubePassTests.renderer): the outline drew \(drawnCount) pixels")
        XCTAssertEqual(stray, 0, "\(stray) outline pixels away from maskAt's half line")
        XCTAssertLessThanOrEqual(Double(missed), Double(edges) * 0.02, "\(missed) of \(edges) edge pixels missed")
    }

    // MARK: - a subject's map, as Vision hands it over

    func testASubjectMapInAFloatBufferIsReadInItsRedChannelTopRowFirst() throws {
        // Vision's `generateScaledMaskForImage` answers in a one-component
        // 32-bit float buffer; this pins how that buffer reaches the layer
        // kernel — its value in the red channel, its first row at the TOP of
        // the frame — with a map that is not symmetric top to bottom.
        let w = 64
        let h = 48
        let buffer = try XCTUnwrap(Self.floatBuffer(width: w, height: h) { x, y in
            (Double(x) / Double(w - 1)) * (y < h / 2 ? 1 : 0.4)
        })
        let map = SubjectMasks.image(from: buffer.buffer)
        XCTAssertEqual(map.extent, CGRect(x: 0, y: 0, width: w, height: h))
        let white = Self.picture(width: w, height: h) { _, _ in (1, 1, 1) }
        let subject = Mask.subject(SubjectMask(points: [AtelierKit.Point(0.5, 0.5)], model: SubjectMasks.model))
        let pass = LayerRenderPass(Self.blackening(subject, width: w, height: h), subject: map)
        let got = try drawn(pass, over: white)
        checkWeights(got, white, "subject map") { i in buffer.values[i] }
    }

    /// A one-component float pixel buffer from a function of (x, y), y from
    /// the TOP, and the values as written.
    static func floatBuffer(width: Int, height: Int,
                            _ at: (Int, Int) -> Double) -> (buffer: CVPixelBuffer, values: [Double])? {
        var made: CVPixelBuffer?
        let attributes = [kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any]()] as CFDictionary
        guard CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_OneComponent32Float,
                                  attributes, &made) == kCVReturnSuccess, let buffer = made else { return nil }
        var values = [Double](repeating: 0, count: width * height)
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
        let row = CVPixelBufferGetBytesPerRow(buffer)
        for y in 0..<height {
            let line = (base + y * row).assumingMemoryBound(to: Float.self)
            for x in 0..<width {
                let v = Float(at(x, y))
                line[x] = v
                values[y * width + x] = Double(v)
            }
        }
        return (buffer, values)
    }
}
