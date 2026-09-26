// Port of `src/shared/roadtrip/hooks/scrub-plan.test.ts`. The web re-exports
// the easings, the tick kits and `hexToRgba` from `scrub-plan.ts`; here they
// are their own modules' names (`hookEasings`, `tickKits`, `hexToRgba`), read
// by the same cases.

import XCTest
@testable import AtelierKit

/// A trip of `total` days starting 2025-03-01, told on the given day numbers.
private func calendar(_ total: Int, _ told: [Int] = [], _ legs: [Int] = [1]) -> [HookDay] {
    (0..<total).map { i in
        let isTold = told.contains(i + 1)
        let pieces = isTold
            ? [HookDayPiece(id: "p\(i + 1)", title: "", published: false,
                            media: SavedMediaRef(name: "p\(i + 1).jpg", size: 1, lastModified: 0), videoSeconds: 0)]
            : []
        return HookDay(date: addDays("2025-03-01", i)!, dayNumber: i + 1, told: isTold,
                       legStart: legs.contains(i + 1), pieces: pieces)
    }
}

private func dateOf(_ cal: [HookDay], _ n: Int) -> String { cal[n - 1].date }

private func opts(_ patch: (inout ScrubOptions) -> Void = { _ in }) -> ScrubOptions {
    var o = ScrubOptions.defaults
    patch(&o)
    return o
}

private func dayNumbers(_ seeds: [ScrubSeed]?) -> [Int] {
    seeds!.map(\.day.dayNumber)
}

final class ScrubOptionsReadTests: XCTestCase {
    func testFillsWhatADocumentNeverStored() {
        XCTAssertEqual(scrubOptions([:]), scrubDefaults)
    }

    func testClampsWhatItDidStoreAndRefusesWhatItCannotRead() {
        let o = scrubOptions(["maxStops": 400, "sweepSeconds": -2, "runUpDays": "lots", "mode": "sideways", "tape": 7])
        XCTAssertEqual(o.maxStops, 16)
        XCTAssertEqual(o.sweepSeconds, 0.8)
        XCTAssertEqual(o.runUpDays, 2)
        XCTAssertEqual(o.mode, .fromStart)
        XCTAssertEqual(o.tape, .bottom)
    }
}

final class ScrubSampleEvenlyTests: XCTestCase {
    func testKeepsTheFirstAndTheLast() {
        let out = sampleEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)
        XCTAssertEqual(out.first, 1)
        XCTAssertEqual(out.last, 10)
        XCTAssertEqual(out.count, 4)
    }

    func testNeverRepeatsAnItemToReachACount() {
        XCTAssertEqual(sampleEvenly([1, 2, 3], 8), [1, 2, 3])
    }
}

final class ScrubStopFractionTests: XCTestCase {
    func testStartsAtZeroAndLandsAtTheEnd() {
        XCTAssertEqual(stopFraction(0, 12), 0)
        XCTAssertEqual(stopFraction(11, 12), 1)
    }

    func testDeceleratesEveryGapBetweenStopsIsLongerThanTheOneBefore() {
        let times = (0..<12).map { stopFraction($0, 12) }
        let gaps = (1..<times.count).map { times[$0] - times[$0 - 1] }
        for i in 1..<gaps.count { XCTAssertGreaterThan(gaps[i], gaps[i - 1]) }
    }
}

final class ScrubEasingsTests: XCTestCase {
    func testEveryCurveRunsZeroToOneAndItsInverseUndoesIt() {
        for id in hookEasingIds {
            let spec = hookEasings[id]!
            assertClose(spec.ease(0), 0, 9)
            assertClose(spec.ease(1), 1, 9)
            for k in 0...20 {
                let u = Double(k) / 20
                assertClose(spec.inverse(spec.ease(u)), u, 6)
            }
        }
    }

    func testEveryCurveIsMonotonicAStopIsNeverReachedBeforeTheOneBeforeIt() {
        for id in hookEasingIds {
            let ease = hookEasings[id]!.ease
            var last = -1.0
            for k in 0...100 {
                let v = ease(Double(k) / 100)
                XCTAssertGreaterThanOrEqual(v, last, id.rawValue)
                last = v
            }
        }
    }

    func testPlacesStopsTheWayEachCurveSays() {
        // Even: equal gaps. Wind up: the gaps SHRINK. Brake: the first gap is tiny.
        let linear = (0..<5).map { stopFraction($0, 5, .linear) }
        XCTAssertEqual(linear, [0, 0.25, 0.5, 0.75, 1])
        let windUp = (0..<5).map { stopFraction($0, 5, .easeIn) }
        let gaps = (1..<windUp.count).map { windUp[$0] - windUp[$0 - 1] }
        for i in 1..<gaps.count { XCTAssertLessThan(gaps[i], gaps[i - 1]) }
        XCTAssertLessThan(stopFraction(1, 12, .easeOutHard), stopFraction(1, 12, .easeOut))
    }
}

final class ScrubSeedsPiecesTests: XCTestCase {
    func testSweepsFromDayOneToTheHeroThroughToldDaysOnly() {
        let cal = calendar(30, [3, 8, 14, 20])
        let seeds = scrubSeeds(cal, dateOf(cal, 27), opts())!
        XCTAssertEqual(dayNumbers(seeds), [1, 3, 8, 14, 20, 27])
        // Day 1 is visited because the sweep STARTS there, not because it was told.
        XCTAssertFalse(seeds[0].day.told)
        XCTAssertNil(seeds[0].want)
    }

    func testCapsTheStopsKeepingTheStartAndTheHero() {
        let cal = calendar(100, (0..<60).map { $0 + 2 })
        let seeds = scrubSeeds(cal, dateOf(cal, 90), opts { $0.maxStops = 8 })!
        XCTAssertEqual(seeds.count, 8)
        XCTAssertEqual(seeds[0].day.dayNumber, 1)
        XCTAssertEqual(seeds[seeds.count - 1].day.dayNumber, 90)
    }

    func testRunsUpThroughTheLastToldDaysBeforeTheHero() {
        let cal = calendar(40, [2, 5, 9, 12, 15, 18, 21, 24])
        let seeds = scrubSeeds(cal, dateOf(cal, 30), opts { $0.mode = .runUp; $0.runUpDays = 3 })
        XCTAssertEqual(dayNumbers(seeds), [18, 21, 24, 30])
    }

    func testStillSweepsATripNothingHasBeenToldFromFlashingNothing() {
        let cal = calendar(20)
        let seeds = scrubSeeds(cal, dateOf(cal, 15), opts())!
        XCTAssertEqual(seeds[0].day.dayNumber, 1)
        XCTAssertEqual(seeds[seeds.count - 1].day.dayNumber, 15)
        XCTAssertTrue(seeds.allSatisfy { $0.want == nil })
        XCTAssertGreaterThan(seeds.count, 2)
    }

    func testRefusesADayThatIsNotADayOfTheTrip() {
        XCTAssertNil(scrubSeeds(calendar(10), "2031-01-01", opts()))
    }

    func testAsksForTheSourcePictureOfThePieceStandingForEachDayThePublishedOneFirst() {
        var cal = calendar(10, [4])
        cal[3].pieces = [
            HookDayPiece(id: "draft", title: "", published: false,
                         media: SavedMediaRef(name: "draft.jpg", size: 1, lastModified: 0), videoSeconds: 0),
            HookDayPiece(id: "bare", title: "", published: true, media: nil, videoSeconds: 0),
            HookDayPiece(id: "live", title: "", published: true,
                         media: SavedMediaRef(name: "live.mov", size: 2, lastModified: 0), videoSeconds: 3.5),
        ]
        let seed = scrubSeeds(cal, dateOf(cal, 8), opts())!.first { $0.day.dayNumber == 4 }!
        XCTAssertEqual(seed.want?.ref.name, "live.mov")
        XCTAssertEqual(seed.want?.atSeconds, 3.5)
        XCTAssertEqual(seed.want?.key, hookPictureKey(SavedMediaRef(name: "live.mov", size: 2, lastModified: 0)))
    }
}

final class ScrubSeedsPickedTests: XCTestCase {
    private let cal = calendar(30, [], [1, 10])

    private func pic(_ name: String, _ day: Int, _ takenAt: Double? = nil) -> HookPickedPicture {
        HookPickedPicture(ref: SavedMediaRef(name: name, size: 1, lastModified: 0),
                          date: day > 0 ? dateOf(cal, day) : "2024-01-01", takenAt: takenAt)
    }

    private func picked(_ list: [HookPickedPicture]) -> ScrubOptions {
        opts { $0.stopsOn = .picked; $0.picked = list }
    }

    func testStopsOnceAPictureInTheOrderTheyWereShotTheHeroLast() {
        let seeds = scrubSeeds(cal, dateOf(cal, 20),
                               picked([pic("c", 12), pic("b", 10, 200), pic("a", 10, 100), pic("d", 5)]))!
        XCTAssertEqual(seeds.map { $0.want?.ref.name ?? "hero" }, ["d", "a", "b", "c", "hero"])
        XCTAssertEqual(seeds.map(\.day.dayNumber), [5, 10, 10, 12, 20])
    }

    func testSoundsALegsStartOnceOnTheFirstPictureOfThatDay() {
        let seeds = scrubSeeds(cal, dateOf(cal, 20), picked([pic("a", 10, 1), pic("b", 10, 2)]))!
        XCTAssertEqual(seeds.map(\.legStart), [true, false, false])
    }

    func testLeavesOutWhatWasShotAfterThisPiecesDayOrOutsideTheTripAndSaysHowMany() {
        let list = [pic("ok", 3), pic("hero-day", 20), pic("later", 25), pic("elsewhere", 0)]
        let seeds = scrubSeeds(cal, dateOf(cal, 20), picked(list))!
        XCTAssertEqual(seeds.map { $0.want?.ref.name ?? "hero" }, ["ok", "hero-day", "hero"])
        let split = partitionPicked(cal, dateOf(cal, 20), list)
        XCTAssertEqual(split.after, 1)
        XCTAssertEqual(split.outside, 1)
    }

    func testThinsALongListEvenlyRatherThanCuttingIt() {
        let list = (0..<90).map { pic("p\($0)", 1 + ($0 % 19), Double($0)) }
        let seeds = scrubSeeds(cal, dateOf(cal, 20), picked(list))!
        XCTAssertEqual(seeds.count, pickedMaxStops + 1)
    }

    func testMarksEveryPickedStopAsFlashingItsOwnPictureNeverTheHero() {
        let plan = scrubPlan(cal, dateOf(cal, 20), picked([pic("a", 4), pic("b", 4)]))!
        XCTAssertEqual(plan.stops.map(\.told), [true, true, false])
        XCTAssertEqual(plan.stops[0].pictureKey, hookPictureKey(pic("a", 4).ref))
        XCTAssertNil(plan.stops[2].pictureKey)
        // Two pictures of one day: the head holds on the tick while the frame changes.
        assertClose(plan.headDayAt(plan.stops[1].at), 4, 6)
    }

    func testAsksTheShellForEachPictureOnceAndNeverForTheHero() {
        let seeds = scrubSeeds(cal, dateOf(cal, 20), picked([pic("a", 4), pic("b", 6)]))!
        XCTAssertEqual(scrubWants(seeds).map(\.ref.name), ["a", "b"])
    }
}

final class ScrubPlanTests: XCTestCase {
    private let cal = calendar(30, [3, 8, 14, 20])
    private lazy var plan = scrubPlan(cal, dateOf(cal, 27), opts { $0.sweepSeconds = 2 })!

    func testLandsTheHeadExactlyOnEveryStopAtThatStopsTime() {
        for (i, stop) in plan.stops.enumerated() {
            XCTAssertEqual(plan.stopAt(stop.at), i)
            assertClose(plan.headDayAt(stop.at), Double(stop.dayNumber), 6)
        }
    }

    func testRestsOnTheHeroOnceTheSweepIsOver() {
        XCTAssertEqual(plan.stopAt(5), plan.stops.count - 1)
        XCTAssertEqual(plan.headDayAt(5), 27)
    }

    func testNeverFlashesTheHeroWhosePictureIsAlreadyOnTheFrame() {
        let hero = plan.stops[plan.stops.count - 1]
        XCTAssertTrue(hero.hero)
        XCTAssertFalse(hero.told)
        XCTAssertEqual(plan.stops.filter(\.told).map(\.dayNumber), [3, 8, 14, 20])
    }

    func testMeasuresTheTimeSinceTheHeadLastLanded() {
        let second = plan.stops[1]
        assertClose(plan.sinceStopAt(second.at + 0.01), 0.01, 6)
    }

    func testHasNothingToSweepWhenTheHeroIsTheFirstDay() {
        let first = scrubPlan(cal, dateOf(cal, 1), opts())!
        XCTAssertEqual(first.sweepSeconds, 0)
        XCTAssertEqual(first.stops.count, 1)
        XCTAssertEqual(first.headDayAt(0), 1)
    }

    func testReadsTheLegsOffTheCalendar() {
        let legs = scrubPlan(calendar(30, [], [1, 11, 21]), dateOf(cal, 25), opts())!
        XCTAssertEqual(legs.legStarts, [1, 11, 21])
    }

    func testHoldsOnTheFirstStopForTheDelayThenSweepsEveryStopShiftedByIt() {
        let held = scrubPlan(cal, dateOf(cal, 27), opts { $0.sweepSeconds = 2; $0.delaySeconds = 0.5 })!
        XCTAssertEqual(held.delaySeconds, 0.5)
        assertClose(held.endSeconds, 2.5, 9)
        XCTAssertEqual(held.stops[0].at, 0.5)
        assertClose(held.stops[held.stops.count - 1].at, 2.5, 9)
        // During the hold the head has not left: first stop, first day, nothing "since".
        XCTAssertEqual(held.stopAt(0.3), 0)
        XCTAssertEqual(held.headDayAt(0.3), Double(held.stops[0].dayNumber))
        XCTAssertLessThan(held.sinceStopAt(0.3), 0)
        // The score is shifted with the stops.
        XCTAssertEqual(scrubScore(held)[0].at, 0.5)
    }

    func testHasNoDelayWhenThereIsNowhereToSweepFrom() {
        let first = scrubPlan(cal, dateOf(cal, 1), opts { $0.delaySeconds = 1 })!
        XCTAssertEqual(first.endSeconds, 0)
    }

    func testLandsTheHeadOnEveryStopAtThatStopsTimeOnEveryEasing() {
        for easing in hookEasingIds {
            let p = scrubPlan(cal, dateOf(cal, 27), opts { $0.easing = easing; $0.sweepSeconds = 2 })!
            for (i, stop) in p.stops.enumerated() {
                XCTAssertEqual(p.stopAt(stop.at), i, easing.rawValue)
                assertClose(p.headDayAt(stop.at), Double(stop.dayNumber), 6)
            }
        }
    }
}

final class ScrubTapeTests: XCTestCase {
    func testPlacesTheFirstAndTheLastDayAtItsTwoEnds() {
        XCTAssertEqual(tapeFraction(1, 104), 0)
        XCTAssertEqual(tapeFraction(104, 104), 1)
        XCTAssertEqual(tapeFraction(1, 1), 0)
    }

    func testTicksEveryDayWhileThereIsRoom() {
        XCTAssertEqual(tapeTicks(10, 900, []), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    }

    func testThinsOutALongTripButKeepsItsEndsAndEveryLegStart() {
        let ticks = tapeTicks(400, 800, [137, 251])
        XCTAssertLessThan(ticks.count, 400)
        XCTAssertTrue(ticks.contains(1))
        XCTAssertTrue(ticks.contains(400))
        XCTAssertTrue(ticks.contains(137))
        XCTAssertTrue(ticks.contains(251))
    }
}

final class ScrubScoreTests: XCTestCase {
    func testLandsASoundOnEveryStopAtThatStopsOwnTime() {
        let cal = calendar(30, [3, 8, 14, 20], [1, 14])
        let plan = scrubPlan(cal, dateOf(cal, 27), opts())!
        XCTAssertEqual(scrubScore(plan).map(\.at), plan.stops.map(\.at))
    }

    func testMarksALegWithItsOwnVoiceAndEndsOnTheSeat() {
        let cal = calendar(30, [3, 8, 14, 20], [1, 14])
        let plan = scrubPlan(cal, dateOf(cal, 27), opts())!
        let score = scrubScore(plan)
        func voiceOn(_ day: Int) -> String {
            score[plan.stops.firstIndex { $0.dayNumber == day }!].voice
        }
        XCTAssertEqual(voiceOn(14), "leg")
        XCTAssertEqual(voiceOn(8), "detent")
        XCTAssertEqual(score[score.count - 1].voice, "seat")
    }

    func testGetsQuieterAsTheMechanismSlowsTheSeatApart() {
        let cal = calendar(60, [4, 9, 15, 22, 30, 37], [])
        let plan = scrubPlan(cal, dateOf(cal, 44), opts())!
        let levels = scrubScore(plan).dropLast().map { $0.gain ?? 0 }
        for i in 1..<levels.count { XCTAssertLessThanOrEqual(levels[i], levels[i - 1]) }
    }

    func testIsSilentWhenThereIsNowhereToSweepFrom() {
        let cal = calendar(10, [2])
        XCTAssertEqual(scrubScore(scrubPlan(cal, dateOf(cal, 1), opts())!), [])
    }

    func testScalesEveryTickByTheVolumeKeepingTheirShape() {
        let cal = calendar(30, [3, 8, 14, 20], [1, 14])
        let plan = scrubPlan(cal, dateOf(cal, 27), opts())!
        let full = scrubScore(plan, 1)
        let half = scrubScore(plan, 0.5)
        for (i, event) in half.enumerated() {
            XCTAssertEqual(event.at, full[i].at)
            assertClose(event.gain ?? 0, (full[i].gain ?? 0) * 0.5, 9)
        }
    }

    func testWritesNoScoreAtAllAtVolumeZeroSoNoSilentTrackIsMade() {
        let cal = calendar(30, [3, 8])
        XCTAssertEqual(scrubScore(scrubPlan(cal, dateOf(cal, 20), opts())!, 0), [])
    }

    func testReadsTheVolumeThroughTheDefaultsClampedAndFallsBackWhenUnreadable() {
        XCTAssertEqual(scrubOptions([:]).tickVolume, 1)
        XCTAssertEqual(scrubOptions(["tickVolume": 9]).tickVolume, 2)
        XCTAssertEqual(scrubOptions(["tickVolume": -1]).tickVolume, 0)
        XCTAssertEqual(scrubOptions(["tickVolume": "loud"]).tickVolume, 1)
    }

    func testReadsTheSoundSwitchThroughTheDefaults() {
        XCTAssertTrue(scrubOptions([:]).sound)
        XCTAssertFalse(scrubOptions(["sound": false]).sound)
    }
}

final class ScrubScoreTuningTests: XCTestCase {
    private let cal = calendar(30, [3, 8, 14, 20], [1, 14])
    private lazy var plan = scrubPlan(cal, dateOf(cal, 27), opts())!
    private var legIndex: Int { plan.stops.firstIndex { $0.dayNumber == 14 }! }

    func testPlaysEveryKitOnItsOwnVoicesTheSeatStayingTheSeat() {
        for id in kitIds {
            let kit = tickKits[id]!
            let score = scrubScore(plan, 1, ScrubTuning(kit: id, pitch: 1, drift: .flat))
            XCTAssertEqual(score[1].voice, kit.tick.rawValue)
            XCTAssertEqual(score[legIndex].voice, kit.leg.voice.rawValue)
            XCTAssertEqual(score[score.count - 1].voice, kit.seat.rawValue)
        }
    }

    func testMakesALegsLandingTheDifferentOneInEveryKitLowerALittleLouder() {
        for id in kitIds {
            let score = scrubScore(plan, 1, ScrubTuning(kit: id, pitch: 1, drift: .flat))
            let plain = score[legIndex - 1]
            let leg = score[legIndex]
            if id == .ratchet {
                XCTAssertNotEqual(leg.voice, plain.voice)
            } else {
                XCTAssertLessThan(leg.rate ?? 1, plain.rate ?? 1)
                XCTAssertGreaterThan((leg.gain ?? 0) / max(0.35, 0.85 - Double(legIndex) * 0.04), 1)
            }
        }
    }

    func testTransposesEveryTickByThePitchTheSeatIncluded() {
        let up = scrubScore(plan, 1, ScrubTuning(kit: .ratchet, pitch: 2, drift: .flat))
        XCTAssertTrue(up.allSatisfy { $0.rate == 2 })
    }

    func testClimbsOrFallsAcrossTheLandingsAndLeavesTheSeatAtThePitch() {
        let rising = scrubScore(plan, 1, ScrubTuning(kit: .ratchet, pitch: 1, drift: .rising))
        let landings = rising.dropLast().map { $0.rate ?? 1 }
        for i in 1..<landings.count { XCTAssertGreaterThan(landings[i], landings[i - 1]) }
        assertClose(landings[0], driftSpan.from, 9)
        assertClose(landings[landings.count - 1], driftSpan.to, 9)
        XCTAssertEqual(rising[rising.count - 1].rate, 1)

        let falling = scrubScore(plan, 1, ScrubTuning(kit: .ratchet, pitch: 1, drift: .falling))
        let down = falling.dropLast().map { $0.rate ?? 1 }
        for i in 1..<down.count { XCTAssertLessThan(down[i], down[i - 1]) }
    }

    func testKeepsASteadyDriftAtExactlyThePitch() {
        XCTAssertEqual(driftAt(.flat, 0), 1)
        XCTAssertEqual(driftAt(.flat, 1), 1)
        assertClose(driftAt(.rising, 0.5), (driftSpan.from + driftSpan.to) / 2, 9)
    }

    func testReadsTheTuningThroughTheDefaultsAndRefusesWhatItCannot() {
        XCTAssertEqual(scrubOptions([:]).kit, .ratchet)
        XCTAssertEqual(scrubOptions(["kit": "kazoo"]).kit, .ratchet)
        XCTAssertEqual(scrubOptions(["kit": "wood"]).kit, .wood)
        XCTAssertEqual(scrubOptions(["tickPitch": 9]).tickPitch, 2)
        XCTAssertEqual(scrubOptions(["tickPitch": "high"]).tickPitch, 1)
        XCTAssertEqual(scrubOptions(["pitchDrift": "sideways"]).pitchDrift, .flat)
        XCTAssertEqual(scrubOptions(["pitchDrift": "rising"]).pitchDrift, .rising)
    }
}

final class ScrubStoredOptionsTests: XCTestCase {
    func testRefusesAnEasingItDoesNotKnowAndClampsTheHold() {
        XCTAssertEqual(scrubOptions(["easing": "bouncy"]).easing, .easeOut)
        XCTAssertEqual(scrubOptions(["easing": "linear"]).easing, .linear)
        XCTAssertEqual(scrubOptions(["delaySeconds": 9]).delaySeconds, 2)
        XCTAssertEqual(scrubOptions(["delaySeconds": "long"]).delaySeconds, 0)
    }

    func testKeepsOnlyPickedPicturesItCanFindAgainOnceEach() {
        let o = scrubOptions([
            "stopsOn": "picked",
            "picked": [
                ["ref": ["name": "a.jpg", "size": 3, "lastModified": 1, "assetId": "w/1", "extra": "x"],
                 "date": "2025-03-04", "takenAt": 5],
                ["ref": ["name": "again.jpg", "size": 9, "lastModified": 1, "assetId": "w/1"], "date": "2025-03-04"],
                ["ref": ["name": ""], "date": "2025-03-04"],
                ["ref": ["name": "b.jpg"], "date": "tuesday"],
                "c.jpg",
                ["ref": ["name": "d.jpg", "size": "big"], "date": "2025-03-05", "takenAt": "noon"],
            ],
        ])
        XCTAssertEqual(o.stopsOn, .picked)
        XCTAssertEqual(o.picked, [
            HookPickedPicture(ref: SavedMediaRef(name: "a.jpg", size: 3, lastModified: 1, assetId: "w/1"),
                              date: "2025-03-04", takenAt: 5),
            HookPickedPicture(ref: SavedMediaRef(name: "d.jpg", size: 0, lastModified: 0), date: "2025-03-05"),
        ])
        XCTAssertEqual(scrubOptions(["picked": "all"]).picked, [])
        XCTAssertEqual(scrubOptions(["stopsOn": "sometimes"]).stopsOn, .pieces)
    }
}

final class ScrubTapeGeometryTests: XCTestCase {
    func testCentresTheTapeAtTheWidthAskedForOnEitherEdge() {
        let bottom = tapeGeometry(1080, 1920, TapeGeometryOptions(tape: .bottom, tapeWidth: 0.86, edgeOffset: 0.045))
        assertClose(bottom.length, 928.8, 6)
        assertClose(bottom.x0, (1080 - 928.8) / 2, 6)
        assertClose(bottom.x1 - bottom.x0, bottom.length, 6)
        assertClose(bottom.baseline, 1920 * 0.955, 6)
        XCTAssertEqual(bottom.dir, -1)
        XCTAssertEqual(bottom.u, 1)
        let top = tapeGeometry(540, 960, TapeGeometryOptions(tape: .top, tapeWidth: 0.5, edgeOffset: 0.1))
        assertClose(top.baseline, 96, 6)
        XCTAssertEqual(top.dir, 1)
        XCTAssertEqual(top.u, 0.5)
        XCTAssertEqual(top.x0, 135)
    }

    func testMovesTheTapeByItsOffsetsAndPlacesAnUnmovedOneExactlyAsBefore() {
        let still = tapeGeometry(1080, 1920, TapeGeometryOptions(tape: .bottom, tapeWidth: 0.5, edgeOffset: 0.045,
                                                                 offsetX: 0, offsetY: 0))
        XCTAssertEqual(still.x0, 270)
        assertClose(still.baseline, 1920 * 0.955, 6)
        let moved = tapeGeometry(1080, 1920, TapeGeometryOptions(tape: .bottom, tapeWidth: 0.5, edgeOffset: 0.045,
                                                                 offsetX: 0.1, offsetY: -0.3))
        assertClose(moved.x0, 270 + 108, 6)
        assertClose(moved.baseline, 1920 * (0.955 - 0.3), 6)
    }

    func testKeepsADraggedBandInsideTheFrameOnTheFramesOwnAspect() {
        // A bottom tape dragged to the very top: its ticks grow UP, so the
        // baseline stops where the band's top meets the frame's.
        let g = tapeGeometry(1920, 1080, TapeGeometryOptions(tape: .bottom, tapeWidth: 1, edgeOffset: 0.02, offsetY: -0.96))
        assertClose(g.band.y, 0, 6)
        XCTAssertLessThanOrEqual(g.band.y + g.band.height, 1080)
    }

    func testGrabsTheBandThatCoversTheHeadAndTheTallestTickOnEitherEdge() {
        for tape in [TapePosition.bottom, .top] {
            let o = TapeGeometryOptions(tape: tape, tapeWidth: 0.86, edgeOffset: 0.045, tickHeight: 2)
            let g = tapeGeometry(1080, 1920, o)
            let box = tapeBox(1080, 1920, o)
            XCTAssertEqual(box, g.band)
            let reach = max(g.tallTick, g.headTall)
            let far = g.baseline + g.dir * reach
            XCTAssertGreaterThanOrEqual(min(g.baseline, far), box.y)
            XCTAssertLessThanOrEqual(max(g.baseline, far), box.y + box.height)
            XCTAssertLessThan(box.x, g.x0)
            XCTAssertGreaterThan(box.x + box.width, g.x1)
        }
    }

    func testDragsByIncrementsAndNeverPastAnEndOrOffTheFrame() {
        let o = opts { $0.tapeWidth = 0.6 }
        let once = moveTape(o, 0.1, -0.2)
        assertClose(once.offsetX, 0.1, 6)
        assertClose(once.offsetY, -0.2, 6)
        XCTAssertTrue(tapeMoved(once))
        let twice = moveTape(once, 0.1, -0.2)
        // Sideways, only until an end meets the edge: (1 - 0.6) / 2.
        assertClose(twice.offsetX, 0.2, 6)
        assertClose(twice.offsetY, -0.4, 6)
        let far = moveTape(twice, -5, -5)
        assertClose(far.offsetX, -0.2, 6)
        // The baseline stays inside: from 1 - 0.045 up to the edge minimum.
        assertClose(far.offsetY, 0.02 - 0.955, 6)
        XCTAssertEqual(moveTape(o, .nan, 0).offsetX, 0)
        XCTAssertFalse(tapeMoved(o))
        // A full-width tape moves up and down only.
        XCTAssertEqual(moveTape(opts { $0.tapeWidth = 1 }, 0.3, 0).offsetX, 0)
    }

    func testReadsAStoredDragAgainstThePlacementItIsMeasuredFrom() {
        assertClose(scrubOptions(["offsetX": 0.4, "tapeWidth": 0.6]).offsetX, 0.2, 6)
        // Widened after the drag: the tape comes back inside the frame.
        assertClose(scrubOptions(["offsetX": 0.2, "tapeWidth": 0.9]).offsetX, 0.05, 6)
        assertClose(scrubOptions(["offsetY": 0.5, "tape": "bottom"]).offsetY, 0.98 - 0.955, 6)
        XCTAssertEqual(scrubOptions(["offsetX": "left"]).offsetX, 0)
    }

    func testFadesToNothingAtTheEndsAndToFullPastTheRampOrNotAtAllWhenOff() {
        let x0 = 100.0
        let x1 = 1100.0
        let ramp = 1000 * edgeFadeShare
        XCTAssertEqual(edgeFadeAt(x0, x0, x1, true), 0)
        XCTAssertEqual(edgeFadeAt(x1, x0, x1, true), 0)
        XCTAssertEqual(edgeFadeAt(600, x0, x1, true), 1)
        XCTAssertEqual(edgeFadeAt(x0 + ramp, x0, x1, true), 1)
        let half = edgeFadeAt(x0 + ramp / 2, x0, x1, true)
        assertClose(half, 0.5, 9)
        assertClose(edgeFadeAt(x1 - ramp / 2, x0, x1, true), half, 9)
        XCTAssertEqual(edgeFadeAt(x0, x0, x1, false), 1)
    }

    func testTurnsAHexColourIntoRgbaAndNeverThrowsOnABadOne() {
        XCTAssertEqual(hexToRgba("#d9442a", 0.5), "rgba(217,68,42,0.5)")
        XCTAssertEqual(hexToRgba("#FFFFFF", 2), "rgba(255,255,255,1)")
        XCTAssertEqual(hexToRgba("vermilion", 0.3), "rgba(255,255,255,0.3)")
    }

    func testReadsTheLookThroughTheDefaultsAndRefusesWhatItCannot() {
        let o = scrubOptions([:])
        XCTAssertEqual(o.tapeWidth, 0.86)
        XCTAssertEqual(o.tickColor, "#ffffff")
        XCTAssertEqual(o.passedColor, "#d9442a")
        XCTAssertEqual(o.headStyle, .bar)
        XCTAssertTrue(o.headGlow)
        XCTAssertTrue(o.showTrack)
        XCTAssertFalse(o.tapeBackground)
        XCTAssertFalse(o.edgeFade)
        let odd = scrubOptions([
            "tapeWidth": 3,
            "edgeOffset": -1,
            "tickColor": "red",
            "passedColor": "#ABCDEF",
            "tickOpacity": 0,
            "tickHeight": "tall",
            "tickGap": 99,
            "showTrack": false,
            "tapeBackground": true,
            "backgroundOpacity": 5,
            "edgeFade": true,
            "headStyle": "arrow",
            "headGlow": false,
        ])
        XCTAssertEqual(odd.tapeWidth, 1)
        XCTAssertEqual(odd.edgeOffset, 0.02)
        XCTAssertEqual(odd.tickColor, "#ffffff")
        XCTAssertEqual(odd.passedColor, "#abcdef")
        XCTAssertEqual(odd.tickOpacity, 0.15)
        XCTAssertEqual(odd.tickHeight, 1)
        XCTAssertEqual(odd.tickGap, 30)
        XCTAssertFalse(odd.showTrack)
        XCTAssertTrue(odd.tapeBackground)
        XCTAssertEqual(odd.backgroundOpacity, 0.9)
        XCTAssertTrue(odd.edgeFade)
        XCTAssertEqual(odd.headStyle, .bar)
        XCTAssertFalse(odd.headGlow)
    }
}
