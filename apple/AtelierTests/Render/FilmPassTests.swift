// The gate for the film node — the web's `scripts/check-render.mjs` film
// rows, on macOS, each held to the pure twins in AtelierKit
// (`Film/FilmGrain.swift`, `Film/FilmNoise.swift`, `Film/FilmTexture.swift`)
// at the web gate's tolerance: TWO 8-bit codes (`grain worst … (allowed 2)`,
// `halation worst … (allowed 2)`, `the same field at 512 and at 1536 …
// (allowed 2)`), measured there at one.
//
// Each row is sized so it measures what it claims: the grain renders tall
// enough that `fade` is 1 (a row with no grain in it passes on nothing — the
// web's own trap), the halation renders at the halo buffer's OWN size so the
// row measures the blur and the composite rather than a downsample, and every
// row asserts the picture MOVED.
//
// The node's coordinate is the frame's with y UP (`quadUv`): a read-back row
// `y`, counted from the top, is at `1 − (y + 0.5) / h`. Get it wrong and the
// grain field is measured mirrored against itself — and passes.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class FilmPassTests: XCTestCase {
    /// Two 8-bit codes.
    static let tolerance = 2.0 / 255.0

    private func texture(_ change: (inout FilmTexture) -> Void) -> FilmTexture {
        var t = defaultFilmTexture
        change(&t)
        return t
    }

    /// `texture` over `source` at `seconds` of the source, read back.
    private func filmed(_ source: LayerPassTests.Picture, _ texture: FilmTexture, seconds: Double? = nil) throws -> [Float] {
        let pass = try XCTUnwrap(FilmPass(texture), "a texture with grain or halation is a pass")
        let recipe: CIImage
        do {
            recipe = try pass.filmed(source.image, PassContext(renderSize: source.image.extent.size, sourceSeconds: seconds))
        } catch KernelError.applyFailed(let name) where !CubePassTests.hasMetal {
            throw XCTSkip("no Metal device here, and the software renderer would not run the '\(name)' kernel")
        }
        let got = CubePassTests.read(recipe, width: source.width, height: source.height)
        if !CubePassTests.hasMetal, got.allSatisfy({ $0.isNaN }) {
            throw XCTSkip("no Metal device here, and the software renderer drew nothing through the film kernels")
        }
        return got
    }

    /// The node's coordinate of read-back pixel (x, y), y from the top.
    private func quad(_ x: Int, _ y: Int, _ w: Int, _ h: Int) -> (Double, Double) {
        ((Double(x) + 0.5) / Double(w), 1 - (Double(y) + 0.5) / Double(h))
    }

    /// The largest channel difference between two read-backs, alpha left out.
    private func apart(_ a: [Float], _ b: [Float]) -> Double {
        var worst = 0.0
        for i in 0..<min(a.count, b.count) where i % 4 != 3 {
            worst = max(worst, abs(Double(a[i]) - Double(b[i])))
        }
        return worst
    }

    // MARK: - the library, and silence

    func testTheLibraryVendsEveryFilmKernel() throws {
        for name in ["filmExtract", "filmBlur", "filmNode"] {
            XCTAssertNoThrow(try Kernels.kernel(name), "default.metallib has no '\(name)': Film.metal did not build")
        }
    }

    func testASilentTextureIsNoPassAtAll() {
        // A stock with no grain and no halation must cost not one pass, so an
        // unfilmed picture is what it was before the node existed.
        XCTAssertNil(FilmPass(texture { $0.grain = 0; $0.halation = 0 }))
        XCTAssertNil(FilmPass(nil))
        XCTAssertNotNil(FilmPass(texture { $0.grain = 0.3 }))
        XCTAssertNotNil(FilmPass(texture { $0.halation = 0.3 }))
        // Read from a grade through the one reader every document goes through.
        XCTAssertNil(FilmPass.from(nil))
        XCTAssertNil(FilmPass.from(RollGrade()))
        let grade = RollGrade(film: texture { $0.grain = 0.4 }.json)
        XCTAssertEqual(FilmPass.from(grade)?.texture.grain, 0.4)
    }

    // MARK: - grain

    func testGrainMatchesApplyGrainOverTheBilinearTile() throws {
        let w = 480
        let h = 320
        let t = texture {
            $0.grain = 0.8
            $0.grainSize = 0.01
            $0.grainChroma = 0.35
            $0.grainFps = 0
            $0.seed = 17
        }
        let source = LayerPassTests.picture(width: w, height: h) { x, y in
            (Double(x) / Double(w), Double(y) / Double(h), Double((x + y) % 64) / 64)
        }
        let u = grainUniforms(t, Double(w), Double(h))
        XCTAssertEqual(u.fade, 1, "the row must be tall enough to draw its grain, or it measures nothing")
        let tile = makeGrainNoise(t.seed)
        let phase = grainPhase(grainFrameIndex(0, t.grainFps), t.seed)
        let got = try filmed(source, t)
        var worst = 0.0
        var moved = 0.0
        var at = (0, 0)
        for y in stride(from: 2, to: h, by: 7) {
            for x in stride(from: 2, to: w, by: 5) {
                let (qx, qy) = quad(x, y, w, h)
                let ux = qx * u.aspect.0 * u.scale + phase.0
                let uy = qy * u.aspect.1 * u.scale + phase.1
                let n = combineOctaves(sampleGrainTile(tile, ux, uy),
                                       sampleGrainTile(tile, ux * octaveScale, uy * octaveScale))
                let before = source.pixels[y * w + x]
                let want = applyGrain(before, n, u.amount, u.chroma, u.fade)
                let wants = [want.0, want.1, want.2]
                let befores = [before.0, before.1, before.2]
                for c in 0..<3 {
                    let d = abs(Double(got[(y * w + x) * 4 + c]) - wants[c])
                    if d.isNaN || d > worst {
                        worst = d.isNaN ? .infinity : d
                        at = (x, y)
                    }
                    moved = max(moved, abs(wants[c] - befores[c]))
                }
            }
        }
        XCTAssertLessThanOrEqual(worst, Self.tolerance,
                                 "\(CubePassTests.renderer): grain worst \(worst * 255) codes at \(at)")
        XCTAssertGreaterThan(moved * 255, 8, "the grain must move the picture, or this row proves nothing")
    }

    func testTheFieldReRollsOnTheSourceFrameNeverOnARepaint() throws {
        // 320 tall, not 128: at 128 a 0.01 cell is 1.28 px, `fade` is 0 and
        // the row would compare four pictures with no grain in them at all.
        let side = 320
        let grey = LayerPassTests.picture(width: side, height: side) { _, _ in (0.45, 0.45, 0.45) }
        let live = texture {
            $0.grain = 1
            $0.grainSize = 0.01
            $0.grainFps = 24
            $0.seed = 5
        }
        var frozen = live
        frozen.grainFps = 0
        let t0 = try filmed(grey, live, seconds: 0)
        XCTAssertEqual(apart(t0, try filmed(grey, live, seconds: 0)), 0, "a repaint is the same field")
        XCTAssertEqual(apart(t0, try filmed(grey, live, seconds: 1.0 / 60)), 0, "the same 1/24 bucket is the same field")
        XCTAssertEqual(apart(t0, try filmed(grey, live)), 0, "a still is frame 0")
        XCTAssertGreaterThan(apart(t0, try filmed(grey, live, seconds: 1.0 / 24)) * 255, 8, "the next bucket re-rolls")
        XCTAssertEqual(apart(try filmed(grey, frozen, seconds: 0), try filmed(grey, frozen, seconds: 10)), 0,
                       "grainFps 0 freezes the field")
    }

    func testTheSameFieldAtTwoRenderSizes() throws {
        // At three times the size the CENTRE pixel of each 3×3 block has
        // exactly the smaller render's frame coordinate, so the two sample the
        // noise field at the very same point: any disagreement is the node's.
        // A cell is 3.1 px at 512 and 9.2 at 1536, so `fade` is 1 at both.
        let t = texture {
            $0.grain = 1
            $0.grainSize = 0.006
            $0.grainChroma = 0
            $0.grainFps = 0
            $0.seed = 23
        }
        let small = try filmed(LayerPassTests.picture(width: 512, height: 512) { _, _ in (0.4, 0.4, 0.4) }, t)
        let big = try filmed(LayerPassTests.picture(width: 1536, height: 1536) { _, _ in (0.4, 0.4, 0.4) }, t)
        var worst = 0.0
        var spread = 0.0
        for y in stride(from: 0, to: 512, by: 3) {
            for x in stride(from: 0, to: 512, by: 3) {
                for c in 0..<3 {
                    let here = Double(small[(y * 512 + x) * 4 + c])
                    let there = Double(big[((3 * y + 1) * 1536 + 3 * x + 1) * 4 + c])
                    worst = max(worst, abs(there - here))
                    spread = max(spread, abs(here - Double(Float(0.4))))
                }
            }
        }
        XCTAssertLessThanOrEqual(worst, Self.tolerance, "\(CubePassTests.renderer): worst \(worst * 255) codes")
        XCTAssertGreaterThan(spread * 255, 8, "the field must be there to compare")
    }

    // MARK: - halation

    func testHalationMatchesExtractBlurScreen() throws {
        // Sized to the halo buffer ITSELF, so the extract is one texel per
        // texel and the row measures the blur and the composite.
        let t = texture {
            $0.grain = 0
            $0.halation = 0.7
            $0.halationRadius = 0.05
            $0.halationThreshold = 0.6
            $0.seed = 3
        }
        let w = 120
        let h = 80
        let buffer = try XCTUnwrap(halationBuffer(t, Double(w), Double(h)))
        XCTAssertEqual(buffer.w, w)
        XCTAssertEqual(buffer.h, h)
        // A bright warm disc on a dark field: something to bleed, and a colour to bleed in.
        let source = LayerPassTests.picture(width: w, height: h) { x, y in
            hypot(Double(x) - 40, Double(y) - 30) < 9 ? (1, 0.92, 0.7) : (0.18, 0.2, 0.22)
        }
        let got = try filmed(source, t)

        // The pure halo, rows from the top — a symmetric blur clamped at the
        // edges is the same whichever way the rows run.
        var channels = [[Float]](repeating: [Float](repeating: 0, count: w * h), count: 3)
        for i in 0..<(w * h) {
            let e = extractHighlight(source.pixels[i], t.halationThreshold)
            channels[0][i] = Float(e.0)
            channels[1][i] = Float(e.1)
            channels[2][i] = Float(e.2)
        }
        let kernel = gaussianKernel(buffer.sigma, halationTaps(buffer.sigma))
        let blurred = channels.map { blurSeparable($0, w, h, kernel) }
        var worst = 0.0
        var moved = 0.0
        var at = (0, 0)
        for y in stride(from: 0, to: h, by: 3) {
            for x in stride(from: 0, to: w, by: 3) {
                let i = y * w + x
                let before = source.pixels[i]
                let halo = (Double(blurred[0][i]), Double(blurred[1][i]), Double(blurred[2][i]))
                let want = screenHalation(before, halo, t.halationTint, t.halation)
                let wants = [want.0, want.1, want.2]
                let befores = [before.0, before.1, before.2]
                for c in 0..<3 {
                    let d = abs(Double(got[i * 4 + c]) - wants[c])
                    if d.isNaN || d > worst {
                        worst = d.isNaN ? .infinity : d
                        at = (x, y)
                    }
                    moved = max(moved, abs(wants[c] - befores[c]))
                }
            }
        }
        XCTAssertLessThanOrEqual(worst, Self.tolerance,
                                 "\(CubePassTests.renderer): halation worst \(worst * 255) codes at \(at) over a \(kernel.count)-tap blur")
        XCTAssertGreaterThan(moved * 255, 8, "the halo must move the picture, or this row proves nothing")
    }

    func testOnALargerRenderTheHaloIsBroughtDownAndNeverDarkens() throws {
        // Four times the buffer: the highlights are brought down to it rather
        // than blurred at the render's size. Whatever the resampling, the bleed
        // is a SCREEN — it never darkens a pixel — it lands around the disc,
        // and far from it the picture comes back as it went in.
        let t = texture {
            $0.grain = 0
            $0.halation = 0.7
            $0.halationRadius = 0.05
            $0.halationThreshold = 0.6
        }
        let w = 480
        let h = 320
        let source = LayerPassTests.picture(width: w, height: h) { x, y in
            hypot(Double(x) - 160, Double(y) - 120) < 36 ? (1, 0.92, 0.7) : (0.18, 0.2, 0.22)
        }
        let got = try filmed(source, t)
        var darkest = 0.0
        for i in 0..<(w * h) {
            let before = source.pixels[i]
            let befores = [before.0, before.1, before.2]
            for c in 0..<3 { darkest = max(darkest, befores[c] - Double(got[i * 4 + c])) }
        }
        XCTAssertLessThanOrEqual(darkest, 1e-3, "a screen never darkens: \(darkest * 255) codes")
        // 14 px past the disc's edge: under one sigma of the blur (16 px at this size).
        let nearby = (120 * w + 160 + 50) * 4
        XCTAssertGreaterThan((Double(got[nearby]) - 0.18) * 255, 4, "the bleed reaches past the disc")
        let far = ((h - 4) * w + (w - 4)) * 4
        XCTAssertEqual(Double(got[far]), 0.18, accuracy: 1e-3, "far from the disc the picture is untouched")
    }

    // MARK: - the seam

    func testTheGraderDrawsTheFilmLastOfAll() throws {
        // In the film slot the node draws after every other pass: grain over a
        // darkened picture, never a darkened grain. The two orders differ; the
        // grader's must be film-last, to the code.
        let w = 256
        let h = 192
        let source = LayerPassTests.picture(width: w, height: h) { x, y in
            (0.45 + 0.1 * sin(Double(x) / 11), 0.45, 0.45 + 0.1 * cos(Double(y) / 9))
        }
        let t = texture {
            $0.grain = 0.9
            $0.grainSize = 0.02
            $0.grainFps = 0
            $0.seed = 41
        }
        var develop = DevelopSettings.default
        develop.exposure = -1
        let darken = LayerRenderPass(try XCTUnwrap(LayerPass(lut: try XCTUnwrap(layerCube(develop)), mask: nil,
                                                             aspectRatio: Double(w) / Double(h), id: "layer:dark")))
        let film = try XCTUnwrap(FilmPass(t))
        let grader = FrameGrader(after: [darken], film: film)
        XCTAssertEqual(grader.passes.map { $0.id }, ["layer:dark", "film"])

        let ctx = PassContext(renderSize: source.image.extent.size)
        let viaGrader = CubePassTests.read(grader.render(source: source.image), width: w, height: h)
        if !CubePassTests.hasMetal, viaGrader.allSatisfy({ $0.isNaN }) {
            throw XCTSkip("no Metal device here, and the software renderer drew nothing through the kernels")
        }
        let darkened = try darken.drawn(source.image, ctx)
        let filmLast = CubePassTests.read(try film.filmed(darkened, ctx), width: w, height: h)
        let grained = try film.filmed(source.image, ctx)
        let filmFirst = CubePassTests.read(try darken.drawn(grained, ctx), width: w, height: h)
        XCTAssertLessThanOrEqual(apart(viaGrader, filmLast), 1.0 / 255, "the grader draws the film LAST")
        XCTAssertGreaterThan(apart(viaGrader, filmFirst) * 255, 2, "and the other order is a different picture")
    }
}
