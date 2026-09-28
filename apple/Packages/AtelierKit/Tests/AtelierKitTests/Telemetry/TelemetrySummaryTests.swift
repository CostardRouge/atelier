// Port of `src/shared/telemetry/telemetry-summary.test.ts`.

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

final class TelemetrySummaryTests: XCTestCase {
    private let summary = summarizeTelemetry(parseSrt(sampleSrt))

    func testCountsCues() {
        XCTAssertEqual(summary.cueCount, 3)
    }

    func testComputesRelAltMinMax() {
        assertClose(summary.relAltMin ?? -1, 35.2, 3)
        assertClose(summary.relAltMax ?? -1, 35.2, 3)
    }

    func testTakesCoordinatesFromTheFirstCue() {
        XCTAssertEqual(summary.startLatitude, "16.056870")
        XCTAssertEqual(summary.startLongitude, "-61.748979")
    }

    func testReportsTheColorProfile() {
        XCTAssertEqual(summary.colorProfile, "dlog_m")
    }

    func testReturnsAZeroedSummaryForAnEmptyTrack() {
        let empty = summarizeTelemetry([])
        XCTAssertEqual(empty.cueCount, 0)
        XCTAssertNil(empty.relAltMin)
        XCTAssertNil(empty.relAltMax)
        XCTAssertNil(empty.startLatitude)
        XCTAssertNil(empty.colorProfile)
    }

    func testSpansTheAltitudeAcrossTheWholeTrack() {
        let cues = [
            Cue(start: 0, end: 1, data: ["rel_alt": "12"]),
            Cue(start: 1, end: 2, data: ["rel_alt": "nan"]),
            Cue(start: 2, end: 3, data: ["rel_alt": "3.5", "latitude": "16", "color_md": "hlg"]),
            Cue(start: 3, end: 4, data: ["rel_alt": "40", "latitude": "17"]),
        ]
        let s = summarizeTelemetry(cues)
        XCTAssertEqual(s.relAltMin, 3.5)
        XCTAssertEqual(s.relAltMax, 40)
        XCTAssertEqual(s.startLatitude, "16")
        XCTAssertNil(s.startLongitude)
        XCTAssertEqual(s.colorProfile, "hlg")
    }
}
