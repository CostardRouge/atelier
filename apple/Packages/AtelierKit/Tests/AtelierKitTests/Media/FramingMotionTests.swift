// Port of `src/shared/media/framing-motion.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

// A 3:2 landscape framed into a 9:16 reel — the case the feature exists for.
private let srcW = 3000.0, srcH = 2000.0
private let dstW = 1080.0, dstH = 1920.0
private let box = PictureBox(srcW: srcW, srcH: srcH, dstW: dstW, dstH: dstH)

private func key(_ at: Double, _ scale: Double, _ x: Double, _ y: Double) -> FramingKey {
    FramingKey(at: at, scale: scale, x: x, y: y)
}

private func motion(_ keys: [FramingKey], easing: EasingId = .linear, steps: Int? = nil, start: MotionStart = .slide) -> FramingMotion {
    FramingMotion(keys: keys, easing: easing, steps: steps, start: start)
}

/// The point of the picture in the middle of the frame, in 0..1 of the picture.
private func centre(_ f: Framing) -> (x: Double, y: Double) {
    let (x, y) = unframePoint(dstW / 2, dstH / 2, srcW, srcH, dstW, dstH, f)
    return (x / srcW, y / srcH)
}

final class ReadMotionTests: XCTestCase {
    func testTurnsAnythingThatIsNotAListOfKeysIntoNoMotion() {
        XCTAssertNil(readMotion(nil))
        XCTAssertNil(readMotion(.null))
        XCTAssertNil(readMotion([:]))
        XCTAssertNil(readMotion(["keys": []]))
        XCTAssertNil(readMotion(["keys": [["at": "x", "scale": 2, "x": 0, "y": 0]]]))
    }

    func testKeepsFiniteKeysSortedClampedOnePerInstant() {
        let m = readMotion([
            "keys": [
                ["at": 0.5, "scale": 12, "x": 0.1, "y": 0],
                ["at": -1, "scale": 0.5, "x": 0, "y": 0],
                ["at": 0.5, "scale": 2, "x": 0.2, "y": 0],
                ["at": 3, "scale": 2, "x": 0, "y": .number(.nan)],
            ],
            "easing": "nope",
            "start": "whenever",
        ])
        XCTAssertNotNil(m)
        XCTAssertEqual(m!.keys.map(\.at), [0, 0.5])
        XCTAssertEqual(m!.keys[0].scale, 1)
        // The later write at the same instant wins.
        XCTAssertEqual(m!.keys[1], key(0.5, 2, 0.2, 0))
        XCTAssertEqual(m!.easing, .inOutCubic)
        XCTAssertEqual(m!.start, .slide)
    }

    func testKeepsAStepCountOnlyForTheSteppedCurve() {
        XCTAssertEqual(readMotion(["keys": [["at": 0, "scale": 2, "x": 0, "y": 0]], "easing": "steps", "steps": 40])!.steps, 12)
        XCTAssertNil(readMotion(["keys": [["at": 0, "scale": 2, "x": 0, "y": 0]], "easing": "linear", "steps": 4])!.steps)
    }

    func testNeverLetsAKeySitOnTheRest() {
        XCTAssertLessThan(readMotion(["keys": [["at": 1, "scale": 2, "x": 0, "y": 0]]])!.keys[0].at, 1)
    }

    // Not in the web spec: the writer is the reader's inverse, `steps` only when held.
    func testWritesBackWhatItRead() {
        let m = motion([key(0, 2, 0.1, -0.2), key(0.5, 1.5, 0, 0)], easing: .steps, steps: 6, start: .afterOpener)
        XCTAssertEqual(readMotion(m.json), m)
        XCTAssertEqual(m.json.objectValue?["easing"], "steps")
        XCTAssertEqual(m.json.objectValue?["start"], "after-opener")
        let linear = motion([key(0, 2, 0, 0)])
        XCTAssertNil(linear.json.objectValue?["steps"])
        XCTAssertEqual(readMotion(linear.json), linear)
    }
}

final class MotionClockTests: XCTestCase {
    private let m = motion([key(0, 2, 0, 0)])

    func testRunsOverTheSlide() {
        XCTAssertEqual(motionProgress(m, 0, 6), 0)
        XCTAssertEqual(motionProgress(m, 3, 6), 0.5)
        XCTAssertEqual(motionProgress(m, 9, 6), 1)
    }

    func testWaitsForTheOpenerWhenAskedAndOnlyThen() {
        var after = m
        after.start = .afterOpener
        XCTAssertEqual(motionProgress(after, 1, 6, 2), 0)
        XCTAssertEqual(motionProgress(after, 4, 6, 2), 0.5)
        assertClose(motionProgress(m, 1, 6, 2), 1.0 / 6, 2)
    }

    func testNeverDividesByASpanItDoesNotHave() {
        var after = m
        after.start = .afterOpener
        XCTAssertEqual(motionProgress(after, 5, 3, 5), 1)
        XCTAssertEqual(motionProgress(after, 1, 3, 5), 0)
    }

    func testMarksEveryPlacedFrameAndTheRestOnTheSlide() {
        let two = motion([key(0, 2, 0, 0), key(0.5, 1.5, 0, 0)], start: .afterOpener)
        XCTAssertEqual(motionMarks(two, 6, 2), [2, 4, 6])
        XCTAssertEqual(motionMarks(nil, 6), [])
    }
}

final class FramingAtProgressTests: XCTestCase {
    private let rest = framing { $0.scale = 1.4; $0.x = 0.05; $0.y = 0; $0.rotation = 12 }
    private let m = motion([key(0.2, 3, -0.3, 0.1)])

    func testIsTheFramingItselfAtRestAndWithNoMotion() {
        XCTAssertEqual(framingAtProgress(rest, m, 1), rest)
        XCTAssertEqual(framingAtProgress(rest, nil, 0.3), rest)
    }

    func testHoldsOnTheFirstKeyBeforeItWithTheRestsRotation() {
        let f = framingAtProgress(rest, m, 0.1)
        var want = rest
        want.scale = 3; want.x = -0.3; want.y = 0.1
        XCTAssertEqual(f, want)
    }

    func testZoomsGeometricallySoTheSpeedLooksConstant() {
        let m2 = motion([key(0, 4, 0, 0)])
        assertClose(framingAtProgress(framing { $0.scale = 1 }, m2, 0.5).scale, 2, 2)
    }

    func testKeepsAPointTheTwoFramesShareStillOnScreen() {
        // Start zoomed out, end moved in on a point left of centre — the frames a
        // wheel on the stage would write.
        let start = framing { $0.scale = 1.2 }
        let anchorX = dstW * 0.4
        let anchorY = dstH * 0.45
        let end = zoomFramingAbout(start, 3, anchorX: anchorX, anchorY: anchorY, srcW, srcH, dstW, dstH)
        let mv = motion([key(0, start.scale, start.x, start.y)], easing: .inOutCubic)
        let (sx, sy) = unframePoint(anchorX, anchorY, srcW, srcH, dstW, dstH, start)
        for i in 0...20 {
            let f = framingAtProgress(end, mv, Double(i) / 20)
            let (px, py) = framePoint(sx, sy, srcW, srcH, dstW, dstH, f)
            assertClose(px, anchorX, 6)
            assertClose(py, anchorY, 6)
        }
    }

    func testHoldsBetweenTwoEqualKeysAPauseIsTwoFrames() {
        let hold = motion([key(0, 2, 0.1, 0), key(0.4, 2, 0.1, 0)])
        let f = framingAtProgress(.default, hold, 0.2)
        assertClose(f.scale, 2, 2)
        assertClose(f.x, 0.1, 2)
    }

    func testKeepsAnOvershootingCurveInsideTheScaleRange() {
        let back = motion([key(0, 1, 0, 0)], easing: .back)
        for i in 0...50 {
            let f = framingAtProgress(framing { $0.scale = 8 }, back, Double(i) / 50)
            XCTAssertGreaterThanOrEqual(f.scale, 1)
            XCTAssertLessThanOrEqual(f.scale, 8)
        }
    }

    func testNeverShowsAnEdgeUnderCoverWhateverInstantIsDrawn() {
        // The draw clamps; this is the invariant the renderers rely on.
        let spring = motion([key(0, 2.5, -0.4, 0.2)], easing: .spring)
        let end = framing { $0.scale = 1; $0.x = 0.3; $0.y = 0 }
        for i in 0...60 {
            let f = framingAtProgress(end, spring, Double(i) / 60)
            let t = framingTransform(srcW, srcH, dstW, dstH, f)
            XCTAssertLessThanOrEqual(abs(t.panX), t.slackX + 1e-6)
            XCTAssertLessThanOrEqual(abs(t.panY), t.slackY + 1e-6)
        }
    }

    func testMovesInWholeStepsUnderTheSteppedCurve() {
        let steps = motion([key(0, 1, 0, 0)], easing: .steps, steps: 4)
        let at = { (u: Double) in framingAtProgress(framing { $0.scale = 3 }, steps, u).scale }
        assertClose(at(0.1), at(0.2), 2)
        XCTAssertGreaterThan(at(0.3), at(0.2))
    }

    func testReadsASlidesSecondsThroughFramingAtAndAClock() {
        let rest2 = Framing.default
        let m2 = motion([key(0, 2, 0, 0)])
        XCTAssertEqual(framingAt(rest2, m2, 0, 4).scale, 2)
        XCTAssertEqual(framingAt(rest2, m2, 4, 4), rest2)
        XCTAssertEqual(framingOnClock(rest2, nil, 0), rest2)
        XCTAssertEqual(framingOnClock(rest2, MotionClock(motion: m2, seconds: 4), 0).scale, 2)
    }
}

final class NeedleEditingTests: XCTestCase {
    private let rest = framing { $0.scale = 1.2 }
    private let m = motion([key(0, 2, 0, 0), key(0.5, 1.6, 0.1, 0)])
    private let snap = 0.05

    func testNamesTheFrameTheNeedleIsOn() {
        XCTAssertEqual(needleTarget(m, 0.01, snap), .key(index: 0, start: true))
        XCTAssertEqual(needleTarget(m, 0.52, snap), .key(index: 1, start: false))
        XCTAssertEqual(needleTarget(m, 0.3, snap), .new)
        XCTAssertEqual(needleTarget(m, 0.97, snap), .rest)
        XCTAssertEqual(needleTarget(nil, 0.3, snap), .rest)
    }

    func testShowsTheFrameItselfNearAKeyTheInstantElsewhere() {
        var onKey = rest
        onKey.scale = 1.6; onKey.x = 0.1; onKey.y = 0
        XCTAssertEqual(framingAtNeedle(rest, m, 0.52, snap), onKey)
        XCTAssertEqual(framingAtNeedle(rest, m, 0.97, snap), rest)
        XCTAssertEqual(framingAtNeedle(rest, m, 0.3, snap), framingAtProgress(rest, m, 0.3))
    }

    func testWritesThePanAndZoomToThatFrameRotationAndFitToTheRest() {
        var next = rest
        next.scale = 3; next.x = -0.2; next.y = 0.05; next.rotation = 5
        let onKey = placeAtNeedle(rest, m, 0.02, next, snap)
        XCTAssertEqual(onKey.motion!.keys[0], key(0, 3, -0.2, 0.05))
        var turned = rest
        turned.rotation = 5
        XCTAssertEqual(onKey.framing, turned)

        let onRest = placeAtNeedle(rest, m, 0.99, next, snap)
        XCTAssertEqual(onRest.framing, next)
        XCTAssertEqual(onRest.motion, m)
    }

    func testPlacesANewFrameWhereTheNeedleIsOnNone() {
        var next = rest
        next.scale = 2.5; next.x = 0.2; next.y = 0
        let placed = placeAtNeedle(rest, m, 0.3, next, snap)
        XCTAssertEqual(placed.motion!.keys.map(\.at), [0, 0.3, 0.5])
        // What the stage shows once the write lands is what the hand left.
        XCTAssertEqual(framingAtNeedle(placed.framing, placed.motion, 0.3, snap), next)
    }

    func testIsThePlainWriteWithNoMotion() {
        var next = rest
        next.scale = 2
        XCTAssertEqual(placeAtNeedle(rest, nil, 0.3, next, snap), FramingWrite(framing: next, motion: nil))
    }

    func testTakesOffAFrameAndTheLastOneTakesTheMotionWithIt() {
        XCTAssertEqual(removeAtNeedle(m, 0.5, snap)!.keys.count, 1)
        XCTAssertEqual(removeAtNeedle(m, 0.3, snap), m)
        XCTAssertNil(removeAtNeedle(motion([key(0, 2, 0, 0)]), 0, snap))
        XCTAssertEqual(keepEnds(m)!.keys, [m.keys[0]])
    }

    func testSnapsToTheSameSecondsWhateverTheSlidesLength() {
        assertClose(snapShare(m, 6), keySnapSeconds / 6, 2)
        XCTAssertEqual(snapShare(m, 0), 0.25)
        XCTAssertEqual(snapShare(nil, 6), 0)
    }
}

final class StartingAndMirroringTests: XCTestCase {
    func testStartsCloserOnTheSamePointAndRestsOnTheComposedFrame() {
        let composed = framing { $0.scale = 2; $0.x = 0.1; $0.y = -0.05 }
        let m = starterMotion(composed)
        XCTAssertTrue(hasMotion(m))
        assertClose(m.keys[0].scale, 2 * starterZoom, 2)
        // Same point in the middle: pan / scale unchanged.
        assertClose(m.keys[0].x / m.keys[0].scale, composed.x / composed.scale, 2)
        let (cx, cy) = unframePoint(dstW / 2, dstH / 2, srcW, srcH, dstW, dstH, composed)
        let start = framingAtProgress(composed, m, 0)
        let (ex, ey) = unframePoint(dstW / 2, dstH / 2, srcW, srcH, dstW, dstH, start)
        assertClose(ex, cx, 3)
        assertClose(ey, cy, 3)
    }

    func testMirrorsEveryKeyAsFlipFramingMirrorsTheRest() {
        let rest = framing { $0.scale = 2; $0.x = 0.2; $0.y = 0.1 }
        let m = motion([key(0, 3, -0.25, 0.1)])
        let flippedRest = flipFraming(rest, axis: "x")
        let flipped = flipMotion(m, axis: "x")!
        XCTAssertEqual(flipped.keys[0], key(0, 3, 0.25, 0.1))
        // The mirrored move shows the mirrored picture at every instant.
        let a = framingAtProgress(rest, m, 0.4)
        let b = framingAtProgress(flippedRest, flipped, 0.4)
        assertClose(b.x, -a.x, 2)
        XCTAssertNil(flipMotion(nil, axis: "y"))
    }
}

final class DeepestFramingTests: XCTestCase {
    func testJudgesAMoveByItsClosestFrameNotByWhereItRests() {
        let rest = framing { $0.scale = 1.1 }
        XCTAssertEqual(deepestFraming(rest, motion([key(0, 2.4, 0, 0)])).scale, 2.4)
        XCTAssertEqual(deepestFraming(rest, motion([key(0, 1, 0, 0)])), rest)
        XCTAssertEqual(deepestFraming(rest, nil), rest)
    }
}

final class MotionPresetTests: XCTestCase {
    // A 3:2 landscape in a 9:16 reel: all the room is sideways.
    private let rest = Framing.default

    func testPansFromOneEdgeOfTheRealSlackToTheOtherTheViewTravellingTheWayItSays() {
        let out = applyPreset(.panRight, rest, nil, box)!
        let start = framingAtProgress(out.framing, out.motion, 0)
        let a = framingTransform(srcW, srcH, dstW, dstH, start)
        let b = framingTransform(srcW, srcH, dstW, dstH, out.framing)
        // Starts on the picture's left edge, rests on its right.
        assertClose(a.panX, a.slackX, 6)
        assertClose(b.panX, -b.slackX, 6)
        let leftStart = unframePoint(0, dstH / 2, srcW, srcH, dstW, dstH, start).0
        let rightEnd = unframePoint(dstW, dstH / 2, srcW, srcH, dstW, dstH, out.framing).0
        assertClose(leftStart, 0, 3)
        assertClose(rightEnd, srcW, 3)
        // Left is the same move backwards.
        let left = applyPreset(.panLeft, rest, nil, box)!
        assertClose(left.motion.keys[0].x, -out.motion.keys[0].x, 2)
        assertClose(left.framing.x, -out.framing.x, 2)
    }

    func testRefusesAPanWithNoRoomAndSaysWhy() {
        XCTAssertTrue(presetProblem(.panUp, rest, box)?.contains("No room to pan up") == true)
        XCTAssertNil(applyPreset(.panUp, rest, nil, box))
        // Zoomed in, the same picture has room to travel up and down.
        XCTAssertNil(presetProblem(.panUp, framing { $0.scale = 1.5 }, box))
        XCTAssertTrue(presetProblem(.panLeft, rest, nil)?.contains("still being read") == true)
    }

    func testPushesInOntoTheCompositionWhenItCanStartWider() {
        let composed = framing { $0.scale = 2; $0.x = 0.05 }
        let out = applyPreset(.pushIn, composed, nil, box)!
        XCTAssertEqual(out.framing, composed)
        assertClose(out.motion.keys[0].scale, 2 / presetZoom, 2)
        // About the middle of the frame: the point there does not move.
        let start = framingAtProgress(out.framing, out.motion, 0)
        assertClose(centre(start).x * srcW, centre(composed).x * srcW, 3)
    }

    func testPushesTheRestInWhenTheCompositionIsAlreadyAtItsWidest() {
        let out = applyPreset(.pushIn, rest, nil, box)!
        XCTAssertEqual(out.motion.keys[0].scale, 1)
        assertClose(out.framing.scale, presetZoom, 2)
    }

    func testPullsOutOntoTheCompositionAndRefusesAtTheCeiling() {
        let out = applyPreset(.pullOut, rest, nil, box)!
        XCTAssertEqual(out.framing, rest)
        assertClose(out.motion.keys[0].scale, presetZoom, 2)
        XCTAssertTrue(presetProblem(.pullOut, framing { $0.scale = 8 }, box)?.contains("already as close") == true)
    }

    func testReplacesTheFramesAndKeepsHowTheMotionTravels() {
        let before = motion([key(0, 3, 0, 0), key(0.5, 2, 0, 0)], easing: .steps, steps: 6, start: .afterOpener)
        let out = applyPreset(.pullOut, rest, before, box)!
        XCTAssertEqual(out.motion.keys.count, 1)
        XCTAssertEqual(out.motion.easing, .steps)
        XCTAssertEqual(out.motion.steps, 6)
        XCTAssertEqual(out.motion.start, .afterOpener)
    }
}

final class TourTests: XCTestCase {
    private let rest = Framing.default
    private let stops = [TourStop(x: 0.3, y: 0.45), TourStop(x: 0.55, y: 0.6), TourStop(x: 0.7, y: 0.4)]

    func testLooksAtAStopInTheMiddleOfTheFrameAndClampsOneNearAnEdge() {
        let f = framingOn(rest, TourStop(x: 0.4, y: 0.55), 2, box)
        assertClose(centre(f).x, 0.4, 6)
        assertClose(centre(f).y, 0.55, 6)
        let edge = framingOn(rest, TourStop(x: 0.01, y: 0.5), 2, box)
        let t = framingTransform(srcW, srcH, dstW, dstH, edge)
        XCTAssertLessThanOrEqual(abs(t.panX), t.slackX + 1e-6)
        XCTAssertGreaterThan(centre(edge).x, 0.01)
    }

    func testHoldsOnEachStopGlidesBetweenThemAndRestsOnTheLast() {
        let out = tourMotion(rest, nil, TourPlan(stops: stops, zoom: 2, holdSeconds: 0.5), box, 6)!
        let m = out.motion!
        // Stop 1 at 0 and 0.5 s, stop 2 arriving and leaving, stop 3 arriving 0.5 s before the end.
        XCTAssertEqual(m.keys.count, 5)
        XCTAssertEqual(m.keys[0].at, 0)
        assertClose(m.keys[1].at, 0.5 / 6, 2)
        assertClose(m.keys[4].at, 1 - 0.5 / 6, 2)
        assertClose(m.keys[3].at - m.keys[2].at, 0.5 / 6, 2)
        // Every stop is looked at where it was tapped; the rest is the last one.
        assertClose(centre(framingAtProgress(out.framing, m, 0.01)).x, 0.3, 6)
        let midway = (m.keys[2].at + m.keys[3].at) / 2
        assertClose(centre(framingAtProgress(out.framing, m, midway)).x, 0.55, 6)
        assertClose(centre(out.framing).x, 0.7, 6)
        XCTAssertEqual(out.framing.scale, 2)
    }

    func testSharesTheGlidesByDistanceSoThePaceHoldsOnALongHop() {
        let far = [TourStop(x: 0.3, y: 0.5), TourStop(x: 0.35, y: 0.5), TourStop(x: 0.75, y: 0.5)]
        let m = tourMotion(rest, nil, TourPlan(stops: far, zoom: 2, holdSeconds: 0), box, 6)!.motion!
        let first = m.keys[1].at - m.keys[0].at
        let second = 1 - m.keys[1].at
        assertClose(second / first, 8, 0)
    }

    func testShrinksThePausesBeforeAGlideGetsTooShort() {
        let m = tourMotion(rest, nil, TourPlan(stops: stops, zoom: 2, holdSeconds: 5), box, 3)!.motion!
        let glide = (m.keys[2].at - m.keys[1].at) * 3
        XCTAssertGreaterThanOrEqual(glide, minGlideSeconds - 1e-6)
    }

    func testIsNoMoveWithOneStopAndNothingWithNone() {
        let one = tourMotion(rest, nil, TourPlan(stops: [TourStop(x: 0.6, y: 0.5)], zoom: 1.5, holdSeconds: 0), box, 4)!
        XCTAssertNil(one.motion)
        assertClose(centre(one.framing).x, 0.6, 6)
        XCTAssertNil(tourMotion(rest, nil, TourPlan(stops: [], zoom: 1.5, holdSeconds: 0), box, 4))
    }

    func testReadsAWrittenTourBackAsTheSameStopsZoomAndPause() {
        let out = tourMotion(rest, nil, TourPlan(stops: stops, zoom: 2, holdSeconds: 0.5), box, 6)!
        let back = tourOf(out.framing, out.motion, box, 6)
        XCTAssertEqual(back.stops.count, 3)
        for (i, s) in back.stops.enumerated() {
            assertClose(s.x, stops[i].x, 6)
            assertClose(s.y, stops[i].y, 6)
        }
        XCTAssertEqual(back.zoom, 2)
        assertClose(back.holdSeconds, 0.5, 6)
        // A picture that holds still is a tour of the one stop it rests on.
        XCTAssertEqual(tourOf(rest, nil, box, 6).stops, [TourStop(x: 0.5, y: 0.5)])
    }

    func testOutlinesWhatAFrameShowsTurnedWithThePicture() {
        let w = framingWindow(framingOn(rest, TourStop(x: 0.5, y: 0.5), 2, box), box)
        XCTAssertEqual(w.count, 4)
        // 9:16 over 3:2 at ×2: a window 0.1875 of the width, the full height / 2.
        assertClose(w[1].x - w[0].x, 0.1875, 6)
        assertClose(w[3].y - w[0].y, 0.5, 6)
        var tilted = framingOn(rest, TourStop(x: 0.5, y: 0.5), 2, box)
        tilted.rotation = 10
        let turned = framingWindow(tilted, box)
        XCTAssertNotEqual(turned[1].y, turned[0].y, accuracy: 0.5e-3)
    }
}

final class ArrivalMarksTests: XCTestCase {
    func testStepsFromStopToStopOverTheEndOfEachPause() {
        let rest = Framing.default
        let m = motion([key(0, 2, 0, 0), key(0.1, 2, 0, 0), key(0.5, 1.5, 0.1, 0)])
        XCTAssertEqual(arrivalMarks(rest, m, 10), [0, 5, 10])
        XCTAssertEqual(arrivalMarks(rest, nil, 10), [])
    }
}
