// `KeptRun.swift` — native only, no web twin: what a run kept past the
// foreground says on the system's progress UI and the Live Activity.

import Foundation
import XCTest
@testable import AtelierKit

final class KeptRunTests: XCTestCase {
    private func task(_ id: String, _ label: String, _ progress: Double? = nil,
                      detail: String? = nil) -> TaskRegistry.Task {
        TaskRegistry.Task(id: id, label: label, progress: progress, detail: detail, startedAt: 0)
    }

    func testOneTaskSaysItsOwnLabelDetailAndBar() {
        let s = keptRunSummary([task("a", "Exporting DJI_0101.JPG", 0.25, detail: "1/4 · DJI_0101")], ended: 0)
        XCTAssertEqual(s.title, "Exporting DJI_0101.JPG")
        XCTAssertEqual(s.detail, "1/4 · DJI_0101")
        XCTAssertEqual(s.progress, 0.25)
        XCTAssertEqual(s.done, 0)
        XCTAssertEqual(s.total, 1)
        XCTAssertEqual(s.unitsDone, 250)
        XCTAssertEqual(s.unitsTotal, keptRunUnits)
    }

    func testAnEmptyDetailIsNoDetail() {
        XCTAssertNil(keptRunSummary([task("a", "Encoding the hook", 0, detail: "")], ended: 0).detail)
        XCTAssertNil(keptRunSummary([task("a", "Encoding the hook", 0)], ended: 0).detail)
    }

    func testSeveralTasksSayThePillsWordAndEveryLabelOldestFirst() {
        let s = keptRunSummary([task("a", "Exporting 3 pictures", 0.5), task("b", "Exporting the piece", 0.1)], ended: 0)
        XCTAssertEqual(s.title, "2 running")
        XCTAssertEqual(s.detail, "Exporting 3 pictures · Exporting the piece")
        XCTAssertEqual(s.progress!, 0.3, accuracy: 1e-12)
        XCTAssertEqual(s.unitsDone, 600)
        XCTAssertEqual(s.unitsTotal, 2000)
    }

    func testOneTaskWithNoLengthMakesTheRunSweepAndCountsNothingForIt() {
        let s = keptRunSummary([task("a", "Exporting graded clips", 0.5), task("b", "Exporting the composition")], ended: 1)
        XCTAssertNil(s.progress)
        // The ended task is whole, the measured one counts its half, the
        // sweeping one nothing: the system's bar never invents motion.
        XCTAssertEqual(s.unitsDone, 1500)
        XCTAssertEqual(s.unitsTotal, 3000)
        XCTAssertEqual(s.done, 1)
        XCTAssertEqual(s.total, 3)
    }

    func testEndedTasksKeepTheBarFromGoingBackWhenOneLeaves() {
        let before = keptRunSummary([task("a", "x", 0.9), task("b", "y", 0.2)], ended: 0)
        let after = keptRunSummary([task("b", "y", 0.2)], ended: 1)
        XCTAssertGreaterThanOrEqual(after.unitsDone, before.unitsDone)
        XCTAssertEqual(after.unitsTotal, before.unitsTotal)
        XCTAssertEqual(after.title, "y")
    }

    func testANegativeEndedCountIsZero() {
        let s = keptRunSummary([task("a", "x", 0)], ended: -2)
        XCTAssertEqual(s.done, 0)
        XCTAssertEqual(s.total, 1)
    }

    func testNothingRunningSaysSo() {
        let s = keptRunSummary([], ended: 2)
        XCTAssertEqual(s.title, "Nothing running")
        XCTAssertNil(s.detail)
        XCTAssertNil(s.progress)
        XCTAssertEqual(s.unitsDone, 2000)
        XCTAssertEqual(s.unitsTotal, 2000)
    }

    func testTheClosingWordsNameOnlyWhatTheAppKnows() {
        let one = keptRunClosing(["Exporting the piece"], end: .finished)
        XCTAssertEqual(one.title, "Exporting the piece")
        XCTAssertEqual(one.detail, "Finished")
        let two = keptRunClosing(["Exporting 3 pictures", "Encoding the hook"], end: .finished)
        XCTAssertEqual(two.title, "2 exports")
        XCTAssertEqual(two.detail, "All finished")
        XCTAssertEqual(keptRunClosing(["a"], end: .cancelled).detail, "Cancelled — what was done is kept")
        XCTAssertEqual(keptRunClosing(["a", "b"], end: .stopped).detail,
                       "Stopped in the background — what was done is kept")
        XCTAssertEqual(keptRunClosing([], end: .finished).title, "Nothing running")
    }
}
