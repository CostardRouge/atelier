// What the geometry family's gate rows share — the web's
// `scripts/check-render.mjs` harness, on macOS: a synthetic picture handed to
// Core Image as untagged float codes, a pass drawn over it, the recipe read
// back as floats, rows top to bottom — IMAGE order, y down, the order the
// fixture was written in and the order every twin states its map in.
//
// Rendered on Metal where the runner has a device; on the software renderer
// otherwise, which a failure names and which — where that renderer will not
// run a Metal kernel at all — turns the row into a skip that says why. A
// kernel that will not LOAD is never a skip: the library did not build.
//
// Named for its family (`GeometryGate`): the test target is ONE module, and
// the other families' gates land in it beside this one.

import AtelierKit
import CoreImage
import Metal
import XCTest
@testable import Atelier

enum GeometryGate {
    static let hasMetal = MTLCreateSystemDefaultDevice() != nil
    static let context: CIContext = RenderContexts.make(software: !hasMetal)
    static var renderer: String {
        hasMetal ? "Metal" : "the software renderer (no Metal device on this machine)"
    }

    /// One 8-bit code, in [0,1].
    static let code = 1.0 / 255.0

    /// A W×H picture, held both ways: as the Core Image source the pass reads,
    /// and as the numbers the twin is fed — the floats the bytes really carry.
    struct Picture {
        let image: CIImage
        let width: Int
        let height: Int
        /// Straight RGBA per pixel, rows TOP to bottom.
        let rgba: [Float]

        func value(_ x: Int, _ y: Int, _ c: Int) -> Double {
            Double(rgba[(y * width + x) * 4 + c])
        }

        /// The GPU's LINEAR read at image point (u, v) — y down — clamped to the
        /// edge: the web gate's `pick`, pixel centres at +0.5.
        func bilinear(_ u: Double, _ v: Double, _ c: Int) -> Double {
            let x = u * Double(width) - 0.5
            let y = v * Double(height) - 0.5
            let x0 = Int(x.rounded(.down))
            let y0 = Int(y.rounded(.down))
            let fx = x - Double(x0)
            let fy = y - Double(y0)
            func at(_ xx: Int, _ yy: Int) -> Double {
                value(min(width - 1, max(0, xx)), min(height - 1, max(0, yy)), c)
            }
            let top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
            let bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
            return top * (1 - fy) + bottom * fy
        }
    }

    /// A picture whose pixel (x, y) — y counted DOWN from the top — is `fill`'s
    /// straight RGB, opaque, as untagged float codes (a decode's own numbers,
    /// nothing to convert from).
    static func picture(width: Int, height: Int, _ fill: (Int, Int) -> (Double, Double, Double)) -> Picture {
        var floats = [Float](repeating: 1, count: width * height * 4)
        for y in 0..<height {
            for x in 0..<width {
                let (r, g, b) = fill(x, y)
                let o = (y * width + x) * 4
                floats[o] = Float(r)
                floats[o + 1] = Float(g)
                floats[o + 2] = Float(b)
            }
        }
        let data = floats.withUnsafeBufferPointer { Data(buffer: $0) }
        let image = CIImage(bitmapData: data, bytesPerRow: width * 16,
                            size: CGSize(width: width, height: height), format: .RGBAf, colorSpace: nil)
        return Picture(image: image, width: width, height: height, rgba: floats)
    }

    /// A recipe rendered to floats, RGBA per pixel, rows top to bottom.
    static func read(_ image: CIImage, width: Int, height: Int) -> [Float] {
        read(image, bounds: CGRect(x: 0, y: 0, width: width, height: height))
    }

    /// The pixels of `bounds` — in Core Image's own coordinates — as floats,
    /// the bitmap's first row being the TOP of the bounds.
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

    /// `draw`'s recipe read back — or a skip where this machine's renderer
    /// cannot run the kernel at all (never where it LOADS badly).
    static func run(_ draw: () throws -> CIImage, width: Int, height: Int) throws -> [Float] {
        let recipe: CIImage
        do {
            recipe = try draw()
        } catch KernelError.applyFailed(let name) where !hasMetal {
            throw XCTSkip("no Metal device here, and the software renderer would not run the '\(name)' kernel")
        }
        let got = read(recipe, width: width, height: height)
        if !hasMetal, got.allSatisfy({ $0.isNaN }) {
            throw XCTSkip("no Metal device here, and the software renderer drew nothing through the kernel")
        }
        return got
    }

    /// The context a pass is handed in a gate row: the picture's own size, at
    /// source density.
    static func ctx(_ picture: Picture) -> PassContext {
        PassContext(renderSize: CGSize(width: picture.width, height: picture.height))
    }

    /// The recipe drawn in four TILES matches it drawn whole — what a region of
    /// interest has to get right. A tile whose ROI is too small reads pixels it
    /// was never given, and comes back different; the whole draw hides that.
    static func assertTilesAgree(_ recipe: CIImage, width: Int, height: Int, pass: String,
                                 file: StaticString = #filePath, line: UInt = #line) {
        let whole = read(recipe, width: width, height: height)
        let halfW = width / 2
        let halfH = height / 2
        let tiles = [
            CGRect(x: 0, y: 0, width: halfW, height: halfH),
            CGRect(x: halfW, y: 0, width: width - halfW, height: halfH),
            CGRect(x: 0, y: halfH, width: halfW, height: height - halfH),
            CGRect(x: halfW, y: halfH, width: width - halfW, height: height - halfH),
        ]
        var worst = 0.0
        var at = ""
        for tile in tiles {
            let bw = Int(tile.width)
            let bh = Int(tile.height)
            let bx = Int(tile.minX)
            let by = Int(tile.minY)
            let got = read(recipe, bounds: tile)
            for r in 0..<bh {
                // Bitmap row r of the tile is Core Image's y = by + bh − 1 − r,
                // which is image row height − by − bh + r of the whole.
                let row = height - by - bh + r
                for c in 0..<bw {
                    for k in 0..<4 {
                        let a = Double(got[(r * bw + c) * 4 + k])
                        let b = Double(whole[(row * width + bx + c) * 4 + k])
                        let d = abs(a - b)
                        if d.isNaN || d > worst {
                            worst = d.isNaN ? .infinity : d
                            at = "pixel (\(bx + c), \(row)) channel \(k), tile \(tile)"
                        }
                    }
                }
            }
        }
        XCTAssertLessThanOrEqual(worst, code / 4,
                                 "\(renderer), \(pass): a tile drawn alone differs from the whole by \(worst * 255) codes at \(at) — its region of interest is short",
                                 file: file, line: line)
    }
}
