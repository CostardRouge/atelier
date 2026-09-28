// Port of `src/shared/telemetry/find-cue.test.ts`.

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

private let cues = parseSrt(sampleSrt)

final class FindCueTests: XCTestCase {
    func testReturnsTheCueActiveAtTimeTLastCueWithStartAtOrBeforeT() {
        XCTAssertEqual(findCue(cues, 0.02)?.frame, 2)
    }

    func testReturnsTheFirstCueExactlyAtItsStart() {
        XCTAssertEqual(findCue(cues, 0)?.frame, 1)
    }

    func testReturnsNilBeforeTheFirstCue() {
        XCTAssertNil(findCue(cues, -1))
    }

    func testReturnsTheLastCuePastTheEnd() {
        XCTAssertEqual(findCue(cues, 9999)?.frame, 3)
    }

    func testReturnsNilForEmptyCueLists() {
        XCTAssertNil(findCue([], 5))
    }

    func testIsTheSameSearchAsCueAt() {
        for t in [-1, 0, 0.01, 0.016, 0.02, 0.032, 5] {
            XCTAssertEqual(findCue(cues, t)?.frame, cueAt(cues, t)?.frame, "t = \(t)")
        }
    }
}
