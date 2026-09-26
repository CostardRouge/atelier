// Overlays as an IMAGE — the one entry point for a Core Image pipeline: the
// video export's per-frame processor (`Video/VideoExport.swift`'s
// `FrameProcessor`) and a stage that composites in Core Image both call it,
// so the burn-in is the stage's drawing at the export's size — the same code
// at two sizes, as the web's `drawOverlays` is for the preview canvas and
// the export's.
//
// A raster is an sRGB, premultiplied 8-bit RGBA bitmap of the frame's size,
// cleared to transparent, whose user space is FLIPPED to the frame's y-down
// (what every painter under `Paint/` draws in). Its codes are sRGB-encoded,
// as the web's canvas is, and the app's render context keeps colour
// management off (`docs/memory/native-app.md`), so an overlay pixel lands on
// a frame as the web's does: source-over in encoded space.

import AtelierKit
import CoreGraphics
import CoreImage
import Foundation

enum OverlayRaster {
    private static let sRGB = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()

    /// A transparent `width`×`height` bitmap whose user space is the frame,
    /// y DOWN, origin at the top-left. Nil for an empty or absurd size.
    static func makeContext(width: Int, height: Int) -> CGContext? {
        guard width > 0, height > 0, width <= 16384, height <= 16384 else { return nil }
        guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                  bytesPerRow: width * 4, space: sRGB,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.clear(CGRect(x: 0, y: 0, width: width, height: height))
        ctx.translateBy(x: 0, y: CGFloat(height))
        ctx.scaleBy(x: 1, y: -1)
        return ctx
    }

    /// An opaque-or-not image from straight RGBA bytes, row 0 at the top.
    static func image(rgba: [UInt8], width: Int, height: Int) -> CGImage? {
        guard width > 0, height > 0, rgba.count == width * height * 4,
              let provider = CGDataProvider(data: Data(rgba) as CFData) else { return nil }
        return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                       space: sRGB, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
                       provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    }

    /// Whatever `draw` paints into a transparent frame-sized raster, as an
    /// image; `draw` receives the y-down context and the frame's size.
    static func image(width: Int, height: Int, _ draw: (CGContext, CGSize) -> Void) -> CGImage? {
        guard let ctx = makeContext(width: width, height: height) else { return nil }
        draw(ctx, CGSize(width: width, height: height))
        return ctx.makeImage()
    }

    /// The same, for Core Image: an image whose extent is `(0, 0, width,
    /// height)` with the frame's top row at the top.
    static func ciImage(width: Int, height: Int, _ draw: (CGContext, CGSize) -> Void) -> CIImage? {
        image(width: width, height: height, draw).map { CIImage(cgImage: $0) }
    }

    /// `overlay` over `frame`, source-over, moved onto the frame's extent and
    /// cropped to it — the burn-in.
    static func composite(_ overlay: CIImage, over frame: CIImage) -> CIImage {
        let e = frame.extent
        let placed = overlay.transformed(by: CGAffineTransform(translationX: e.minX - overlay.extent.minX,
                                                                y: e.minY - overlay.extent.minY))
        return placed.composited(over: frame).cropped(to: e)
    }
}

extension OverlayPainter {
    /// The overlays at `time` as a frame-sized image for Core Image — the
    /// export's per-frame burn-in, and a stage that composites in Core Image.
    /// `width`×`height` are the FRAME's pixels: the layout scales with them.
    func overlayImage(width: Int, height: Int, elements: [OverlayElement], cue: Cue?, time: Double,
                      theme: StyleTheme?, options: OverlayDrawOptions = OverlayDrawOptions()) -> CIImage? {
        OverlayRaster.ciImage(width: width, height: height) { ctx, size in
            self.drawOverlays(in: ctx, size: size, elements: elements, cue: cue, time: time, theme: theme, options: options)
        }
    }

    /// `frame` with the overlays at `time` burned in, at the frame's own size
    /// — what a `FrameProcessor`'s `draw` returns. Nothing to draw leaves the
    /// frame as it came.
    func burnIn(_ frame: CIImage, elements: [OverlayElement], cue: Cue?, time: Double,
                theme: StyleTheme?, options: OverlayDrawOptions = OverlayDrawOptions()) -> CIImage {
        let e = frame.extent
        guard !elements.isEmpty, e.width.isFinite, e.height.isFinite else { return frame }
        let w = Int(e.width.rounded())
        let h = Int(e.height.rounded())
        guard let overlay = overlayImage(width: w, height: h, elements: elements, cue: cue, time: time,
                                         theme: theme, options: options) else { return frame }
        return OverlayRaster.composite(overlay, over: frame)
    }
}
