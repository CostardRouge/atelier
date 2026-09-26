// A QR code painted onto a frame — the app-level port of
// `src/shared/overlay/draw-qr.ts`. The encoder is the kernel's
// (`Lib/QR.swift`, `encodeQr`), the placement too
// (`OverlayGeometry.qrPlacement`): this is only the paint.
//
// Every module is a WHOLE number of pixels — a module 7.4 px wide lands on
// half pixels, its edges antialias grey, and a scanner reading a photograph
// of the result has to guess — and the four-module quiet zone is drawn, the
// single most common way a code fails in the wild being a code printed
// against a dark photograph without one.

import AtelierKit
import CoreGraphics
import Foundation

enum QRPainter {
    static func drawQr(_ c: PaintCanvas, _ w: Double, _ h: Double, _ qr: QrDraw) {
        let place = OverlayGeometry.qrPlacement(w, h, qr)
        let quiet = OverlayGeometry.qrQuietModules
        let size = qr.matrix.size
        c.save()
        c.setFill(qr.light)
        c.fillRect(place.left, place.top, place.drawn, place.drawn)
        c.setFill(qr.dark)
        for row in 0..<size {
            for col in 0..<size where qr.matrix.modules[row * size + col] {
                c.fillRect(place.left + Double(col + quiet) * place.module,
                           place.top + Double(row + quiet) * place.module,
                           place.module, place.module)
            }
        }
        c.restore()
    }

    /// `drawQr` into a context whose user space is the `size` frame, y down.
    static func drawQr(in cg: CGContext, size: CGSize, _ qr: QrDraw) {
        let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
        drawQr(c, c.width, c.height, qr)
        c.finish()
    }
}
