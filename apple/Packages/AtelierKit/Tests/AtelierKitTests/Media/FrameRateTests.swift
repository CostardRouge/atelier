// Port of `src/shared/media/frame-rate.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

/// JavaScript's `Math.round` for the non-negative numbers these helpers pass.
private func jsRound(_ x: Double) -> Double { x.rounded(.toNearestOrAwayFromZero) }

/// Walk a whole clip through the planner, the way the pipeline does: each
/// source frame's span is `timestamp + duration`, both rounded to whole
/// microseconds exactly as mp4box hands them over — so the spans drift a
/// microsecond past their successor's start, which is the case the edge
/// tolerance exists for.
private func retime(_ sourceFps: Double, _ targetFps: Double, _ frames: Int) -> [[Int]] {
    let step = jsRound(1_000_000 / sourceFps)
    var out: [[Int]] = []
    var next = 0
    for i in 0..<frames {
        let start = jsRound((Double(i) * 1_000_000) / sourceFps)
        let indices = planFrameIndices(start, start + step, targetFps, next)
        if let last = indices.last { next = last + 1 }
        out.append(indices)
    }
    return out
}

/// The retime as the pipelines run it: the source span divided by the speed,
/// then laid on the output grid. `speed` 2 walks the source twice as fast.
private func retimeAtSpeed(_ sourceFps: Double, _ targetFps: Double, _ speed: Double, _ frames: Int) -> [[Int]] {
    let step = jsRound(1_000_000 / sourceFps)
    var next = 0
    var out: [[Int]] = []
    for i in 0..<frames {
        let start = jsRound((Double(i) * 1_000_000) / sourceFps) / speed
        let indices = planFrameIndices(start, start + step / speed, targetFps, next)
        if let last = indices.last { next = last + 1 }
        out.append(indices)
    }
    return out
}

final class ResolveFrameRateTests: XCTestCase {
    func testFollowsTheSourceWhenNothingIsAskedFor() {
        XCTAssertEqual(resolveFrameRate(.source, 60), 60)
        XCTAssertEqual(resolveFrameRate(nil, 30), 30)
        XCTAssertEqual(resolveFrameRate(nil, 24), 24)
    }

    func testTakesAnExplicitTarget() {
        XCTAssertEqual(resolveFrameRate(.fps(24), 60), 24)
        XCTAssertEqual(resolveFrameRate(.fps(120), 30), 120)
    }

    func testFallsBackToTheSourceForANonsensicalTarget() {
        XCTAssertEqual(resolveFrameRate(.fps(0), 30), 30)
        XCTAssertEqual(resolveFrameRate(.fps(-24), 30), 30)
        XCTAssertEqual(resolveFrameRate(.fps(Double.nan), 30), 30)
    }

    func testNeverResolvesBelow1Fps() {
        XCTAssertEqual(resolveFrameRate(.source, 0), 1)
        XCTAssertEqual(resolveFrameRate(.fps(0.2), 30), 1)
    }
}

final class PlanFrameIndicesTests: XCTestCase {
    func testIsAPassThroughAtTheSourceRate() {
        XCTAssertEqual(retime(30, 30, 4), [[0], [1], [2], [3]])
    }

    func testDropsEveryOtherFrameFrom60To30() {
        XCTAssertEqual(retime(60, 30, 6), [[0], [], [1], [], [2], []])
    }

    func testDuplicatesEveryFrameFrom30To60() {
        XCTAssertEqual(retime(30, 60, 3), [[0, 1], [2, 3], [4, 5]])
    }

    func testKeepsA60To24PullDownRegular() {
        // 5 source frames → 2 output frames.
        let plan = retime(60, 24, 10).map { $0.count }
        XCTAssertEqual(plan, [1, 0, 1, 0, 0, 1, 0, 1, 0, 0])
    }

    func testEmitsEveryOutputIndexExactlyOnceInOrder() {
        let pairs: [(Double, Double)] = [(30, 24), (60, 48), (24, 60), (50, 30)]
        for (src, dst) in pairs {
            let flat = retime(src, dst, 240).flatMap { $0 }
            XCTAssertEqual(flat, flat.sorted())
            XCTAssertEqual(Set(flat).count, flat.count)
            XCTAssertEqual(flat[0], 0)
            // No index is skipped: the output timeline has no gap.
            XCTAssertEqual(flat[flat.count - 1], flat.count - 1)
        }
    }

    func testStartsAtIndex0EvenWhenTheClipDoesNotStartAtT0() {
        // A first sample at 1 s: the grid is relative to it, so nothing is lost.
        XCTAssertEqual(planFrameIndices(0, 33_333, 30, 0), [0])
    }

    func testReturnsNothingForAnEmptyOrInvertedSpan() {
        XCTAssertEqual(planFrameIndices(1000, 1000, 30, 0), [])
        XCTAssertEqual(planFrameIndices(2000, 1000, 30, 0), [])
    }

    func testNeverReEmitsAnIndexTheCallerAlreadyUsed() {
        XCTAssertEqual(planFrameIndices(0, 100_000, 30, 2), [2])
    }
}

final class FrameTimestampMicrosTests: XCTestCase {
    func testWalksTheGrid() {
        XCTAssertEqual(frameTimestampMicros(0, 30), 0)
        XCTAssertEqual(frameTimestampMicros(1, 30), 33_333)
        XCTAssertEqual(frameTimestampMicros(30, 30), 1_000_000)
        XCTAssertEqual(frameTimestampMicros(24, 24), 1_000_000)
    }
}

final class OutputFrameCountTests: XCTestCase {
    func testCountsTheFramesOfAClipAtARate() {
        XCTAssertEqual(outputFrameCount(10, 30), 300)
        XCTAssertEqual(outputFrameCount(10, 24), 240)
        XCTAssertEqual(outputFrameCount(0, 30), 1)
    }
}

final class ResolveSpeedTests: XCTestCase {
    func testKeepsTheClipAsShotWhenNothingIsAskedFor() {
        XCTAssertEqual(resolveSpeed(nil), 1)
        XCTAssertEqual(resolveSpeed(1), 1)
    }

    func testTakesARealMultiplier() {
        XCTAssertEqual(resolveSpeed(2), 2)
        XCTAssertEqual(resolveSpeed(0.25), 0.25)
    }

    func testRefusesASpeedThatWouldBeNonsenseRatherThanClampingIntoOne() {
        XCTAssertEqual(resolveSpeed(0), 1)
        XCTAssertEqual(resolveSpeed(-2), 1)
        XCTAssertEqual(resolveSpeed(Double.nan), 1)
        XCTAssertEqual(resolveSpeed(1000), 1)
    }
}

final class SpeedPresentationTests: XCTestCase {
    func testSaysNothingAboutAClipDeliveredAsShot() {
        XCTAssertNil(describeSpeed(1))
        XCTAssertNil(speedSuffix(1))
    }

    func testNamesTheDeparture() {
        XCTAssertEqual(describeSpeed(2), "2× speed")
        XCTAssertEqual(describeSpeed(0.5), "0.5× speed")
        XCTAssertEqual(speedSuffix(2), "2x")
        XCTAssertEqual(speedSuffix(0.5), "0.5x")
    }

    func testMovesTheDurationAndOnlyTheDuration() {
        XCTAssertEqual(retimedDuration(40, 2), 20)
        XCTAssertEqual(retimedDuration(40, 0.5), 80)
        XCTAssertEqual(retimedDuration(40, 1), 40)
    }

    // Not in the web spec: the picker's other label.
    func testDescribesACadence() {
        XCTAssertEqual(describeFrameRate(.source), "source fps")
        XCTAssertEqual(describeFrameRate(.fps(30)), "30 fps")
        XCTAssertEqual(describeFrameRate(.fps(29.97)), "29.97 fps")
    }
}

final class PlanFrameIndicesUnderARetimeTests: XCTestCase {
    func testDropsEveryOtherFrameAt2xAndTheSameCadence() {
        // Twice as fast at 30 fps: half the frames, half the duration.
        XCTAssertEqual(retimeAtSpeed(30, 30, 2, 6), [[0], [], [1], [], [2], []])
    }

    func testRepeatsEveryFrameAtHalfSpeed() {
        XCTAssertEqual(retimeAtSpeed(30, 30, 0.5, 3), [[0, 1], [2, 3], [4, 5]])
    }

    func testComposesWithACadenceChangeInsteadOfFightingIt() {
        // 60 fps source, delivered at 30 fps and 2× — a quarter of the frames.
        XCTAssertEqual(retimeAtSpeed(60, 30, 2, 8), [[0], [], [], [], [1], [], [], []])
    }

    func testStartsAtIndex0FromATrimmedOriginWhateverTheSpeed() {
        // A trim hands the grid frames that begin mid-file; the pipeline
        // rebases on the first KEPT frame, so the two features compose instead
        // of colliding.
        for speed in [0.5, 2.0] {
            let step = jsRound(1_000_000 / 30)
            let origin = jsRound(7.3 * 1_000_000) // in point, 7.3 s in
            var next = 0
            var out: [[Int]] = []
            for i in 0..<6 {
                let start = (origin + Double(i) * step - origin) / speed
                let indices = planFrameIndices(start, start + step / speed, 30, next)
                if let last = indices.last { next = last + 1 }
                out.append(indices)
            }
            XCTAssertEqual(out.flatMap { $0 }[0], 0)
            XCTAssertEqual(out, retimeAtSpeed(30, 30, speed, 6))
        }
    }

    func testEmitsEveryOutputIndexExactlyOnceInOrder() {
        for speed in [0.25, 0.5, 2, 4] {
            let flat = retimeAtSpeed(30, 30, speed, 40).flatMap { $0 }
            XCTAssertEqual(flat, flat.sorted())
            XCTAssertEqual(Set(flat).count, flat.count)
        }
    }
}
