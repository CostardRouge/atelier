// Port of `src/shared/overlay/field-format.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

/// `tests/fixtures/sample.srt`, inlined: three cues of a DJI Mini 4 Pro log.
private let sampleSrt = """
1
00:00:00,000 --> 00:00:00,016
<font size="28">FrameCnt: 1, DiffTime: 16ms
2026-05-30 05:49:34.609
[iso: 100] [shutter: 1/500.0] [fnum: 1.7] [ev: 0] [color_md: dlog_m] [focal_len: 24.00] [latitude: 16.056870] [longitude: -61.748979] [rel_alt: 35.200 abs_alt: 80.196] [ct: 5300] </font>

2
00:00:00,016 --> 00:00:00,032
<font size="28">FrameCnt: 2, DiffTime: 16ms
2026-05-30 05:49:34.624
[iso: 100] [shutter: 1/500.0] [fnum: 1.7] [ev: 0] [color_md: dlog_m] [focal_len: 24.00] [latitude: 16.056871] [longitude: -61.748979] [rel_alt: 35.200 abs_alt: 80.196] [ct: 5300] </font>

3
00:00:00,032 --> 00:00:00,049
<font size="28">FrameCnt: 3, DiffTime: 17ms
2026-05-30 05:49:34.641
[iso: 100] [shutter: 1/500.0] [fnum: 1.7] [ev: 0] [color_md: dlog_m] [focal_len: 24.00] [latitude: 16.056871] [longitude: -61.748979] [rel_alt: 35.200 abs_alt: 80.196] [ct: 5300] </font>
"""

private let cue = parseSrt(sampleSrt)[0]

private func with(_ change: (inout Cue) -> Void) -> Cue {
    var c = cue
    change(&c)
    return c
}

final class FormatFieldTests: XCTestCase {
    func testAppendsMetricUnitsForAltitude() {
        XCTAssertEqual(formatField(.relAlt, cue), "35.200 m")
        XCTAssertEqual(formatField(.absAlt, cue), "80.196 m")
    }

    func testPrefixesApertureWithF() {
        XCTAssertEqual(formatField(.fnum, cue), "f/1.7")
    }

    func testSuffixesColourTemperatureAndFocalLength() {
        XCTAssertEqual(formatField(.ct, cue), "5300 K")
        XCTAssertEqual(formatField(.focalLen, cue), "24.00 mm")
    }

    func testPassesRawValuesThroughUntouched() {
        XCTAssertEqual(formatField(.iso, cue), "100")
        XCTAssertEqual(formatField(.shutter, cue), "1/500.0")
    }

    func testReadsFrameAndTimestampOffTheCueNotItsData() {
        XCTAssertEqual(formatField(.frame, cue), "1")
        // Re-formatted rather than echoed: milliseconds are opt-in.
        XCTAssertEqual(formatField(.timestamp, cue), "2026-05-30 05:49:34")
        XCTAssertEqual(formatField(.timestamp, cue, nil, TimeFieldOptions(format: TimeFormatOptions(milliseconds: true))),
                       "2026-05-30 05:49:34.609")
    }

    func testFormatsTheTimeFieldsAndCorrectsThemByTheProjectShift() {
        XCTAssertEqual(formatField(.clock, cue), "05:49:34")
        XCTAssertEqual(formatField(.date, cue), "2026-05-30")

        let opts = TimeFieldOptions(format: TimeFormatOptions(hour12: true, seconds: false), shift: nil)
        XCTAssertEqual(formatField(.clock, cue, nil, opts), "5:49 AM")

        // A correction rolls the date when it crosses midnight — one shift,
        // both fields, so the clock and the date can never disagree.
        let shift = TimeFieldOptions(shift: TimeShift(minutes: -6 * 60, days: 0))
        XCTAssertEqual(formatField(.clock, cue, nil, shift), "23:49:34")
        XCTAssertEqual(formatField(.date, cue, nil, shift), "2026-05-29")
    }

    func testSaysNothingWhenThereIsNoTimestampToRead() {
        let blind = with { $0.timestamp = nil }
        XCTAssertEqual(formatField(.clock, blind), "—")
        XCTAssertEqual(formatField(.date, blind), "—")
        XCTAssertEqual(formatField(.timestamp, blind), "—")
    }

    func testFormatsTheGpsDerivedMotionFieldsOffCueDerived() {
        let moving = with { $0.derived = Motion(groundSpeed: 12.34, verticalSpeed: -1.2, heading: 270) }
        XCTAssertEqual(formatField(.gndSpeed, moving), "12.3 m/s")
        XCTAssertEqual(formatField(.vertSpeed, moving), "-1.2 m/s")
        XCTAssertEqual(formatField(.heading, moving), "270° W")
    }

    func testShowsThePlaceholderWhenMotionWasNotDerivable() {
        // The fixture cues are 16 ms apart, so no motion is derived for them.
        XCTAssertEqual(formatField(.gndSpeed, cue), missingField)
        XCTAssertEqual(formatField(.heading, cue), missingField)
        XCTAssertEqual(formatField(.vertSpeed, with { $0.derived = Motion() }), missingField)
    }

    func testFillsAMissingMotionValueFromTheOpeningWindowLookAhead() {
        let opening = with { $0.derived = Motion(); $0.lead = Motion(groundSpeed: 12.34, heading: 270) }
        XCTAssertEqual(formatField(.gndSpeed, opening), "12.3 m/s")
        XCTAssertEqual(formatField(.heading, opening), "270° W")
        // Opted out on the element, the readout waits for a backward measurement.
        XCTAssertEqual(formatField(.gndSpeed, opening, nil, nil, early: false), missingField)
        XCTAssertEqual(formatField(.heading, opening, nil, nil, early: false), missingField)
    }

    func testNeverLetsTheLookAheadCoverAMeasuredValue() {
        let both = with { $0.derived = Motion(groundSpeed: 3); $0.lead = Motion(groundSpeed: 12.34) }
        XCTAssertEqual(formatField(.gndSpeed, both), "3.0 m/s")
    }

    func testReturnsThePlaceholderWhenTheCueOrValueIsMissing() {
        XCTAssertEqual(formatField(.relAlt, nil), missingField)
        XCTAssertEqual(formatField(.iso, with { $0.data = [:] }), missingField)
        XCTAssertEqual(formatField(.frame, with { $0.frame = nil }), missingField)
    }
}

/// JS `Math.round`: halves toward +∞.
private func jsRound(_ x: Double) -> Double {
    let floor = x.rounded(.down)
    return x - floor >= 0.5 ? floor + 1 : floor
}

/// `1.5` → `00:00:01,500`, the SRT timing shape.
private func srtTime(_ seconds: Double) -> String {
    let ms = Int(jsRound(seconds * 1000))
    func pad(_ n: Int, _ w: Int = 2) -> String {
        let s = String(n)
        return String(repeating: "0", count: max(0, w - s.count)) + s
    }
    return "\(pad(ms / 3_600_000)):\(pad((ms / 60_000) % 60)):\(pad((ms / 1000) % 60)),\(pad(ms % 1000, 3))"
}

/// A 2-second, 30 fps clip flying due north at ~10 m/s.
private func northboundClip() -> String {
    let step = 1.0 / 30
    return (0..<60).map { i -> String in
        let t = Double(i) * step
        let lat = ExifText.toFixed(16 + t * 8.98e-5, 6) // ~10 m/s
        let alt = ExifText.toFixed(35 + t, 3)
        return [
            String(i + 1),
            "\(srtTime(t)) --> \(srtTime(t + step))",
            "<font size=\"28\">FrameCnt: \(i + 1), DiffTime: 33ms",
            "2026-05-30 05:49:34.609",
            "[iso: 100] [latitude: \(lat)] [longitude: -61.000000] [rel_alt: \(alt) abs_alt: 80.196] </font>",
        ].joined(separator: "\n")
    }.joined(separator: "\n\n")
}

final class FirstFrameOfAClipTests: XCTestCase {
    func testReadsItsInstrumentsInsteadOfShowingDashes() {
        let clip = parseSrt(northboundClip())
        let first = clip[0]

        // What the look-back alone can say about frame 1: nothing.
        XCTAssertEqual(formatField(.gndSpeed, first, nil, nil, early: false), missingField)
        XCTAssertEqual(formatField(.heading, first, nil, nil, early: false), missingField)

        // What the clip is actually doing there, measured over the second ahead.
        XCTAssertEqual(formatField(.gndSpeed, first), "10.0 m/s")
        XCTAssertEqual(formatField(.heading, first), "0° N")
        XCTAssertEqual(formatField(.vertSpeed, first), "+1.0 m/s")
    }
}

final class RenderElementTextTests: XCTestCase {
    func testComposesALabelPrefixWithTheValue() {
        let el = createTelemetryElement(.relAlt) // default label "ALT"
        XCTAssertEqual(renderElementText(el, cue), "ALT 35.200 m")
    }

    func testOmitsThePrefixWhenTheLabelIsCleared() {
        var el = createTelemetryElement(.iso)
        el.label = ""
        XCTAssertEqual(renderElementText(el, cue), "100")
    }

    func testReturnsTheLiteralForATextElement() {
        XCTAssertEqual(renderElementText(createTextElement("Sunset flight"), cue), "Sunset flight")
    }

    func testShowsThePlaceholderForAMissingTelemetryValue() {
        var el = createTelemetryElement(.iso)
        el.label = ""
        XCTAssertEqual(renderElementText(el, nil), missingField)
    }

    func testAnticipatesTheOpeningWindowUnlessTheElementOptsOut() {
        let opening = with { $0.derived = Motion(); $0.lead = Motion(groundSpeed: 12.34) }
        var el = createTelemetryElement(.gndSpeed)
        el.label = ""
        XCTAssertEqual(renderElementText(el, opening), "12.3 m/s")
        el.earlyValues = false
        XCTAssertEqual(renderElementText(el, opening), missingField)
    }

    // Beyond the web spec: the element's stored PARTIAL time format reads
    // with the web's defaults.
    func testReadsAnElementsPartialTimeFormat() {
        var el = createTelemetryElement(.clock)
        el.timeFormat = ["hour12": true, "seconds": false]
        XCTAssertEqual(renderElementText(el, cue), "5:49 AM")
        XCTAssertEqual(renderElementText(el, cue, shift: TimeShift(minutes: 60, days: 0)), "6:49 AM")
    }
}
