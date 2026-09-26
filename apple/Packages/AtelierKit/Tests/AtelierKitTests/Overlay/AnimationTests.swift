// Port of `src/shared/overlay/animation.test.ts`, plus the JSON round trip
// the web does by a cast.

import Foundation
import XCTest
@testable import AtelierKit

private let fadeIn = AnimStep(preset: .fade, duration: 1, easing: .linear)
private let fadeOut = AnimStep(preset: .fade, duration: 1, easing: .linear)

final class AnimationEaseAtTests: XCTestCase {
    func testPinsBothEndsWhateverTheCurve() {
        for e in [EasingId.linear, .in, .out, .inOut] {
            XCTAssertEqual(easeAt(e, 0), 0)
            XCTAssertEqual(easeAt(e, 1), 1)
        }
    }

    func testClampsOutside0To1() {
        XCTAssertEqual(easeAt(EasingId.out, -2), 0)
        XCTAssertEqual(easeAt(EasingId.out, 5), 1)
    }

    func testDeceleratesOnOutAndAcceleratesOnIn() {
        XCTAssertGreaterThan(easeAt(EasingId.out, 0.5), 0.5)
        XCTAssertLessThan(easeAt(EasingId.in, 0.5), 0.5)
    }
}

final class TransformAtTests: XCTestCase {
    private let anim = ElementAnimation(in: fadeIn, out: fadeOut)
    private let win = TimeWindow(start: 1, end: 5)

    func testDrawsNothingBeforeTheWindowOpensOrAfterItCloses() {
        XCTAssertTrue(isHidden(transformAt(anim, win, 0.9)))
        XCTAssertTrue(isHidden(transformAt(anim, win, 5)))
        XCTAssertTrue(isHidden(transformAt(anim, win, 9)))
    }

    func testFadesInFromTheWindowStart() {
        assertClose(transformAt(anim, win, 1).alpha, 0, 2)
        assertClose(transformAt(anim, win, 1.5).alpha, 0.5, 2)
        XCTAssertTrue(isIdentity(transformAt(anim, win, 2.5)))
    }

    func testFinishesTheExitExactlyAtTheWindowEnd() {
        assertClose(transformAt(anim, win, 4).alpha, 1, 2)
        assertClose(transformAt(anim, win, 4.5).alpha, 0.5, 2)
        XCTAssertLessThan(transformAt(anim, win, 4.99).alpha, 0.02)
    }

    func testHoldsAnElementInvisibleThroughItsStaggerDelay() {
        var delayed = fadeIn
        delayed.delay = 2
        let staggered = ElementAnimation(in: delayed)
        XCTAssertTrue(isHidden(transformAt(staggered, win, 2.5)))
        assertClose(transformAt(staggered, win, 3.5).alpha, 0.5, 2)
    }

    func testIsTheIdentityWithNeitherWindowNorAnimation() {
        XCTAssertTrue(isIdentity(transformAt(nil, nil, 12)))
    }

    func testPlaysAnAnimationWithNoWindowFromTheFirstFrame() {
        assertClose(transformAt(ElementAnimation(in: fadeIn), nil, 0.5).alpha, 0.5, 2)
        XCTAssertTrue(isIdentity(transformAt(ElementAnimation(in: fadeIn), nil, 30)))
    }

    func testCutsHardWithoutAnAnimationInsideTheWindowOnly() {
        XCTAssertTrue(isHidden(transformAt(nil, win, 0.5)))
        XCTAssertTrue(isIdentity(transformAt(nil, win, 3)))
        XCTAssertTrue(isHidden(transformAt(nil, win, 6)))
    }

    func testNeverLeavesWithoutAnEndToLeaveAt() {
        let open = TimeWindow(start: 0, end: nil)
        XCTAssertTrue(isIdentity(transformAt(anim, open, 1000)))
    }
}

final class SlideAndScaleTests: XCTestCase {
    func testEntersFromBelowWhenItTravelsUpAndLeavesUpwards() {
        let win = TimeWindow(start: 0, end: 4)
        let anim = ElementAnimation(
            in: AnimStep(preset: .slide, duration: 1, easing: .linear, direction: .up),
            out: AnimStep(preset: .slide, duration: 1, easing: .linear, direction: .up)
        )
        XCTAssertGreaterThan(transformAt(anim, win, 0).dy, 0) // starts below
        XCTAssertLessThan(transformAt(anim, win, 3.99).dy, 0) // ends above
        XCTAssertEqual(transformAt(anim, win, 2).dy, 0)
    }

    func testMirrorsTheAxisForAHorizontalSlide() {
        let t = transformAt(
            ElementAnimation(in: AnimStep(preset: .slide, duration: 1, easing: .linear, direction: .left)),
            TimeWindow(start: 0, end: nil),
            0
        )
        XCTAssertGreaterThan(t.dx, 0)
        XCTAssertEqual(t.dy, 0)
    }

    func testGrowsFromScaleFromTo1() {
        let anim = ElementAnimation(in: AnimStep(preset: .scale, duration: 1, easing: .linear, scaleFrom: 0.5))
        let open = TimeWindow(start: 0, end: nil)
        assertClose(transformAt(anim, open, 0).scale, 0.5, 2)
        assertClose(transformAt(anim, open, 0.5).scale, 0.75, 2)
        assertClose(transformAt(anim, open, 1).scale, 1, 2)
    }

    func testRevealsRatherThanFadesOnATypewriter() {
        let anim = ElementAnimation(in: AnimStep(preset: .typewriter, duration: 1, easing: .linear))
        let t = transformAt(anim, TimeWindow(start: 0, end: nil), 0.5)
        assertClose(t.reveal, 0.5, 2)
        XCTAssertEqual(t.alpha, 1)
    }
}

final class OvershootAndStepsTests: XCTestCase {
    private let open = TimeWindow(start: 0, end: nil)

    func testLetsAScaleOvershootItsRestOnBackAndClampsTheFade() {
        let anim = ElementAnimation(in: AnimStep(preset: .scale, duration: 1, easing: .back, scaleFrom: 0.4))
        var peak = 0.0
        for i in 0...40 {
            let t = transformAt(anim, open, Double(i) / 40)
            peak = max(peak, t.scale)
            XCTAssertLessThanOrEqual(t.alpha, 1)
            XCTAssertGreaterThanOrEqual(t.alpha, 0)
        }
        XCTAssertGreaterThan(peak, 1.02)
        XCTAssertTrue(isIdentity(transformAt(anim, open, 1)))
    }

    func testMovesAFadeInWholeJumpsOnSteps() {
        let anim = ElementAnimation(in: AnimStep(preset: .fade, duration: 1, easing: .steps, steps: 4))
        XCTAssertEqual(transformAt(anim, open, 0.1).alpha, 0)
        XCTAssertEqual(transformAt(anim, open, 0.3).alpha, 0.25)
        XCTAssertEqual(transformAt(anim, open, 0.8).alpha, 0.75)
        XCTAssertTrue(isIdentity(transformAt(anim, open, 1)))
    }
}

final class PhasesForTests: XCTestCase {
    func testLaysTheExitAgainstTheWindowEnd() {
        let ph = phasesFor(TimeWindow(start: 2, end: 10), ElementAnimation(in: fadeIn, out: fadeOut))
        XCTAssertEqual(ph.inStart, 2)
        XCTAssertEqual(ph.inEnd, 3)
        XCTAssertEqual(ph.outStart, 9)
    }

    func testSplitsAWindowTooShortToHoldBothInsteadOfDroppingOne() {
        let ph = phasesFor(TimeWindow(start: 0, end: 0.4), ElementAnimation(in: fadeIn, out: fadeOut))
        assertClose(ph.inEnd, 0.2, 2)
        assertClose(ph.outStart, 0.2, 2)
        // Both ends still play: the element appears and leaves.
        let anim = ElementAnimation(in: fadeIn, out: fadeOut)
        XCTAssertGreaterThan(transformAt(anim, TimeWindow(start: 0, end: 0.4), 0.1).alpha, 0)
        XCTAssertLessThan(transformAt(anim, TimeWindow(start: 0, end: 0.4), 0.1).alpha, 1)
    }

    func testHasNoExitWithoutAnEnd() {
        XCTAssertEqual(phasesFor(TimeWindow(start: 0, end: nil), ElementAnimation(out: fadeOut)).outStart, .infinity)
    }
}

// The web reads a stored animation by a cast; the port reads it, keeping
// every field and the `null` spellings, so an element writes back as read.
final class AnimationJSONTests: XCTestCase {
    func testRoundTripsAStepWithEveryField() throws {
        let raw: JSONValue = [
            "preset": "slide", "duration": 0.6, "easing": "out-cubic", "direction": "left",
            "distanceFrac": 0.05, "scaleFrom": 0.8, "delay": 0.2, "steps": 4, "inside": true,
        ]
        let step = try XCTUnwrap(AnimStep(json: raw))
        XCTAssertEqual(step.preset, .slide)
        XCTAssertEqual(step.easing, .outCubic)
        XCTAssertEqual(step.direction, .left)
        XCTAssertEqual(step.inside, true)
        XCTAssertEqual(step.json, raw)
    }

    func testReadsWhatTheWebDrawsForJunk() throws {
        let step = try XCTUnwrap(AnimStep(json: ["preset": "wobble", "easing": "bounce"]))
        XCTAssertEqual(step.preset, .fade)
        XCTAssertEqual(step.easing, .linear)
        XCTAssertEqual(step.duration, 0)
        XCTAssertNil(AnimStep(json: "fade"))
    }

    func testKeepsANullEndApartFromAnAbsentOne() throws {
        let raw: JSONValue = ["in": ["preset": "fade", "duration": 0.5, "easing": "out"], "out": nil]
        let anim = try XCTUnwrap(ElementAnimation(json: raw))
        XCTAssertNotNil(anim.inStep)
        XCTAssertNil(anim.outStep)
        XCTAssertEqual(anim.json, raw)
        XCTAssertEqual(ElementAnimation(json: [:])?.json, [:])
    }

    func testWritesAnOpenWindowsEndAsNull() throws {
        XCTAssertEqual(TimeWindow(start: 0.45, end: nil).json, ["start": 0.45, "end": nil])
        let back = try XCTUnwrap(TimeWindow(json: ["start": 1, "end": 3]))
        XCTAssertEqual(back, TimeWindow(start: 1, end: 3))
    }

    func testFadesByDefault() {
        XCTAssertEqual(defaultStep(), AnimStep(preset: .fade, duration: 0.5, easing: .out))
    }
}
