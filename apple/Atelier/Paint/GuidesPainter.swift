// The editor-only composition guides — the grid and a platform's safe zone —
// the app-level port of `src/shared/overlay/draw-guides.ts`.
//
// Kept OUT of `OverlayPainter` on purpose, as on the web: the export burns
// in `drawOverlays` and never calls this, so nothing here reaches a file.
// The safe zone is the kernel's (`resolveSafeZone`, which may turn a
// template a quarter to span the frame; `targetFrame`), the grid's lines the
// kernel's (`OverlayGeometry.gridLines`, on half pixels).

import AtelierKit
import CoreGraphics
import Foundation

enum GuidesPainter {
    /// The active guides over the stage: the grid under, the safe zone over.
    static func drawGuides(in cg: CGContext, size: CGSize, guides: GuidesState) {
        let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
        drawGuides(c, guides: guides)
        c.finish()
    }

    static func drawGuides(_ c: PaintCanvas, guides: GuidesState) {
        let vw = c.width
        let vh = c.height
        if guides.grid.show { drawGrid(c, guides.grid.cols, guides.grid.rows, vw, vh) }
        let preset = resolveSafeZone(guides, vh > 0 ? vw / vh : 0)
        if let preset { drawSafeZone(c, preset, vw, vh) }
    }

    private static func drawGrid(_ c: PaintCanvas, _ cols: Int, _ rows: Int, _ vw: Double, _ vh: Double) {
        c.save()
        c.setStroke("rgba(255,255,255,0.4)")
        c.lineWidth = max(1, vh * 0.0015)
        c.beginPath()
        for x in OverlayGeometry.gridLines(cols, vw) {
            c.moveTo(x, 0)
            c.lineTo(x, vh)
        }
        for y in OverlayGeometry.gridLines(rows, vh) {
            c.moveTo(0, y)
            c.lineTo(vw, y)
        }
        c.stroke()
        c.restore()
    }

    private static func drawSafeZone(_ c: PaintCanvas, _ preset: SafeZonePreset, _ vw: Double, _ vh: Double) {
        let f = targetFrame(preset.aspect, vw, vh)
        c.save()

        // Dim what the platform will not show.
        if f.width < vw - 1 || f.height < vh - 1 {
            c.setFill("rgba(0,0,0,0.35)")
            if f.y > 0 {
                c.fillRect(0, 0, vw, f.y)
                c.fillRect(0, f.y + f.height, vw, vh - f.y - f.height)
            }
            if f.x > 0 {
                c.fillRect(0, 0, f.x, vh)
                c.fillRect(f.x + f.width, 0, vw - f.x - f.width, vh)
            }
        }

        // Outline the target frame.
        c.setStroke("rgba(255,255,255,0.85)")
        c.lineWidth = max(1.5, vh * 0.002)
        c.strokeRect(f.x + 0.5, f.y + 0.5, f.width - 1, f.height - 1)

        // The deadzones the platform's own interface covers, translucent.
        let fontPx = max(11, vh * 0.02)
        for r in preset.deadzones {
            let x = f.x + r.x * f.width
            let y = f.y + r.y * f.height
            let w = r.w * f.width
            let h = r.h * f.height
            c.setFill("rgba(217,68,42,0.28)")
            c.fillRect(x, y, w, h)
            c.setStroke("rgba(217,68,42,0.6)")
            c.lineWidth = max(1, vh * 0.0012)
            c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
            if let label = r.label {
                c.font = PaintFont(["ui-monospace", "monospace"], size: fontPx, weight: 600)
                c.setFill("rgba(255,255,255,0.92)")
                c.textBaseline = .top
                c.textAlign = .left
                c.fillText(label, x + fontPx * 0.35, y + fontPx * 0.3)
            }
        }
        c.restore()
    }
}
