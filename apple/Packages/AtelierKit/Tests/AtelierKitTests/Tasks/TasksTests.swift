// Port of `src/shared/tasks/tasks.test.ts`. The web clears its module state
// after each case; here each case makes its own registry, and one case
// exercises the shared instance the app reads.

import Foundation
import XCTest
@testable import AtelierKit

final class TaskRegistryTests: XCTestCase {
    func testListsATaskFromStartToDoneAndTellsItsSubscribersEachTime() {
        let r = TaskRegistry()
        var told = 0
        let off = r.subscribeTasks { told += 1 }
        let v0 = r.tasksVersion()
        let h = r.startTask(label: "Opening DSC00123.ARW", scope: "a", now: 1000)
        XCTAssertEqual(r.listTasks().map(\.label), ["Opening DSC00123.ARW"])
        let first = r.listTasks()[0]
        XCTAssertNil(first.progress)
        XCTAssertNil(first.detail)
        XCTAssertEqual(first.scope, "a")
        XCTAssertNil(first.cancel)
        XCTAssertEqual(first.startedAt, 1000)
        h.update(TaskPatch(progress: 0.5, detail: "26 MB of 52"))
        XCTAssertEqual(r.listTasks()[0].progress, 0.5)
        XCTAssertEqual(r.listTasks()[0].detail, "26 MB of 52")
        h.done()
        XCTAssertEqual(r.listTasks(), [])
        XCTAssertEqual(told, 3)
        XCTAssertEqual(r.tasksVersion(), v0 + 3)
        off()
        // A handle that is done ignores what comes after.
        h.update(TaskPatch(progress: 1))
        XCTAssertEqual(r.listTasks(), [])
        XCTAssertEqual(told, 3)
    }

    func testKeepsTheSameListUntilSomethingChangesAndClampsTheBar() {
        let r = TaskRegistry()
        let h = r.startTask(label: "x", progress: 1.4)
        let a = r.listTasks()
        let v = r.tasksVersion()
        XCTAssertEqual(a, r.listTasks())
        XCTAssertEqual(r.tasksVersion(), v)
        XCTAssertEqual(a[0].progress, 1)
        h.update(TaskPatch(progress: -1))
        XCTAssertEqual(r.listTasks()[0].progress, 0)
        XCTAssertNotEqual(r.listTasks(), a)
        XCTAssertEqual(r.tasksVersion(), v + 1)
    }

    func testScopesAMediasOwnTasks() {
        let r = TaskRegistry()
        _ = r.startTask(label: "a", scope: "m1")
        _ = r.startTask(label: "b", scope: "m2")
        _ = r.startTask(label: "c")
        XCTAssertEqual(r.tasksFor("m1").map(\.label), ["a"])
        XCTAssertEqual(r.tasksFor("m2").map(\.label), ["b"])
        XCTAssertEqual(r.tasksFor("m1", r.listTasks()).map(\.label), ["a"])
    }

    func testCancelsOnlyWhereTheWorkCanStop() {
        let r = TaskRegistry()
        var stopped = 0
        let can = r.startTask(label: "fetch", cancel: { stopped += 1 })
        let cannot = r.startTask(label: "decode")
        XCTAssertTrue(r.cancelTask(can.id))
        XCTAssertEqual(stopped, 1)
        XCTAssertFalse(r.cancelTask(cannot.id))
        XCTAssertFalse(r.cancelTask("nope"))
    }

    func testAPatchLeavesWhatItDoesNotNameAndClearsWhatItNamesNil() {
        let r = TaskRegistry()
        let h = r.startTask(label: "Fetching", progress: 0.25, detail: "18 MB of 74")
        h.update(TaskPatch(label: "Fetching DJI_0101.DNG"))
        XCTAssertEqual(r.listTasks()[0].label, "Fetching DJI_0101.DNG")
        XCTAssertEqual(r.listTasks()[0].progress, 0.25)
        XCTAssertEqual(r.listTasks()[0].detail, "18 MB of 74")
        h.update(TaskPatch(progress: .some(nil), detail: .some(nil)))
        XCTAssertNil(r.listTasks()[0].progress)
        XCTAssertNil(r.listTasks()[0].detail)
    }

    func testTheSharedRegistryClearsForASpec() {
        let r = TaskRegistry.shared
        r.clearTasks()
        let v = r.tasksVersion()
        r.clearTasks()
        XCTAssertEqual(r.tasksVersion(), v, "clearing nothing tells nobody")
        _ = r.startTask(label: "a")
        _ = r.startTask(label: "b")
        XCTAssertEqual(r.listTasks().count, 2)
        r.clearTasks()
        XCTAssertEqual(r.listTasks(), [])
        XCTAssertEqual(r.tasksVersion(), v + 3)
    }

    func testAnUnsubscribedListenerHearsNothing() {
        let r = TaskRegistry()
        var told = 0
        let off = r.subscribeTasks { told += 1 }
        _ = r.startTask(label: "a")
        off()
        _ = r.startTask(label: "b")
        XCTAssertEqual(told, 1)
    }
}

final class TaskSurfaceTests: XCTestCase {
    func testDrawsNothingUnder400MsAndSaysWhenTheYoungestBecomesVisible() {
        let r = TaskRegistry()
        _ = r.startTask(label: "old", now: 0)
        _ = r.startTask(label: "young", now: 900)
        let all = r.listTasks()
        XCTAssertEqual(visibleTasks(all, now: 1000).map(\.label), ["old"])
        XCTAssertEqual(nextReveal(all, now: 1000), showAfterMs - 100)
        XCTAssertEqual(visibleTasks(all, now: 1300).map(\.label), ["old", "young"])
        XCTAssertNil(nextReveal(all, now: 1300))
    }

    func testMeasuresTheWholeOnlyWhereEveryPartIsMeasured() {
        let r = TaskRegistry()
        _ = r.startTask(label: "a", progress: 0.2)
        _ = r.startTask(label: "b", progress: 0.6)
        assertClose(overallProgress(r.listTasks()) ?? -1, 0.4, 9)
        _ = r.startTask(label: "c")
        XCTAssertNil(overallProgress(r.listTasks()))
        XCTAssertNil(overallProgress([]))
    }

    func testSaysOneWordAndOneSentence() {
        let r = TaskRegistry()
        XCTAssertEqual(tasksSentence([]), "Nothing running")
        let h = r.startTask(label: "Fetching DJI_0101.DNG", progress: 0.25, detail: "18 MB of 74")
        XCTAssertEqual(pillWord(r.listTasks()), "Working")
        XCTAssertEqual(tasksSentence(r.listTasks()), "Fetching DJI_0101.DNG · 25 % · 18 MB of 74")
        h.update(TaskPatch(progress: .some(nil), detail: .some(nil)))
        XCTAssertEqual(tasksSentence(r.listTasks()), "Fetching DJI_0101.DNG")
        _ = r.startTask(label: "Exporting the roll")
        XCTAssertEqual(pillWord(r.listTasks()), "2 running")
        XCTAssertEqual(tasksSentence(r.listTasks()), "2 things running — Fetching DJI_0101.DNG, Exporting the roll")
    }
}
