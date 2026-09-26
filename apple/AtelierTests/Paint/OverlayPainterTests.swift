// The overlay painter held to the web's `draw-overlays.ts`: the shapes' boxes
// are the web's numbers (the kernel's spec pins the same ones on Linux; here
// they come through the app's own entry point), a text element paints INSIDE
// the box `measureOverlays` gives it — one layout for the grab and the paint —
// in the brand face, with its legibility shadow under it; an element off
// screen paints nothing; every kind paints; and the Core Image entry point
// keeps the frame's extent.

import AtelierKit
import CoreGraphics
import CoreImage
import XCTest
@testable import Atelier

final class OverlayPainterTests: XCTestCase {
    override func setUp() {
        super.setUp()
        Brand.registerFonts()
    }

    private let hd = CGSize(width: 1920, height: 1080)

    private func render(_ elements: [OverlayElement], cue: Cue? = nil, time: Double = 0, theme: StyleTheme? = nil,
                        options: OverlayDrawOptions = OverlayDrawOptions(), width: Int = 1920, height: Int = 1080) -> PaintRaster {
        let painter = OverlayPainter()
        return PaintRaster.render(width, height) { cg, size in
            painter.drawOverlays(in: cg, size: size, elements: elements, cue: cue, time: time, theme: theme, options: options)
        }
    }

    // MARK: boxes

    func testTheShapesBoxesAreTheWebsNumbers() {
        var arrow = createHeadingArrowElement(id: "arrow")
        arrow.showCompass = true
        let boxes = OverlayPainter().measureOverlays(size: hd, elements: [createBatteryElement(id: "bat"),
                                                                         createHeadingTapeElement(id: "tape"), arrow],
                                                     cue: nil, time: 0, theme: nil)
        XCTAssertEqual(boxes.map(\.id), ["bat", "tape", "arrow"])
        // Battery: 174.44322 × 37.26 at (1649.55678, 54), margin 9.72.
        XCTAssertEqual(boxes[0].x, 1649.55678 - 9.72, accuracy: 1e-6)
        XCTAssertEqual(boxes[0].w, 174.44322 + 19.44, accuracy: 1e-6)
        XCTAssertEqual(boxes[0].h, 37.26 + 19.44, accuracy: 1e-6)
        // Tape: 960 × 116.424 at (480, 64.8), margin 0.028 × 1080 × 0.3.
        XCTAssertEqual(boxes[1].x, 480 - 9.072, accuracy: 1e-6)
        XCTAssertEqual(boxes[1].h, 116.424 + 18.144, accuracy: 1e-6)
        // Arrow with its compass: 187.92 square at (866.04, 446.04), margin 4.86.
        XCTAssertEqual(boxes[2].x, 866.04 - 4.86, accuracy: 1e-6)
        XCTAssertEqual(boxes[2].w, 187.92 + 9.72, accuracy: 1e-6)
    }

    func testATextElementPaintsInsideTheBoxItIsGrabbedBy() {
        var el = createTextElement("Kalbarri 128 km", id: "t")
        el.anchor = .bottomLeft
        el.x = 0.1
        el.y = 0.8
        el.sizeFrac = 0.08
        el.legibility = LegibilityStyle(mode: .none, color: "rgba(0,0,0,0)", padFrac: 0.3)
        let box = OverlayPainter().measureOverlays(size: hd, elements: [el], cue: nil, time: 0, theme: nil)[0]
        let raster = render([el])
        let ink = raster.bounds { $0.a > 0 }
        XCTAssertNotNil(ink, "the text paints")
        guard let ink else { return }
        XCTAssertGreaterThanOrEqual(Double(ink.minX), box.x)
        XCTAssertGreaterThanOrEqual(Double(ink.minY), box.y)
        XCTAssertLessThanOrEqual(Double(ink.maxX), box.x + box.w)
        XCTAssertLessThanOrEqual(Double(ink.maxY), box.y + box.h)
        // The margin is 0.3 em (the padding), so the ink reaches near the
        // box's inner edges: the box is not a loose guess.
        let margin = 0.3 * 0.08 * 1080
        XCTAssertLessThan(Double(ink.minX) - box.x, margin + 12)
        XCTAssertLessThan(box.y + box.h - Double(ink.maxY), margin + 12)
    }

    func testATextElementIsSetInItsBrandFace() {
        let el = createTextElement("ALT", id: "t")
        let st = resolveElementStyle(el, nil)
        let face = PaintFonts.resolve(.overlay(st, 48))
        XCTAssertTrue(face.postScriptName.hasPrefix("SpaceGrotesk"), face.postScriptName)
        let raster = render([el])
        XCTAssertGreaterThan(raster.points { $0.a > 128 && $0.r > 200 }.count, 100, "white ink on the frame")
    }

    func testTheLegibilityShadowLiesUnderTheTextAndOnlyWhenAskedFor() {
        var el = createTextElement("SHADOW", id: "t")
        el.sizeFrac = 0.1
        el.x = 0.1
        el.y = 0.3
        // Premultiplied: a white glyph's soft edge has r == a, a shadow's r ≈ 0.
        let dark: (PaintRaster.Pixel) -> Bool = { $0.a > 24 && $0.r * 4 < $0.a }
        let shadowed = render([el])
        XCTAssertGreaterThan(shadowed.points(where: dark).count, 500, "a soft dark halo around the letters")
        XCTAssertGreaterThan(shadowed.meanY(where: dark), shadowed.meanY { $0.a > 200 && $0.r > 200 } - 1,
                             "the shadow falls DOWN (0.05 em), never up")
        el.legibility = LegibilityStyle(mode: .none, color: "rgba(0,0,0,0.65)", padFrac: 0.3)
        XCTAssertEqual(render([el]).points(where: dark).count, 0)
    }

    func testABoxLegibilityPaintsItsPanelBehindTheText() {
        var el = createTextElement("BOX", id: "t")
        el.x = 0.4
        el.y = 0.4
        el.legibility = LegibilityStyle(mode: .box, color: "#000000", padFrac: 0.3)
        let box = OverlayPainter().measureOverlays(size: hd, elements: [el], cue: nil, time: 0, theme: nil)[0]
        let raster = render([el])
        // The box's corner inset by its radius: black panel.
        let p = raster.pixel(Int(box.x + box.w / 2), Int(box.y + 2))
        XCTAssertEqual(p.a, 255)
        XCTAssertEqual(p.r, 0)
    }

    // MARK: time

    func testAnElementOutOfItsWindowPaintsNothingButItsGhostDoes() {
        var el = createTextElement("Later", id: "t")
        el.legibility = LegibilityStyle(mode: .none, color: "rgba(0,0,0,0)", padFrac: 0)
        el.window = TimeWindow(start: 5, end: nil)
        XCTAssertTrue(render([el], time: 1).points { $0.a > 0 }.isEmpty)
        let ghost = render([el], time: 1, options: OverlayDrawOptions(ghostId: "t"))
        let ink = ghost.points { $0.a > 0 }
        XCTAssertFalse(ink.isEmpty)
        XCTAssertLessThanOrEqual(ink.map { ghost.pixel($0.x, $0.y).a }.max() ?? 255, 100, "ghosted at 0.35")
    }

    func testAFadeInIsHalfWayAtItsMiddle() {
        var el = createTextElement("FADE", id: "t")
        el.legibility = LegibilityStyle(mode: .none, color: "rgba(0,0,0,0)", padFrac: 0)
        el.window = TimeWindow(start: 0, end: nil)
        el.animation = ElementAnimation(in: .some(AnimStep(preset: .fade, duration: 1, easing: .linear)))
        let raster = render([el], time: 0.5)
        let peak = raster.points { $0.a > 0 }.map { raster.pixel($0.x, $0.y).a }.max() ?? 0
        XCTAssertEqual(Double(peak), 127.5, accuracy: 3)
    }

    // MARK: every kind

    func testEveryKindPaints() {
        let cue = Cue(start: 0, end: 1, data: ["rel_alt": "120.5"], derived: Motion(groundSpeed: 12, heading: 247))
        var arrow = createHeadingArrowElement(id: "arrow")
        arrow.showCompass = true
        let kinds: [OverlayElement] = [
            createTelemetryElement(.relAlt, id: "alt"),
            arrow,
            createHeadingTapeElement(id: "tape"),
            createBatteryElement(id: "bat"),
            createFrameCornersElement(id: "corners"),
            createRotateDeviceElement(id: "rot"),
        ]
        for el in kinds {
            XCTAssertGreaterThan(render([el], cue: cue).points { $0.a > 0 }.count, 50, el.kind.rawValue)
        }
    }

    func testAGlowReachesBeyondTheInkAndGrains() {
        var el = createTextElement("GLOW", id: "t")
        el.sizeFrac = 0.1
        el.x = 0.3
        el.y = 0.4
        el.legibility = LegibilityStyle(mode: .none, color: "rgba(0,0,0,0)", padFrac: 0)
        el.color = "#e02015"
        let flat = render([el]).points { $0.a > 0 }.count
        el.glowAmount = 0.75
        let glowing = render([el], time: 0.3).points { $0.a > 0 }.count
        XCTAssertGreaterThan(glowing, flat * 2, "the bleed and the halo spread past the letters")
    }

    func testTheOutroCardPaintsItsGroundItsLinesAndItsCode() throws {
        var card = createOutroCard("See you on the road")
        card.qr = OutroQr(url: "https://example.com/trip", x: 0.35, y: 0.55, sizeFrac: 0.3, dark: "#000000", light: "#ffffff")
        let prepared = prepareOutro(card)
        XCTAssertNotNil(prepared.qr)
        let raster = PaintRaster.render(1080, 1920) { cg, size in
            OutroPainter.draw(prepared, in: cg, size: size, tSeconds: 1, painter: OverlayPainter())
        }
        XCTAssertEqual(raster.pixel(5, 5), .init(r: 0x10, g: 0x0f, b: 0x0d, a: 255), "the card's own ground")
        let place = OverlayGeometry.qrPlacement(1080, 1920, try XCTUnwrap(prepared.qr))
        XCTAssertEqual(raster.pixel(Int(place.left) + 1, Int(place.top) + 1), .init(r: 255, g: 255, b: 255, a: 255),
                       "the quiet zone is light")
    }

    // MARK: the Core Image entry point

    func testTheBurnInKeepsTheFramesExtentAndDrawsOnIt() {
        let frame = CIImage(color: CIColor(red: 0, green: 0, blue: 0)).cropped(to: CGRect(x: 0, y: 0, width: 640, height: 360))
        let painter = OverlayPainter()
        let out = painter.burnIn(frame, elements: [createFrameCornersElement(id: "c")], cue: nil, time: 0, theme: nil)
        XCTAssertEqual(out.extent, frame.extent)
        let overlay = painter.overlayImage(width: 640, height: 360, elements: [createFrameCornersElement(id: "c")],
                                           cue: nil, time: 0, theme: nil)
        XCTAssertEqual(overlay?.extent, CGRect(x: 0, y: 0, width: 640, height: 360))
        XCTAssertTrue(painter.burnIn(frame, elements: [], cue: nil, time: 0, theme: nil) === frame, "nothing to draw, no node")
    }
}
