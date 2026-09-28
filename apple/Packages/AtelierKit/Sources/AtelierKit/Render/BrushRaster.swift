// A painted mask, rasterised — the one mask kind the GPU cannot compute from
// a handful of uniforms. Port of `src/shared/render/brush-raster.ts`.
//
// The rules it keeps:
// - it is the SAME maths as `Mask.swift`, not an approximation: every texel
//   is `brushCoverageAt` at that texel's centre, so the raster and the pure
//   module agree by construction and the GPU can be held to it;
// - cost is the area PAINTED, not the frame: each stroke is walked only
//   inside its own bounding box, which is what makes a live drag possible;
// - strokes composite in the order painted, an eraser only removes what is
//   already down, and the accumulator is 32-bit float as the web's is, so a
//   byte here is the byte the web writes;
// - the hot loop allocates nothing — `framePoint` is written out per row and
//   per texel, and the stroke's centred points are read through a buffer.

import Foundation

public struct BrushRaster: Equatable, Sendable {
    /// One byte of coverage per texel, row-major from the TOP of the picture.
    public var data: [UInt8]
    public var width: Int
    public var height: Int

    public init(data: [UInt8], width: Int, height: Int) {
        self.data = data; self.width = width; self.height = height
    }
}

/// How big the alpha map is on its long edge. A mask is a soft thing, so it
/// survives being sampled at a fraction of the picture's density; 1024 keeps
/// a 48-megapixel delivery honest while costing 1 MB rather than 48.
public let brushRasterLongEdge = 1024

/// The map's size for a frame of this shape, long edge capped.
public func brushRasterSize(_ aspectRatio: Double, _ longEdge: Int = brushRasterLongEdge) -> (width: Int, height: Int) {
    let ar = aspectRatio.isFinite && aspectRatio > 0 ? aspectRatio : 1
    let edge = max(16, longEdge)
    if ar >= 1 {
        return (edge, max(16, Int((Double(edge) / ar).rounded())))
    }
    return (max(16, Int((Double(edge) * ar).rounded())), edge)
}

/// The strokes as an alpha map.
public func rasteriseBrush(_ strokes: [BrushStroke], _ aspectRatio: Double, _ longEdge: Int = brushRasterLongEdge) -> BrushRaster {
    let size = brushRasterSize(aspectRatio, longEdge)
    let width = size.width
    let height = size.height
    var acc = [Float](repeating: 0, count: width * height)
    let ar = aspectRatio.isFinite && aspectRatio > 0 ? aspectRatio : 1
    let diagonal = hypot(ar, 1)
    // The frame in the shared centred space, so a radius can be turned into a
    // number of texels without going through `framePoint` per pixel.
    let spanX = (ar / diagonal) * 2
    let spanY = (1 / diagonal) * 2
    let w = Double(width)
    let h = Double(height)

    acc.withUnsafeMutableBufferPointer { acc in
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
            let x0 = Int(min(w, max(0, ((minU - padU) * w).rounded(.down))))
            let x1 = Int(max(-1, min(w - 1, ((maxU + padU) * w).rounded(.up))))
            let y0 = Int(min(h, max(0, ((minV - padV) * h).rounded(.down))))
            let y1 = Int(max(-1, min(h - 1, ((maxV + padV) * h).rounded(.up))))
            if x1 < x0 || y1 < y0 { continue }

            let radius = stroke.radius
            let hardness = stroke.hardness
            let erase = stroke.erase
            centred.withUnsafeBufferPointer { pts in
                var y = y0
                while y <= y1 {
                    // `framePoint`, written out: the row's y once per row.
                    let py = (((Double(y) + 0.5) / h - 0.5) * 2) / diagonal
                    var x = x0
                    while x <= x1 {
                        let px = (((Double(x) + 0.5) / w - 0.5) * 2 * ar) / diagonal
                        let c = coverageAt(pts, radius, hardness, px, py)
                        if c > 0 {
                            let i = y * width + x
                            let under = Double(acc[i])
                            acc[i] = Float(erase ? under * (1 - c) : under + (1 - under) * c)
                        }
                        x += 1
                    }
                    y += 1
                }
            }
        }
    }

    var data = [UInt8](repeating: 0, count: width * height)
    data.withUnsafeMutableBufferPointer { out in
        acc.withUnsafeBufferPointer { acc in
            for i in 0..<acc.count {
                out[i] = UInt8((min(1, max(0, Double(acc[i]))) * 255).rounded())
            }
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
