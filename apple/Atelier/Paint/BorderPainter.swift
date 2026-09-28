// A picture AS DELIVERED — its border's fill, then the framed crop in its
// rectangle — the app-level port of `src/shared/develop/border-paint.ts`. One
// painter for every place that shows it (the export, the filmstrip cell, the
// viewport, the Crop tab's preview), or they would disagree about where the
// crop sits on its canvas.
//
// The layout is the kernel's (`borderLayout`, `blurFillLayout`); this only
// paints it. The blur fill is made from a copy `borderBlurEdge` pixels on its
// long side, whatever the output — box-blurred there by the kernel's own
// `boxBlurRGBA` (three passes of radius 2), darkened by black at 0.18 — so
// the preview and the file blur the SAME picture.

import AtelierKit
import CoreGraphics
import Foundation

enum BorderPainter {
    /// The framed crop in its rectangle, clipped to it — a cover framing
    /// draws the whole picture otherwise.
    static func drawPictureIn(_ c: PaintCanvas, _ picture: PaintPicture, _ framing: Framing, _ layout: BorderLayout) {
        c.save()
        c.beginPath()
        c.rect(layout.x, layout.y, layout.pw, layout.ph)
        c.clip()
        c.translate(layout.x, layout.y)
        CellPainter.drawFramed(c, picture, layout.pw, layout.ph, framing)
        c.restore()
    }

    /// The crop, blurred on a tiny copy and scaled to cover the whole canvas.
    private static func drawBlurFill(_ c: PaintCanvas, _ picture: PaintPicture, _ framing: Framing, _ layout: BorderLayout) {
        let fill = blurFillLayout(layout)
        guard let small = blurredCopy(picture, framing, fill.sw, fill.sh) else { return }
        c.save()
        c.imageSmoothing = .high
        c.drawImage(small, fill.x, fill.y, fill.w, fill.h)
        c.setFill("rgba(0,0,0,\(borderBlurDarken))")
        c.fillRect(0, 0, layout.w, layout.h)
        c.restore()
    }

    /// The crop drawn into an `sw`×`sh` copy and box-blurred there, as the
    /// web's `getImageData` → `boxBlurRGBA` → `putImageData` does. The copy
    /// is opaque (a cover crop, or black bars), so its premultiplied bytes
    /// are the web's straight ones.
    static func blurredCopy(_ picture: PaintPicture, _ framing: Framing, _ sw: Int, _ sh: Int) -> CGImage? {
        guard let ctx = OverlayRaster.makeContext(width: sw, height: sh) else { return nil }
        let s = PaintCanvas(ctx, width: Double(sw), height: Double(sh))
        s.imageSmoothing = .high
        CellPainter.drawFramed(s, picture, Double(sw), Double(sh), framing)
        s.finish()
        if let raw = ctx.data {
            let rowBytes = ctx.bytesPerRow
            let bytes = raw.assumingMemoryBound(to: UInt8.self)
            var pixels = [UInt8](repeating: 0, count: sw * sh * 4)
            for row in 0..<sh {
                for i in 0..<(sw * 4) { pixels[row * sw * 4 + i] = bytes[row * rowBytes + i] }
            }
            boxBlurRGBA(&pixels, sw, sh, borderBlurRadius)
            for row in 0..<sh {
                for i in 0..<(sw * 4) { bytes[row * rowBytes + i] = pixels[row * sw * 4 + i] }
            }
        }
        return ctx.makeImage()
    }

    /// The whole delivered canvas at `layout` (in the canvas's pixels): the
    /// border's fill when there is one, then the crop. With no border the
    /// layout is the crop itself and this is `drawFramed`.
    static func drawDelivered(_ c: PaintCanvas, _ picture: PaintPicture, _ framing: Framing, _ layout: BorderLayout,
                              border: RollBorder?) {
        if let border {
            if border.isBlur {
                drawBlurFill(c, picture, framing, layout)
            } else {
                c.save()
                c.setFill(border.fill)
                c.fillRect(0, 0, layout.w, layout.h)
                c.restore()
            }
        }
        drawPictureIn(c, picture, framing, layout)
    }

    /// `drawDelivered` into a context whose user space is the delivered
    /// canvas (`layout.w`×`layout.h`), y down.
    static func drawDelivered(in cg: CGContext, _ picture: PaintPicture, _ framing: Framing, _ layout: BorderLayout,
                              border: RollBorder?) {
        let c = PaintCanvas(cg, width: layout.w, height: layout.h)
        drawDelivered(c, picture, framing, layout, border: border)
        c.finish()
    }
}
