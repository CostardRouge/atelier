// The overlay panels' pure half (`Overlay/OverlayPanels.swift`). The web keeps
// this logic inside its components and has no spec for it; these pin the
// observable rules the components encode, one per behaviour.

import Foundation
import XCTest
@testable import AtelierKit

private typealias P = OverlayPanels

private func cue(_ data: [String: String], timestamp: String? = nil) -> Cue {
    Cue(start: 0, end: 0.033, frame: 12, timestamp: timestamp, data: data)
}

private let theme = themeFromPreset("or-cine")!

final class OverlayPanelsTests: XCTestCase {
    // MARK: printing

    func testPrintsNumbersTheWayTheWebDoes() {
        XCTAssertEqual(P.fixed(0.25, 1), "0.3")
        XCTAssertEqual(P.plain(3), "3")
        XCTAssertEqual(P.plain(0.65), "0.65")
        XCTAssertEqual(P.percent(0.045), "5%")
        XCTAssertEqual(P.percent(0.035), "4%")
        XCTAssertEqual(P.hundredths(3.14159), 3.14)
        XCTAssertEqual(P.smoothingText(0), "off")
        XCTAssertEqual(P.smoothingText(0.6), "0.6 s")
        XCTAssertEqual(P.hudFadeText(0), "cut")
        XCTAssertEqual(P.hudFadeText(0.5), "0.50 s")
    }

    func testReadsEveryKindsDefaultsFromItsCreator() {
        XCTAssertEqual(P.freshElement(.headingTape).tapeSpanDeg, 90)
        XCTAssertEqual(P.freshElement(.frameCorners).cornerInset, 0.03)
        XCTAssertEqual(P.freshElement(.battery).batteryPercent, 100)
        XCTAssertEqual(P.freshElement(.rotateDevice).rotateCycleSeconds, 1.8)
        for kind in OverlayKind.allCases { XCTAssertEqual(P.freshElement(kind).kind, kind) }
    }

    // MARK: the palette

    func testEveryCellIsItsOwnConstructor() {
        for group in paletteGroups {
            for item in group.items {
                let el = P.paletteElement(item)
                switch item {
                case .telemetryField(let f):
                    XCTAssertEqual(el.kind, .telemetryField)
                    XCTAssertEqual(el.field, f)
                case .preset(let id):
                    XCTAssertEqual(el.sceneId, introSceneId, id.rawValue)
                default:
                    XCTAssertEqual(el.kind.rawValue, item.kind)
                }
            }
        }
        // Two presses, two elements.
        XCTAssertNotEqual(P.paletteElement(.text).id, P.paletteElement(.text).id)
    }

    func testKeysEveryCellUniquely() {
        let keys = paletteGroups.flatMap(\.items).map(P.paletteItemKey)
        XCTAssertEqual(Set(keys).count, keys.count)
    }

    func testNamesACellWithoutTheDropdownsParenthetical() {
        XCTAssertEqual(P.paletteItemName(.telemetryField(.clock)), "Clock")
        XCTAssertEqual(P.paletteItemName(.telemetryField(.relAlt)), "Rel. altitude")
        XCTAssertEqual(P.paletteItemName(.headingArrow), "Arrow")
        XCTAssertEqual(P.paletteItemName(.frameCorners), "Corners")
        XCTAssertEqual(P.paletteItemName(.preset(.hookTitle)), "Hook title")
    }

    func testCountsWhatIsPlacedButNeverAnIntroPreset() {
        let deck = [createTelemetryElement(.relAlt), createTelemetryElement(.relAlt), createTelemetryElement(.iso),
                    createBatteryElement(), createTextElement()]
        XCTAssertEqual(P.palettePlacedCount(deck, .telemetryField(.relAlt)), 2)
        XCTAssertEqual(P.palettePlacedCount(deck, .telemetryField(.heading)), 0)
        XCTAssertEqual(P.palettePlacedCount(deck, .battery), 1)
        XCTAssertEqual(P.palettePlacedCount(deck, .text), 1)
        XCTAssertEqual(P.palettePlacedCount(deck + [introPreset(.hookTitle).create()], .preset(.hookTitle)), 0)
        XCTAssertEqual(P.paletteCellTitle("Battery", placed: 0), "Add Battery")
        XCTAssertEqual(P.paletteCellTitle("Battery", placed: 2), "Add another Battery (2 already on the frame)")
    }

    func testSaysWhereAnIntroCellLands() {
        XCTAssertEqual(P.paletteTimingHint(introPreset(.hookTitle).create()), "intro")
        XCTAssertEqual(P.paletteTimingHint(introPreset(.subtitle).create()), "+0.5s")
        XCTAssertNil(P.paletteTimingHint(createTextElement()))
    }

    func testPreviewsTheRealValueOrTheFieldsNameNeverAFabricatedOne() {
        let alt = createTelemetryElement(.relAlt)
        XCTAssertEqual(P.palettePreviewText(.telemetryField(.relAlt), alt, cue(["rel_alt": "87.2"])), "ALT 87.2 m")
        // No log: the label alone, never `ALT —` and never an invented reading.
        XCTAssertEqual(P.palettePreviewText(.telemetryField(.relAlt), alt, nil), "ALT")
        // No label (the clock): the field's own name.
        let clock = createTelemetryElement(.clock)
        XCTAssertEqual(P.palettePreviewText(.telemetryField(.clock), clock, nil), "Clock (HH:MM:SS)")
        XCTAssertEqual(P.palettePreviewText(.telemetryField(.clock), clock, cue([:], timestamp: "2026-05-30 05:49:34.609")),
                       "05:49:34")
        // The project's shift reaches the preview.
        XCTAssertEqual(P.palettePreviewText(.telemetryField(.clock), clock, cue([:], timestamp: "2026-05-30 05:49:34"),
                                            timeShift: TimeShift(minutes: 60, days: 0)), "06:49:34")
        XCTAssertEqual(P.palettePreviewText(.text, createTextElement(), nil), "Text")
        XCTAssertEqual(P.palettePreviewText(.preset(.question), introPreset(.question).create(), nil), "What if you could…?")
        XCTAssertEqual(P.palettePreviewText(.battery, createBatteryElement(), nil), "")
    }

    // MARK: the list

    func testListsARowAsTheStageDrawsIt() {
        XCTAssertEqual(P.listRow(createHeadingTapeElement(), nil), P.ListRow(preview: "Heading tape", tag: "⇥"))
        XCTAssertEqual(P.listRow(createRotateDeviceElement(), nil), P.ListRow(preview: "Rotate phone", tag: "⟳"))
        XCTAssertEqual(P.listRow(createTextElement("Hello"), nil), P.ListRow(preview: "Hello", tag: "TXT"))
        XCTAssertEqual(P.listRow(createTextElement(""), nil), P.ListRow(preview: "(empty)", tag: "TXT"))
        XCTAssertEqual(P.listRow(createTelemetryElement(.iso), cue(["iso": "100"])), P.ListRow(preview: "ISO 100", tag: "iso"))
        XCTAssertEqual(P.listRow(createTelemetryElement(.iso), nil), P.ListRow(preview: "ISO —", tag: "iso"))
    }

    // MARK: the element panel

    func testPinsATouchedPropertyOnlyUnderATheme() {
        let el = createTextElement()
        XCTAssertNil(P.pinningStyle(el, [.color], theme: nil).styleOverrides)
        XCTAssertEqual(P.pinningStyle(el, [.color], theme: theme).styleOverrides, ["color"])
        XCTAssertEqual(P.pinningStyle(el, [], theme: theme), el)
    }

    func testNeverRepinsAndKeepsTheOrderItFound() {
        var el = createTextElement()
        el.styleOverrides = ["weight", "color", "weight"]
        // Nothing new: untouched, duplicates and all (the web only rewrites on growth).
        XCTAssertEqual(P.pinningStyle(el, [.color], theme: theme).styleOverrides, ["weight", "color", "weight"])
        // Something new: the web's `[...new Set(overrides), added]`.
        XCTAssertEqual(P.pinningStyle(el, [.glow, .color], theme: theme).styleOverrides, ["weight", "color", "glow"])
    }

    func testHandsAPropertyBackToTheTheme() {
        var el = createTextElement()
        el.styleOverrides = ["color", "weight", "color"]
        XCTAssertEqual(P.withoutOverride(el, .color).styleOverrides, ["weight"])
        XCTAssertTrue(P.isOverriding(el, .weight, theme: theme))
        XCTAssertFalse(P.isOverriding(el, .weight, theme: nil))
        XCTAssertFalse(P.isOverriding(el, .italic, theme: theme))
        XCTAssertEqual(P.overridesSentence(0), "Following the project style.")
        XCTAssertEqual(P.overridesSentence(1), "1 property overriding the style.")
        XCTAssertEqual(P.overridesSentence(3), "3 properties overriding the style.")
    }

    func testSplitsACssColourIntoAWellAndAnAlpha() {
        XCTAssertTrue(P.splitColor("rgba(0,0,0,0.65)") == ("#000000", 0.65))
        XCTAssertTrue(P.splitColor("rgba(255, 128, 7, 0.4)") == ("#ff8007", 0.4))
        XCTAssertTrue(P.splitColor("RGB(12,34,56)") == ("#0c2238", 1))
        XCTAssertTrue(P.splitColor("rgba(300,-4,0,1)") == ("#ff0000", 1))
        XCTAssertTrue(P.splitColor("#e2542f") == ("#e2542f", 1))
        XCTAssertTrue(P.splitColor("tomato") == ("#000000", 1))
        XCTAssertEqual(P.rgba("#ff8007", 0.4), "rgba(255,128,7,0.4)")
        XCTAssertEqual(P.rgba("#000000", 1), "rgba(0,0,0,1)")
        // A round trip is the identity on what the panel writes.
        let split = P.splitColor(P.rgba("#1a2b3c", 0.35))
        XCTAssertEqual(split.hex, "#1a2b3c")
        XCTAssertEqual(split.alpha, 0.35)
        XCTAssertEqual(P.hexOr("rgba(0,0,0,1)", "#e2542f"), "#e2542f")
        XCTAssertEqual(P.hexOr("#123456", "#e2542f"), "#123456")
        XCTAssertEqual(P.hexOr(nil, "#e2402a"), "#e2402a")
    }

    func testReadsAndWritesTheBatterysReading() {
        var el = createBatteryElement()
        XCTAssertEqual(P.batteryReading(el), .right)
        el = P.withBatteryReading(el, .above)
        XCTAssertEqual(el.batteryLabel, .above)
        XCTAssertEqual(el.batteryShowPercent, true)
        el = P.withBatteryReading(el, .none)
        XCTAssertEqual(P.batteryReading(el), LabelPlacement.none)
        // Hiding the number keeps where it was, for the day it comes back.
        XCTAssertEqual(el.batteryLabel, .above)
        XCTAssertEqual(P.batteryKeyPlaceholder, "(probe battery, battery_percent, batterypercent…)")
    }

    func testWritesOnlyTheTouchedKeyOfATimeFormat() {
        let el = createTelemetryElement(.clock)
        let twelve = P.patchTimeFormat(el, hour12: true)
        XCTAssertEqual(twelve.timeFormat, .object(["hour12": .bool(true)]))
        let both = P.patchTimeFormat(twelve, dateStyle: .longDmy)
        XCTAssertEqual(both.timeFormat, .object(["hour12": .bool(true), "dateStyle": .string("long-dmy")]))
        XCTAssertEqual(both.timeFormatOptions?.hour12, true)
        XCTAssertEqual(both.timeFormatOptions?.seconds, true)
    }

    // MARK: the title style

    func testTunesAGlowLayerByHandAndHandsItBack() {
        let style = theme.style
        let derived = glowLayersFor(style)
        let tuned = P.GlowLayer.haloAlpha.setting(0.9, in: style)
        XCTAssertEqual(P.GlowLayer.haloAlpha.override(in: tuned), 0.9)
        XCTAssertEqual(P.GlowLayer.haloAlpha.value(in: glowLayersFor(tuned)), 0.9)
        XCTAssertEqual(P.GlowLayer.bleedAlpha.value(in: glowLayersFor(tuned)), derived.bleedAlpha)
        // Handed back: no empty record is left behind.
        let back = P.GlowLayer.haloAlpha.setting(nil, in: tuned)
        XCTAssertNil(back.glowLayers)
        XCTAssertEqual(back, style)
        XCTAssertEqual(P.GlowLayer.allCases.map(\.label),
                       ["Core softness", "Halo radius", "Halo strength", "Bleed radius", "Bleed strength", "Grain"])
    }

    // MARK: timing

    func testSaysWhichCurvesOvershootOrJump() {
        XCTAssertEqual(P.easingLabel(.out), "Out")
        XCTAssertEqual(P.easingLabel(.back), "Back — overshoots")
        XCTAssertEqual(P.easingLabel(.spring), "Spring — overshoots")
        XCTAssertEqual(P.easingLabel(.steps), "Steps — in jumps")
    }

    func testTurnsAnAnimationOnFromAUsableStep() {
        let placeholder = P.timingPlaceholderStep(.entrance)
        var slide = placeholder
        slide.preset = .slide
        // From nothing: the default, wearing the chosen preset — never zero seconds long.
        XCTAssertEqual(P.timingStepChanged(nil, slide, .entrance),
                       AnimStep(preset: .slide, duration: 0.5, easing: .out))
        XCTAssertEqual(P.timingStepChanged(nil, slide, .exit)?.duration, 0.4)
        XCTAssertEqual(P.timingStepChanged(nil, slide, .exit)?.easing, .in)
        // Over a step: the edit itself.
        var longer = AnimStep(preset: .fade, duration: 0.5, easing: .out)
        longer.duration = 1.2
        XCTAssertEqual(P.timingStepChanged(P.timingDefaultStep(.entrance), longer, .entrance), longer)
        // A cut: nothing.
        XCTAssertNil(P.timingStepChanged(longer, placeholder, .entrance))
    }

    func testWritesACutAsNullAndKeepsTheOtherEnd() {
        var el = createTextElement()
        el = P.withTimingStep(el, .exit, AnimStep(preset: .fade, duration: 0.4, easing: .in))
        el = P.withTimingStep(el, .entrance, nil)
        XCTAssertEqual(el.animation?.json, .object([
            "in": .null,
            "out": .object(["preset": .string("fade"), "duration": .number(0.4), "easing": .string("in")]),
        ]))
    }

    func testNeverLetsAWindowsEndsCross() {
        XCTAssertEqual(P.timingWindow(nil, start: 2), TimeWindow(start: 2, end: nil))
        XCTAssertEqual(P.timingWindow(TimeWindow(start: 1, end: 3), end: .some(0.5)), TimeWindow(start: 1, end: 1.1))
        XCTAssertEqual(P.timingWindow(TimeWindow(start: 1, end: 3), start: 4), TimeWindow(start: 4, end: 4.1))
        XCTAssertEqual(P.timingWindow(TimeWindow(start: 1, end: 3), end: .some(nil)), TimeWindow(start: 1, end: nil))
        XCTAssertEqual(P.timingWindowToggled(true, inScene: false), TimeWindow(start: 0, end: 3))
        XCTAssertEqual(P.timingWindowToggled(true, inScene: true), TimeWindow(start: 0, end: nil))
        XCTAssertNil(P.timingWindowToggled(false, inScene: false))
    }

    func testReadsThePlayheadInTheScenesOwnClock() {
        let scene = OverlayScene(id: "intro", name: "Introduction", start: 2, end: 5)
        XCTAssertEqual(P.timingLocal(3.5, scene: scene), 1.5)
        XCTAssertEqual(P.timingLocal(1, scene: scene), 0)
        XCTAssertEqual(P.timingLocal(3.5, scene: nil), 3.5)
    }

    func testSaysWhenAnExitHasNothingToPlayAgainst() {
        let el = createTextElement()
        XCTAssertTrue(P.timingExitNeedsEnd(el, scene: nil))
        XCTAssertFalse(P.timingExitNeedsEnd(el, scene: createIntroScene()))
        var timed = el
        timed.window = TimeWindow(start: 0, end: 3)
        XCTAssertFalse(P.timingExitNeedsEnd(timed, scene: nil))
    }

    // MARK: the scene

    func testNudgesASceneThatWouldNeverDraw() {
        var scene = createIntroScene()
        scene.end = 0
        XCTAssertEqual(P.scenePatched(scene).end, 0.2)
        XCTAssertEqual(P.scenePatched(createIntroScene()).end, 3)
        XCTAssertEqual(P.sceneBadge(createIntroScene()), "0.0–3.0 s")
    }

    func testSwitchesTheCascadeAndSeedsAShuffleOnce() {
        XCTAssertEqual(P.sceneStaggerToggled(true), .some(Stagger.default))
        XCTAssertEqual(P.sceneStaggerToggled(false), .some(nil))
        let shuffled = P.sceneStaggerOrdered(.default, .random, seed: { 42 })
        XCTAssertEqual(shuffled.seed, 42)
        XCTAssertEqual(P.sceneStaggerOrdered(shuffled, .random, seed: { 7 }).seed, 42)
        XCTAssertNil(P.sceneStaggerOrdered(.default, .rows, seed: { 7 }).seed)
        XCTAssertEqual(P.staggerOrderLabel(staggerOrders[2]), "Centre out — From the middle of the frame outwards")
        XCTAssertEqual(P.sceneMembersSentence(0), "Nothing in it yet.")
        XCTAssertEqual(P.sceneMembersSentence(1), "1 element")
        XCTAssertEqual(P.sceneMembersSentence(4), "4 elements")
    }

    // MARK: the outro

    func testEditsTheCardsLines() {
        let card = withOutroLine(createOutroCard("Merci"), "See you")
        let lines = P.outroLines(card)
        XCTAssertEqual(lines.map(\.text), ["Merci", "See you"])
        let edited = P.outroWithLineText(card, lines[1].id, "À bientôt")
        XCTAssertEqual(P.outroLines(edited).map(\.text), ["Merci", "À bientôt"])
        XCTAssertEqual(P.outroLines(P.outroWithoutLine(card, lines[0].id)).map(\.text), ["See you"])
    }

    func testHoldsTheCardHalfASecondAtLeast() {
        let card = createOutroCard("Merci")
        XCTAssertEqual(P.outroSeconds(card, 6).seconds, 6)
        XCTAssertEqual(P.outroSeconds(card, 0).seconds, 0.5)
        XCTAssertEqual(P.outroSeconds(card, 0.2).seconds, 0.5)
        XCTAssertEqual(P.outroSeconds(card, .nan).seconds, 0.5)
        XCTAssertEqual(P.outroBadge(card), "+ 4.0 s")
    }

    func testPlacesAFirstQrUnderTheMiddleAndRemovesAnEmptyOne() {
        let card = createOutroCard("Merci")
        let portrait = P.outroWithQrUrl(card, "https://steeve.website", aspect: 9.0 / 16)
        XCTAssertEqual(portrait.qr?.url, "https://steeve.website")
        assertClose(portrait.qr?.x ?? 0, 0.35)
        XCTAssertEqual(portrait.qr?.light, card.background)
        XCTAssertEqual(portrait.qr?.dark, "#f4f0e7")
        let landscape = P.outroWithQrUrl(card, "https://steeve.website", aspect: 16.0 / 9)
        assertClose(landscape.qr?.x ?? 0, 0.5 - 0.3 * (9.0 / 16) / 2)
        // A second link keeps where the code was.
        var moved = portrait
        moved.qr?.x = 0.1
        XCTAssertEqual(P.outroWithQrUrl(moved, "https://other", aspect: 1).qr?.x, 0.1)
        XCTAssertNil(P.outroWithQrUrl(portrait, "   ", aspect: 1).qr)
    }

    // MARK: the clip's facts

    func testSaysTheCadenceOrWhyItCannot() {
        var none = TimeScaleReading.realtime
        XCTAssertEqual(P.infoCadence(none, scale: 1, overridden: false), "")
        none.mediaFps = 29.97
        XCTAssertEqual(P.infoCadence(none, scale: 1, overridden: false),
                       "plays at 29.97 fps · shooting cadence not measurable")
        XCTAssertEqual(P.infoCadence(none, scale: 0.25, overridden: true), "4× slow motion · set by hand")
        let slow = TimeScaleReading(scale: 0.25, basis: .timestamps, mediaFps: 30, captureFps: 120, snapped: true,
                                    spanSeconds: 10, samples: 300)
        XCTAssertEqual(P.infoCadence(slow, scale: 0.25, overridden: false), "120 → 30 fps · 4× slow motion")
    }

    func testSummarisesTheFlight() {
        XCTAssertNil(P.infoFlight([]))
        let cues = [cue(["rel_alt": "20", "color_md": "dlog_m"]), cue(["rel_alt": "60.5"])]
        XCTAssertEqual(P.infoFlight(cues), "2 cues · alt 20–60.5 m · dlog_m")
        XCTAssertEqual(P.infoFlight([cue([:])]), "1 cues")
    }

    func testNamesThePhotosCameraAndLens() {
        XCTAssertEqual(P.infoCamera(ExifData(make: "SONY", model: "ILCE-7CM2")), "SONY ILCE-7CM2")
        XCTAssertNil(P.infoCamera(ExifData()))
        XCTAssertEqual(P.infoLens(ExifData(lensModel: "FE 24-70mm F2.8 GM II")), "FE 24-70mm F2.8 GM II")
        XCTAssertEqual(P.infoLens(ExifData(lensMake: "Sony", lensModel: "FE 35mm")), "Sony FE 35mm")
        XCTAssertNil(P.infoLens(ExifData(make: "DJI")))
    }
}
