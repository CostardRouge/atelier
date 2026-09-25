// Port of `src/shared/lib/format.test.ts`, plus the rules of `formatTimecode`,
// which the web never pinned.

import Foundation
import XCTest
@testable import AtelierKit

final class FormatBytesTests: XCTestCase {
    func testFormatsBytesKBMBGB() {
        XCTAssertEqual(formatBytes(512), "512 B")
        XCTAssertEqual(formatBytes(1500), "1.5 KB")
        XCTAssertEqual(formatBytes(2_500_000), "2.5 MB")
        XCTAssertEqual(formatBytes(3_200_000_000), "3.2 GB")
    }

    func testHandlesInvalidInput() {
        XCTAssertEqual(formatBytes(-1), "—")
        XCTAssertEqual(formatBytes(Double.nan), "—")
    }

    // Not in the web spec: the two JavaScript spellings the port emulates.
    func testRoundsAHalfUpAndDropsTheDecimalPastAHundred() {
        XCTAssertEqual(formatBytes(250_500), "251 KB")
        XCTAssertEqual(formatBytes(412_800_000), "413 MB")
        XCTAssertEqual(formatBytes(999.0), "999 B")
    }
}

final class FormatDurationTests: XCTestCase {
    func testFormatsMSSAndHMMSS() {
        XCTAssertEqual(formatDuration(75), "1:15")
        XCTAssertEqual(formatDuration(3661), "1:01:01")
    }

    func testReportsUnavailableForNilOrInvalid() {
        XCTAssertEqual(formatDuration(nil), "duration unavailable")
        XCTAssertEqual(formatDuration(Double.nan), "duration unavailable")
    }
}

final class FormatTimecodeTests: XCTestCase {
    // Not in the web spec: `M:SS.cs`, floored, and a refusal for nonsense.
    func testReadsMinutesSecondsAndCentiseconds() {
        XCTAssertEqual(formatTimecode(0), "0:00.00")
        XCTAssertEqual(formatTimecode(75.5), "1:15.50")
        XCTAssertEqual(formatTimecode(3.999), "0:03.99")
        XCTAssertEqual(formatTimecode(600), "10:00.00")
    }

    func testRefusesANegativeOrNonFinitePosition() {
        XCTAssertEqual(formatTimecode(-1), "0:00.00")
        XCTAssertEqual(formatTimecode(Double.nan), "0:00.00")
        XCTAssertEqual(formatTimecode(Double.infinity), "0:00.00")
    }
}
