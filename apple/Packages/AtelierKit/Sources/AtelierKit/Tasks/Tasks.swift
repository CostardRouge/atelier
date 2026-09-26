// ONE place that knows what is running: a fetch, a decode, an export —
// anything that takes long enough for a person to wonder whether the app is
// still alive. Port of `src/shared/tasks/tasks.ts` (`docs/progress-feedback.md`
// §3.1, T1; the decisions in `docs/memory/tasks.md`).
//
// The web keeps this as MODULE state with a subscription — never a React
// context — so a task started by a screen survives that screen (a roll export
// goes on while he walks to the gallery, and the pill still says so). Here it
// is a class with the same API and one shared instance, `TaskRegistry.shared`,
// which is what the app's progress pill reads; a spec makes its own.
//
// Rules (§3.2): a task is named after what a person ASKED for; a length nobody
// knows is nil and SWEEPS — a percentage nobody measured is a fabrication;
// `cancel` is present only where stopping is real; and under `showAfterMs`
// the surfaces draw nothing, so a fast fetch never flashes.
//
// The web's `Task` keeps its name as `TaskRegistry.Task`, nested: a top-level
// `Task` would shadow Swift's own `Task` in every file that imports the kernel.
// The registry is guarded by a lock because a task's `update` may come from
// the thread doing the work while the pill reads on the main one; listeners
// are always called outside it.

import Foundation

/// How long a task must have run before a surface draws it, in milliseconds.
public let showAfterMs: Double = 400

public struct TaskInit {
    /// What is happening, in the words a person would use: "Opening DSC00123.ARW".
    public var label: String
    /// What it belongs to, so a media's own edge draws only its own tasks.
    public var scope: String?
    /// 0..1 where it is known, nil where it is not.
    public var progress: Double?
    /// A second line — "12 MB of 52", "3 of 8 pictures" — or nil.
    public var detail: String?
    /// Present only where the work can really stop. Never drawn otherwise.
    public var cancel: (() -> Void)?

    public init(label: String, scope: String? = nil, progress: Double? = nil,
                detail: String? = nil, cancel: (() -> Void)? = nil) {
        self.label = label
        self.scope = scope
        self.progress = progress
        self.detail = detail
        self.cancel = cancel
    }
}

/// What an `update` changes. Each field is left alone when absent (`nil`), set
/// when present, and — for the two that may be cleared — CLEARED when present
/// and holding nil: `TaskPatch(progress: .some(nil))` is the web's
/// `{ progress: null }`, `TaskPatch(progress: 0.5)` its `{ progress: 0.5 }`.
public struct TaskPatch {
    public var label: String?
    public var progress: Double??
    public var detail: String??

    public init(label: String? = nil, progress: Double?? = nil, detail: String?? = nil) {
        self.label = label
        self.progress = progress
        self.detail = detail
    }
}

public struct TaskHandle {
    public let id: String
    /// Move the bar, change the words. Ignored once done.
    public let update: (TaskPatch) -> Void
    /// The work ended, however it ended: the task leaves the list.
    public let done: () -> Void

    public init(id: String, update: @escaping (TaskPatch) -> Void, done: @escaping () -> Void) {
        self.id = id
        self.update = update
        self.done = done
    }
}

public final class TaskRegistry {
    public struct Task: Equatable {
        public var id: String
        public var label: String
        /// 0..1 where it is known, nil where it is not.
        public var progress: Double?
        public var detail: String?
        public var scope: String?
        /// Present only where the work can really stop.
        public var cancel: (() -> Void)?
        /// Milliseconds, on the clock `startTask` was given.
        public var startedAt: Double

        public init(id: String, label: String, progress: Double? = nil, detail: String? = nil,
                    scope: String? = nil, cancel: (() -> Void)? = nil, startedAt: Double) {
            self.id = id
            self.label = label
            self.progress = progress
            self.detail = detail
            self.scope = scope
            self.cancel = cancel
            self.startedAt = startedAt
        }

        /// Two closures cannot be compared; equality asks only whether a
        /// Cancel is there, which is all a surface ever asks of it.
        public static func == (l: Task, r: Task) -> Bool {
            let same = l.id == r.id && l.label == r.label && l.progress == r.progress
            let rest = l.detail == r.detail && l.scope == r.scope && l.startedAt == r.startedAt
            let cancellable = (l.cancel == nil) == (r.cancel == nil)
            return same && rest && cancellable
        }
    }

    /// The app's one registry — the web's module state.
    public static let shared = TaskRegistry()

    private let lock = NSLock()
    /// Oldest first — the insertion order the web's `Map` keeps.
    private var tasks: [Task] = []
    private var version = 0
    private var seq = 0
    private var listeners: [Int: () -> Void] = [:]
    private var listenerSeq = 0

    public init() {}

    /// Register a running task; the handle is how the work reports and ends it.
    public func startTask(_ spec: TaskInit, now: Double = Date().timeIntervalSince1970 * 1000) -> TaskHandle {
        lock.lock()
        seq += 1
        let id = "task-\(seq)"
        tasks.append(Task(id: id, label: spec.label, progress: spec.progress.map(clamp01), detail: spec.detail,
                          scope: spec.scope, cancel: spec.cancel, startedAt: now))
        let fns = bump()
        lock.unlock()
        for fn in fns { fn() }
        return TaskHandle(
            id: id,
            update: { [weak self] patch in self?.update(id, patch) },
            done: { [weak self] in self?.finish(id) }
        )
    }

    /// The same, spelled out.
    public func startTask(label: String, scope: String? = nil, progress: Double? = nil, detail: String? = nil,
                          cancel: (() -> Void)? = nil,
                          now: Double = Date().timeIntervalSince1970 * 1000) -> TaskHandle {
        startTask(TaskInit(label: label, scope: scope, progress: progress, detail: detail, cancel: cancel), now: now)
    }

    private func update(_ id: String, _ patch: TaskPatch) {
        lock.lock()
        guard let i = tasks.firstIndex(where: { $0.id == id }) else {
            lock.unlock()
            return
        }
        if let label = patch.label { tasks[i].label = label }
        if let progress = patch.progress { tasks[i].progress = progress.map(clamp01) }
        if let detail = patch.detail { tasks[i].detail = detail }
        let fns = bump()
        lock.unlock()
        for fn in fns { fn() }
    }

    private func finish(_ id: String) {
        lock.lock()
        guard let i = tasks.firstIndex(where: { $0.id == id }) else {
            lock.unlock()
            return
        }
        tasks.remove(at: i)
        let fns = bump()
        lock.unlock()
        for fn in fns { fn() }
    }

    /// Under the lock: something changed. Returns the listeners to call once
    /// the lock is released.
    private func bump() -> [() -> Void] {
        version += 1
        return Array(listeners.values)
    }

    /// Every running task, oldest first.
    public func listTasks() -> [Task] {
        lock.lock()
        defer { lock.unlock() }
        return tasks
    }

    /// The tasks scoped to one media.
    public func tasksFor(_ scope: String, _ all: [Task]? = nil) -> [Task] {
        (all ?? listTasks()).filter { $0.scope == scope }
    }

    /// Ask a task to stop, where it can. True when it could be asked.
    @discardableResult
    public func cancelTask(_ id: String) -> Bool {
        lock.lock()
        let cancel = tasks.first(where: { $0.id == id })?.cancel
        lock.unlock()
        guard let cancel else { return false }
        cancel()
        return true
    }

    /// Bumped on every change — a cheap "did anything move" for a surface.
    public func tasksVersion() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return version
    }

    /// Called after every change; the returned closure unsubscribes.
    public func subscribeTasks(_ fn: @escaping () -> Void) -> () -> Void {
        lock.lock()
        listenerSeq += 1
        let key = listenerSeq
        listeners[key] = fn
        lock.unlock()
        return { [weak self] in
            guard let self else { return }
            self.lock.lock()
            self.listeners[key] = nil
            self.lock.unlock()
        }
    }

    /// For a spec: nothing running.
    public func clearTasks() {
        lock.lock()
        if tasks.isEmpty {
            lock.unlock()
            return
        }
        tasks.removeAll()
        let fns = bump()
        lock.unlock()
        for fn in fns { fn() }
    }
}

// MARK: - what a surface draws, pure

/// The tasks old enough to be drawn — a bar that flashes on every fetch is noise.
public func visibleTasks(_ all: [TaskRegistry.Task], now: Double, showAfter: Double = showAfterMs) -> [TaskRegistry.Task] {
    all.filter { now - $0.startedAt >= showAfter }
}

/// Milliseconds until the youngest hidden task becomes visible, or nil when none is hidden.
public func nextReveal(_ all: [TaskRegistry.Task], now: Double, showAfter: Double = showAfterMs) -> Double? {
    var wait: Double? = nil
    for t in all {
        let left = showAfter - (now - t.startedAt)
        if left > 0, wait == nil || left < wait! { wait = left }
    }
    return wait
}

/// One number for several tasks: the mean of what is measured, or nil the
/// moment ANY of them has no length — a bar that is half determinate would be
/// claiming a whole nobody knows.
public func overallProgress(_ all: [TaskRegistry.Task]) -> Double? {
    if all.isEmpty { return nil }
    var sum = 0.0
    for t in all {
        guard let p = t.progress else { return nil }
        sum += p
    }
    return sum / Double(all.count)
}

/// The pill's one word.
public func pillWord(_ all: [TaskRegistry.Task]) -> String {
    all.count > 1 ? "\(all.count) running" : "Working"
}

/// The pill's sentence, for a screen reader and the popover's head.
public func tasksSentence(_ all: [TaskRegistry.Task]) -> String {
    if all.isEmpty { return "Nothing running" }
    if all.count == 1 {
        let t = all[0]
        let pct = t.progress.map { " · \(Int(($0 * 100).rounded())) %" } ?? ""
        var detail = ""
        if let d = t.detail, !d.isEmpty { detail = " · \(d)" }
        return "\(t.label)\(pct)\(detail)"
    }
    return "\(all.count) things running — \(all.map(\.label).joined(separator: ", "))"
}
