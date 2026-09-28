// Port of `src/shared/telemetry/heading-smooth.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

/// A cue list at 10 Hz; `headings[i]` of nil means "no reading here".
private func track(_ headings: [Double?], hz: Double = 10) -> [Cue] {
    headings.enumerated().map { i, h in
        Cue(start: Double(i) / hz, end: Double(i + 1) / hz, frame: i + 1, timestamp: nil, data: [:],
            derived: h.map { Motion(heading: $0) } ?? Motion())
    }
}

final class HeadingSmoothTests: XCTestCase {
    func testSaysNothingWhenThereIsNothingToSay() {
        XCTAssertNil(smoothHeading([], 1).heading)
        XCTAssertNil(smoothHeading(track([nil, nil, nil]), 0.2).heading)
        // Before the first cue.
        XCTAssertNil(smoothHeading(track([90, 90]), -1).heading)
    }

    func testReturnsTheRawNewestReadingWhenSmoothingIsOff() {
        let cues = track([10, 20, 30, 40])
        XCTAssertEqual(smoothHeading(cues, 0.3, tauSeconds: 0).heading, 40)
        XCTAssertEqual(smoothHeading(cues, 0.1, tauSeconds: 0).heading, 20)
    }

    func testEasesAStepInsteadOfJumpingToIt() {
        // Steady 0°, then a hard turn to 90° on the last few cues.
        let cues = track([0, 0, 0, 0, 0, 0, 90, 90, 90])
        let raw = smoothHeading(cues, 0.8, tauSeconds: 0).heading!
        let eased = smoothHeading(cues, 0.8, tauSeconds: 0.6).heading!
        XCTAssertEqual(raw, 90)
        // The eased value is on its way there, not there yet.
        XCTAssertGreaterThan(eased, 0)
        XCTAssertLessThan(eased, 90)
    }

    func testAveragesTheShortWayRoundNorthNeverThroughSouth() {
        let cues = track([350, 355, 0, 5, 10])
        let h = smoothHeading(cues, 0.4, tauSeconds: 0.6).heading!
        // The circular mean sits near North; an arithmetic mean would give ~144.
        let fromNorth = min(h, 360 - h)
        XCTAssertLessThan(fromNorth, 20)
    }

    func testBridgesAShortGapByHoldingTheLastKnownBearing() {
        let cues = track([90, 90, 90, nil, nil, nil, nil])
        let out = smoothHeading(cues, 0.6, tauSeconds: 0.6, holdSeconds: 2)
        XCTAssertNotNil(out.heading)
        XCTAssertLessThan(abs(out.heading! - 90), 1)
        XCTAssertGreaterThan(out.age, 0)
        // Still trusted, but visibly less than live data.
        XCTAssertGreaterThan(out.confidence, 0)
        XCTAssertLessThan(out.confidence, 1)
    }

    func testLetsConfidenceRunOutOverTheHoldWindowThenGivesUp() {
        let cues = track([90] + [Double?](repeating: nil, count: 60))
        let live = smoothHeading(cues, 0, tauSeconds: 0.6, holdSeconds: 2)
        XCTAssertEqual(live.confidence, 1)

        let halfway = smoothHeading(cues, 1, tauSeconds: 0.6, holdSeconds: 2)
        XCTAssertGreaterThan(halfway.confidence, 0.3)
        XCTAssertLessThan(halfway.confidence, 0.7)

        let spent = smoothHeading(cues, 2.5, tauSeconds: 0.6, holdSeconds: 2)
        XCTAssertEqual(spent.confidence, 0)
    }

    func testIsAPureFunctionOfCuesAndTimeNoAccumulatedState() {
        // The same call, made in any order, must give the same answer: this is
        // what keeps the preview and the export frame-identical.
        let cues = track([0, 30, 60, 90, 120, 150])
        let forwards = [0.1, 0.2, 0.3, 0.4].map { smoothHeading(cues, $0).heading }
        let backwards = Array([0.4, 0.3, 0.2, 0.1].map { smoothHeading(cues, $0).heading }.reversed())
        XCTAssertEqual(forwards, backwards)
    }

    func testPointsFromTheFirstFrameOnTheOpeningWindowLookAhead() {
        // The clip opens with no reading behind it (motion measures backwards),
        // but the first cues carry the window measured forward.
        var cues = track([nil, nil, nil, 90, 90, 90])
        cues[0].lead = Motion(heading: 88)
        cues[1].lead = Motion(heading: 89)

        let early = smoothHeading(cues, 0, tauSeconds: 0.6, holdSeconds: 2)
        assertClose(early.heading ?? -1, 88, 3)
        XCTAssertEqual(early.confidence, 1) // live, not a stale bearing being held

        // Opted out, the instrument waits for its first real reading.
        XCTAssertNil(smoothHeading(cues, 0, tauSeconds: 0.6, holdSeconds: 2, early: false).heading)
    }

    func testFollowsASteadyTurnWithoutLaggingForever() {
        // A constant 60°/s turn: the eased value trails, but by a bounded amount.
        let cues = track((0..<40).map { Double(($0 * 6) % 360) })
        let at = smoothHeading(cues, 3.9, tauSeconds: 0.5).heading!
        let raw = smoothHeading(cues, 3.9, tauSeconds: 0).heading!
        let lag = (raw - at + 540).truncatingRemainder(dividingBy: 360) - 180
        XCTAssertGreaterThan(lag, 0)
        XCTAssertLessThan(lag, 45)
    }
}
