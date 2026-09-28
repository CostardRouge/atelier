// The app's task center — the observable view of the kernel's registry that
// the toolbar's pill and a media's edge read (`tasks.md`): nothing drawn
// under 400 ms and the task revealed once it is old enough, a media's own
// tasks and none for a media with no scope, a Cancel spent once and only
// where there is one, a transfer's bytes on its task in `trackedFetch`'s own
// words, and a task that leaves however its work ends — a Cancel included.

import AtelierKit
import Foundation
import XCTest
@testable import Atelier

final class TaskCenterTests: XCTestCase {
    private func ago(_ ms: Double) -> Double { TaskCenter.nowMs() - ms }

    /// Poll the main actor until `condition` holds, for at most `seconds`.
    @MainActor private func eventually(_ seconds: Double = 3, _ condition: () -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if condition() { return true }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return condition()
    }

    @MainActor func testNothingIsDrawnUnder400ms() {
        let registry = TaskRegistry()
        let center = TaskCenter(registry: registry)
        _ = registry.startTask(label: "Opening DSC00123.ARW", scope: "p1", now: ago(1000))
        _ = registry.startTask(label: "Fetching DJI_0202.JPG", scope: "p2", now: ago(10))
        center.refresh()
        XCTAssertEqual(center.running.map(\.label), ["Opening DSC00123.ARW", "Fetching DJI_0202.JPG"])
        XCTAssertEqual(center.visible.map(\.label), ["Opening DSC00123.ARW"])
    }

    @MainActor func testATaskIsRevealedOnceOldEnoughAndLeavesWhenDone() async {
        let registry = TaskRegistry()
        let center = TaskCenter(registry: registry)
        let handle = registry.startTask(label: "Exporting 2 pictures", progress: 0)
        center.refresh()
        XCTAssertEqual(center.running.count, 1)
        XCTAssertTrue(center.visible.isEmpty, "a task younger than 400 ms is not drawn")
        let shown = await eventually { center.visible.count == 1 }
        XCTAssertTrue(shown, "the center wakes itself when the task is old enough")
        handle.update(TaskPatch(progress: 0.5, detail: "1/2 · DJI_0101.JPG"))
        let moved = await eventually { center.visible.first?.progress == 0.5 }
        XCTAssertTrue(moved, "a worker's update reaches the surfaces")
        handle.done()
        let gone = await eventually { center.visible.isEmpty && center.running.isEmpty }
        XCTAssertTrue(gone)
    }

    @MainActor func testAMediaReadsOnlyItsOwnTasks() {
        let registry = TaskRegistry()
        let center = TaskCenter(registry: registry)
        _ = registry.startTask(label: "Opening A.JPG", scope: "p1", now: ago(1000))
        _ = registry.startTask(label: "Opening B.JPG", scope: "p2", now: ago(1000))
        _ = registry.startTask(label: "Exporting 2 pictures", now: ago(1000))
        center.refresh()
        XCTAssertEqual(center.scoped("p1").map(\.label), ["Opening A.JPG"])
        XCTAssertTrue(center.scoped("p3").isEmpty)
        XCTAssertTrue(center.scoped(nil).isEmpty, "a media with no scope yet draws nothing")
    }

    @MainActor func testACancelIsSpentOnceAndOnlyWhereThereIsOne() {
        let registry = TaskRegistry()
        let center = TaskCenter(registry: registry)
        var asked = 0
        let run = registry.startTask(label: "Exporting 3 pictures", cancel: { asked += 1 }, now: ago(1000))
        let pack = registry.startTask(label: "Importing AUTHENTIC", now: ago(1000))
        center.refresh()
        center.cancel(run.id)
        center.cancel(run.id)
        XCTAssertEqual(asked, 1, "a Cancel already pressed is not pressed again")
        XCTAssertEqual(center.cancelling, [run.id])
        center.cancel(pack.id)
        XCTAssertFalse(center.cancelling.contains(pack.id), "no Cancel, nothing to spend")
        run.done()
        center.refresh()
        XCTAssertTrue(center.cancelling.isEmpty, "a task that left is forgotten")
    }

    func testATransfersBytesSayTheWebsWords() {
        let mb = 1_000_000
        let measured = TaskCenter.transferPatch(
            TransferProgress(direction: .download, bytes: Int64(13 * mb), total: Int64(52 * mb)), known: nil)
        XCTAssertEqual(measured.progress, 0.25)
        XCTAssertEqual(measured.detail, "13.0 MB of 52.0 MB")

        let known = TaskCenter.transferPatch(TransferProgress(direction: .download, bytes: 1000, total: nil), known: 4000)
        XCTAssertEqual(known.progress, 0.25, "the weight the caller knew stands in for a missing length")
        XCTAssertEqual(known.detail, "1.0 KB of 4.0 KB")

        let unknown = TaskCenter.transferPatch(TransferProgress(direction: .download, bytes: 10, total: nil), known: nil)
        XCTAssertEqual(unknown.progress, .some(nil), "no length: the bar sweeps")
        XCTAssertEqual(unknown.detail, "10 B")
    }

    func testATrackedTransferMovesItsBarAndLeaves() async throws {
        let registry = TaskRegistry()
        let seen = try await TaskCenter.tracked("Fetching DJI_0202.JPG", scope: "asset-202", bytes: 4000,
                                                in: registry) { () async throws -> [String] in
            let first = registry.listTasks()
            WinnowTransfer.progress?(TransferProgress(direction: .download, bytes: 1000, total: nil))
            let after = registry.listTasks()
            return [
                first.first?.scope ?? "-",
                first.first?.detail ?? "-",
                "\(first.first?.progress ?? -1)",
                "\(after.first?.progress ?? -1)",
                after.first?.detail ?? "-",
                first.first?.cancel == nil ? "no cancel" : "cancel",
            ]
        }
        XCTAssertEqual(seen, ["asset-202", "4.0 KB", "0.0", "0.25", "1.0 KB of 4.0 KB", "cancel"])
        XCTAssertTrue(registry.listTasks().isEmpty, "gone the moment it ends")
    }

    func testARunsCancelStopsTheWorkAndTheTaskLeaves() async {
        let registry = TaskRegistry()
        do {
            _ = try await TaskCenter.run("Exporting 2 pictures", in: registry) { (_: TaskHandle) async throws -> Int in
                let id = registry.listTasks().first?.id ?? ""
                registry.cancelTask(id)
                try await Task.sleep(nanoseconds: 5_000_000_000)
                return 1
            }
            XCTFail("a cancelled run must throw")
        } catch is CancellationError {
            // The person's own doing.
        } catch {
            XCTFail("a cancel is a CancellationError, not \(error)")
        }
        XCTAssertTrue(registry.listTasks().isEmpty)
    }
}
