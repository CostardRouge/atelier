// What the geometry family's passes share — the camera warp, the gain map,
// the lens, the keystone, the post-crop vignette and the clipping view.
//
// The one convention they all rest on is WHERE a pixel is. Every twin in the
// kernel (`CameraWarp.swift`, `GainMapGrid.swift`, `Keystone.swift`,
// `PostVignette.swift`) states its map in IMAGE coordinates — [0,1]², y DOWN
// from the top of the picture — while Core Image's working space runs y UP
// from the bottom of the extent. So each kernel is handed the picture's
// extent and converts both ways inside itself (`…ImageUv`, `…WorkingPoint`
// in `Kernels/*.metal`): the native twin of the web's `imageUv` rule
// (`render-geometry.md`), DERIVED here — `u = (x − x0) / w`,
// `v = 1 − (y − y0) / h` — rather than copied, since the web's flip is a
// property of WebGL texture uploads that Core Image does not have. The gate
// pins it with a marker turned 90° and an off-centre crop.

import CoreImage
import Foundation

enum GeometryPassSupport {
    /// The picture's extent as the kernels take it: `(x, y, width, height)`
    /// in working space.
    static func extentVector(_ extent: CGRect) -> CIVector {
        CIVector(x: extent.minX, y: extent.minY, z: extent.width, w: extent.height)
    }

    /// Whether a kernel can draw on this picture at all: a finite, non-empty
    /// extent. An infinite image (a solid colour) has no frame to warp.
    static func drawable(_ image: CIImage) -> Bool {
        !image.extent.isInfinite && !image.extent.isEmpty && !image.extent.isNull
    }

    /// What a WARP reads, whatever the output rect: its whole input, plus the
    /// two pixels past the edge a bilinear read at the last half pixel
    /// reaches, which the clamped input supplies — the web's CLAMP_TO_EDGE.
    /// A warp whose inverse is not cheap and exact cannot promise less.
    static func warpRegion(_ extent: CGRect) -> CGRect {
        extent.insetBy(dx: -2, dy: -2)
    }

    /// An image point (y down from the top) in working space — the Swift
    /// twin of the kernels' `…WorkingPoint`, for a region of interest.
    static func workingPoint(u: Double, v: Double, in extent: CGRect) -> CGPoint {
        CGPoint(x: Double(extent.minX) + u * Double(extent.width),
                y: Double(extent.minY) + (1 - v) * Double(extent.height))
    }

    /// A working-space point as an image point — the twin of `…ImageUv`.
    static func imagePoint(_ p: CGPoint, in extent: CGRect) -> (u: Double, v: Double) {
        ((Double(p.x) - Double(extent.minX)) / Double(extent.width),
         1 - (Double(p.y) - Double(extent.minY)) / Double(extent.height))
    }
}
