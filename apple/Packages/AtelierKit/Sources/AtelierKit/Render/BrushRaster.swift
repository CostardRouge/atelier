// A painted mask, rasterised — port of `src/shared/render/brush-raster.ts`.
//
// The other mask shapes are a few numbers and a formula, so a kernel mirrors
// them directly. A brush is a list of polylines, and a per-pixel kernel that
// walked every segment of every stroke would cost `pixels × points` —
// hundreds of millions for an ordinary mask. So the CPU rasterises it once
// into an alpha map and the GPU samples that.
//
// Rules kept:
// - It is the SAME maths, not an approximation of it: every texel is
//   `brushCoverageAt` at that texel's centre, so the raster and the pure
//   module agree by construction (`brushAt` is the one-point twin).
// - Cost is the area PAINTED, not the frame: each stroke is walked only inside
//   its own bounding box, which is what makes a live drag possible.
// - Strokes composite in the order they were painted; an eraser only removes
//   what is already down, so a stroke painted after it comes back.
// - No strokes is an EMPTY map (every texel 0): only the absence of a mask is
//   the whole picture.
//
// Pure: it returns bytes, and the app uploads them.

import Foundation

/// One byte of coverage per texel, row-major from the TOP of the picture.
public struct BrushRaster: Equatable, Sendable {
    public var data: [UInt8]
    public var width: Int
    public var height: Int

    public init(data: [UInt8], width: Int, height: Int) {
        self.data = data
        self.width = width
        self.height = height
    }
}

/// How big the alpha map is on its long edge. A mask is a soft thing, so it
/// survives being sampled at a fraction of the picture's density far better
/// than the picture would: 1024 keeps a 48-megapixel delivery honest while
/// costing 1 MB rather than 48.
public let brushRasterLongEdge = 1024

/// JavaScript's `Math.round`: half up, whatever the sign.
@inline(__always)
private func jsRound(_ x: Double) -> Double {
    (x + 0.5).rounded(.down)
}

/// The map's size for a frame of this shape, long edge capped.
public func brushRasterSize(_ aspectRatio: Double, longEdge: Int = brushRasterLongEdge) -> (width: Int, height: Int) {
    let ar = aspectRatio.isFinite && aspectRatio > 0 ? aspectRatio : 1
    let edge = max(16, longEdge)
    if ar >= 1 {
        return (width: edge, height: max(16, Int(jsRound(Double(edge) / ar))))
    }
    return (width: max(16, Int(jsRound(Double(edge) * ar))), height: edge)
}

/// The strokes as an alpha map.
public func rasteriseBrush(_ strokes: [BrushStroke], _ aspectRatio: Double, longEdge: Int = brushRasterLongEdge) -> BrushRaster {
    let size = brushRasterSize(aspectRatio, longEdge: longEdge)
    let width = size.width
    let height = size.height
    var acc = [Float](repeating: 0, count: width * height)
    let ar = aspectRatio.isFinite && aspectRatio > 0 ? aspectRatio : 1
    let diagonal = hypot(ar, 1)
    // The frame in the shared centred space, so a radius can be turned into a
    // number of texels without going through `framePoint` per texel.
    let spanX = (ar / diagonal) * 2
    let spanY = (1 / diagonal) * 2

    acc.withUnsafeMutableBufferPointer { buf in
        for stroke in strokes {
            if stroke.points.isEmpty { continue }
            let r = max(stroke.radius, 1e-6)
            // Converted ONCE per stroke, not per texel.
            let centred = strokePoints(stroke, ar)
            // The stroke's own box, in [0,1] frame coordinates, grown by its radius.
            var minU = Double.infinity
            var maxU = -Double.infinity
            var minV = Double.infinity
            var maxV = -Double.infinity
            for p in stroke.points {
                if p.x < minU { minU = p.x }
                if p.x > maxU { maxU = p.x }
                if p.y < minV { minV = p.y }
                if p.y > maxV { maxV = p.y }
            }
            let padU = r / spanX
            let padV = r / spanY
            let x0 = max(0, Int(((minU - padU) * Double(width)).rounded(.down)))
            let x1 = min(width - 1, Int(((maxU + padU) * Double(width)).rounded(.up)))
            let y0 = max(0, Int(((minV - padV) * Double(height)).rounded(.down)))
            let y1 = min(height - 1, Int(((maxV + padV) * Double(height)).rounded(.up)))
            if x1 < x0 || y1 < y0 { continue }

            for y in y0...y1 {
                // `framePoint`, written out: the row's y is shared by the whole
                // row, so it is computed once here, and no tuple is made per texel.
                let py = (((Double(y) + 0.5) / Double(height) - 0.5) * 2) / diagonal
                for x in x0...x1 {
                    let px = (((Double(x) + 0.5) / Double(width) - 0.5) * 2 * ar) / diagonal
                    let c = coverageAt(centred, stroke.radius, stroke.hardness, px, py)
                    if c <= 0 { continue }
                    let i = y * width + x
                    let under = Double(buf[i])
                    buf[i] = Float(stroke.erase ? under * (1 - c) : under + (1 - under) * c)
                }
            }
        }
    }

    var data = [UInt8](repeating: 0, count: width * height)
    data.withUnsafeMutableBufferPointer { out in
        for i in 0..<out.count {
            out[i] = UInt8(jsRound(clamp01(Double(acc[i])) * 255))
        }
    }
    return BrushRaster(data: data, width: width, height: height)
}

/// The same answer as `rasteriseBrush` at one point, without building a map —
/// for a spec, and for anything that needs to ask about a single pixel.
public func brushAt(_ strokes: [BrushStroke], _ u: Double, _ v: Double, _ aspectRatio: Double = 1) -> Double {
    let (px, py) = framePoint(u, v, aspectRatio)
    return brushCoverageAt(strokes, px, py, aspectRatio)
}
