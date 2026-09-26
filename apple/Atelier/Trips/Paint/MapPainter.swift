// The Itinerary painted — the strokes of
// `src/shared/roadtrip/hooks/map-paint.ts` over the kernel's `MapFrame`
// (`Roadtrip/Hooks/MapPaint.swift`), which decided every point from the SAME
// projection, so nothing sits where the line is not. Painting order is the
// frame's: the backdrop, the plate, the graticule, the path (the line ahead,
// then the line drawn, each over its dark underlay), the context places, the
// pins' stems, the dots, the pins, the names, the pen, the card, the strip,
// the compass and the distance. Every stroke has round caps and joins.
//
// A picture is a tile (`CellPainter.tile`, the web's `cell-paint.ts`):
// cover-cropped, on a paper mount with a soft shadow or bare with rounded
// corners, a card's caption in the paper under it. A stop with no picture
// draws NOTHING — the kernel left it out of the frame.
//
// Names are measured HERE, by Core Text in the label face at 600, and handed
// to the kernel's placement, so a label keeps clear of a dot and of a pin by
// the width the eye will see.

import AtelierKit
import CoreGraphics
import Foundation

enum MapPainter {
    static func paint(_ c: PaintCanvas, _ drawing: MapDrawing, _ t: Double, _ frame: FrameBox) {
        guard let f = drawing.frame(at: t, frame, measure: HookPaint.labelWidth) else { return }
        let w = frame.width
        let h = frame.height
        let u = w / 1080
        let pictures = drawing.pictures
        c.save()
        c.lineCap = .round
        c.lineJoin = .round

        if let backdrop = f.backdrop {
            for layer in backdrop.layers {
                guard let picture = HookPaint.picture(pictures?[layer.key]), layer.alpha > 0 else { continue }
                c.save()
                c.globalAlpha = layer.alpha
                CellPainter.drawFramed(c, picture, w, h)
                c.restore()
            }
            if backdrop.veil > 0 {
                c.save()
                c.globalAlpha = backdrop.veil
                c.setFill("#000000")
                c.fillRect(0, 0, w, h)
                c.restore()
            }
        }

        if let plate = f.plate {
            HookPaint.fill(c, plate.ink)
            CellPainter.roundedRect(c, plate.rect.x, plate.rect.y, plate.rect.width, plate.rect.height, plate.radius)
            c.fill()
        }

        if let graticule = f.graticule {
            c.save()
            c.beginPath()
            c.rect(graticule.clip.x, graticule.clip.y, graticule.clip.width, graticule.clip.height)
            c.clip()
            c.setLineDash([])
            HookPaint.stroke(c, graticule.ink, width: graticule.width)
            for line in graticule.lines {
                c.beginPath()
                c.moveTo(line.from.x, line.from.y)
                c.lineTo(line.to.x, line.to.y)
                c.stroke()
            }
            c.restore()
        }

        for arc in f.arcs {
            c.setLineDash(arc.dash)
            HookPaint.stroke(c, arc.ink, width: arc.width)
            c.beginPath()
            c.moveTo(arc.start.x, arc.start.y)
            c.quadraticCurveTo(arc.control.x, arc.control.y, arc.end.x, arc.end.y)
            c.stroke()
        }
        c.setLineDash([])

        for place in f.context {
            HookPaint.disc(c, center: place.center, radius: place.radius, place.ink)
        }

        for stem in f.stems {
            HookPaint.stroke(c, stem.ink, width: stem.width)
            c.beginPath()
            c.moveTo(stem.from.x, stem.from.y)
            c.lineTo(stem.to.x, stem.to.y)
            c.stroke()
        }

        for dot in f.dots {
            if let under = dot.underlay { HookPaint.disc(c, center: under.center, radius: under.radius, under.ink) }
            HookPaint.disc(c, center: dot.disc.center, radius: dot.disc.radius, dot.disc.ink)
            if let numeral = dot.numeral { HookPaint.text(c, numeral) }
        }

        for pin in f.pins { tile(c, pin, pictures, u) }

        for label in f.labels { HookPaint.text(c, label) }

        if let pen = f.pen {
            switch pen {
            case .dot(let disc):
                HookPaint.disc(c, center: disc.center, radius: disc.radius, disc.ink)
            case .plane(let points, let ink):
                HookPaint.polygon(c, points, ink)
            }
        }

        for card in f.card { tile(c, card, pictures, u) }

        for item in f.strip {
            tile(c, item.tile, pictures, u)
            if let veil = item.veil {
                HookPaint.fill(c, veil.ink)
                CellPainter.roundedRect(c, veil.rect.x, veil.rect.y, veil.rect.width, veil.rect.height, veil.radius)
                c.fill()
            }
            if let ring = item.ring {
                HookPaint.stroke(c, ring.ink, width: ring.width)
                CellPainter.roundedRect(c, ring.rect.x, ring.rect.y, ring.rect.width, ring.rect.height, ring.radius)
                c.stroke()
            }
        }

        if let compass = f.compass {
            for line in compass.shaft {
                HookPaint.stroke(c, line.ink, width: line.width)
                c.beginPath()
                c.moveTo(line.from.x, line.from.y)
                c.lineTo(line.to.x, line.to.y)
                c.stroke()
            }
            HookPaint.polygon(c, compass.head, compass.headInk)
            HookPaint.text(c, compass.letter)
        }

        if let distance = f.distance { HookPaint.text(c, distance) }

        c.restore()
    }

    /// A picture mounted in its box at its alpha — nothing when the picture is
    /// not there to draw.
    private static func tile(_ c: PaintCanvas, _ tile: MapFrame.Tile, _ pictures: [String: HookPicture]?, _ u: Double) {
        guard tile.alpha > 0, let picture = HookPaint.picture(pictures?[tile.key]) else { return }
        c.save()
        c.globalAlpha = tile.alpha
        CellPainter.tile(c, picture, tile.rect.x, tile.rect.y, tile.rect.width, tile.rect.height,
                         frame: tile.frame == .paper ? .paper : .bare, u: u, caption: tile.caption)
        c.restore()
    }
}
