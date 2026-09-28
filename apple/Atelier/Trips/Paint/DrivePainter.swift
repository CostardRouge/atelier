// «Virée» painted — the strokes of `src/shared/roadtrip/hooks/drive-paint.ts`
// over the kernel's `DriveFrame` (`Roadtrip/Hooks/DrivePaint.swift`), a
// READING of `DrivePlan.at(t)`: the same reading the score is written from,
// so a tick lands on the frame its stop appears in.
//
// The variant OWNS the frame: on paper it covers the piece's picture with a
// map of its own, on the picture ground it draws only the road, the stops
// and the car. When the car has arrived the map can fade away and leave the
// piece's own picture: the web paints the map whole into a buffer and lays it
// over at a falling alpha; here the frame is painted in ONE transparency
// layer composited at `DriveFrame.alpha` — the same picture, one composite,
// not a hundred alphas.
//
// The car is the kernel's (`Mesh3D.paintSteps`, `groundShadow`): faces
// ordered, lit and coloured there, filled then stroked here with round joins
// (the ink on the parts that ask, a hairline of the face's own colour on the
// rest, which closes the seams adjacent fills leave), its soft shadow three
// stacked ellipses. No shadow blur anywhere: shadows are stacked fills.

import AtelierKit
import CoreGraphics
import Foundation

enum DrivePainter {
    static func paint(_ c: PaintCanvas, _ drawing: DriveDrawing, _ t: Double, _ frame: FrameBox) {
        guard let f = drawing.frame(at: t, frame, measure: HookPaint.labelWidth) else { return }
        let layered = f.alpha < 1
        if layered {
            c.cg.saveGState()
            c.cg.setAlpha(CGFloat(max(0, f.alpha)))
            c.cg.beginTransparencyLayer(auxiliaryInfo: nil)
        }
        paintMap(c, f, drawing.pictures, frame)
        if layered {
            c.cg.endTransparencyLayer()
            c.cg.restoreGState()
        }
    }

    private static func paintMap(_ c: PaintCanvas, _ f: DriveFrame, _ pictures: [String: HookPicture]?, _ frame: FrameBox) {
        let w = frame.width
        let h = frame.height
        c.save()
        c.lineCap = .round
        c.lineJoin = .round

        if let paper = f.paper {
            HookPaint.fill(c, paper)
            c.fillRect(0, 0, w, h)
        }
        fullFrame(c, f.backdrop, pictures, w, h)

        if let graticule = f.graticule {
            HookPaint.stroke(c, graticule.ink, width: graticule.width)
            c.beginPath()
            for x in graticule.xs {
                c.moveTo(x, 0)
                c.lineTo(x, h)
            }
            for y in graticule.ys {
                c.moveTo(0, y)
                c.lineTo(w, y)
            }
            c.stroke()
        }

        if let vignette = f.vignette { paintVignette(c, vignette, w, h) }

        if let road = f.road { polyline(c, road) }
        for line in f.trail { polyline(c, line) }

        for dot in f.dots {
            HookPaint.disc(c, center: dot.halo.center, radius: dot.halo.radius, dot.halo.ink)
            HookPaint.disc(c, center: dot.fill.center, radius: dot.fill.radius, dot.fill.ink)
            HookPaint.stroke(c, dot.stroke, width: dot.strokeWidth)
            c.beginPath()
            c.arc(dot.fill.center.x, dot.fill.center.y, dot.fill.radius, 0, Double.pi * 2)
            c.stroke()
        }

        if let ripple = f.ripple {
            HookPaint.stroke(c, ripple.ink, width: ripple.width)
            c.beginPath()
            c.arc(ripple.center.x, ripple.center.y, ripple.radius, 0, Double.pi * 2)
            c.stroke()
        }

        for label in f.labels { HookPaint.text(c, label) }

        // The prints lie on the map; the car, a toy standing on it, is drawn over them.
        for card in f.cards { paintCard(c, card, pictures) }

        paintCar(c, f.car)

        if let compass = f.compass { paintCompass(c, compass) }

        if let scale = f.scaleBar {
            polyline(c, scale.halo)
            polyline(c, scale.bracket)
            HookPaint.text(c, scale.label)
        }

        if let distance = f.distance { HookPaint.text(c, distance) }

        // A picture filling the frame while the car halts: over everything of the map.
        fullFrame(c, f.fill, pictures, w, h)

        c.restore()
    }

    /// Pictures cover-cropped into the whole frame, each at its alpha.
    private static func fullFrame(_ c: PaintCanvas, _ layers: [DriveFrame.Layer], _ pictures: [String: HookPicture]?,
                                  _ w: Double, _ h: Double) {
        for layer in layers {
            guard layer.alpha > 0, let picture = HookPaint.picture(pictures?[layer.key]) else { continue }
            c.save()
            c.globalAlpha = layer.alpha
            CellPainter.drawFramed(c, picture, w, h)
            c.restore()
        }
    }

    private static func polyline(_ c: PaintCanvas, _ line: DriveFrame.Polyline) {
        guard line.points.count > 1 else { return }
        c.save()
        c.setLineDash(line.dash)
        HookPaint.stroke(c, line.ink, width: line.width)
        HookPaint.trace(c, line.points, close: false)
        c.stroke()
        c.restore()
    }

    /// A radial gradient over the whole frame, from the inner ink to the outer.
    private static func paintVignette(_ c: PaintCanvas, _ v: DriveFrame.Vignette, _ w: Double, _ h: Double) {
        let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        let colors = [HookPaint.color(v.inner), HookPaint.color(v.outer)]
        let locations: [CGFloat] = [0, 1]
        guard let gradient = CGGradient(colorsSpace: space, colors: colors as CFArray, locations: locations) else { return }
        let center = CGPoint(x: v.center.x, y: v.center.y)
        c.cg.saveGState()
        c.cg.setAlpha(CGFloat(c.globalAlpha))
        c.cg.clip(to: CGRect(x: 0, y: 0, width: w, height: h))
        c.cg.drawRadialGradient(gradient, startCenter: center, startRadius: CGFloat(max(0, v.innerRadius)),
                                endCenter: center, endRadius: CGFloat(max(0, v.outerRadius)),
                                options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
        c.cg.restoreGState()
    }

    /// A print as it pops: turned and scaled about its centre, its stacked
    /// shadows, its paper, then the picture whole.
    private static func paintCard(_ c: PaintCanvas, _ card: DriveFrame.Card, _ pictures: [String: HookPicture]?) {
        guard card.alpha > 0 else { return }
        c.save()
        c.translate(card.center.x, card.center.y)
        c.rotate(card.angle)
        c.scale(card.scale, card.scale)
        for shadow in card.shadows {
            HookPaint.fill(c, shadow.ink)
            CellPainter.roundedRect(c, shadow.rect.x, shadow.rect.y, shadow.rect.width, shadow.rect.height, card.radius)
            c.fill()
        }
        HookPaint.fill(c, card.paperInk)
        CellPainter.roundedRect(c, card.paper.x, card.paper.y, card.paper.width, card.paper.height, card.radius)
        c.fill()
        if let picture = HookPaint.picture(pictures?[card.key]) {
            c.globalAlpha = card.alpha
            c.drawImage(picture.image, card.picture.x, card.picture.y, card.picture.width, card.picture.height)
        }
        c.restore()
    }

    /// The car as the kernel lays it down: its ground shadow — three stacked
    /// ellipses, squashed by the camera's tilt and turned with the car — then
    /// every face filled and stroked. The garage's turntable draws through
    /// this too.
    static func paintCar(_ c: PaintCanvas, _ car: DriveFrame.Car) {
        let shadow = car.shadow
        // A camera level with the ground squashes the shadow to nothing.
        if shadow.squash > 0 {
            c.save()
            c.translate(shadow.origin.x, shadow.origin.y)
            c.scale(1, shadow.squash)
            c.rotate(shadow.rotation)
            let ink = Mesh3D.GroundShadow.rgb
            for ellipse in shadow.ellipses where ellipse.radiusX > 0 && ellipse.radiusY > 0 {
                c.save()
                c.setFill("rgba(\(ink.r),\(ink.g),\(ink.b),\(ellipse.alpha))")
                c.scale(ellipse.radiusX, ellipse.radiusY)
                c.beginPath()
                c.arc(0, 0, 1, 0, Double.pi * 2)
                c.fill()
                c.restore()
            }
            c.restore()
        }

        c.save()
        c.lineJoin = .round
        c.lineCap = .round
        for step in car.faces where step.points.count >= 3 {
            HookPaint.trace(c, step.points, close: true)
            c.setFill(.color(rgb(step.fill)))
            c.fill()
            c.setStroke(step.stroke)
            c.lineWidth = step.lineWidth
            c.stroke()
        }
        c.restore()
    }

    private static func rgb(_ v: Mesh3D.Rgb) -> CGColor {
        CGColor(srgbRed: CGFloat(max(0, min(255, v.r))) / 255, green: CGFloat(max(0, min(255, v.g))) / 255,
                blue: CGFloat(max(0, min(255, v.b))) / 255, alpha: 1)
    }

    /// A compass rose: the star stroked in the halo, filled in the halo,
    /// outlined in the ink; the north point filled in the ink; the N.
    private static func paintCompass(_ c: PaintCanvas, _ compass: DriveFrame.Compass) {
        HookPaint.trace(c, compass.star, close: true)
        HookPaint.stroke(c, compass.halo, width: compass.haloWidth)
        c.stroke()
        HookPaint.fill(c, compass.halo)
        c.fill()
        HookPaint.stroke(c, compass.ink, width: compass.inkWidth)
        c.stroke()
        HookPaint.polygon(c, compass.north, compass.ink)
        HookPaint.text(c, compass.letter)
    }
}
