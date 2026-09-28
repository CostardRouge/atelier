// What the painter specs share: render into a frame-sized raster (the same
// y-down sRGB bitmap `OverlayRaster` hands the export) and read its pixels
// back, row 0 at the TOP — so a spec speaks in the frame's own coordinates.

import CoreGraphics
import Foundation
@testable import Atelier

struct PaintRaster {
    let width: Int
    let height: Int
    /// Premultiplied RGBA, row 0 at the top.
    let bytes: [UInt8]

    struct Pixel: Equatable {
        var r: Int
        var g: Int
        var b: Int
        var a: Int
    }

    func pixel(_ x: Int, _ y: Int) -> Pixel {
        let i = (y * width + x) * 4
        return Pixel(r: Int(bytes[i]), g: Int(bytes[i + 1]), b: Int(bytes[i + 2]), a: Int(bytes[i + 3]))
    }

    /// Every pixel for which `test` holds, as (x, y).
    func points(where test: (Pixel) -> Bool) -> [(x: Int, y: Int)] {
        var out: [(x: Int, y: Int)] = []
        for y in 0..<height {
            for x in 0..<width where test(pixel(x, y)) { out.append((x, y)) }
        }
        return out
    }

    /// The tight box of the pixels `test` picks, or nil when there are none.
    func bounds(where test: (Pixel) -> Bool) -> CGRect? {
        let hits = points(where: test)
        guard let first = hits.first else { return nil }
        var minX = first.x, maxX = first.x, minY = first.y, maxY = first.y
        for p in hits {
            minX = min(minX, p.x); maxX = max(maxX, p.x)
            minY = min(minY, p.y); maxY = max(maxY, p.y)
        }
        return CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
    }

    /// Mean row of the pixels `test` picks.
    func meanY(where test: (Pixel) -> Bool) -> Double {
        let hits = points(where: test)
        guard !hits.isEmpty else { return .nan }
        return Double(hits.reduce(0) { $0 + $1.y }) / Double(hits.count)
    }

    /// Paint into a transparent `width`×`height` frame and read it back.
    static func render(_ width: Int, _ height: Int, _ draw: (CGContext, CGSize) -> Void) -> PaintRaster {
        guard let ctx = OverlayRaster.makeContext(width: width, height: height) else {
            return PaintRaster(width: width, height: height, bytes: [UInt8](repeating: 0, count: width * height * 4))
        }
        draw(ctx, CGSize(width: width, height: height))
        var out = [UInt8](repeating: 0, count: width * height * 4)
        if let raw = ctx.data {
            let bytes = raw.assumingMemoryBound(to: UInt8.self)
            let rowBytes = ctx.bytesPerRow
            for row in 0..<height {
                for i in 0..<(width * 4) { out[row * width * 4 + i] = bytes[row * rowBytes + i] }
            }
        }
        return PaintRaster(width: width, height: height, bytes: out)
    }

    /// A solid `width`×`height` picture of one colour.
    static func solid(_ width: Int, _ height: Int, _ r: UInt8, _ g: UInt8, _ b: UInt8) -> CGImage {
        var rgba = [UInt8](repeating: 255, count: width * height * 4)
        for i in 0..<(width * height) {
            rgba[i * 4] = r
            rgba[i * 4 + 1] = g
            rgba[i * 4 + 2] = b
        }
        return OverlayRaster.image(rgba: rgba, width: width, height: height)!
    }
}
