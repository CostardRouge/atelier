// How big a hook's flashed pictures are decoded — pure arithmetic. Port of
// `src/shared/roadtrip/hooks/picture-budget.ts`.
//
// A flash is drawn cover-cropped into the frame, so everything outside the
// frame's shape is decoded for nothing: a 4:3 photograph flashed into a 9:16
// reel shows a third of its width. So a picture is cropped to the frame's
// shape AT decode, and sized to what a delivered frame can show — its long
// edge 1920, what every Trips export writes — and never upscaled.
//
// Then memory. A decoded picture is four bytes a pixel for as long as the
// piece is open, and a picked sweep may hold forty: at a full 1080×1920 that
// is 330 MB, the order of what killed a tab on an iPhone. The set shares ONE
// budget instead, split evenly, so twelve pictures decode at full size and
// forty at the size a tenth of a second on screen deserves. The app's decoder
// (ImageIO's thumbnailing) takes these numbers as they are.

import Foundation

/// The long edge of a delivered frame — `longEdge` in every Trips export. The
/// web's `FRAME_LONG_EDGE`.
public let frameLongEdge = 1920.0

/// The long edge a picture drawn as a PRINT is decoded to — a card on a map
/// covers at most about a third of the frame, so half the frame's edge is
/// already more than it can show. The web's `PRINT_LONG_EDGE`.
public let printLongEdge = 1080.0

/// Pixels the whole decoded set may hold: 32 MP, about 128 MB of RGBA. The
/// web's `PICTURES_PIXEL_BUDGET`.
public let picturesPixelBudget = 32_000_000.0

public struct CoverCrop: Equatable, Sendable {
    /// The source rectangle the frame shows, centred.
    public var sx: Double
    public var sy: Double
    public var sw: Double
    public var sh: Double
    /// The size to decode that rectangle at, in whole pixels.
    public var width: Int
    public var height: Int
    public init(sx: Double, sy: Double, sw: Double, sh: Double, width: Int, height: Int) {
        self.sx = sx; self.sy = sy; self.sw = sw; self.sh = sh; self.width = width; self.height = height
    }
}

/// The pixels ONE picture of a set of `count` may take.
public func perPicturePixels(_ count: Int, budget: Double = picturesPixelBudget) -> Double {
    budget / Double(max(1, count))
}

/// A whole-pixel size, at least 1, from a value that may be huge or infinite.
private func pixelCount(_ v: Double) -> Int {
    guard v.isFinite else { return v > 0 ? Int.max / 2 : 1 }
    return Int(max(1, min(v, Double(Int.max / 2))))
}

/// The centred part of a `srcW`×`srcH` picture a frame of `aspect` (width /
/// height) shows, and the size to decode it at: no larger than a delivered
/// frame, no more than `maxPixels`, and never larger than the crop itself.
public func coverCrop(_ srcW: Double, _ srcH: Double, _ aspect: Double, _ maxPixels: Double,
                      longEdge: Double = frameLongEdge) -> CoverCrop {
    let a = aspect.isFinite && aspect > 0 ? aspect : 9.0 / 16
    let w = max(1, srcW)
    let h = max(1, srcH)
    let wider = w / h > a
    let sw = wider ? h * a : w
    let sh = wider ? h : w / a

    // The frame's own size at `longEdge`.
    let frameW = a >= 1 ? longEdge : longEdge * a
    // The width at which width × height equals the pixel cap.
    let capW = (max(1, maxPixels) * a).squareRoot()
    let width = max(1, min(sw, frameW, capW).rounded(.down))
    let height = max(1, TripJS.round(width / a))
    return CoverCrop(sx: (w - sw) / 2, sy: (h - sh) / 2, sw: sw, sh: sh,
                     width: pixelCount(width), height: pixelCount(height))
}

/// The whole picture at its own shape, for one drawn as a print: no crop, the
/// long edge no larger than `longEdge`, no more than `maxPixels`, never
/// enlarged.
public func wholeCrop(_ srcW: Double, _ srcH: Double, _ maxPixels: Double,
                      longEdge: Double = printLongEdge) -> CoverCrop {
    let w = max(1, srcW)
    let h = max(1, srcH)
    let a = w / h
    let byEdge = w >= h ? longEdge : longEdge * a
    let capW = (max(1, maxPixels) * a).squareRoot()
    let width = max(1, min(w, byEdge, capW).rounded(.down))
    let height = max(1, TripJS.round(width / a))
    return CoverCrop(sx: 0, sy: 0, sw: w, sh: h, width: pixelCount(width), height: pixelCount(height))
}
