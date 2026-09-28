// What the overlay panels' previews draw: a DJI flight log parsed by the
// kernel's own parser (the instruments' fixture, so a cue carries real
// motion), a deck holding one element of every kind, the Or ciné theme, an
// intro scene with its veil and cascade, a closing card with a QR, and a
// photograph's EXIF read as its one cue. Preview-only — nothing here reaches
// a document.

import SwiftUI
import AtelierKit

enum OverlayPanelFixtures {
    static let cues: [Cue] = parseSrt(InstrumentFixtures.srt(count: 120))

    /// Four seconds in: past the opening window, so speed and heading are measured.
    static var cue: Cue? { cues.count > 100 ? cues[100] : cues.last }

    static let timing: TimeScaleReading = measureTimeScale(cues)

    static let theme: StyleTheme? = themeFromPreset("or-cine")

    /// One element of every kind, ids stable so a selection survives a redraw.
    static let deck: [OverlayElement] = {
        var deck: [OverlayElement] = defaultElementsPreset().enumerated().map { pair -> OverlayElement in
            var copy = pair.element
            copy.id = "deck.\(pair.offset)"
            return copy
        }
        var title = introPreset(.hookTitle).create()
        title.id = "deck.title"
        var tape = createHeadingTapeElement(id: "deck.tape")
        tape.styleOverrides = ["color"]
        tape.color = "#9fe0ff"
        var hidden = createTextElement("Behind the scenes", id: "deck.hidden")
        hidden.visible = false
        deck.append(contentsOf: [
            title, tape, createHeadingArrowElement(id: "deck.arrow"), createBatteryElement(id: "deck.battery"),
            createFrameCornersElement(id: "deck.corners"), createRotateDeviceElement(id: "deck.rotate"), hidden,
            createTelemetryElement(.clock, id: "deck.clock"),
        ])
        return deck
    }()

    static func element(_ id: String) -> OverlayElement {
        deck.first { $0.id == id } ?? createTextElement(id: id)
    }

    static let scene: OverlayScene = {
        var scene = createIntroScene(end: 3.5)
        scene.scrim = .default
        scene.solo = true
        scene.stagger = .some(Stagger(each: 0.15, order: .rows))
        return scene
    }()

    static let outro: OutroCard = {
        var card = withOutroLine(createOutroCard("Merci"), "See you on the next flight")
        card = OverlayPanels.outroWithQrUrl(card, "https://steeve.website", aspect: 9.0 / 16)
        return card
    }()

    static let photo: ExifData = InstrumentFixtures.exif
    static var photoCue: Cue? { cueFromExif(photo) }
}
