// The gate for the presence passes — the web's `check-render.mjs` rows
// «presence: dehaze, clarity, texture against presence.ts», on macOS: the
// same 400×300 hazy gradient with a dark block, a bright block and noise over
// all of it (the web's LCG and seed) — big enough that each blur's taps are
// spaced PAST a pixel and read between texels, the branch a small picture
// never reaches — and the same six rows (±, each op), each node held to
// AtelierKit's `applyPresence` at the web's two codes, over every pixel.
//
// The web draws a slider as two passes with the estimate in alpha; here it
// is ONE node with the estimate as its own image (`PresencePass.swift`), so
// the row holds that node — both kernels — to the twin of the pair.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class PresencePassTests: XCTestCase {
    static let width = 400
    static let height = 300

    /// The web's fixture on a 1/256 grid a half float holds exactly
    /// (`DetailPassTests.onHalfGrid` says why).
    static let picture: DetailImage = {
        let w = PresencePassTests.width
        let h = PresencePassTests.height
        var seed: UInt32 = 777
        func rnd() -> Double {
            seed = seed &* 1_664_525 &+ 1_013_904_223
            return Double(seed) / 4_294_967_296
        }
        var data = [Float](repeating: 0, count: w * h * 3)
        for y in 0..<h {
            for x in 0..<w {
                let haze = 0.3 + 0.4 * (Double(y) / Double(h))
                var px = [haze * 0.9, haze, haze * 1.1]
                if x > 60 && x < 160 && y > 60 && y < 200 { px = [0.15, 0.25, 0.1] }
                if x > 230 && x < 330 && y > 100 && y < 170 { px = [0.85, 0.8, 0.7] }
                for c in 0..<3 {
                    let noisy = px[c] + (rnd() - 0.5) * 0.06
                    data[(y * w + x) * 3 + c] = Float(DetailPassTests.onHalfGrid(noisy))
                }
            }
        }
        return DetailImage(width: w, height: h, data: data)
    }()

    var context: PassContext {
        PassContext(renderSize: CGSize(width: Self.width, height: Self.height))
    }

    /// One slider's node over the fixture, held to `applyPresence`.
    func check(_ op: PresenceOp, _ amount: Double, file: StaticString = #filePath, line: UInt = #line) throws {
        var amounts = PresenceAmounts()
        switch op {
        case .dehaze: amounts.dehaze = amount
        case .clarity: amounts.clarity = amount
        case .texture: amounts.texture = amount
        }
        let pure = applyPresence(Self.picture, amounts)
        let moved = NeighbourhoodGate.moved(pure, from: Self.picture)
        XCTAssertGreaterThan(moved, 0.01, "\(op.rawValue) \(amount): the twin MOVED NOTHING, so the row proves nothing",
                             file: file, line: line)
        let source = NeighbourhoodGate.image(Self.picture)
        let ctx = context
        let got = try NeighbourhoodGate.drawn(width: Self.width, height: Self.height) {
            try PresencePass(op: op, amount: amount).drawn(source, ctx)
        }
        let worst = NeighbourhoodGate.worst(got, width: Self.width, height: Self.height, NeighbourhoodGate.want(pure))
        XCTAssertLessThanOrEqual(
            worst.codes, NeighbourhoodGate.codes,
            "\(NeighbourhoodGate.renderer), \(op.rawValue) \(amount): worst \(worst.codes) codes at (\(worst.x), \(worst.y)) channel \(worst.channel)",
            file: file, line: line)
    }

    // MARK: - the library

    func testTheLibraryVendsBothPresenceKernels() {
        XCTAssertNoThrow(try Kernels.kernel("presenceBlur"), "Presence.metal did not build, or the function moved")
        XCTAssertNoThrow(try Kernels.kernel("presenceApply"), "Presence.metal did not build, or the function moved")
    }

    func testTheFixtureReallyReadsBetweenTexels() {
        // The point of 400×300: the dehaze blur's taps are spaced PAST a
        // pixel, so the kernel's bilinear reads are exercised, not skipped.
        let g = blurGeometry(PresenceOp.dehaze.scale, Self.width, Self.height)
        XCTAssertGreaterThan(g.step, 1)
        XCTAssertEqual(g.taps, presenceTaps)
    }

    // MARK: - the six rows

    func testDehazeRemovesHazeAsTheTwinDoes() throws {
        try check(.dehaze, 0.8)
    }

    func testANegativeDehazeAddsAVeilAsTheTwinDoes() throws {
        try check(.dehaze, -0.6)
    }

    func testClarityMatchesTheTwinBothWays() throws {
        try check(.clarity, 1)
        try check(.clarity, -1)
    }

    func testTextureMatchesTheTwinBothWays() throws {
        try check(.texture, 1)
        try check(.texture, -0.7)
    }

    // MARK: - nothing to do, the id, the size

    func testZeroDrawsNothingAndTheIdNamesTheSlider() throws {
        let source = NeighbourhoodGate.image(Self.picture)
        XCTAssertTrue(try PresencePass(op: .clarity, amount: 0).drawn(source, context) === source)
        XCTAssertEqual(PresencePass(op: .dehaze, amount: 0.5).id, "presence-dehaze")
        XCTAssertEqual(PresencePass(op: .texture, amount: 0.5).id, "presence-texture")
        XCTAssertEqual(PresencePass.planIds, [.presenceBlur, .presenceApply])
    }

    func testAContextWithNoSizeReadsThePicturesOwn() throws {
        // A scale is a share of the short side of the RENDER — the web's
        // `u_texel`; a context that names no size falls back on the picture.
        let pure = applyPresence(Self.picture, PresenceAmounts(clarity: 0.6))
        let source = NeighbourhoodGate.image(Self.picture)
        let got = try NeighbourhoodGate.drawn(width: Self.width, height: Self.height) {
            try PresencePass(op: .clarity, amount: 0.6).drawn(source, PassContext(renderSize: .zero))
        }
        let worst = NeighbourhoodGate.worst(got, width: Self.width, height: Self.height, NeighbourhoodGate.want(pure))
        XCTAssertLessThanOrEqual(worst.codes, NeighbourhoodGate.codes, "\(NeighbourhoodGate.renderer): worst \(worst.codes) codes")
    }

    // MARK: - the ROI, tile by tile

    func testTheROIHoldsTileByTileForTheWidestBlur() throws {
        // Dehaze walks 24 taps a side spaced past a pixel — 27 pixels each
        // way, along X for the estimate and along Y for the move. 53×41 tiles
        // cut through both reaches everywhere.
        let source = NeighbourhoodGate.image(Self.picture)
        let pass = PresencePass(op: .dehaze, amount: 0.8)
        let ctx = context
        let whole = try NeighbourhoodGate.drawn(width: Self.width, height: Self.height) { try pass.drawn(source, ctx) }
        let tiled = NeighbourhoodGate.tiled(try pass.drawn(source, ctx), width: Self.width, height: Self.height, tile: (53, 41))
        let (difference, at) = NeighbourhoodGate.largest(whole, tiled)
        XCTAssertLessThanOrEqual(
            difference, 1e-3,
            "\(NeighbourhoodGate.renderer): a tile read differs from the whole by \(difference) at pixel (\(at % Self.width), \(at / Self.width)) — the ROI falls short")
    }
}
