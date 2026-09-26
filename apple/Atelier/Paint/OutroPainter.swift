// The closing card painted — the drawing half of
// `src/shared/overlay/outro-card.ts` (`prepareOutro().draw`); the model, the
// seeding and the QR's resolution are the kernel's (`Overlay/OutroCard.swift`,
// `prepareOutro`), resolved ONCE and painted at any size and any moment.
//
// The ground, then the card's elements with NO cue and NO theme — the card
// states nothing measured, and its ink is its own — at the card's own clock
// (windows count from its first frame), then the QR over everything.

import AtelierKit
import CoreGraphics
import Foundation

enum OutroPainter {
    /// The whole card at `tSeconds` into its own life, on `c`'s frame.
    static func draw(_ prepared: PreparedOutro, _ c: PaintCanvas, tSeconds: Double, painter: OverlayPainter) {
        let w = c.width
        let h = c.height
        c.save()
        c.setFill(prepared.card.background)
        c.fillRect(0, 0, w, h)
        c.restore()
        painter.drawOverlays(c, elements: prepared.card.elements, cue: nil, time: tSeconds, theme: nil,
                             options: OverlayDrawOptions(originSeconds: 0))
        if let qr = prepared.qr { QRPainter.drawQr(c, w, h, qr) }
    }

    /// The card into a context whose user space is the `size` frame, y down —
    /// the panel's preview and each export variant's tail frames alike.
    static func draw(_ prepared: PreparedOutro, in cg: CGContext, size: CGSize, tSeconds: Double, painter: OverlayPainter) {
        let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
        draw(prepared, c, tSeconds: tSeconds, painter: painter)
        c.finish()
    }

    /// One tail frame of the card as an image for Core Image, `width`×`height`
    /// pixels — what the export appends after the footage.
    static func image(_ prepared: PreparedOutro, width: Int, height: Int, tSeconds: Double,
                      painter: OverlayPainter) -> CGImage? {
        OverlayRaster.image(width: width, height: height) { ctx, size in
            draw(prepared, in: ctx, size: size, tSeconds: tSeconds, painter: painter)
        }
    }
}
