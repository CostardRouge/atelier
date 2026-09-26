// A badge painted over its picture — the web's `renderBadge`
// (`src/shared/roadtrip/badge-render.ts`), the ONE render the stage, the PNG
// deck, the rail's thumbnails and every frame of a painted clip go through.
// The preview and the export MUST be the same code at two sizes: everything
// here is a fraction of the frame, so the only difference between the two is
// the canvas they are handed.
//
// The order is the web's, and it is the product:
//
//     ground → picture (graded at SOURCE density, then framed) or the
//     collage's cells → the OPENER → the shades → the QR → the badge
//
// so an opener that owns the frame covers the picture while the shades and
// the badge still sit above whatever it drew, and the shades darken the
// picture rather than the text drawn over it.
//
// Rules kept:
// - The grader is CALLER-OWNED (`roadtrip.md`, «caller-owned grader»): a
//   grader holds packed lattices and a render context's work, and one per
//   repaint would be built and dropped on every frame of the transport. The
//   stage keeps one per grade; an export makes one per slide.
// - A picture is graded ONCE per change (`BadgeSource.picture`), never per
//   redraw — the web's `holdGrades`.
// - The badge's windows count from 0 (`originSeconds` 0): a badge has no clip
//   to be trimmed against.
// - A still has no clock: a surface that draws a slide SETTLED hands no
//   motion clock and draws the rest; the collage's cells then never leave.
// - An editor-only ghost (`ghostId`) is never set by an export.
//
// A renderer holds the overlay painter's grain state across frames, so one
// renderer belongs to one consumer (the stage, one export) — never shared
// across threads.

import AtelierKit
import CoreGraphics
import Foundation

/// One cell of a collage, ready to paint — the web's `CollageItem`.
struct CollageItem {
    var source: BadgeSource?
    var framing: Framing
    /// How this cell's picture moves — read only under a clock.
    var motion: FramingMotion?
    /// This cell's own cube, as a grader the CALLER owns.
    var grader: FrameGrader?
    /// What the grader's passes are, so the graded cell is held across redraws.
    var gradeKey: String?

    init(source: BadgeSource?, framing: Framing, motion: FramingMotion? = nil, grader: FrameGrader? = nil,
         gradeKey: String? = nil) {
        self.source = source; self.framing = framing; self.motion = motion; self.grader = grader
        self.gradeKey = gradeKey
    }
}

/// Several pictures in the frame instead of one — the web's `CollageRender`.
struct CollageRender {
    var collage: SlideCollage
    /// Cell by cell, the lead first; a short list leaves the rest empty.
    var items: [CollageItem]
    /// The slide's screen time, what the cells' exit is laid against; nil (a
    /// still, a surface with no clock) and the cells never leave.
    var seconds: Double?
    /// The clock the cells' pictures MOVE on; nil draws every cell at rest.
    var clock: MotionClock?

    init(collage: SlideCollage, items: [CollageItem], seconds: Double? = nil, clock: MotionClock? = nil) {
        self.collage = collage; self.items = items; self.seconds = seconds; self.clock = clock
    }
}

/// Everything one badge frame is made of — the web's `RenderBadgeOptions`.
struct BadgeRenderOptions {
    var source: BadgeSource?
    var elements: [OverlayElement]
    var theme: StyleTheme?
    /// Where the badge's animations are up to, in seconds from the first frame.
    var timeSeconds: Double = 0
    /// Painted where no picture covers the frame.
    var background: String?
    /// Darkening over the picture, under the badge.
    var shades: [Shade]?
    /// The badge block's extent, for a shade that follows the hook.
    var block: HookBlock?
    /// The piece's prepared OPENER, painted between the picture and the shades.
    var hook: ResolvedHook?
    /// The badge's elements AT a moment, for an opener that rewrites its words;
    /// wins over `elements` for the paint and the measure alike.
    var elementsAt: ElementsAt?
    /// A QR square, drawn under the text — the closing card's hero.
    var qr: QrDraw?
    /// The grade, as a grader the caller owns, and the key its passes stand for.
    var grader: FrameGrader?
    var gradeKey: String?
    /// How the picture sits in the frame; nil is the centred cover.
    var framing: Framing?
    /// The picture's motion and the slide's clock, for a surface that shows it moving.
    var motion: MotionClock?
    /// Several pictures instead of `source` + `framing` + `grader`.
    var collage: CollageRender?
    /// EDITOR ONLY: the selected element, drawn ghosted outside its window.
    var ghostId: String?

    init(source: BadgeSource? = nil, elements: [OverlayElement] = [], theme: StyleTheme? = nil) {
        self.source = source
        self.elements = elements
        self.theme = theme
    }

    /// The elements a paint or a measure uses — rewritten at the clock when an opener says so.
    var elementsNow: [OverlayElement] {
        elementsAt.map { $0(timeSeconds) } ?? elements
    }

    /// The overlay engine's options for a badge, shared by the paint and the measure.
    var overlayOptions: OverlayDrawOptions {
        OverlayDrawOptions(originSeconds: 0, ghostId: ghostId)
    }
}

final class BadgeRenderer {
    /// The suite's frame black — what shows where no picture covers the frame.
    static let ground = "#100f0d"

    /// The overlay painter this renderer's frames share (it holds the glow's
    /// grain state across frames).
    let overlays: OverlayPainter

    init(overlays: OverlayPainter = OverlayPainter()) {
        self.overlays = overlays
    }

    // MARK: - painting

    /// One badge frame onto `c`, at whatever size the canvas is.
    func render(_ c: PaintCanvas, _ o: BadgeRenderOptions) {
        let w = c.width
        let h = c.height
        guard w > 0, h > 0 else { return }
        c.clearRect(0, 0, w, h)
        c.save()
        c.setFill(o.background ?? BadgeRenderer.ground)
        c.fillRect(0, 0, w, h)
        c.restore()

        if let collage = o.collage {
            paintCollage(c, w, h, collage, o.timeSeconds)
        } else if let source = o.source, source.width > 0, source.height > 0,
                  let picture = source.picture(grader: o.grader, gradeKey: o.gradeKey) {
            // Graded at the source's own density, THEN framed.
            let framing = framingOnClock(o.framing ?? .default, o.motion, o.timeSeconds)
            CellPainter.drawFramed(c, picture, w, h, framing)
        }

        if let hook = o.hook { HookPaint.paint(hook, c, o.timeSeconds) }
        if let shades = o.shades, !shades.isEmpty { ShadePainter.paintShades(c, w, h, shades, o.block) }
        if let qr = o.qr { QRPainter.drawQr(c, w, h, qr) }
        overlays.drawOverlays(c, elements: o.elementsNow, cue: nil, time: o.timeSeconds, theme: o.theme,
                              options: o.overlayOptions)
    }

    /// The same into a context whose user space is the `size` frame, y down —
    /// a SwiftUI `Canvas`'s own space, or an `OverlayRaster` bitmap.
    func render(in cg: CGContext, size: CGSize, _ o: BadgeRenderOptions) {
        let c = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
        render(c, o)
        c.finish()
    }

    /// The frame as an image of `width`×`height` pixels — a still, a thumbnail,
    /// one frame of a painted clip.
    func image(width: Int, height: Int, _ o: BadgeRenderOptions) -> CGImage? {
        OverlayRaster.image(width: width, height: height) { cg, size in
            self.render(in: cg, size: size, o)
        }
    }

    /// The hit boxes of the badge's elements, measured exactly as the paint
    /// lays them out — so a tap on the stage lands on what the eye sees.
    func measure(size: CGSize, _ o: BadgeRenderOptions) -> [OverlayGeometry.ElementBox] {
        overlays.measureOverlays(size: size, elements: o.elementsNow, cue: nil, time: o.timeSeconds, theme: o.theme,
                                 options: o.overlayOptions)
    }

    // MARK: - the collage

    /// A collage's cells over its background — the picture step when a slide
    /// holds several. Each cell graded at its source's density, then framed;
    /// the cells' entrances and exits read at the badge's own clock.
    private func paintCollage(_ c: PaintCanvas, _ w: Double, _ h: Double, _ render: CollageRender, _ t: Double) {
        c.save()
        c.setFill(render.collage.background)
        c.fillRect(0, 0, w, h)
        c.restore()
        let cells = resolveCollage(render.collage, w, h)
        let motions = collageCellMotions(render.collage, cells, AtelierKit.Size(width: w, height: h), t, render.seconds)
        let pictures: [PaintPicture?] = cells.indices.map { i in
            guard i < render.items.count, let source = render.items[i].source, source.width > 0, source.height > 0
            else { return nil }
            return source.picture(grader: render.items[i].grader, gradeKey: render.items[i].gradeKey)
        }
        let items = render.items
        let clock = render.clock
        var motionAt: ((Int) -> CellMotion?)? = nil
        if let list = motions {
            motionAt = { i in i < list.count ? list[i] : nil }
        }
        let options = CellPainter.LayoutOptions(
            picture: { i in i < pictures.count ? pictures[i] : nil },
            framing: { i in
                guard i < items.count else { return .default }
                let item = items[i]
                // A cell's picture moves only where this surface shows motion.
                guard let clock else { return item.framing }
                return framingAt(item.framing, item.motion, t, clock.seconds, clock.openerSeconds ?? 0)
            },
            spacing: render.collage.spacing,
            motion: motionAt
        )
        CellPainter.drawLayout(c, frameW: w, frameH: h, cells: cells, options)
    }
}
