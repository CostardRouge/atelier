// Port of `src/shared/roadtrip/hook-video.test.ts` — every case: the clip's
// speed and slice, the screen time a clip can hold, the hook's default
// length, its range, its variant and its file name, and the demuxer's refusal.

import XCTest
@testable import AtelierKit

final class HookVideoClipSpeedTests: XCTestCase {
    func testOffersTheStudiosOwnStepsWithOneAmongThem() {
        XCTAssertTrue(clipSpeeds.contains(1))
        for s in clipSpeeds { XCTAssertEqual(clipSpeed(s), s) }
    }

    func testReadsAnythingOddAsAsShot() {
        for s: Double? in [0, -2, .nan, .infinity, nil, 1000] {
            XCTAssertEqual(clipSpeed(s), 1)
        }
    }
}

final class HookVideoClipSliceTests: XCTestCase {
    func testIsTheInPointPlusTheScreenTimeAsShot() {
        XCTAssertEqual(clipSlice(3, 5, 1, 60), TrimRange(start: 3, end: 8))
    }

    func testReachesTwiceAsFarIntoTheSourceAt2xAndHalfAsFarAtHalf() {
        XCTAssertEqual(clipSlice(3, 5, 2, 60), TrimRange(start: 3, end: 13))
        XCTAssertEqual(clipSlice(3, 5, 0.5, 60), TrimRange(start: 3, end: 5.5))
    }

    func testNeverReachesPastTheEndOfTheClip() {
        XCTAssertEqual(clipSlice(8, 5, 2, 10), TrimRange(start: 8, end: 10))
    }

    func testAssumesTheClipIsLongEnoughWhileItsDurationIsUnknown() {
        XCTAssertEqual(clipSlice(3, 5, 2, 0), TrimRange(start: 3, end: 13))
        XCTAssertEqual(clipSlice(3, 5, 1, .nan), TrimRange(start: 3, end: 8))
    }

    func testNeverReturnsAnEmptyOrInvertedSlice() {
        let cases: [(Double, Double, Double, Double)] = [
            (100, 5, 1, 10), (9.99, 5, 4, 10), (-4, 5, 0.25, 10), (3, -5, 2, 10), (3, 0, 1, 10),
        ]
        for (start, length, speed, duration) in cases {
            let r = clipSlice(start, length, speed, duration)
            XCTAssertGreaterThan(r.end, r.start)
            XCTAssertGreaterThanOrEqual(r.start, 0)
            XCTAssertLessThanOrEqual(r.end, duration)
        }
    }
}

final class HookVideoScreenSecondsTests: XCTestCase {
    func testIsTheSourceStretchDividedByTheSpeed() {
        XCTAssertEqual(screenSecondsOf(TrimRange(start: 3, end: 13), 2), 5)
        XCTAssertEqual(screenSecondsOf(TrimRange(start: 3, end: 5.5), 0.5), 5)
        XCTAssertEqual(screenSecondsOf(TrimRange(start: 3, end: 8), 1), 5)
    }

    func testRoundTripsWithClipSlice() {
        for speed in clipSpeeds {
            assertClose(screenSecondsOf(clipSlice(2, 4, speed, 120), speed), 4, 2)
        }
    }

    func testTheCeilingIsWhatIsLeftOfTheClipAfterTheInPointAtTheSpeed() {
        XCTAssertEqual(screenSecondsCeiling(4, 1, 10), 6)
        XCTAssertEqual(screenSecondsCeiling(4, 2, 10), 3)
        XCTAssertEqual(screenSecondsCeiling(4, 0.5, 10), 12)
    }

    func testTheCeilingStaysInsideTheControlsOwnBounds() {
        XCTAssertEqual(screenSecondsCeiling(0, 0.25, 600), maxHookSeconds)
        XCTAssertEqual(screenSecondsCeiling(9.9, 4, 10), minHookSeconds)
        XCTAssertEqual(screenSecondsCeiling(0, 1, 0), maxHookSeconds)
    }

    func testWithinKeepsTheAskWhenTheClipHoldsItAndClampsWhenItDoesNot() {
        XCTAssertEqual(screenSecondsWithin(5, 0, 1, 60), 5)
        XCTAssertEqual(screenSecondsWithin(9, 4, 1, 10), 6)
        // Half speed: 6 s of footage is 12 s on screen, so 9 s fits.
        XCTAssertEqual(screenSecondsWithin(9, 4, 0.5, 10), 9)
        XCTAssertEqual(screenSecondsWithin(9, 4, 2, 10), 3)
    }

    func testRetimingKeepsTheFootageAndMovesTheScreenTime() {
        // 6 s on screen as shot is 6 s of footage: 3 s at 2×, 12 s at 0.5×.
        XCTAssertEqual(retimedScreenSeconds(6, 1, 2), 3)
        XCTAssertEqual(retimedScreenSeconds(6, 1, 0.5), 12)
        // And back again.
        XCTAssertEqual(retimedScreenSeconds(3, 2, 1), 6)
    }

    func testRetimingNeverClaimsMoreThanTheControlOffers() {
        XCTAssertEqual(retimedScreenSeconds(20, 1, 0.25), maxHookSeconds)
    }
}

final class HookVideoDefaultSecondsTests: XCTestCase {
    func testGivesTheBadgeItsHoldPlusABeatOfPicture() {
        XCTAssertEqual(defaultHookSeconds(4), 5)
    }

    func testStaysInsideWhatTheControlOffersWhateverItIsHanded() {
        for d in [-10, 0, 0.2, 4, 120, Double.nan, Double.infinity] {
            let v = defaultHookSeconds(d)
            XCTAssertGreaterThanOrEqual(v, minHookSeconds)
            XCTAssertLessThanOrEqual(v, maxHookSeconds)
        }
    }

    func testAHoldThatWasNeverWrittenIsTheShortestHook() {
        XCTAssertEqual(defaultHookSeconds(nil), 1)
    }
}

final class HookVideoRangeTests: XCTestCase {
    func testStartsOnTheFrameTheAuthorPicked() {
        XCTAssertEqual(hookRange(3, 5, 60), TrimRange(start: 3, end: 8))
    }

    func testStopsAtTheEndOfTheClipRatherThanPastIt() {
        XCTAssertEqual(hookRange(8, 5, 10), TrimRange(start: 8, end: 10))
    }

    func testIsNilWhenTheWholeClipAlreadyGoesOut() {
        XCTAssertNil(hookRange(0, 30, 6))
    }

    func testIsNilWhenTheDurationIsNotKnownYet() {
        XCTAssertNil(hookRange(0, 5, 0))
        XCTAssertNil(hookRange(2, 5, .nan))
    }

    func testReadsTheLengthAsScreenTimeSoASpeedReachesFurtherIntoTheSource() {
        XCTAssertEqual(hookRange(3, 5, 60, 2), TrimRange(start: 3, end: 13))
        XCTAssertEqual(hookRange(3, 5, 60, 0.5), TrimRange(start: 3, end: 5.5))
        // 10 s of a 10 s clip at 2× is the whole clip: no trim.
        XCTAssertNil(hookRange(0, 5, 10, 2))
    }

    func testNeverReturnsAnEmptyOrInvertedSlice() {
        let cases: [(Double, Double, Double)] = [(100, 5, 10), (9.99, 5, 10), (-4, 5, 10), (3, -5, 10)]
        for (start, length, duration) in cases {
            guard let r = hookRange(start, length, duration) else { continue }
            XCTAssertGreaterThan(r.end, r.start)
            XCTAssertGreaterThanOrEqual(r.start, 0)
            XCTAssertLessThanOrEqual(r.end, duration)
        }
    }
}

final class HookVideoVariantTests: XCTestCase {
    func testBurnsTheOverlaysInAHookWithoutThemIsNotAHook() {
        XCTAssertTrue(hookVariant("9:16").overlays)
    }

    func testKeepsTheClipsOwnCadenceAndSpeed() {
        let v = hookVariant("9:16")
        XCTAssertEqual(v.frameRate, .source)
        XCTAssertEqual(v.speed, 1)
    }

    func testCarriesTheSlidesSpeedIntoThePipelineClampedLikeTheStudios() {
        XCTAssertEqual(hookVariant("9:16", .shortSide(1080), 2).speed, 2)
        XCTAssertEqual(hookVariant("9:16", .shortSide(1080), 0.5).speed, 0.5)
        XCTAssertEqual(hookVariant("9:16", .shortSide(1080), .nan).speed, 1)
    }

    func testCarriesThePostsFrame() {
        XCTAssertEqual(hookVariant("4:5").aspectId, "4:5")
    }

    func testTheNameSaysTheTripThePieceAndThatItIsTheHook() {
        XCTAssertEqual(hookVideoName("Australia", "day 27", hookVariant("9:16")), "australia-day-27-hook-9x16-1080p.mp4")
    }

    func testTheNameSurvivesANamelessTripAndANamelessPiece() {
        XCTAssertEqual(hookVideoName("", "", hookVariant("source", .source)), "hook.mp4")
    }

    func testTheNameIsALegalFileNameWhateverWasTyped() {
        let name = hookVideoName("Australie / 2025", "Jour 27 — départ!", hookVariant("9:16"))
        XCTAssertNil(name.range(of: #"[/\\:*?"<>|]"#, options: .regularExpression))
        XCTAssertTrue(name.hasSuffix(".mp4"))
    }

    func testTheNameLeavesTheSpeedOutItIsCompositionNotASecondCut() {
        XCTAssertEqual(hookVideoName("Australia", "day 27", hookVariant("9:16", .shortSide(1080), 2)),
                       "australia-day-27-hook-9x16-1080p.mp4")
    }
}

final class HookVideoSecondsWithinTests: XCTestCase {
    func testFollowsTheBadgeUntilTheAuthorSaysOtherwise() {
        XCTAssertEqual(hookSecondsWithin(nil, 4, 60), 5)
        XCTAssertEqual(hookSecondsWithin(9, 4, 60), 9)
    }

    func testNeverClaimsMoreThanTheClipHolds() {
        XCTAssertEqual(hookSecondsWithin(9, 4, 3), 3)
        XCTAssertEqual(hookSecondsWithin(nil, 20, 2.5), 2.5)
    }

    func testFallsBackToTheFullRangeWhileTheDurationIsUnknown() {
        XCTAssertEqual(hookSecondsWithin(12, 4, 0), 12)
    }

    func testStaysAtLeastTheMinimumHoweverShortTheClip() {
        XCTAssertEqual(hookSecondsWithin(nil, 4, 0.2), minHookSeconds)
    }

    func testCountsFromTheInPointAtTheSpeed() {
        // 10 s clip, in at 4 s: 6 s of footage — 3 s on screen at 2×, 12 at 0.5×.
        XCTAssertEqual(hookSecondsWithin(9, 4, 10, 4, 1), 6)
        XCTAssertEqual(hookSecondsWithin(9, 4, 10, 4, 2), 3)
        XCTAssertEqual(hookSecondsWithin(9, 4, 10, 4, 0.5), 9)
    }
}

final class HookVideoSourceProblemTests: XCTestCase {
    func testPassesWhatThePipelineCanActuallyDemux() {
        XCTAssertNil(hookSourceProblem("DJI_0042.MP4"))
        XCTAssertNil(hookSourceProblem("clip.mov"))
        XCTAssertNil(hookSourceProblem("clip", "video/mp4"))
    }

    func testNamesTheFileAndSaysTheStillStillWorks() throws {
        let said = try XCTUnwrap(hookSourceProblem("clip.webm", "video/webm"))
        XCTAssertTrue(said.contains("clip.webm"))
        XCTAssertTrue(said.contains("PNG"))
    }
}
