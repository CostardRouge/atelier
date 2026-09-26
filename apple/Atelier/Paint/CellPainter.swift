// Pictures painted into frames and cells — the app-level port of
// `src/shared/media/cell-paint.ts` and of `framing.ts`'s `drawFramed`, on
// `PaintCanvas`.
//
// Everything draws THROUGH `drawFramed`, so a cell honours the same `Framing`
// (pan, zoom, rotation, flips, fill or whole) a full-frame picture does — at
// the cell's size, which makes the pan a fraction of the CELL's long edge.
// The transform is the kernel's `framingTransform`, applied in the frame's
// y-down space exactly as the web applies it to a canvas; a `contain` framing
// paints its bars black, never leaves whatever the context held.
//
// An empty cell draws NOTHING — not a slot, not a stand-in: an export of a
// half-filled collage shows the background where a picture is missing, and
// the editor draws its own placeholder over that. A shadow sits under a
// mount (a print's paper, a tile), never under the picture drawn after it.

import AtelierKit
import CoreGraphics
import Foundation

/// A decoded picture and its natural size — the web's `LayoutPicture`. The
/// size is what the framing is computed on; the bitmap is scaled into it.
struct PaintPicture {
    let image: CGImage
    let width: Double
    let height: Double

    init(_ image: CGImage, width: Double? = nil, height: Double? = nil) {
        self.image = image
        self.width = width ?? Double(image.width)
        self.height = height ?? Double(image.height)
    }
}

/// Where cell `i` is in its entrance or exit — the overlay engine's own
/// transform plus how it is applied to a picture. The web's `CellMotion`.
struct CellMotion {
    var transform: OverlayTransform
    /// The edge a reveal grows from; `right` when unsaid (a left→right wipe).
    var direction: AnimDirection?
    /// Move the picture inside the mask rather than the cell.
    var inside: Bool = false
}

enum CellPainter {
    /// The paper a tile is mounted on, and the ink of a caption on it.
    static let tilePaper = "#f4efe4"
    static let tilePaperInk = "#1c1a17"
    /// The suite's face with its fallbacks: a glyph must survive a stack we
    /// do not control.
    static let tileLabelFamilies = ["Space Grotesk", "Helvetica Neue", "Arial", "sans-serif"]

    enum TileFrame { case paper, bare }

    /// The paper mount a print sits on: border and radius as fractions of the
    /// frame's short side.
    private static let printBorder = 0.02
    private static let printRadius = 0.004

    // MARK: - one picture in a frame

    /// The web's `drawFramed`: `picture` into a `dstW`×`dstH` box at the
    /// current origin under `framing` — the mirror innermost, then the pan,
    /// then the rotation about the box's centre.
    static func drawFramed(_ c: PaintCanvas, _ picture: PaintPicture, _ dstW: Double, _ dstH: Double,
                           _ framing: Framing = .default) {
        let srcW = picture.width
        let srcH = picture.height
        guard srcW > 0, srcH > 0, dstW > 0, dstH > 0 else { return }
        let t = framingTransform(srcW, srcH, dstW, dstH, framing)
        c.save()
        if framing.fit == .contain {
            c.setFill("#000000")
            c.fillRect(0, 0, dstW, dstH)
        }
        c.translate(dstW / 2, dstH / 2)
        c.rotate(t.angle)
        c.translate(t.panX, t.panY)
        c.scale(t.scale * t.mirrorX, t.scale * t.mirrorY)
        c.drawImage(picture.image, -srcW / 2, -srcH / 2, srcW, srcH)
        c.restore()
    }

    /// `drawFramed` into a context whose user space is the `size` box, y down.
    static func drawFramed(in cg: CGContext, size: CGSize, _ picture: PaintPicture, _ framing: Framing = .default) {
        let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
        drawFramed(c, picture, c.width, c.height, framing)
        c.finish()
    }

    // MARK: - shapes

    /// The web's `roundedRect`: quadratic corners, the radius clamped to half
    /// the shorter side.
    static func roundedRect(_ c: PaintCanvas, _ x: Double, _ y: Double, _ w: Double, _ h: Double, _ r: Double) {
        let rr = max(0, min(r, w / 2, h / 2))
        c.beginPath()
        c.moveTo(x + rr, y)
        c.lineTo(x + w - rr, y)
        c.quadraticCurveTo(x + w, y, x + w, y + rr)
        c.lineTo(x + w, y + h - rr)
        c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
        c.lineTo(x + rr, y + h)
        c.quadraticCurveTo(x, y + h, x, y + h - rr)
        c.lineTo(x, y + rr)
        c.quadraticCurveTo(x, y, x + rr, y)
        c.closePath()
    }

    // MARK: - a tile

    /// One picture in a box, cover-cropped, on paper or bare; a caption sits
    /// in the paper below it. `u` is the frame's unit (a 1080-wide frame's
    /// pixel), so the tile draws the same at every size.
    static func tile(_ c: PaintCanvas, _ picture: PaintPicture, _ x: Double, _ y: Double, _ w: Double, _ h: Double,
                     frame: TileFrame, u: Double, caption: String = "") {
        let paper = frame == .paper
        let border = paper ? max(3 * u, min(w, h) * 0.045) : 0
        let captionH = paper && !caption.isEmpty ? max(18 * u, h * 0.16) : 0
        let radius = 5 * u
        c.save()
        // A shadow under the tile, not under everything drawn after it.
        c.setShadow(color: "rgba(0,0,0,0.45)", blur: 10 * u, offsetY: 3 * u)
        if paper {
            c.setFill(tilePaper)
            roundedRect(c, x, y, w, h + captionH, radius)
            c.fill()
        }
        c.restore()

        let px = x + border
        let py = y + border
        let pw = max(1, w - border * 2)
        let ph = max(1, h - border * 2)
        c.save()
        c.beginPath()
        if paper { c.rect(px, py, pw, ph) } else { roundedRect(c, px, py, pw, ph, radius) }
        c.clip()
        c.translate(px, py)
        drawFramed(c, picture, pw, ph)
        c.restore()

        if !paper {
            c.save()
            c.setStroke("rgba(255,255,255,0.85)")
            c.lineWidth = 2 * u
            roundedRect(c, px, py, pw, ph, radius)
            c.stroke()
            c.restore()
        }

        if captionH > 0 {
            c.save()
            c.setFill(tilePaperInk)
            c.font = PaintFont(tileLabelFamilies, size: min(captionH * 0.52, 30 * u), weight: 600)
            c.textAlign = .center
            c.textBaseline = .middle
            c.fillText(caption, x + w / 2, y + h + captionH / 2 - border / 2, maxWidth: w - border * 2)
            c.restore()
        }
    }

    // MARK: - a layout

    /// What `drawLayout` asks of its caller, per cell index.
    struct LayoutOptions {
        /// The picture for cell `i`, or nil for an empty cell (which draws nothing).
        var picture: (Int) -> PaintPicture?
        /// How cell `i`'s picture sits in it.
        var framing: (Int) -> Framing
        var spacing: LayoutSpacing
        /// Cell `i`'s motion at this moment; nil paints every cell at rest.
        var motion: ((Int) -> CellMotion?)? = nil
    }

    /// Every cell of a resolved layout into a `frameW`×`frameH` frame whose
    /// background the caller already painted. Radii and mounts scale with the
    /// short side, so the stage and the export draw the same collage.
    static func drawLayout(_ c: PaintCanvas, frameW: Double, frameH: Double, cells: [CellRect], _ opts: LayoutOptions) {
        let short = min(frameW, frameH)
        for (i, cell) in cells.enumerated() {
            guard let picture = opts.picture(i), picture.width > 0, picture.height > 0 else { continue }
            if cell.width <= 0 || cell.height <= 0 { continue }
            let motion: CellMotion? = opts.motion?(i)
            drawCell(c, short: short, cell, picture, opts.framing(i), opts.spacing, motion: motion)
        }
    }

    /// `drawLayout` into a context whose user space is the frame, y down.
    static func drawLayout(in cg: CGContext, size: CGSize, cells: [CellRect], _ opts: LayoutOptions) {
        let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
        drawLayout(c, frameW: c.width, frameH: c.height, cells: cells, opts)
        c.finish()
    }

    /// Clip to the revealed share of a box, growing from `direction`'s far edge.
    private static func clipReveal(_ c: PaintCanvas, _ x: Double, _ y: Double, _ w: Double, _ h: Double,
                                   _ reveal: Double, _ direction: AnimDirection?) {
        let r = max(0, min(1, reveal))
        c.beginPath()
        switch direction {
        case .left: c.rect(x + w * (1 - r), y, w * r, h)
        case .down: c.rect(x, y, w, h * r)
        case .up: c.rect(x, y + h * (1 - r), w, h * r)
        default: c.rect(x, y, w * r, h)
        }
        c.clip()
    }

    /// One cell: its mount, its clip, its picture — about the cell's centre
    /// so a print can turn. A motion applies the overlay engine's transform
    /// (alpha, an offset in short-side fractions, a scale about the centre, a
    /// reveal) to the whole cell or, `inside`, to the picture behind its mask.
    static func drawCell(_ c: PaintCanvas, short: Double, _ cell: CellRect, _ picture: PaintPicture, _ framing: Framing,
                         _ spacing: LayoutSpacing, motion: CellMotion? = nil) {
        let tr = motion?.transform
        if let tr, tr.alpha <= 0.001 || tr.reveal <= 0 { return }
        let isPrint = cell.mount == .print
        let radius = isPrint ? printRadius * short : spacing.radius * short
        let border = isPrint ? printBorder * short : 0
        let inside = (motion?.inside ?? false) && tr != nil
        let w = cell.width
        let h = cell.height
        c.save()
        if let tr, tr.alpha < 1 { c.globalAlpha = c.globalAlpha * tr.alpha }
        c.translate(cell.x + w / 2, cell.y + h / 2)
        if cell.rotation != 0 { c.rotate(cell.rotation * Double.pi / 180) }
        if let tr, tr.reveal < 1 {
            clipReveal(c, -w / 2 - border, -h / 2 - border, w + 2 * border, h + border * 3.4, tr.reveal, motion?.direction)
        }
        if let tr, !inside {
            c.translate(tr.dx * short, tr.dy * short)
            if tr.scale != 1 { c.scale(tr.scale, tr.scale) }
        }

        if isPrint {
            // A print's paper, deeper at the foot the way a real one is, its
            // shadow under the paper alone.
            c.save()
            c.setShadow(color: "rgba(20,14,8,0.42)", blur: short * 0.035, offsetY: short * 0.012)
            c.setFill(tilePaper)
            roundedRect(c, -w / 2 - border, -h / 2 - border, w + 2 * border, h + border * 3.4, short * 0.006)
            c.fill()
            c.restore()
        }

        c.save()
        roundedRect(c, -w / 2, -h / 2, w, h, radius)
        c.clip()
        if let tr, inside {
            // Behind the mask the offset is read against the CELL, and a zoom
            // only settles from larger — a picture smaller than its mask
            // would show the ground.
            let long = max(w, h)
            c.translate(tr.dx * long, tr.dy * long)
            let s = tr.scale < 1 ? 1 + (1 - tr.scale) : tr.scale
            if s != 1 { c.scale(s, s) }
        }
        c.translate(-w / 2, -h / 2)
        drawFramed(c, picture, w, h, framing)
        c.restore()

        if cell.mount == .stroke {
            c.save()
            c.lineWidth = short * 0.009
            c.setStroke("rgba(251,248,241,0.95)")
            c.setShadow(color: "rgba(0,0,0,0.3)", blur: short * 0.02)
            roundedRect(c, -w / 2, -h / 2, w, h, radius)
            c.stroke()
            c.restore()
        }
        c.restore()
    }
}
