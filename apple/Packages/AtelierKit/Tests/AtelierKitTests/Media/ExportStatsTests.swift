// Port of `src/shared/media/export-stats.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func stat(bytes: Int = 412_800_000, seconds: Double = 108, clipSeconds: Double? = 120) -> ExportStat {
    ExportStat(bytes: bytes, seconds: seconds, clipSeconds: clipSeconds)
}

final class FormatElapsedTests: XCTestCase {
    func testKeepsADecimalUnderTenSecondsWhereItIsTheDifference() {
        XCTAssertEqual(formatElapsed(8.34), "8.3 s")
        XCTAssertEqual(formatElapsed(0.4), "0.4 s")
    }

    func testRoundsToWholeSecondsUnderAMinute() {
        XCTAssertEqual(formatElapsed(41.4), "41 s")
        XCTAssertEqual(formatElapsed(59.6), "60 s")
    }

    func testSplitsMinutesAndSecondsPaddedSoTheColumnLinesUp() {
        XCTAssertEqual(formatElapsed(108), "1 min 48 s")
        XCTAssertEqual(formatElapsed(125), "2 min 05 s")
        XCTAssertEqual(formatElapsed(3599), "59 min 59 s")
    }

    func testDropsToHoursAndMinutesPastAnHour() {
        XCTAssertEqual(formatElapsed(3600), "1 h 00 min")
        XCTAssertEqual(formatElapsed(3900), "1 h 05 min")
    }

    func testRefusesToInventAFigureForNonsense() {
        XCTAssertEqual(formatElapsed(Double.nan), "—")
        XCTAssertEqual(formatElapsed(-1), "—")
    }
}

final class FormatSpeedTests: XCTestCase {
    func testReadsAsAMultipleOfRealtime() {
        XCTAssertEqual(formatSpeed(120, 108), "1.1× realtime")
        XCTAssertEqual(formatSpeed(120, 41), "2.9× realtime")
    }

    func testDropsTheDecimalOnceTheRatioIsLarge() {
        XCTAssertEqual(formatSpeed(600, 40), "15× realtime")
    }

    func testSaysNothingRatherThanGuessingWithoutAClipDuration() {
        XCTAssertNil(formatSpeed(nil, 108))
        XCTAssertNil(formatSpeed(0, 108))
        XCTAssertNil(formatSpeed(120, 0))
    }
}

final class DescribeExportStatTests: XCTestCase {
    func testReadsSizeTimeThenSpeed() {
        XCTAssertEqual(describeExportStat(stat()), "413 MB · 1 min 48 s · 1.1× realtime")
    }

    func testLeavesTheSpeedOutEntirelyWhenTheDurationIsUnknown() {
        XCTAssertEqual(describeExportStat(stat(clipSeconds: nil)), "413 MB · 1 min 48 s")
    }
}

final class ExportRunTotalTests: XCTestCase {
    func testSumsBytesAndSeconds() {
        let stats = [stat(), stat(bytes: 38_200_000, seconds: 41)]
        let total = totalExportStats(stats)
        XCTAssertEqual(total.bytes, 451_000_000)
        XCTAssertEqual(total.seconds, 149)
        XCTAssertEqual(describeExportRun(stats), "2 files · 451 MB · 2 min 29 s")
    }

    func testSays1FileForASingleVariant() {
        XCTAssertEqual(describeExportRun([stat()]), "1 file · 413 MB · 1 min 48 s")
    }

    func testIsEmptySafe() {
        let total = totalExportStats([])
        XCTAssertEqual(total.bytes, 0)
        XCTAssertEqual(total.seconds, 0)
    }
}
