// A spec of its own for `src/shared/overlay/overlay-types.ts`, which has no
// web twin: the creators' defaults, the stored strings, and the reader the
// web does by a cast — every element written back as it was read.

import Foundation
import XCTest
@testable import AtelierKit

final class OverlayCreatorsTests: XCTestCase {
    func testGivesATelemetryFieldItsShortLabelAndTheBaseStyle() {
        let el = createTelemetryElement(.relAlt, id: "a")
        XCTAssertEqual(el.label, "ALT")
        XCTAssertEqual(createTelemetryElement(.clock).label, "")
        XCTAssertEqual(el.fontFamily, .spaceGrotesk)
        XCTAssertEqual(el.sizeFrac, 0.045)
        XCTAssertEqual(el.weight, 600)
        XCTAssertEqual(el.legibility, LegibilityStyle(mode: .shadow, color: "rgba(0,0,0,0.65)", padFrac: 0.3))
        XCTAssertEqual(el.anchor, .topLeft)
    }

    func testDressesEachShapeAsTheWebDoes() {
        let tape = createHeadingTapeElement()
        XCTAssertEqual(tape.anchor, .topCenter)
        XCTAssertEqual(tape.tapeReticle, .both)
        XCTAssertEqual(tape.tapeReticleColor, "#e2542f")
        XCTAssertEqual(tape.legibility.color, "rgba(0,0,0,0.55)")
        let battery = createBatteryElement()
        XCTAssertEqual(battery.batterySource, .manual)
        XCTAssertEqual(battery.batteryPercent, 100)
        XCTAssertEqual(createFrameCornersElement().legibility.mode, .none)
        XCTAssertEqual(createHeadingArrowElement().headingGap, .dim)
        let rotate = createRotateDeviceElement()
        XCTAssertEqual(rotate.text, "Rotate your phone")
        XCTAssertEqual(rotate.rotateLabel, .below)
    }

    func testWritesALowercaseUuidAsItsId() {
        let id = createTextElement().id
        XCTAssertEqual(id, id.lowercased())
        XCTAssertEqual(id.count, 36)
    }

    func testLaysOutTheStarterDeck() {
        let deck = defaultElementsPreset()
        XCTAssertEqual(deck.map(\.field), [.relAlt, .gndSpeed, .heading, .latitude, .longitude, .iso, .shutter])
        XCTAssertEqual(deck[0].sizeFrac, 0.045)
        XCTAssertEqual(deck[3].anchor, .bottomLeft)
        XCTAssertEqual(deck[6].y, 0.09)
    }

    func testKeepsTheWebsStoredStrings() {
        XCTAssertEqual(OverlayKind.allCases.map(\.rawValue),
                       ["telemetry-field", "text", "heading-arrow", "heading-tape", "frame-corners", "battery", "rotate-device"])
        XCTAssertEqual(OverlayAnchor.bottomCenter.rawValue, "bottom-center")
        XCTAssertEqual(TelemetryFieldKey.allCases.map(\.rawValue), [
            "rel_alt", "abs_alt", "gnd_speed", "vert_speed", "heading", "latitude", "longitude", "iso", "shutter",
            "fnum", "ev", "focal_len", "color_md", "ct", "frame", "timestamp", "clock", "date",
        ])
        XCTAssertEqual(curatedFonts.map(\.rawValue),
                       ["Space Grotesk", "JetBrains Mono", "Instrument Serif", "VT323", "Arial", "Georgia", "Courier New"])
        XCTAssertEqual(brandFonts.count, 4)
    }
}

final class OverlayElementJSONTests: XCTestCase {
    func testWritesBackEveryElementItCreates() throws {
        let made = [
            createTelemetryElement(.gndSpeed), createTextElement("Hook"), createFrameCornersElement(),
            createHeadingArrowElement(), createHeadingTapeElement(), createBatteryElement(), createRotateDeviceElement(),
        ] + introPresets.map { $0.create() }
        for el in made {
            let back = try XCTUnwrap(readOverlayElement(el.json), el.kind.rawValue)
            XCTAssertEqual(back, el, el.kind.rawValue)
        }
    }

    func testReadsAStoredElementAndWritesItBackUnchanged() throws {
        let raw: JSONValue = [
            "id": "e1", "kind": "telemetry-field", "field": "clock", "label": "", "anchor": "bottom-right",
            "x": 0.95, "y": 0.9, "fontFamily": "JetBrains Mono", "sizeFrac": 0.03, "color": "#f2c230",
            "weight": 500, "italic": true,
            "legibility": ["mode": "box", "color": "rgba(0,0,0,0.4)", "padFrac": 0.3, "radiusFrac": 0.5,
                           "borderColor": nil, "borderWidthFrac": 0],
            "visible": true, "timeFormat": ["hour12": true], "speedUnit": "km/h",
            "window": ["start": 0.2, "end": nil],
            "animation": ["in": ["preset": "fade", "duration": 0.5, "easing": "out", "delay": 0.1], "out": nil],
            "sceneId": "intro", "styleOverrides": ["color", "futureKey"],
            "somethingNewer": ["a": 1],
        ]
        let el = try XCTUnwrap(readOverlayElement(raw))
        XCTAssertEqual(el.kind, .telemetryField)
        XCTAssertEqual(el.field, .clock)
        XCTAssertEqual(el.anchor, .bottomRight)
        XCTAssertEqual(el.fontFamily, .jetBrainsMono)
        XCTAssertEqual(el.speedUnit, .kilometresPerHour)
        XCTAssertEqual(el.legibility.borderColor, .some(nil))
        XCTAssertNil(el.legibility.outlineColor)
        XCTAssertEqual(el.timeFormatOptions, TimeFormatOptions(hour12: true))
        XCTAssertEqual(el.carried["somethingNewer"], ["a": 1])
        XCTAssertEqual(el.json, raw)
    }

    func testLeavesAbsentOptionalsAbsent() throws {
        let raw: JSONValue = [
            "id": "t", "kind": "text", "text": "Hi", "anchor": "center", "x": 0.5, "y": 0.5,
            "fontFamily": "Space Grotesk", "sizeFrac": 0.045, "color": "#ffffff", "weight": 600, "italic": false,
            "legibility": ["mode": "shadow", "color": "rgba(0,0,0,0.65)", "padFrac": 0.3], "visible": true,
        ]
        let el = try XCTUnwrap(readOverlayElement(raw))
        XCTAssertNil(el.window)
        XCTAssertNil(el.animation)
        XCTAssertNil(el.legibility.radiusFrac)
        XCTAssertEqual(el.legibility.borderColor, .none)
        XCTAssertEqual(el.json, raw)
    }

    func testRefusesWhatIsNotAnElementAndDropsItFromAList() {
        XCTAssertNil(readOverlayElement("text"))
        XCTAssertNil(readOverlayElement(["kind": "text"]))
        XCTAssertNil(readOverlayElement(["id": "x", "kind": "hologram"]))
        let list: JSONValue = [["id": "x", "kind": "hologram"], createTextElement("kept").json, 42]
        XCTAssertEqual(readOverlayElements(list).map(\.text), ["kept"])
    }

    func testFillsAMissingRequiredFieldWithANewElementsDefault() throws {
        let el = try XCTUnwrap(readOverlayElement(["id": "x", "kind": "text", "fontFamily": "Comic Sans"]))
        XCTAssertEqual(el.fontFamily, .spaceGrotesk)
        XCTAssertEqual(el.sizeFrac, 0.045)
        XCTAssertEqual(el.legibility, .default)
        XCTAssertTrue(el.visible)
    }
}
