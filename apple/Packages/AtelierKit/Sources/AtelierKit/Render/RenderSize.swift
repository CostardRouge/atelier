// How big a picture the GPU can take, and how to bring one within it. Port of
// `src/shared/render/render-size.ts`.
//
// A texture and a framebuffer both stop at a maximum edge (8192 on older
// mobile GPUs, 16384 on most desktops), and a picture past it does not fail
// loudly: the upload is refused, the texture stays incomplete, and an
// incomplete texture samples BLACK — a 61-megapixel still delivered on an
// 8192 GPU was a black JPEG with every gate green. This is the pure
// arithmetic; the CAP is a parameter the app asks its device for (the web's
// `maxRenderSize` probe), so "grade at source density" means at the source's
// density or the GPU's cap, whichever is smaller — and a delivery says when it
// was the cap.

import Foundation

public struct RenderSize: Equatable, Sendable {
    public var width: Int
    public var height: Int

    public init(width: Int, height: Int) {
        self.width = width; self.height = height
    }
}

/// `Math.floor`, never below zero, for a pixel count.
private func whole(_ v: Double) -> Int {
    guard v.isFinite, v > 0 else { return 0 }
    return Int(v.rounded(.down))
}

/// The size at which `width`×`height` fits the GPU's cap: unchanged when it
/// already does, else scaled DOWN so the longer edge is exactly the cap, the
/// aspect kept and never upscaled. A non-finite or non-positive cap means no
/// limit (no GPU to fit, so nothing to resample for).
public func fitRenderSize(_ width: Double, _ height: Double, _ cap: Double) -> RenderSize {
    let w = whole(width)
    let h = whole(height)
    if !cap.isFinite || cap <= 0 { return RenderSize(width: w, height: h) }
    let long = Double(max(w, h))
    if long <= cap { return RenderSize(width: w, height: h) }
    let scale = cap / long
    // `Math.round` on a non-negative value is the schoolbook rounding.
    let fittedW = max(1, min(cap, (Double(w) * scale).rounded()))
    let fittedH = max(1, min(cap, (Double(h) * scale).rounded()))
    return RenderSize(width: Int(fittedW), height: Int(fittedH))
}

/// True when a picture of this size needs resampling before the GPU can take it.
public func exceedsRenderSize(_ width: Double, _ height: Double, _ cap: Double) -> Bool {
    let fitted = fitRenderSize(width, height, cap)
    let floorW = width.isFinite ? Int(width.rounded(.down)) : -1
    let floorH = height.isFinite ? Int(height.rounded(.down)) : -1
    return fitted.width != floorW || fitted.height != floorH
}
