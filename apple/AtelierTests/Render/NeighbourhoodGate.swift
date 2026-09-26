// What the neighbourhood gates share — the detail, presence and repair rows
// of the web's `scripts/check-render.mjs`, on macOS: a picture the pure twin
// reads (AtelierKit's `DetailImage`, top row first) made into an untagged
// float `CIImage` the pass draws on, the recipe read back, and the worst
// difference in 8-bit codes against the twin, both sides clamped to [0,1] as
// the web's canvas read-back clamps them. The web allows TWO codes on every
// one of these rows (`check-render.mjs`: detail, presence, repair).
//
// Plus the one check the web's gate has no need of: a recipe read TILE BY
// TILE, each tile its own render, must equal the whole. Core Image renders a
// big picture in tiles and asks each kernel for the region it reads (its
// ROI); a kernel whose ROI falls short reads the clear outside the
// intermediate it was given and seams at the tile's edge — invisible on a
// small picture drawn whole, visible on every export. Reading small tiles
// forces exactly that path on a small picture.

import AtelierKit
import CoreImage
import Metal
import XCTest
@testable import Atelier

enum NeighbourhoodGate {
    /// The web gate's allowance for every neighbourhood row, in 8-bit codes.
    static let codes = 2.0
    static let hasMetal = MTLCreateSystemDefaultDevice() != nil
    static let context: CIContext = RenderContexts.make(software: !hasMetal)
    static var renderer: String {
        hasMetal ? "Metal" : "the software renderer (no Metal device on this machine)"
    }

    /// `img` as an opaque, untagged float picture — codes, as a decode hands
    /// the graph — with its first row at the TOP, as the twin reads it.
    static func image(_ img: DetailImage) -> CIImage {
        let count = img.width * img.height
        var floats = [Float](repeating: 1, count: count * 4)
        for i in 0..<count {
            floats[i * 4] = img.data[i * 3]
            floats[i * 4 + 1] = img.data[i * 3 + 1]
            floats[i * 4 + 2] = img.data[i * 3 + 2]
        }
        let data = floats.withUnsafeBufferPointer { Data(buffer: $0) }
        return CIImage(bitmapData: data, bytesPerRow: img.width * 16,
                       size: CGSize(width: img.width, height: img.height), format: .RGBAf, colorSpace: nil)
    }

    /// The pixels of `bounds` — in Core Image's own coordinates — as RGBA
    /// floats, the TOP row of the bounds first.
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

    /// A `width × height` picture at the origin read whole, top row first —
    /// index for index with the twin's `DetailImage`.
    static func read(_ image: CIImage, width: Int, height: Int) -> [Float] {
        read(image, bounds: CGRect(x: 0, y: 0, width: width, height: height))
    }

    /// The recipe built by `draw`, read back whole — or a skip where this
    /// machine's renderer cannot run the kernel at all (never where it LOADS
    /// badly: a missing function is a failure, the library did not build).
    static func drawn(width: Int, height: Int, _ draw: () throws -> CIImage) throws -> [Float] {
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

    struct Worst {
        /// In 8-bit codes; a NaN reads as infinity, never as a pass.
        var codes: Double
        var x: Int
        var y: Int
        var channel: Int
    }

    /// The worst channel difference between `got` (RGBA, top row first) and
    /// `want(x, y)`, both clamped to [0,1] as a canvas read-back is, over
    /// every pixel.
    static func worst(_ got: [Float], width: Int, height: Int,
                      _ want: (Int, Int) -> (Double, Double, Double)) -> Worst {
        var worst = Worst(codes: 0, x: 0, y: 0, channel: 0)
        for y in 0..<height {
            for x in 0..<width {
                let w = want(x, y)
                let wanted = [w.0, w.1, w.2]
                for c in 0..<3 {
                    let g = Double(got[(y * width + x) * 4 + c])
                    let d = abs(min(1, max(0, g)) - min(1, max(0, wanted[c]))) * 255
                    if d.isNaN || g.isNaN {
                        return Worst(codes: .infinity, x: x, y: y, channel: c)
                    }
                    if d > worst.codes { worst = Worst(codes: d, x: x, y: y, channel: c) }
                }
            }
        }
        return worst
    }

    /// The twin's picture as the comparison's `want`.
    static func want(_ pure: DetailImage) -> (Int, Int) -> (Double, Double, Double) {
        { x, y in pixelAt(pure, x, y) }
    }

    /// How far the twin moved the picture anywhere — a row whose pass moved
    /// nothing proves nothing.
    static func moved(_ pure: DetailImage, from source: DetailImage) -> Double {
        var m = 0.0
        for i in 0..<source.data.count {
            m = max(m, abs(Double(pure.data[i]) - Double(source.data[i])))
        }
        return m
    }

    /// `image` (a `width × height` picture at the origin) read TILE BY TILE,
    /// each tile its own render of its own bounds, assembled top row first.
    static func tiled(_ image: CIImage, width: Int, height: Int, tile: (w: Int, h: Int)) -> [Float] {
        var out = [Float](repeating: .nan, count: width * height * 4)
        var top = 0
        while top < height {
            let th = min(tile.h, height - top)
            var left = 0
            while left < width {
                let tw = min(tile.w, width - left)
                // Rows `top ..< top + th` counted from the top are Core
                // Image's y from `height − top − th`, its y running up.
                let bounds = CGRect(x: left, y: height - top - th, width: tw, height: th)
                let part = read(image, bounds: bounds)
                for row in 0..<th {
                    for col in 0..<tw {
                        let from = (row * tw + col) * 4
                        let to = ((top + row) * width + left + col) * 4
                        for c in 0..<4 { out[to + c] = part[from + c] }
                    }
                }
                left += tw
            }
            top += th
        }
        return out
    }

    /// The largest difference between two reads, RGB and alpha; a NaN is infinity.
    static func largest(_ a: [Float], _ b: [Float]) -> (difference: Double, at: Int) {
        var worst = 0.0
        var at = 0
        for i in 0..<min(a.count, b.count) {
            let d = abs(Double(a[i]) - Double(b[i]))
            if d.isNaN { return (.infinity, i / 4) }
            if d > worst {
                worst = d
                at = i / 4
            }
        }
        return (worst, at)
    }
}
