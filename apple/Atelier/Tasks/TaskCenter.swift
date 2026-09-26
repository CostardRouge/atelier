// What is running, for the whole app — the web's `src/shared/tasks/`
// (`tasks.ts`, `use-tasks.ts`, `tracked.ts`; `docs/progress-feedback.md`,
// the decisions in `docs/memory/tasks.md`) on the app's side.
//
// The kernel's `TaskRegistry` is the model: module state, lock-guarded, so a
// task is started and moved from the thread doing the work — a render, an
// encode, a transfer's queue. `TaskCenter` is the ONE observable view of it
// the surfaces read (`TaskPill` in the toolbar, `TaskEdge` on a media's edge):
// the registry's list mirrored on the main actor, a refresh coalesced however
// many changes a worker reports, and the 400 ms rule kept by a timer that
// wakes when the youngest hidden task is old enough — so a surface appears
// once and never flashes for a fetch that was over before it mattered.
//
// Rules kept (`tasks.md`):
// - A task SURVIVES the screen that started it: the registry is the app's,
//   never a view's, so an export goes on while he walks back to the gallery
//   and the pill still says so.
// - One task per operation a person ASKED for, named in his words
//   ("Exporting 3 pictures", "Opening DSC00123.ARW"), never one per frame.
// - A length nobody measured is nil and SWEEPS; `overallProgress` is nil the
//   moment any task has none.
// - A Cancel exists only where the work can really stop, and `cancel` is the
//   only caller: a button that does nothing is worse than no button. What a
//   Cancel stops at is the work's own safe point — between two pictures,
//   between two clips — and what was done is kept.
// - No ceiling: the list is oldest first.
//
// Starting a task is `TaskCenter.start` from any thread (the handle's
// `update` and `done` too); `run` ties a task to a Swift task, its Cancel
// cancelling it; `tracked` is the web's `trackedFetch` for a Winnow call, its
// bar moving with the bytes (`WinnowTransfer.$progress`).

import Foundation
import Observation
import AtelierKit

/// A running task as the surfaces read it — the kernel's `TaskRegistry.Task`,
/// named for the app so it is never read as Swift's own `Task`.
typealias RunningTask = TaskRegistry.Task

@MainActor
@Observable
final class TaskCenter {
    /// The app's one center, over the kernel's one registry.
    static let shared = TaskCenter(registry: .shared)

    /// Every running task, oldest first.
    private(set) var running: [RunningTask] = []
    /// The tasks old enough to draw (`showAfterMs`) — what every surface reads.
    private(set) var visible: [RunningTask] = []
    /// Whether anything is drawn at all — what a toolbar reads to hold the
    /// pill's place, so a bar moving does not re-read every screen's toolbar.
    private(set) var anyVisible = false
    /// Tasks asked to stop and still winding down to their safe point: their
    /// Cancel is spent, and a surface says so instead of drawing it again.
    private(set) var cancelling: Set<String> = []

    @ObservationIgnored let registry: TaskRegistry
    @ObservationIgnored private var revealTimer: Task<Void, Never>?

    init(registry: TaskRegistry) {
        self.registry = registry
        let gate = RefreshGate()
        // Called from whichever thread changed the registry: one main-actor
        // refresh owed at a time, reading the latest list when it lands.
        // `@Sendable`, so the closure is never taken for the main actor's.
        _ = registry.subscribeTasks { @Sendable [weak self] in
            guard gate.arm() else { return }
            let owner = self
            Task { @MainActor in
                gate.disarm()
                owner?.refresh()
            }
        }
        refresh()
    }

    // MARK: - what the surfaces read

    /// The visible tasks scoped to one media — its edge's; none for a media
    /// with no scope yet (the web's `useTasks(null)`).
    func scoped(_ scope: String?) -> [RunningTask] {
        guard let scope else { return [] }
        return visible.filter { $0.scope == scope }
    }

    /// Ask a task to stop, once. Ignored for a task with no Cancel, and for
    /// one already asked.
    func cancel(_ id: String) {
        guard !cancelling.contains(id) else { return }
        if registry.cancelTask(id) { cancelling.insert(id) }
    }

    /// Read the registry again. Called by the subscription and the reveal
    /// timer; a spec calls it to read the registry at once.
    func refresh() {
        let all = registry.listTasks()
        let now = TaskCenter.nowMs()
        if all != running { running = all }
        let shown = visibleTasks(all, now: now)
        if shown != visible { visible = shown }
        let drawn = !shown.isEmpty
        if drawn != anyVisible { anyVisible = drawn }
        let alive = Set(all.map(\.id))
        let kept = cancelling.intersection(alive)
        if kept != cancelling { cancelling = kept }
        wake(after: nextReveal(all, now: now))
    }

    /// Come back when the youngest hidden task is old enough to be drawn.
    private func wake(after wait: Double?) {
        revealTimer?.cancel()
        guard let wait else {
            revealTimer = nil
            return
        }
        let nanos = UInt64(max(0, wait + 5) * 1_000_000)
        revealTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: nanos)
            guard !Task.isCancelled else { return }
            self?.refresh()
        }
    }

    /// The registry's clock: milliseconds since 1970, as `startTask` stamps them.
    nonisolated static func nowMs() -> Double {
        Date().timeIntervalSince1970 * 1000
    }

    // MARK: - starting one, from anywhere

    /// Register a running task; the handle is how the work reports and ends
    /// it — from any thread. `cancel` only where the work can really stop.
    nonisolated static func start(_ label: String, scope: String? = nil, progress: Double? = nil,
                                  detail: String? = nil, cancel: (() -> Void)? = nil,
                                  in registry: TaskRegistry = .shared) -> TaskHandle {
        registry.startTask(label: label, scope: scope, progress: progress, detail: detail, cancel: cancel)
    }

    /// Run `operation` as a task: registered now, gone when it ends however
    /// it ends. Where `cancellable`, the task's Cancel cancels the Swift task
    /// the operation runs in — it stops at its own next check — and a caller
    /// cancelled from outside cancels it too.
    nonisolated static func run<T: Sendable>(_ label: String, scope: String? = nil, progress: Double? = nil,
                                             detail: String? = nil, cancellable: Bool = true,
                                             in registry: TaskRegistry = .shared,
                                             _ operation: @escaping (TaskHandle) async throws -> T) async throws -> T {
        let box = CancelBox()
        let stop: (() -> Void)? = cancellable ? { box.cancel() } : nil
        let handle = registry.startTask(label: label, scope: scope, progress: progress, detail: detail, cancel: stop)
        defer { handle.done() }
        let work = Task { try await operation(handle) }
        box.hold { work.cancel() }
        return try await withTaskCancellationHandler {
            try await work.value
        } onCancel: {
            work.cancel()
        }
    }

    /// The web's `trackedFetch`: a Winnow call as a TASK — registered before
    /// the first byte, a bar that moves with the bytes (against the answer's
    /// length, else the weight the caller already knew — a row's
    /// `file_size` —, else a sweep), a Cancel that cancels the request, gone
    /// the moment it ends. A cancelled transfer throws `CancellationError`,
    /// the person's own doing: a caller says "… was cancelled" or stays quiet.
    nonisolated static func tracked<T: Sendable>(_ label: String, scope: String? = nil, bytes: Int64? = nil,
                                                 in registry: TaskRegistry = .shared,
                                                 _ operation: @escaping () async throws -> T) async throws -> T {
        let known: Int64? = (bytes ?? 0) > 0 ? bytes : nil
        let firstDetail = known.map { formatBytes(Double($0)) }
        return try await run(label, scope: scope, progress: known == nil ? nil : 0, detail: firstDetail,
                             in: registry) { (handle: TaskHandle) async throws -> T in
            let report: WinnowTransfer.Handler = { moved in
                handle.update(TaskCenter.transferPatch(moved, known: known))
            }
            return try await WinnowTransfer.$progress.withValue(report) {
                try await operation()
            }
        }
    }

    /// What a transfer's bytes say on its task — `trackedFetch`'s `onProgress`:
    /// a ratio against the whole where one is known, the bytes alone otherwise.
    nonisolated static func transferPatch(_ moved: TransferProgress, known: Int64?) -> TaskPatch {
        let whole = moved.total ?? known
        let done = formatBytes(Double(moved.bytes))
        guard let whole, whole > 0 else {
            return TaskPatch(progress: .some(nil), detail: .some(done))
        }
        let ratio = min(1, Double(moved.bytes) / Double(whole))
        return TaskPatch(progress: .some(ratio), detail: .some("\(done) of \(formatBytes(Double(whole)))"))
    }

    /// The words a surface says for a task cancelled by the person — the web's
    /// `AbortError` message.
    nonisolated static func cancelledSentence(_ label: String) -> String {
        "\(label) was cancelled"
    }
}

/// One main-actor refresh owed at a time, however many changes a worker
/// reports between two turns of the main run loop.
private final class RefreshGate: @unchecked Sendable {
    private let lock = NSLock()
    private var owed = false

    /// True when the caller must schedule the refresh.
    func arm() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if owed { return false }
        owed = true
        return true
    }

    func disarm() {
        lock.lock()
        owed = false
        lock.unlock()
    }
}

/// A Cancel that may be pressed before the work it cancels exists.
private final class CancelBox: @unchecked Sendable {
    private let lock = NSLock()
    private var action: (() -> Void)?
    private var pressed = false

    func hold(_ cancel: @escaping () -> Void) {
        lock.lock()
        if pressed {
            lock.unlock()
            cancel()
            return
        }
        action = cancel
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        pressed = true
        let run = action
        lock.unlock()
        run?()
    }
}
