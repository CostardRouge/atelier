// Port of `src/shared/telemetry/srt-parser.test.ts`, `motion.test.ts` and the
// measuring half of `time-scale.test.ts` (the project setting — the manual
// override — belongs to the Studio and is not ported yet).

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

/// A minimal cue with just the fields the motion maths reads.
private func cue(_ start: Double, _ lat: Double, _ lon: Double, _ relAlt: Double) -> Cue {
    Cue(start: start, end: start, data: ["latitude": String(lat), "longitude": String(lon), "rel_alt": String(relAlt)])
}

/// A 3-second track sampled every 100 ms.
private func trackOf(_ latAt: (Double) -> Double, _ altAt: (Double) -> Double = { _ in 10 }) -> [Cue] {
    (0...30).map { k in
        let t = (Double(k) * 0.1 * 1000).rounded() / 1000
        return cue(t, latAt(t), -61, altAt(t))
    }
}

/// Flying due north at 0.001°/s ≈ 111 m/s, from the very first frame.
private func northbound(_ t: Double) -> Double { 16 + t * 0.001 }

/// Ten seconds of media, one cue every 0.1 s, moving due east at a steady rate.
private func eastbound() -> [Cue] {
    (0...100).map { i in cue(Double(i) / 10, 16, -61 + Double(i) * 0.0001, 35) }
}

/// Every cue's timeline stretched by `factor`: the same flight laid down slowed.
private func stretched(_ cues: [Cue], _ factor: Double) -> [Cue] {
    cues.map { c in
        var out = c
        out.start = c.start * factor
        out.end = c.end * factor
        return out
    }
}

// MARK: - the conform fixtures of time-scale.test.ts

private let epochMillis: Double = {
    var c = DateComponents()
    c.year = 2026; c.month = 5; c.day = 30; c.hour = 5; c.minute = 49; c.second = 34
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    return cal.date(from: c)!.timeIntervalSince1970 * 1000 + 609
}()

private let stampFormatter: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "UTC")
    f.dateFormat = "yyyy-MM-dd HH:mm:ss"
    return f
}()

/// The DJI timestamp line for an epoch reading, milliseconds included.
private func stamp(_ ms: Double) -> String {
    let total = ms.rounded(.towardZero)
    let whole = (total / 1000).rounded(.down)
    let millis = Int(total - whole * 1000)
    return stampFormatter.string(from: Date(timeIntervalSince1970: whole)) + String(format: ".%03d", millis)
}

/// The same line without its milliseconds — a firmware that writes whole seconds.
private func coarse(_ timestamp: String?) -> String? {
    guard let timestamp, let dot = timestamp.firstIndex(of: ".") else { return timestamp }
    return String(timestamp[..<dot])
}

/// A conformed clip: `frames` cues laid on the file's timeline at `mediaFps`,
/// each carrying the wall-clock reading of the moment it was actually shot
/// (`captureFps`). Equal rates = ordinary footage.
private func clip(_ frames: Int, _ mediaFps: Double, _ captureFps: Double,
                  timestamps: Bool = true, diffTime: Bool = true, jitterMs: Double = 0) -> [Cue] {
    (0..<frames).map { i in
        let start = (Double(i) / mediaFps * 1000).rounded() / 1000
        let captured = epochMillis + Double(i) / captureFps * 1000
        let drift = jitterMs != 0 ? Double((i % 3) - 1) * jitterMs : 0
        return Cue(
            start: start,
            end: (Double(i + 1) / mediaFps * 1000).rounded() / 1000,
            frame: i + 1,
            timestamp: timestamps ? stamp((captured + drift).rounded()) : nil,
            diffTime: diffTime ? (1000 / captureFps).rounded() / 1000 : nil,
            data: [:]
        )
    }
}

final class SrtParserTests: XCTestCase {
    private let cues = parseSrt(sampleSrt)

    func testReturnsThreeCuesForTheFixture() {
        XCTAssertEqual(cues.count, 3)
    }

    func testParsesCueTimingInSeconds() {
        XCTAssertEqual(cues[0].start, 0)
        assertClose(cues[0].end, 0.016, 3)
    }

    func testParsesFrameCnt() {
        XCTAssertEqual(cues.map(\.frame), [1, 2, 3])
    }

    func testParsesTheCaptureTimestamp() {
        XCTAssertEqual(cues[0].timestamp, "2026-05-30 05:49:34.609")
    }

    func testParsesDiffTimeInSecondsFromOutsideTheBrackets() {
        assertClose(cues[0].diffTime ?? -1, 0.016, 6)
        assertClose(cues[2].diffTime ?? -1, 0.017, 6)
    }

    func testSplitsTheDoublePairRelAltAbsAltBracket() {
        XCTAssertEqual(cues[0].data["rel_alt"], "35.200")
        XCTAssertEqual(cues[0].data["abs_alt"], "80.196")
    }

    func testParsesSinglePairFields() {
        XCTAssertEqual(cues[0].data["iso"], "100")
        XCTAssertEqual(cues[0].data["latitude"], "16.056870")
        XCTAssertEqual(cues[0].data["longitude"], "-61.748979")
        XCTAssertEqual(cues[0].data["shutter"], "1/500.0")
        XCTAssertEqual(cues[0].data["fnum"], "1.7")
        XCTAssertEqual(cues[0].data["ev"], "0")
        XCTAssertEqual(cues[0].data["color_md"], "dlog_m")
        XCTAssertEqual(cues[0].data["focal_len"], "24.00")
        XCTAssertEqual(cues[0].data["ct"], "5300")
    }

    func testNeverLeaksFontTagsIntoAnyValue() {
        for cue in cues {
            for value in cue.data.values {
                XCTAssertFalse(value.contains("<") || value.contains(">") || value.contains("font"), value)
            }
        }
    }

    func testReturnsCuesSortedByAscendingStart() {
        for i in 1..<cues.count { XCTAssertGreaterThanOrEqual(cues[i].start, cues[i - 1].start) }
    }

    func testReturnsAnEmptyListForUnsupportedOrEmptyInput() {
        XCTAssertEqual(parseSrt(""), [])
        XCTAssertEqual(parseSrt("not an srt file at all"), [])
    }

    func testReadsWindowsLineEndingsAndWhitespaceOnlyBlankLines() {
        let windows = sampleSrt.replacingOccurrences(of: "\n", with: "\r\n")
        XCTAssertEqual(parseSrt(windows).map(\.frame), [1, 2, 3])
        // A "blank" line that holds a space still separates two cues.
        let spaced = sampleSrt.replacingOccurrences(of: "\n\n", with: "\n \n")
        XCTAssertEqual(parseSrt(spaced).map(\.frame), [1, 2, 3])
    }

    func testAttachesTheClipsOwnMotion() {
        // Three cues 16 ms apart span too little to trust a derived speed, and
        // the fixture's positions barely move: nothing is invented.
        XCTAssertEqual(cues[0].derived, Motion())
        XCTAssertNil(cues[2].derived?.heading)
    }
}

final class GeodesyTests: XCTestCase {
    func testHaversineMeasuresAboutOneHundredAndElevenMetresForAThousandthOfADegree() {
        assertClose(haversine(16, -61, 16.001, -61), 111.2, 0)
        XCTAssertEqual(haversine(16, -61, 16, -61), 0)
    }

    func testBearingReadsTheFourCardinalPoints() {
        assertClose(bearing(16, -61, 16.001, -61), 0, 1)
        assertClose(bearing(16, -61, 16, -60.999), 90, 1)
        assertClose(bearing(16, -61, 15.999, -61), 180, 1)
        assertClose(bearing(16, -61, 16, -61.001), 270, 1)
    }

    func testCompass16MapsCardinalsIntercardinalsAndWraps() {
        XCTAssertEqual(compass16(0), "N")
        XCTAssertEqual(compass16(90), "E")
        XCTAssertEqual(compass16(180), "S")
        XCTAssertEqual(compass16(270), "W")
        XCTAssertEqual(compass16(45), "NE")
        XCTAssertEqual(compass16(247.5), "WSW")
        XCTAssertEqual(compass16(360), "N")
        XCTAssertEqual(compass16(-90), "W")
    }
}

final class AttachMotionTests: XCTestCase {
    func testDerivesSpeedClimbAndHeadingOverTheLookBackWindow() {
        var cues = [cue(0, 16, -61, 10), cue(1, 16.001, -61, 12)]
        attachMotion(&cues)
        assertClose(cues[1].derived?.groundSpeed ?? -1, 111.2, 0)
        assertClose(cues[1].derived?.verticalSpeed ?? -1, 2, 3)
        assertClose(cues[1].derived?.heading ?? -1, 0, 1)
    }

    func testLeavesTheFirstCueWithoutAPredecessorEmpty() {
        var cues = [cue(0, 16, -61, 10), cue(1, 16.001, -61, 12)]
        attachMotion(&cues)
        XCTAssertEqual(cues[0].derived, Motion())
    }

    func testSuppressesHeadingWhileHoveringButStillReportsTheClimbRate() {
        var cues = [cue(0, 16, -61, 10), cue(1, 16, -61, 13)]
        attachMotion(&cues)
        XCTAssertNil(cues[1].derived?.heading)
        assertClose(cues[1].derived?.groundSpeed ?? -1, 0, 3)
        assertClose(cues[1].derived?.verticalSpeed ?? -1, 3, 3)
    }

    func testDoesNotDeriveWhenTheSpannedTimeIsTooShortToTrust() {
        var cues = [cue(0, 16, -61, 10), cue(0.016, 16.001, -61, 12)]
        attachMotion(&cues)
        XCTAssertEqual(cues[1].derived, Motion())
    }

    func testFirstIndexAtOrAfterMirrorsLastIndexAtOrBefore() {
        let cues = trackOf(northbound)
        XCTAssertEqual(firstIndexAtOrAfter(cues, 0), 0)
        XCTAssertEqual(firstIndexAtOrAfter(cues, 1), 10)
        XCTAssertEqual(firstIndexAtOrAfter(cues, 0.95), 10)
        XCTAssertEqual(firstIndexAtOrAfter(cues, 99), -1)
        XCTAssertEqual(lastIndexAtOrBefore(cues, 1), 10)
        XCTAssertEqual(lastIndexAtOrBefore(cues, -1), -1)
        XCTAssertEqual(cueAt(cues, 1.05)?.start, 1)
        XCTAssertNil(cueAt(cues, -1))
    }

    func testGivesTheFirstCueTheReadingItIsAboutToHave() {
        var cues = trackOf(northbound) { t in 10 + t * 2 }
        attachMotion(&cues)
        XCTAssertEqual(cues[0].derived, Motion())
        assertClose(cues[0].lead?.groundSpeed ?? -1, 111.2, 0)
        assertClose(cues[0].lead?.verticalSpeed ?? -1, 2, 3)
        assertClose(cues[0].lead?.heading ?? -1, 0, 1)
    }

    func testAttachesNothingWhereTheLookBackAlreadyAnswers() {
        var cues = trackOf(northbound)
        attachMotion(&cues)
        XCTAssertNotNil(cues[0].lead)
        XCTAssertNotNil(cues[2].lead)
        XCTAssertNil(cues[3].lead)
    }

    func testReachesNoFurtherThanTheOpeningWindow() {
        var cues = trackOf { t in t < 2 ? 16 : 16 + (t - 2) * 0.001 }
        attachMotion(&cues)
        XCTAssertNil(cues[15].derived?.heading)
        XCTAssertNil(cues[15].lead)
    }

    func testNeverOverwritesAValueTheLookBackCouldMeasure() {
        var cues = trackOf { t in t < 0.6 ? 16 : 16 + (t - 0.6) * 0.001 }
        attachMotion(&cues)
        let at = cues[5]
        assertClose(at.start, 0.5, 3)
        assertClose(at.derived?.groundSpeed ?? -1, 0, 3)
        XCTAssertNil(at.derived?.heading)
        assertClose(motionAt(at).groundSpeed ?? -1, 0, 3)
        assertClose(motionAt(at).heading ?? -1, 0, 1)
    }

    func testInventsNothingForAnAircraftThatStaysPut() {
        var cues = trackOf { _ in 16 }
        attachMotion(&cues)
        XCTAssertNil(motionAt(cues[0]).heading)
        assertClose(motionAt(cues[0]).groundSpeed ?? -1, 0, 3)
    }

    func testMotionAtFillsTheMissingValuesFromAheadOrNothingWhenAsked() {
        var cues = trackOf(northbound)
        attachMotion(&cues)
        assertClose(motionAt(cues[0]).groundSpeed ?? -1, 111.2, 0)
        XCTAssertEqual(motionAt(cues[0], early: false), Motion())
        XCTAssertEqual(motionAt(nil), Motion())
        XCTAssertEqual(motionAt(cues[20]), cues[20].derived)
    }

    func testReadsTheSameGroundSpeedWhateverCadenceTheClipWasConformedTo() {
        var real = eastbound()
        attachMotion(&real)
        let atSpeed = real[80].derived?.groundSpeed ?? 0
        XCTAssertGreaterThan(atSpeed, 0)
        var slow = stretched(eastbound(), 4)
        attachMotion(&slow, timeScale: 0.25)
        assertClose(slow[80].derived?.groundSpeed ?? -1, atSpeed, 6)
    }

    func testUnderReportsByExactlyTheConformFactorWhenTheScaleIsIgnored() {
        var slow = stretched(eastbound(), 4)
        attachMotion(&slow, timeScale: 1)
        let wrong = slow[80].derived?.groundSpeed ?? 0
        attachMotion(&slow, timeScale: 0.25)
        let right = slow[80].derived?.groundSpeed ?? 0
        assertClose(right / wrong, 4, 6)
    }

    func testLeavesTheHeadingAlone() {
        var slow = stretched(eastbound(), 4)
        attachMotion(&slow, timeScale: 1)
        let uncorrected = slow[80].derived?.heading ?? 0
        attachMotion(&slow, timeScale: 0.25)
        let corrected = slow[80].derived?.heading ?? 0
        assertClose(uncorrected, 90, 3)
        assertClose(corrected, 90, 3)
    }

    func testScalesTheVerticalSpeedTheSameWay() {
        var climbing = stretched(eastbound(), 4)
        for i in climbing.indices { climbing[i].data["rel_alt"] = String(35 + Double(i) * 0.2) }
        attachMotion(&climbing, timeScale: 0.25)
        assertClose(climbing[80].derived?.verticalSpeed ?? -1, 2, 1)
    }

    func testReDerivingIsIdempotentNeverCompounding() {
        var cues = eastbound()
        attachMotion(&cues, timeScale: 0.25)
        let once = cues[80].derived?.groundSpeed
        attachMotion(&cues, timeScale: 0.25)
        XCTAssertEqual(cues[80].derived?.groundSpeed, once)
    }

    func testRetimeCuesAnswersWithANewListAndLeavesTheOriginalUntouched() {
        var cues = [cue(0, 16, -61, 35), cue(1, 16, -60.9999, 35), cue(2, 16, -60.9998, 35)]
        attachMotion(&cues)
        let before = cues[2].derived?.groundSpeed ?? 0
        let retimed = retimeCues(cues, timeScale: 0.5)
        XCTAssertEqual(cues[2].derived?.groundSpeed, before)
        assertClose(retimed[2].derived?.groundSpeed ?? -1, before * 2, 6)
    }
}

final class MotionFormatTests: XCTestCase {
    func testFormatsGroundSpeedToOneDecimalWithUnits() {
        XCTAssertEqual(formatGroundSpeed(12.34), "12.3 m/s")
        XCTAssertNil(formatGroundSpeed(nil))
    }

    func testSignsVerticalSpeedAndCollapsesNearZero() {
        XCTAssertEqual(formatVerticalSpeed(2), "+2.0 m/s")
        XCTAssertEqual(formatVerticalSpeed(-0.8), "-0.8 m/s")
        XCTAssertEqual(formatVerticalSpeed(0.02), "0.0 m/s")
        XCTAssertNil(formatVerticalSpeed(nil))
    }

    func testConvertsIntoEveryOfferedUnitSignKept() {
        XCTAssertEqual(formatGroundSpeed(10, unit: .kilometresPerHour), "36.0 km/h")
        XCTAssertEqual(formatGroundSpeed(10, unit: .milesPerHour), "22.4 mph")
        XCTAssertEqual(formatVerticalSpeed(-2, unit: .milesPerHour), "-4.5 mph")
        XCTAssertEqual(formatVerticalSpeed(2, unit: .kilometresPerHour), "+7.2 km/h")
        XCTAssertEqual(SpeedUnit.allCases.map(\.rawValue), ["m/s", "km/h", "mph"])
    }

    func testFormatsHeadingAsDegreesPlusCompassPoint() {
        XCTAssertEqual(formatHeading(0), "0° N")
        XCTAssertEqual(formatHeading(90), "90° E")
        XCTAssertEqual(formatHeading(247.5), "248° WSW")
        XCTAssertNil(formatHeading(nil))
    }
}

final class TimeScaleTests: XCTestCase {
    private func assertSnap(_ fps: Double, _ want: Double, _ snapped: Bool, file: StaticString = #filePath, line: UInt = #line) {
        let got = snapRate(fps)
        XCTAssertEqual(got.fps, want, file: file, line: line)
        XCTAssertEqual(got.snapped, snapped, file: file, line: line)
    }

    func testSnapRatePullsAJitteryMeasurementOntoTheRateTheCameraReallyShoots() {
        assertSnap(120.4, 120, true)
        assertSnap(24.2, 24, true)
    }

    func testSnapRatePicksTheNearestCandidateNotTheFirst() {
        assertSnap(30, 30, true)
        assertSnap(29.972, 29.97, true)
        assertSnap(59.88, 59.94, true)
    }

    func testSnapRateLeavesARateThatIsNothingStandardAlone() {
        assertSnap(37, 37, false)
    }

    func testMeasureMediaFpsReadsTheFileCadenceThroughMillisecondQuantisation() {
        XCTAssertEqual(measureMediaFps(clip(600, 60, 60)), 60)
        XCTAssertEqual(measureMediaFps(clip(300, 30, 120)), 30)
    }

    func testMeasureMediaFpsSurvivesAHole() {
        let head = clip(200, 30, 30)
        let tail = clip(200, 30, 30).map { c -> Cue in
            var out = c
            out.start += 900
            out.end += 900
            return out
        }
        XCTAssertEqual(measureMediaFps(head + tail), 30)
    }

    func testMeasureMediaFpsSaysNothingRatherThanGuessingFromTwoCues() {
        XCTAssertNil(measureMediaFps(clip(2, 30, 30)))
        XCTAssertNil(measureMediaFps([]))
    }

    func testReadsOrdinaryFootageAsRealTime() {
        let r = measureTimeScale(clip(600, 60, 60))
        XCTAssertEqual(r.scale, 1)
        XCTAssertEqual(r.basis, .timestamps)
        XCTAssertEqual(r.mediaFps, 60)
        XCTAssertTrue(isRealtime(r.scale))
    }

    func testMeasuresAFourTimesSlowMotionConformExactly() {
        let r = measureTimeScale(clip(600, 30, 120))
        assertClose(r.scale, 0.25, 6)
        XCTAssertEqual(r.mediaFps, 30)
        XCTAssertEqual(r.captureFps, 120)
        XCTAssertTrue(r.snapped)
    }

    func testMeasuresATimeLapseTheSameWayInTheOtherDirection() {
        let r = measureTimeScale(clip(300, 30, 0.5))
        assertClose(r.scale, 60, 1)
        XCTAssertEqual(timeScaleTag(r.scale), "60× fast")
    }

    func testShrugsOffAClockThatHadNotBeenSetOnTheFirstCues() {
        var cues = clip(600, 30, 120)
        for i in 0..<5 { cues[i].timestamp = stamp(0) }
        assertClose(measureTimeScale(cues).scale, 0.25, 2)
    }

    func testFallsBackToDiffTimeWhenNoCueCarriesATimestamp() {
        let r = measureTimeScale(clip(600, 30, 120, timestamps: false))
        XCTAssertEqual(r.basis, .diffTime)
        assertClose(r.scale, 0.25, 6)
    }

    func testReportsNothingMeasurableRatherThanAFabricatedCadence() {
        let r = measureTimeScale(clip(600, 30, 120, timestamps: false, diffTime: false))
        XCTAssertEqual(r.basis, TimeScaleReading.Basis.none)
        XCTAssertEqual(r.scale, 1)
        XCTAssertEqual(r.mediaFps, 30)
        XCTAssertNil(r.captureFps)
        XCTAssertNil(formatCadence(r))
        XCTAssertEqual(measureTimeScale([]), .realtime)
    }

    func testDoesNotCallMillisecondJitterASlowMotion() {
        XCTAssertEqual(measureTimeScale(clip(600, 60, 60, jitterMs: 2)).scale, 1)
    }

    func testIgnoresAClockThatRunsBackwardsInsteadOfInvertingTheClip() {
        var cues = clip(600, 60, 60)
        for i in cues.indices { cues[i].timestamp = stamp(epochMillis - Double(i) / 60 * 1000) }
        XCTAssertEqual(measureTimeScale(cues).scale, 1)
    }

    func testIsNotFooledByAFirmwareThatWritesWholeSeconds() {
        var coarseReal = clip(1200, 60, 60)
        for i in coarseReal.indices { coarseReal[i].timestamp = coarse(coarseReal[i].timestamp) }
        XCTAssertEqual(measureTimeScale(coarseReal).scale, 1)

        var coarseSlow = clip(1200, 30, 120)
        for i in coarseSlow.indices { coarseSlow[i].timestamp = coarse(coarseSlow[i].timestamp) }
        assertClose(measureTimeScale(coarseSlow).scale, 0.25, 2)
    }

    func testRefusesRatherThanGuessesWhenTheClockIsTooCoarseForTheClip() {
        var short = clip(150, 30, 30, diffTime: false)
        for i in short.indices { short[i].timestamp = coarse(short[i].timestamp) }
        let r = measureTimeScale(short)
        XCTAssertEqual(r.basis, TimeScaleReading.Basis.none)
        XCTAssertEqual(r.scale, 1)

        var withDiff = clip(150, 30, 120)
        for i in withDiff.indices { withDiff[i].timestamp = coarse(withDiff[i].timestamp) }
        let d = measureTimeScale(withDiff)
        XCTAssertEqual(d.basis, .diffTime)
        assertClose(d.scale, 0.25, 6)
    }

    func testReadsAWholeMillisecondDiffTimeAsTheRateThatWroteIt() {
        let r = measureTimeScale(clip(600, 30, 120, timestamps: false))
        XCTAssertEqual(r.basis, .diffTime)
        XCTAssertEqual(r.captureFps, 120)
        assertClose(r.scale, 0.25, 6)

        let fast = measureTimeScale(clip(600, 30, 240, timestamps: false))
        XCTAssertEqual(fast.captureFps, 240)
        assertClose(fast.scale, 0.125, 6)

        var odd = clip(600, 30, 120, timestamps: false)
        for i in odd.indices { odd[i].diffTime = 0.013 }
        XCTAssertEqual(measureTimeScale(odd).basis, TimeScaleReading.Basis.none)
    }

    func testSaysNothingAboutAFileThatIsSubtitlesNotAFlightLog() {
        let spans: [(Double, Double)] = [(1, 3.5), (4, 6.2), (6.5, 9), (9.4, 12), (12.5, 15), (16, 18)]
        let captions = spans.map { Cue(start: $0.0, end: $0.1) }
        let r = measureTimeScale(captions)
        XCTAssertEqual(r, .realtime)
        XCTAssertNil(r.mediaFps)
    }

    func testRefusesAClockThatStalledAcrossMostOfTheClip() {
        var cues = clip(600, 30, 30, diffTime: false)
        let held = cues[120].timestamp
        for i in 120..<540 { cues[i].timestamp = held }
        XCTAssertEqual(measureTimeScale(cues).basis, TimeScaleReading.Basis.none)
    }

    func testMeasuresFromAHeadAndTailSampleAsWellAsFromTheWholeLog() {
        let whole = clip(3600, 30, 120)
        let sampled = Array(whole[0..<400]) + Array(whole[3200...])
        assertClose(measureTimeScale(sampled).scale, measureTimeScale(whole).scale, 6)
    }

    func testSaysNothingAtAllAboutOrdinaryFootage() {
        XCTAssertNil(timeScaleTag(1))
        XCTAssertNil(describeTimeScale(1))
        XCTAssertNil(describeTimeScale(1.005))
    }

    func testNeverRendersAFactorItHasJustCalledAbnormalAsOne() {
        XCTAssertEqual(describeTimeScale(1.03), "1.03× time-lapse")
        XCTAssertEqual(timeScaleTag(0.97), "1.03× slow")
    }

    func testNamesTheTwoDirectionsTheWayAShooterThinksOfThem() {
        XCTAssertEqual(describeTimeScale(0.25), "4× slow motion")
        XCTAssertEqual(describeTimeScale(0.4), "2.5× slow motion")
        XCTAssertEqual(describeTimeScale(10), "10× time-lapse")
        XCTAssertEqual(timeScaleTag(0.25), "4× slow")
    }

    func testSpellsTheCadenceAsCaptureToPlaybackOnlyWhenTheyDiffer() {
        XCTAssertEqual(formatCadence(measureTimeScale(clip(600, 30, 120))), "120 → 30 fps")
        XCTAssertEqual(formatCadence(measureTimeScale(clip(600, 60, 60))), "60 fps")
        XCTAssertNil(formatCadence(.realtime))
    }

    func testParseSrtMeasuresTheScaleItselfUnlessToldOne() {
        let auto = parseSrt(sampleSrt)
        let fixed = parseSrt(sampleSrt, timeScale: .fixed(0.25))
        XCTAssertEqual(auto.count, fixed.count)
        assertClose(wallClockMillis("2026-05-30 05:49:34.609") ?? -1, epochMillis, 3)
        XCTAssertNil(wallClockMillis("yesterday"))
    }
}
