// Port of `src/shared/render/pass-plan.test.ts`.

import XCTest
@testable import AtelierKit

final class PlanPassesTests: XCTestCase {
    func testIsSourceToCanvasAtOnePassWithNoFramebufferAtAll() {
        // The property the whole core rests on: the common case is the general
        // algorithm at n = 1, not a fast path bolted beside it.
        XCTAssertEqual(planPasses(1), [PassSlot(from: .source, to: .canvas)])
        XCTAssertEqual(targetsNeeded(1), 0)
    }

    func testDrawsNothingForNoPasses() {
        XCTAssertEqual(planPasses(0), [])
        XCTAssertEqual(planPasses(-3), [])
        XCTAssertEqual(targetsNeeded(0), 0)
    }

    func testHandsThePictureAlongFirstFromTheSourceAndLastToTheCanvas() {
        XCTAssertEqual(planPasses(2), [
            PassSlot(from: .source, to: .target(0)),
            PassSlot(from: .target(0), to: .canvas),
        ])
        XCTAssertEqual(planPasses(3), [
            PassSlot(from: .source, to: .target(0)),
            PassSlot(from: .target(0), to: .target(1)),
            PassSlot(from: .target(1), to: .canvas),
        ])
        XCTAssertEqual(planPasses(4), [
            PassSlot(from: .source, to: .target(0)),
            PassSlot(from: .target(0), to: .target(1)),
            PassSlot(from: .target(1), to: .target(0)),
            PassSlot(from: .target(0), to: .canvas),
        ])
    }

    func testNeverReadsAndWritesTheSameTargetTheSilentWayToSampleWhatYouAreDrawing() {
        for n in 1...24 {
            for slot in planPasses(n) {
                XCTAssertNotEqual(slot.from, slot.to)
            }
        }
    }

    func testEveryPassButTheFirstReadsWhatTheOneBeforeItWrote() {
        for n in 1...24 {
            let slots = planPasses(n)
            XCTAssertEqual(slots.count, n)
            XCTAssertEqual(slots[0].from, .source)
            XCTAssertEqual(slots[n - 1].to, .canvas)
            for i in 1..<max(1, n) where i < n {
                XCTAssertEqual(slots[i].from, slots[i - 1].to)
            }
        }
    }

    func testTheCanvasIsWrittenExactlyOnceByTheLastPass() {
        for n in 1...24 {
            let toCanvas = planPasses(n).filter { $0.to == .canvas }
            XCTAssertEqual(toCanvas.count, 1)
        }
    }

    func testTwoTargetsAreEnoughHoweverLongTheChain() {
        XCTAssertEqual(targetsNeeded(2), 1)
        for n in 3...24 { XCTAssertEqual(targetsNeeded(n), 2) }
        for n in 1...24 {
            for slot in planPasses(n) {
                if case .target(let t) = slot.to { XCTAssertLessThan(t, targetsNeeded(n)) }
                if case .target(let t) = slot.from { XCTAssertLessThan(t, targetsNeeded(n)) }
            }
        }
    }

    func testRoundsAFractionalCountRatherThanPlanningHalfAPass() {
        XCTAssertEqual(planPasses(2.7).count, 2)
    }
}
