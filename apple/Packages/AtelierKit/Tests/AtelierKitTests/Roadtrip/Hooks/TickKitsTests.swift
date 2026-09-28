// The kernel's own spec for `src/shared/roadtrip/hooks/tick-kits.ts`, which
// has no twin on the web (its rules are exercised through `scrub-plan.test.ts`).
// A kit is a stored option, so its words are pinned; so is the one rule that
// shapes every kit — the leg's landing is the different sound, lower and
// louder, and the seat is the seat everywhere.

import XCTest
@testable import AtelierKit

final class TickKitsTests: XCTestCase {
    func testTheKitsAreTheWebsWordsInTheWebsOrder() {
        XCTAssertEqual(kitIds.map(\.rawValue), ["ratchet", "wood", "typewriter", "click"])
        XCTAssertEqual(kitIds.map { $0.spec.label }, ["Ratchet", "Woodblock", "Typewriter", "Shutter"])
        XCTAssertEqual(Set(tickKits.keys), Set(kitIds))
        for kit in kitIds { XCTAssertEqual(tickKits[kit], kit.spec) }
    }

    func testEveryKitEndsOnTheSeatAndPlaysOnlyVoicesTheTableKnows() {
        for kit in kitIds {
            let spec = kit.spec
            XCTAssertEqual(spec.seat, .seat)
            XCTAssertTrue(isVoice(spec.tick.rawValue))
            XCTAssertTrue(isVoice(spec.leg.voice.rawValue))
        }
    }

    func testALegsLandingIsTheOneThatDiffersLowerAndLouder() {
        let ratchet = TickKit.ratchet.spec
        XCTAssertEqual(ratchet.tick, .detent)
        XCTAssertEqual(ratchet.leg, TickKitLeg(voice: .leg, rate: 1, gain: 1))
        for kit in [TickKit.wood, .typewriter, .click] {
            let spec = kit.spec
            XCTAssertEqual(spec.leg.voice, spec.tick)
            XCTAssertLessThan(spec.leg.rate, 1)
            XCTAssertGreaterThan(spec.leg.gain, 1)
        }
        XCTAssertEqual(TickKit.wood.spec.leg, TickKitLeg(voice: .wood, rate: 0.67, gain: 1.3))
        XCTAssertEqual(TickKit.typewriter.spec.leg, TickKitLeg(voice: .typewriter, rate: 0.7, gain: 1.3))
        XCTAssertEqual(TickKit.click.spec.leg, TickKitLeg(voice: .click, rate: 0.6, gain: 1.3))
    }

    func testAFlatSweepKeepsThePlainPitch() {
        for share in [0.0, 0.3, 1, -2, 5] { XCTAssertEqual(driftAt(.flat, share), 1) }
    }

    /// About three semitones each way: ×0.84 to ×1.19.
    func testARisingSweepClimbsTheSpanAndAFallingOneDescendsIt() {
        XCTAssertEqual(driftSpan, DriftSpan(from: 0.84, to: 1.19))
        assertClose(driftAt(.rising, 0), 0.84, 12)
        assertClose(driftAt(.rising, 0.5), 1.015, 12)
        assertClose(driftAt(.rising, 1), 1.19, 12)
        assertClose(driftAt(.falling, 0), 1.19, 12)
        assertClose(driftAt(.falling, 1), 0.84, 12)
        XCTAssertLessThan(driftAt(.falling, 0.6), driftAt(.falling, 0.4))
    }

    func testAShareOutsideTheSweepIsHeldAtItsEnds() {
        assertClose(driftAt(.rising, -1), 0.84, 12)
        assertClose(driftAt(.rising, 2), 1.19, 12)
        assertClose(driftAt(.falling, 3), 0.84, 12)
        XCTAssertTrue(driftAt(.rising, .nan).isNaN)
    }
}
