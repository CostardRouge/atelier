// Spec of `Overlay/OverlayGeometry.swift`. The first three groups are
// `src/shared/overlay/draw-overlays.test.ts`, one for one (anchorOrigin,
// anchorPoint, hitTest); the rest pin the layout arithmetic the web leaves to
// a browser — every number below was computed by running the web's own
// `draw-overlays.ts` formulas in node — and the draw loop's decisions, over a
// fake monospace measure standing in for Core Text.

import Foundation
import XCTest
@testable import AtelierKit

private typealias G = OverlayGeometry

/// A monospace stand-in for Core Text: 0.6 em a character plus the spacing,
/// 0.7 em of ink above the baseline and 0.2 below.
private let mono: OverlayGeometry.Measure = { text, _, fontPx, spacing in
    let n = Double(text.unicodeScalars.count)
    return OverlayTextMetrics(width: n * (fontPx * 0.6 + spacing), ascent: fontPx * 0.7, descent: fontPx * 0.2)
}

private func point(_ p: Point, _ x: Double, _ y: Double, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertEqual(p, Point(x, y), file: file, line: line)
}

final class OverlayGeometryTests: XCTestCase {
    // MARK: anchorOrigin (draw-overlays.test.ts)

    private let w = 100.0
    private let h = 40.0

    func testAnchorOriginTopLeftPutsTheAnchorAtTheBoxTopLeft() {
        point(G.anchorOrigin(.topLeft, 500, 300, w, h), 500, 300)
    }

    func testAnchorOriginBottomRightPutsTheAnchorAtTheBoxBottomRight() {
        point(G.anchorOrigin(.bottomRight, 500, 300, w, h), 400, 260)
    }

    func testAnchorOriginCentresTheBoxForCenter() {
        point(G.anchorOrigin(.center, 500, 300, w, h), 450, 280)
    }

    func testAnchorOriginHandlesMixedAnchors() {
        point(G.anchorOrigin(.topCenter, 500, 300, w, h), 450, 300)
        point(G.anchorOrigin(.centerRight, 500, 300, w, h), 400, 280)
        point(G.anchorOrigin(.bottomCenter, 500, 300, w, h), 450, 260)
    }

    // MARK: anchorPoint

    func testAnchorPointReadsTheAnchorBackFromABoxTopLeft() {
        point(G.anchorPoint(.bottomRight, 400, 260, w, h), 500, 300)
        point(G.anchorPoint(.topLeft, 400, 260, w, h), 400, 260)
        point(G.anchorPoint(.center, 400, 260, w, h), 450, 280)
    }

    func testAnchorPointRoundTripsWithAnchorOriginForEveryAnchor() {
        let topLeft = Point(123, 45)
        for a in OverlayAnchor.allCases {
            let ap = G.anchorPoint(a, topLeft.x, topLeft.y, w, h)
            XCTAssertEqual(G.anchorOrigin(a, ap.x, ap.y, w, h), topLeft, a.rawValue)
        }
    }

    // MARK: hitTest

    private let boxes = [
        G.ElementBox(id: "a", x: 0, y: 0, w: 100, h: 100),
        G.ElementBox(id: "b", x: 50, y: 50, w: 100, h: 100), // overlaps a, drawn later (on top)
    ]

    func testHitTestReturnsTheBoxUnderThePoint() {
        XCTAssertEqual(G.hitTest(boxes, 10, 10), "a")
        XCTAssertEqual(G.hitTest(boxes, 140, 140), "b")
    }

    func testHitTestReturnsTheTopmostBoxWhereBoxesOverlap() {
        XCTAssertEqual(G.hitTest(boxes, 60, 60), "b")
    }

    func testHitTestReturnsNilWhenThePointMissesEveryBox() {
        XCTAssertNil(G.hitTest(boxes, 300, 300))
    }

    func testHitTestTreatsBoxEdgesAsInside() {
        XCTAssertEqual(G.hitTest([G.ElementBox(id: "a", x: 0, y: 0, w: 100, h: 100)], 100, 100), "a")
    }

    func testHitTestReturnsNilForAnEmptyList() {
        XCTAssertNil(G.hitTest([], 10, 10))
    }

    func testBoxForIdFindsOneBox() {
        XCTAssertEqual(G.boxForId(boxes, "b")?.x, 50)
        XCTAssertNil(G.boxForId(boxes, "z"))
    }

    // MARK: the shapes' layouts, pinned to the web's numbers

    func testTheDefaultBatteryAtTheTopRightOfA1080pFrame() {
        let el = createBatteryElement(id: "bat")
        let lay = G.batteryLayout(el, resolveElementStyle(el, nil), 1920, 1080)
        assertClose(lay.fontPx, 32.4, 9)
        assertClose(lay.cellH, 37.26, 9)
        assertClose(lay.cellW, 78.246, 9)
        assertClose(lay.w, 174.44322, 9)
        assertClose(lay.h, 37.26, 9)
        assertClose(lay.x, 1649.55678, 9)
        assertClose(lay.y, 54, 9)
        assertClose(lay.cellX, 1649.55678, 9)
        assertClose(lay.cellY, 54, 9)
    }

    func testABatteryCaptionAboveLiftsTheCellAndAStubbyAspectIsClamped() {
        var el = createBatteryElement(id: "bat")
        el.anchor = .bottomLeft
        el.x = 0.1
        el.y = 0.9
        el.sizeFrac = 0.05
        el.batteryAspect = 1
        el.batteryLabel = .above
        let lay = G.batteryLayout(el, resolveElementStyle(el, nil), 1080, 1920)
        assertClose(lay.fontPx, 54, 9)
        assertClose(lay.cellW, 74.52, 9)
        assertClose(lay.w, 79.7364, 9)
        assertClose(lay.h, 135, 9)
        assertClose(lay.x, 108, 9)
        assertClose(lay.y, 1593, 9)
        assertClose(lay.cellY, 1665.9, 9)
        XCTAssertEqual(G.batteryPlace(el), .above)
        el.batteryShowPercent = false
        XCTAssertEqual(G.batteryPlace(el), LabelPlacement.none, "no percentage, no caption room")
    }

    func testTheDefaultHeadingTape() {
        let el = createHeadingTapeElement(id: "tape")
        let lay = G.tapeLayout(el, resolveElementStyle(el, nil), 1920, 1080)
        assertClose(lay.fontPx, 30.24, 9)
        assertClose(lay.halfW, 480, 9)
        assertClose(lay.tickH, 30.24, 9)
        assertClose(lay.x, 480, 9)
        assertClose(lay.y, 64.8, 9)
        assertClose(lay.w, 960, 9)
        assertClose(lay.h, 116.424, 9)
        assertClose(lay.cx, 960, 9)
        assertClose(lay.cy, 110.16, 9)
        assertClose(lay.ribbonDy, 45.36, 9)
    }

    func testATapeCaptionOnTheLeftWidensTheBoxInstead() {
        var el = createHeadingTapeElement(id: "tape")
        el.anchor = .center
        el.x = 0.5
        el.y = 0.5
        el.sizeFrac = 0.03
        el.tapeWidthFrac = 0.3
        el.tapeTickScale = 1.5
        el.tapeLabel = .left
        let lay = G.tapeLayout(el, resolveElementStyle(el, nil), 1920, 1080)
        assertClose(lay.w, 770.4, 9)
        assertClose(lay.h, 92.34, 9)
        assertClose(lay.x, 574.8, 9)
        assertClose(lay.y, 493.83, 9)
        assertClose(lay.cx, 1057.2, 9)
        assertClose(lay.cy, 493.83, 9)
        assertClose(lay.tickH, 48.6, 9)
    }

    func testTheArrowsSquareGrowsWithTheCompassRing() {
        var el = createHeadingArrowElement(id: "arrow")
        el.showCompass = true
        let lay = G.arrowLayout(el, 1920, 1080)
        assertClose(lay.r, 32.4, 9)
        assertClose(lay.halfSize, 93.96, 9)
        assertClose(lay.x, 866.04, 9)
        assertClose(lay.y, 446.04, 9)
        assertClose(lay.w, 187.92, 9)
        XCTAssertEqual(lay.cx, 960)
        XCTAssertEqual(lay.cy, 540)
        el.showCompass = nil
        XCTAssertEqual(G.arrowLayout(el, 1920, 1080).halfSize, G.arrowLayout(el, 1920, 1080).r)
    }

    func testTheArrowIgnoresTheThemesSizeMultiplier() {
        let el = createHeadingArrowElement(id: "arrow")
        let big = G.arrowLayout(el, 1920, 1080)
        XCTAssertEqual(big.r, el.sizeFrac * 1080 * 0.5, "the element's own sizeFrac, as the web")
    }

    func testTheRotatePromptsSquareAndItsCaptionBelow() {
        let el = createRotateDeviceElement(id: "rot")
        let lay = G.rotateLayout(el, resolveElementStyle(el, nil), 1080, 1920, measure: mono)
        assertClose(lay.side, 172.8, 9)
        assertClose(lay.phoneH, 114.048, 9)
        assertClose(lay.phoneW, 59.30496, 9)
        assertClose(lay.arcRadius, 76.032, 9)
        assertClose(lay.arcWeight, 4.8384, 9)
        assertClose(lay.fontPx, 25.92, 9)
        assertClose(lay.gap, 13.824, 9)
        assertClose(lay.x, 453.6, 9)
        assertClose(lay.y, 849.192, 9)
        assertClose(lay.w, 172.8, 9)
        assertClose(lay.h, 221.616, 9)
        assertClose(lay.cx, 540, 9)
        assertClose(lay.cy, 935.592, 9)
        XCTAssertEqual(lay.place, .below)
        XCTAssertEqual(lay.caption, "Rotate your phone")
    }

    func testARotateCaptionOnTheSideIsMeasuredWithoutLetterSpacing() {
        var el = createRotateDeviceElement(id: "rot")
        el.rotateLabel = .right
        el.letterSpacingEm = 0.5
        el.uppercase = true
        var asked: Double = -1
        let lay = G.rotateLayout(el, resolveElementStyle(el, nil), 1080, 1920) { text, style, px, spacing in
            asked = spacing
            return mono(text, style, px, spacing)
        }
        XCTAssertEqual(asked, 0)
        XCTAssertEqual(lay.caption, "ROTATE YOUR PHONE")
        assertClose(lay.w, lay.side + 17 * lay.fontPx * 0.6 + lay.gap, 9)
        el.text = "   "
        XCTAssertEqual(G.rotateLayout(el, resolveElementStyle(el, nil), 1080, 1920, measure: mono).place, LabelPlacement.none,
                       "a blank caption takes no room")
    }

    // MARK: text

    func testATextLayoutIsTheMeasuredRunAtItsAnchor() {
        var el = createTextElement("Hello", id: "t")
        el.anchor = .bottomRight
        el.x = 0.9
        el.y = 0.9
        el.sizeFrac = 0.05
        el.letterSpacingEm = 0.1
        let lay = G.textLayout(el, nil, 1920, 1080, theme: nil, timeShift: nil, measure: mono)!
        XCTAssertEqual(lay.fontPx, 54)
        assertClose(lay.w, 5 * (54 * 0.6 + 5.4), 9)
        assertClose(lay.h, 54 * 0.9, 9)
        assertClose(lay.ascent, 54 * 0.7, 9)
        assertClose(lay.x, 1728 - lay.w, 9)
        assertClose(lay.y, 972 - lay.h, 9)
    }

    func testATextWithNothingToShowHasNoLayout() {
        let el = createTextElement("", id: "t")
        XCTAssertNil(G.textLayout(el, nil, 1920, 1080, theme: nil, timeShift: nil, measure: mono))
    }

    func testCasingIsAppliedToTheStringAndTheThemeScalesTheSize() {
        var el = createTextElement("straße", id: "t")
        el.uppercase = true
        el.styleOverrides = ["uppercase"]
        let theme = themeFromPreset("pixel-crt")!
        let lay = G.textLayout(el, nil, 1920, 1080, theme: theme, timeShift: nil, measure: mono)!
        XCTAssertEqual(lay.text, "STRASSE", "JavaScript's toUpperCase: ß → SS")
        assertClose(lay.fontPx, 0.045 * 1.15 * 1080, 9)
    }

    func testATelemetryFieldWithNoCueReadsItsLabelAndADash() {
        let el = createTelemetryElement(.relAlt, id: "alt")
        let lay = G.textLayout(el, nil, 1920, 1080, theme: nil, timeShift: nil, measure: mono)!
        XCTAssertEqual(lay.text, "ALT —")
    }

    func testATypewriterStopsOnWholeCodePoints() {
        XCTAssertNil(G.typedPrefix("abcd", 1))
        XCTAssertEqual(G.typedPrefix("abcd", 0), "")
        XCTAssertEqual(G.typedPrefix("abcd", 0.5), "ab")
        XCTAssertEqual(G.typedPrefix("abcd", 0.375), "ab", "1.5 rounds half up")
        XCTAssertEqual(G.typedPrefix("\u{E9}\u{1F642}xy", 0.5), "\u{E9}\u{1F642}", "an emoji is ONE code point to the spread")
    }

    // MARK: boxes

    func testMeasureGivesEachKindItsMarginAndSkipsFrameCorners() {
        var text = createTextElement("Hi", id: "t")
        text.sizeFrac = 0.05
        let arrow = createHeadingArrowElement(id: "arrow")
        let corners = createFrameCornersElement(id: "corners")
        let battery = createBatteryElement(id: "bat")
        let boxes = G.measureOverlays([text, arrow, corners, battery], nil, 1920, 1080, time: 0, theme: nil,
                                      options: OverlayDrawOptions(), measure: mono)
        XCTAssertEqual(boxes.map(\.id), ["t", "arrow", "bat"])
        // Text: the shadow legibility pads 0.3 em, more than the 0.2 em floor.
        let lay = G.textLayout(text, nil, 1920, 1080, theme: nil, timeShift: nil, measure: mono)!
        assertClose(boxes[0].x, lay.x - 0.3 * 54, 9)
        assertClose(boxes[0].w, lay.w + 0.6 * 54, 9)
        // Arrow: 15 % of r.
        let alay = G.arrowLayout(arrow, 1920, 1080)
        assertClose(boxes[1].x, alay.x - max(2, alay.r * 0.15), 9)
        // Battery: 0.3 of its size.
        assertClose(boxes[2].x, 1649.55678 - 9.72, 9)
        assertClose(boxes[2].h, 37.26 + 2 * 9.72, 9)
    }

    func testATextMarginCoversAnOutlinedBoxAndAGlowsBleed() {
        var el = createTextElement("Hi", id: "t")
        el.legibility = LegibilityStyle(mode: .box, color: "#000000", padFrac: 0.1, borderColor: .some("#fff"), borderWidthFrac: 0.2)
        var lay = G.textLayout(el, nil, 1000, 1000, theme: nil, timeShift: nil, measure: mono)!
        assertClose(G.textMargin(lay), max(0.1 * 45 + 0.2 * 45 * 0.5, 45 * 0.2), 9)
        el.glowAmount = 1
        lay = G.textLayout(el, nil, 1000, 1000, theme: nil, timeShift: nil, measure: mono)!
        assertClose(G.textMargin(lay), 0.6 * 45 * 0.5, 9, "the bleed reaches farthest")
    }

    func testAnElementOutOfItsWindowHasNoBoxUnlessItIsTheGhost() {
        var el = createTextElement("Title", id: "t")
        el.window = TimeWindow(start: 2, end: 4)
        let off = G.measureOverlays([el], nil, 1920, 1080, time: 0.5, theme: nil, options: OverlayDrawOptions(), measure: mono)
        XCTAssertTrue(off.isEmpty)
        let ghost = G.measureOverlays([el], nil, 1920, 1080, time: 0.5, theme: nil,
                                      options: OverlayDrawOptions(ghostId: "t"), measure: mono)
        XCTAssertEqual(ghost.map(\.id), ["t"])
        let on = G.measureOverlays([el], nil, 1920, 1080, time: 12.5, theme: nil,
                                   options: OverlayDrawOptions(originSeconds: 10), measure: mono)
        XCTAssertEqual(on.map(\.id), ["t"], "windows count from the first exported frame")
    }

    func testASoloSceneHoldsTheHudBackFromTheBoxesToo() {
        var scene = createIntroScene(end: 3)
        scene.solo = true
        var member = createTextElement("Intro", id: "m")
        member.sceneId = scene.id
        let hud = createTextElement("ALT", id: "hud")
        let boxes = G.measureOverlays([member, hud], nil, 1920, 1080, time: 1, theme: nil,
                                      options: OverlayDrawOptions(scenes: [scene]), measure: mono)
        XCTAssertEqual(boxes.map(\.id), ["m"])
    }

    func testReanchoringInPlaceKeepsTheBoxStill() {
        var el = createTextElement("Somewhere", id: "t")
        el.anchor = .topLeft
        el.x = 0.2
        el.y = 0.3
        let before = G.textLayout(el, nil, 1920, 1080, theme: nil, timeShift: nil, measure: mono)!
        let p = G.reanchorInPlace(el, nil, 1920, 1080, .bottomRight, theme: nil, timeShift: nil, measure: mono)!
        el.anchor = .bottomRight
        el.x = p.x
        el.y = p.y
        let after = G.textLayout(el, nil, 1920, 1080, theme: nil, timeShift: nil, measure: mono)!
        assertClose(after.x, before.x, 9)
        assertClose(after.y, before.y, 9)
        XCTAssertNil(G.reanchorInPlace(createFrameCornersElement(), nil, 1920, 1080, .center, theme: nil,
                                       timeShift: nil, measure: mono))
    }

    // MARK: the draw loop's decisions

    func testThePlanSkipsHiddenElementsAndGhostsTheSelectedOne() {
        var early = createTextElement("A", id: "a")
        early.window = TimeWindow(start: 5, end: nil)
        var hidden = createTextElement("B", id: "b")
        hidden.visible = false
        let always = createTextElement("C", id: "c")
        let plan = G.drawPlan([early, hidden, always], 1920, 1080, time: 1, options: OverlayDrawOptions(ghostId: "a"))
        XCTAssertEqual(plan.items.map(\.element.id), ["a", "c"])
        XCTAssertEqual(plan.items[0].transform, OverlayTransform(alpha: G.ghostAlpha))
        XCTAssertEqual(plan.items[1].transform, .identity)
        XCTAssertNil(plan.scrim)
    }

    func testThePlanFoldsASoloScenesHoldBackIntoTheAlphaAndCarriesItsScrim() {
        var scene = createIntroScene(end: 4)
        scene.solo = true
        scene.hudFade = 1
        scene.scrim = SceneScrim(color: "#000000", opacity: 0.5, fade: 0)
        let hud = createTextElement("ALT", id: "hud")
        let before = G.drawPlan([hud], 1920, 1080, time: 4.5, options: OverlayDrawOptions(scenes: [scene]))
        XCTAssertEqual(before.items.count, 1)
        assertClose(before.items[0].transform.alpha, 0.5, 9, "half way back after the scene closes")
        let during = G.drawPlan([hud], 1920, 1080, time: 2, options: OverlayDrawOptions(scenes: [scene]))
        XCTAssertTrue(during.items.isEmpty)
        XCTAssertEqual(during.scrim?.color, "#000000")
        assertClose(during.scrim?.opacity ?? 0, 0.5, 9)
    }

    func testAnItemsLocalClockStartsWhenItsWindowOpens() {
        var el = createRotateDeviceElement(id: "rot")
        el.window = TimeWindow(start: 2, end: nil)
        let plan = G.drawPlan([el], 1080, 1920, time: 13.5, options: OverlayDrawOptions(originSeconds: 10))
        assertClose(plan.elapsed, 3.5, 9)
        assertClose(plan.items[0].localSeconds, 1.5, 9)
    }

    // MARK: the heading

    func testWithNoCueListTheArrowReadsTheCuesOwnHeading() {
        let cue = Cue(start: 0, end: 1, derived: Motion(heading: 90))
        let el = createHeadingArrowElement(id: "arrow")
        XCTAssertEqual(G.heading(for: el, cue: cue, time: 0, cues: nil), G.HeadingReading(heading: 90, alpha: 1))
        XCTAssertEqual(G.heading(for: el, cue: nil, time: 0, cues: []), G.HeadingReading(heading: nil, alpha: 1))
    }

    func testAStaleBearingDimsThenHideDropsIt() {
        let cues = [
            Cue(start: 0, end: 1, derived: Motion(heading: 45)),
            Cue(start: 1, end: 2, derived: Motion()),
            Cue(start: 2, end: 3, derived: Motion()),
        ]
        var el = createHeadingArrowElement(id: "arrow")
        el.headingSmoothing = 0
        el.headingHoldSeconds = 2
        let dim = G.heading(for: el, cue: cues[1], time: 1, cues: cues)
        XCTAssertEqual(dim.heading ?? -1, 45, accuracy: 1e-9)
        XCTAssertLessThan(dim.alpha, 1)
        XCTAssertGreaterThanOrEqual(dim.alpha, 0.25)
        el.headingGap = .hold
        XCTAssertEqual(G.heading(for: el, cue: cues[1], time: 1, cues: cues).alpha, 1)
        el.headingGap = .hide
        XCTAssertNil(G.heading(for: el, cue: cues[1], time: 1, cues: cues).heading)
    }

    // MARK: grain, QR, grid

    func testTheGrainTileIsTheWebsLcgToTheBit() {
        let tile = G.grainTile()
        XCTAssertEqual(tile.count, 128 * 128)
        let head: [UInt8] = [128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 128, 0, 0, 0,
                             64, 0, 0, 0, 0, 64, 0, 64, 0, 0, 0, 64, 0, 0, 64, 0, 0, 0, 0, 0]
        XCTAssertEqual(Array(tile.prefix(40)), head)
        XCTAssertEqual(Array(tile.suffix(4)), [0, 64, 0, 0])
        XCTAssertEqual(tile.reduce(0) { $0 + Int($1) }, 352533)
        var hash: UInt32 = 0
        for v in tile { hash = hash &* 31 &+ UInt32(v) }
        XCTAssertEqual(hash, 855532151)
    }

    func testTheGrainFieldStepsTenTimesASecond() {
        XCTAssertTrue(G.grainOffset(0) == (0, 0))
        XCTAssertTrue(G.grainOffset(0.05) == (0, 0))
        XCTAssertTrue(G.grainOffset(0.1) == (53, 97))
        XCTAssertTrue(G.grainOffset(0.25) == (106, 66))
    }

    func testTheGrainBoxIsTheTextGrownByTheBleed() {
        var el = createTextElement("Glow", id: "g")
        el.glowAmount = 0.5
        let lay = G.textLayout(el, nil, 1000, 1000, theme: nil, timeShift: nil, measure: mono)!
        let glow = lay.style.glow!
        let box = G.grainBox(lay, glow)
        let reach = glow.bleedRadiusFrac * 45 + 45 * 0.3
        XCTAssertEqual(box.x, (lay.x - reach).rounded(.down))
        XCTAssertEqual(box.w, (lay.w + reach * 2).rounded(.up))
    }

    func testAQrSnapsItsModulesToWholePixelsAndCentresTheRemainder() throws {
        let matrix = try XCTUnwrap(encodeQr("https://example.com"))
        let qr = QrDraw(x: 0.35, y: 0.55, sizeFrac: 0.3, matrix: matrix, dark: "#000000", light: "#ffffff")
        let place = G.qrPlacement(1080, 1920, qr)
        let side = 0.3 * 1080
        let total = Double(matrix.size + 8)
        XCTAssertEqual(place.module, (side / total).rounded(.down))
        XCTAssertEqual(place.drawn, place.module * total)
        XCTAssertEqual(place.left, (0.35 * 1080 + (side - place.drawn) / 2).rounded(.toNearestOrAwayFromZero))
        XCTAssertEqual(place.top, (0.55 * 1920 + (side - place.drawn) / 2).rounded(.toNearestOrAwayFromZero))
        let tiny = G.qrPlacement(20, 20, qr)
        XCTAssertEqual(tiny.module, 1, "never under one pixel a module")
    }

    func testGridLinesLandOnHalfPixels() {
        XCTAssertEqual(G.gridLines(3, 1920), [640.5, 1280.5])
        XCTAssertEqual(G.gridLines(3, 1000), [333.5, 667.5])
        XCTAssertEqual(G.gridLines(1, 1000), [])
    }
}
