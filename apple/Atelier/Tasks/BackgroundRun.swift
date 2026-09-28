// Every EXPORT keeps running when he leaves the app — the maintainer's ask:
// "once it comes to exports and encoding video, I want it done natively,
// using the phone's hardware to the max" (the run-sheet's «Background and
// the Live Activity»). Before this, an export stopped the moment the app left
// the foreground: iOS suspends a process that holds nothing.
//
// ONE helper, one line per export: `BackgroundRun.keep(handle)` right after
// the export's `TaskCenter.start` (or the registry's `startTask`). The task is
// then KEPT, and for as long as any kept task runs the app holds what the
// platform grants a person's own long work:
//
// - iOS 26 and later: a `BGContinuedProcessingTask`, submitted while the app
//   is still on screen — the only moment the system takes one — asking for
//   the GPU in the background where the device grants it. The system draws
//   its own progress UI for it from the request's title and subtitle (the
//   kept task's label and detail) and from the progress object this helper
//   keeps level with the kept tasks (`keptRunSummary`). Its expiration — the
//   system's, or his Stop on that UI — asks every kept task to stop through
//   its OWN Cancel (`TaskCenter.cancel`), so each ends at its safe point and
//   what was done is kept (`tasks.md`). The last kept task to end completes it.
// - iOS 17–25, and iOS 26 whenever the system refuses the request:
//   `beginBackgroundTask`, which buys about THIRTY SECONDS once the app has
//   left the screen — never more, whatever the export's length. Its
//   expiration cancels the kept tasks the same way. (It is also held on
//   iOS 26 from the start until the continued task launches, so the gap
//   between the request and its launch is covered.)
// - macOS: `ProcessInfo.beginActivity(.userInitiated)`, so App Nap does not
//   throttle an export in a hidden window and the Mac does not idle to sleep
//   under it; ended with the last kept task.
//
// The LIVE ACTIVITY (iOS; `apple/Shared/ExportActivity.swift`, drawn by the
// `apple/Widgets/` extension) is started with the run while the app is on
// screen — the one moment ActivityKit takes a request from the app —, fed
// from the same summary at most once a second (and every 20 s with nothing
// new, so that only a SUSPENDED app lets it go stale), and ended with the
// run's last words: left a few minutes when the run ended while he was away,
// gone at once when he is looking at the app. It is NOT started beside iOS
// 26's continued task (`activityBesideSystemUI`): the system draws its own
// progress UI for that one, from the same title, subtitle and progress. Every
// ActivityKit call is guarded by `areActivitiesEnabled`.
//
// The helper WATCHES `TaskCenter.shared.running` (Observation) and reads the
// kernel's registry itself for the truth — a task kept a moment before the
// center's coalesced refresh is still found —, so a kept task that ends,
// however it ends, lets go of what was held for it. Main actor throughout.
//
// [verify on device] — nothing here has run on a phone or a Mac:
// - The iOS 26 API as remembered from Apple's documentation, not compiled
//   against it here: `BGContinuedProcessingTaskRequest(identifier:title:
//   subtitle:)`, `strategy = .fail`, `requiredResources = .gpu`,
//   `BGTaskScheduler.supportedResources`, `BGContinuedProcessingTask`'s
//   `updateTitle(_:subtitle:)`, `progress`, `expirationHandler`. Guarded by
//   `#if compiler(>=6.2)` so an older Xcode still builds the rest.
// - One FIXED identifier, one run at a time: whether it may be submitted
//   again once its task completed (iOS 26 also takes a `<bundle>.<ctx>.*`
//   wildcard with a fresh suffix per request — the fallback if it may not).
// - Whether the `processing` background mode is needed (declared in
//   `project.yml` to be safe), and whether background GPU needs an
//   entitlement this app does not declare (remembered as
//   `com.apple.developer.background-tasks.continued-processing.gpu`): a
//   refused `.gpu` request is submitted again without it, and the refusal is
//   logged (`website.steeve.atelier` · `background`).
// - Whether the GPU and the hardware encoder answer in the background at all
//   without that grant: Core Image renders on Metal and `AVAssetWriter` is
//   known to be interrupted when an app leaves the screen. If they refuse, a
//   kept export FAILS in the background rather than stalling — the first run
//   on a device says which.
// - That the system shows its own progress UI for a continued task (Apple's
//   documentation: continued processing tasks "will present UI while in
//   progress"), which is why our Live Activity stands down beside one; if it
//   does not, `activityBesideSystemUI = true` shows ours there too.

import Foundation
import Observation
import AtelierKit
#if os(iOS)
import UIKit
import BackgroundTasks
import ActivityKit
import os
#endif

@MainActor
final class BackgroundRun {
    /// The app's one helper.
    static let shared = BackgroundRun()

    /// The continued processing task's identifier — permitted in
    /// `project.yml` (`BGTaskSchedulerPermittedIdentifiers`), registered at launch.
    nonisolated static let continuedIdentifier = "website.steeve.atelier.export"

    /// Keep a task running past the foreground — an export, right after its
    /// `TaskCenter.start`. Nil is ignored, so an optional handle is one line too.
    static func keep(_ handle: TaskHandle?) {
        guard let handle else { return }
        shared.keepTask(handle.id)
    }

    /// Once, while the app launches: the system refuses a launch handler
    /// registered later than that.
    nonisolated static func registerAtLaunch() {
        #if os(iOS) && compiler(>=6.2)
        if #available(iOS 26, *) {
            let accepted = BGTaskScheduler.shared.register(forTaskWithIdentifier: continuedIdentifier,
                                                           using: .main) { task in
                MainActor.assumeIsolated { BackgroundRun.shared.launched(task) }
            }
            if !accepted {
                Logger(subsystem: "website.steeve.atelier", category: "background")
                    .error("the continued processing task could not be registered")
            }
        }
        #endif
        #if os(iOS)
        Task { @MainActor in BackgroundRun.shared.endLeftovers() }
        #endif
    }

    // MARK: - the run

    /// True from the first kept task starting to the last one ending (or the
    /// platform taking the time away).
    private var active = false
    /// The kept tasks still running.
    private var kept: Set<String> = []
    /// Every task kept in this run, oldest first, with its latest label — the
    /// run's closing words.
    private var labels: [(id: String, label: String)] = []
    /// Kept tasks of this run that ended.
    private var ended = 0
    /// A kept task's Cancel was pressed on the way.
    private var sawCancel = false
    private var watching = false

    private var registry: TaskRegistry { TaskCenter.shared.registry }

    private func keepTask(_ id: String) {
        guard !kept.contains(id), let task = registry.listTasks().first(where: { $0.id == id }) else { return }
        let fresh = !active
        if fresh {
            ended = 0
            sawCancel = false
            labels = []
        }
        kept.insert(id)
        labels.append((id: id, label: task.label))
        if fresh {
            active = true
            hold(keptRunSummary([task], ended: 0))
        }
        watch()
        refresh()
    }

    /// Follow the center's list; each change is read once, on the main actor.
    private func watch() {
        guard !watching else { return }
        watching = true
        withObservationTracking {
            _ = TaskCenter.shared.running
            _ = TaskCenter.shared.cancelling
        } onChange: {
            Task { @MainActor in
                let run = BackgroundRun.shared
                run.watching = false
                run.refresh()
                if run.active { run.watch() }
            }
        }
    }

    /// Read the registry: which kept tasks still run, what they say, and
    /// whether the run is over.
    private func refresh() {
        guard active else { return }
        let cancelling = TaskCenter.shared.cancelling
        var running: [RunningTask] = []
        for t in registry.listTasks() where kept.contains(t.id) {
            running.append(t)
            if cancelling.contains(t.id) { sawCancel = true }
            if let i = labels.firstIndex(where: { $0.id == t.id }) { labels[i].label = t.label }
        }
        let still = Set(running.map(\.id))
        ended += kept.subtracting(still).count
        kept = still
        if kept.isEmpty {
            close(sawCancel ? .cancelled : .finished)
            return
        }
        report(keptRunSummary(running, ended: ended))
    }

    /// The platform takes the time away: every kept task is asked to stop
    /// through its own Cancel — it ends at its safe point when the app next
    /// runs, keeping what was done — and the run lets go now.
    private func expire() {
        guard active else { return }
        for id in kept { TaskCenter.shared.cancel(id) }
        close(.stopped)
    }

    /// The run is over: let go of everything held for it.
    private func close(_ end: KeptRunEnd) {
        guard active else { return }
        active = false
        kept = []
        #if os(iOS)
        let words = keptRunClosing(labels.map { $0.label }, end: end)
        completeContinued(words, whole: end != .stopped)
        // The seconds go once the Live Activity has its last words — and
        // never later than a second from now: at an expiration the system
        // does not wait.
        let held = seconds
        seconds = nil
        endActivity(words, end: end) { held?.end() }
        if let held {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                MainActor.assumeIsolated { held.end() }
            }
        }
        #elseif os(macOS)
        if let activityToken { ProcessInfo.processInfo.endActivity(activityToken) }
        activityToken = nil
        #endif
    }

    /// Hold the platform's time for a run that starts now.
    private func hold(_ summary: KeptRunSummary) {
        #if os(iOS)
        beginLegacy()
        if UIApplication.shared.applicationState == .active {
            submitContinued(summary)
            startActivity(summary)
        }
        #elseif os(macOS)
        activityToken = ProcessInfo.processInfo.beginActivity(options: .userInitiated,
                                                              reason: "Atelier: \(summary.title)")
        #endif
    }

    /// Say where the run is on what the platform shows.
    private func report(_ summary: KeptRunSummary) {
        #if os(iOS)
        mirrorContinued(summary)
        pushActivity(activityState(summary))
        #endif
    }

    #if os(macOS)
    /// App Nap and idle sleep held off while a kept task runs.
    private var activityToken: NSObjectProtocol?
    #endif

    #if os(iOS)
    // MARK: - iOS 17–25: the seconds after leaving the screen

    /// The seconds `beginBackgroundTask` bought — ended exactly once.
    @MainActor
    private final class Seconds {
        var id: UIBackgroundTaskIdentifier = .invalid

        func end() {
            guard id != .invalid else { return }
            UIApplication.shared.endBackgroundTask(id)
            id = .invalid
        }
    }

    /// The seconds the running run holds.
    private var seconds: Seconds?

    private func beginLegacy() {
        guard seconds == nil else { return }
        let held = Seconds()
        held.id = UIApplication.shared.beginBackgroundTask(withName: "Atelier: exporting") {
            // Called on the main thread, shortly before the time runs out.
            MainActor.assumeIsolated { BackgroundRun.shared.legacyExpired(held) }
        }
        seconds = held
    }

    private func legacyExpired(_ held: Seconds) {
        // Once the continued task runs it is the one holding the time, and
        // seconds a closed run still holds are simply let go.
        if held === seconds, continued == nil, active {
            expire()  // close() lets these seconds go after the last words
        } else {
            held.end()
            if held === seconds { seconds = nil }
        }
    }

    private func endLegacy() {
        seconds?.end()
        seconds = nil
    }

    // MARK: - iOS 26: the continued processing task

    /// The continued task, once the system launched it.
    private var continued: BGTask?
    /// A request submitted and not launched yet.
    private var continuedAsked = false
    /// What the system's UI was last told.
    private var shownTitle = ""
    private var shownSubtitle = ""
    private let log = Logger(subsystem: "website.steeve.atelier", category: "background")

    private func submitContinued(_ summary: KeptRunSummary) {
        guard continued == nil, !continuedAsked else { return }
        #if compiler(>=6.2)
        if #available(iOS 26, *) {
            continuedAsked = submit(summary, gpu: true) || submit(summary, gpu: false)
        }
        #endif
    }

    #if compiler(>=6.2)
    /// One request, with or without the GPU; false when refused.
    @available(iOS 26, *)
    private func submit(_ summary: KeptRunSummary, gpu: Bool) -> Bool {
        let subtitle = summary.detail ?? "Working"
        let request = BGContinuedProcessingTaskRequest(identifier: Self.continuedIdentifier,
                                                       title: summary.title, subtitle: subtitle)
        // Now or not at all: a request left in a queue would start after the
        // export it was asked for.
        request.strategy = .fail
        if gpu {
            // Core Image and the encoder on the hardware — where the device
            // grants it in the background.
            guard BGTaskScheduler.supportedResources.contains(.gpu) else { return false }
            request.requiredResources = .gpu
        }
        do {
            try BGTaskScheduler.shared.submit(request)
            shownTitle = summary.title
            shownSubtitle = subtitle
            return true
        } catch {
            log.error("continued processing refused (gpu: \(gpu)): \(error.localizedDescription, privacy: .public)")
            return false
        }
    }
    #endif

    /// The system launched the continued task — on the main queue, as registered.
    private func launched(_ task: BGTask) {
        continuedAsked = false
        #if compiler(>=6.2)
        guard #available(iOS 26, *), let work = task as? BGContinuedProcessingTask, active else {
            // The run ended before the system started it: nothing is left to do.
            task.setTaskCompleted(success: true)
            return
        }
        continued = work
        work.expirationHandler = {
            DispatchQueue.main.async {
                MainActor.assumeIsolated { BackgroundRun.shared.expire() }
            }
        }
        // This task holds the time from now on.
        endLegacy()
        refresh()
        #else
        task.setTaskCompleted(success: false)
        #endif
    }

    /// The system's progress object and words, level with the kept tasks.
    private func mirrorContinued(_ summary: KeptRunSummary) {
        #if compiler(>=6.2)
        guard #available(iOS 26, *), let work = continued as? BGContinuedProcessingTask else { return }
        work.progress.totalUnitCount = summary.unitsTotal
        work.progress.completedUnitCount = summary.unitsDone
        let subtitle = summary.detail ?? "Working"
        if summary.title != shownTitle || subtitle != shownSubtitle {
            shownTitle = summary.title
            shownSubtitle = subtitle
            work.updateTitle(summary.title, subtitle: subtitle)
        }
        #endif
    }

    /// The run is over: the system's task says the last words and completes —
    /// a success unless the time was taken away.
    private func completeContinued(_ words: (title: String, detail: String), whole: Bool) {
        #if compiler(>=6.2)
        if #available(iOS 26, *), let work = continued as? BGContinuedProcessingTask {
            if whole { work.progress.completedUnitCount = work.progress.totalUnitCount }
            work.updateTitle(words.title, subtitle: words.detail)
            work.setTaskCompleted(success: whole)
        }
        #endif
        continued = nil
    }

    // MARK: - the Live Activity

    /// Our own Live Activity beside iOS 26's continued task too. Off: the
    /// system draws its own progress UI for a continued task, and two faces
    /// of one export on the Lock Screen are one too many. [verify on device]
    static let activityBesideSystemUI = false
    /// How long a run that ended while he was away stays on the Lock Screen.
    private static let lingerSeconds: TimeInterval = 5 * 60
    /// An activity the app stopped feeding goes stale after this long…
    private static let staleAfter: TimeInterval = 60
    /// …so a running one is fed at least this often, even with nothing new.
    private static let heartbeatSeconds: TimeInterval = 20

    private var activity: Activity<ExportActivityAttributes>?
    /// The state owed to the activity, and the one it last received.
    private var owed: ExportActivityAttributes.ContentState?
    private var sent: ExportActivityAttributes.ContentState?
    private var sentAt = Date.distantPast
    private var pendingSend: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?

    private var activitiesEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    private func activityState(_ summary: KeptRunSummary) -> ExportActivityAttributes.ContentState {
        let several = summary.total > 1
        return ExportActivityAttributes.ContentState(
            title: summary.title, detail: summary.detail, progress: summary.progress, phase: .running,
            done: several ? summary.done : nil, total: several ? summary.total : nil)
    }

    /// Start the run's activity — in the foreground only, and not where the
    /// system already shows the continued task.
    private func startActivity(_ summary: KeptRunSummary) {
        guard activity == nil, activitiesEnabled else { return }
        if continuedAsked, !Self.activityBesideSystemUI { return }
        let state = activityState(summary)
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(Self.staleAfter))
        do {
            activity = try Activity.request(attributes: ExportActivityAttributes(startedAt: Date()),
                                            content: content, pushType: nil)
            owed = state
            sent = state
            sentAt = Date()
            beat()
        } catch {
            log.error("the Live Activity was refused: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Feed the activity what the run says now — at most once a second.
    private func pushActivity(_ state: ExportActivityAttributes.ContentState) {
        guard activity != nil else { return }
        owed = state
        guard state != sent, pendingSend == nil else { return }
        let wait = 1 - Date().timeIntervalSince(sentAt)
        if wait <= 0 {
            sendActivity()
            return
        }
        pendingSend = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            guard !Task.isCancelled else { return }
            let run = BackgroundRun.shared
            run.pendingSend = nil
            run.sendActivity()
        }
    }

    private func sendActivity() {
        guard let activity, let state = owed, activitiesEnabled else { return }
        sent = state
        sentAt = Date()
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(Self.staleAfter))
        Task { await activity.update(content) }
    }

    /// Keep a running activity fresh while nothing moves (a long step with no
    /// length), so that only a SUSPENDED app lets it go stale.
    private func beat() {
        heartbeat?.cancel()
        heartbeat = Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(BackgroundRun.heartbeatSeconds * 1_000_000_000))
                let run = BackgroundRun.shared
                guard !Task.isCancelled, run.activity != nil else { return }
                if Date().timeIntervalSince(run.sentAt) >= BackgroundRun.heartbeatSeconds { run.sendActivity() }
            }
        }
    }

    /// The run's last words: left on the Lock Screen a few minutes when it
    /// ended while he was away, gone at once when he is looking at the app —
    /// then `after`, whatever happened.
    private func endActivity(_ words: (title: String, detail: String), end: KeptRunEnd,
                             then after: @escaping () -> Void) {
        pendingSend?.cancel()
        pendingSend = nil
        heartbeat?.cancel()
        heartbeat = nil
        let last = owed
        owed = nil
        sent = nil
        guard let activity else {
            after()
            return
        }
        self.activity = nil
        guard activitiesEnabled else {
            after()
            return
        }
        let finished = end == .finished
        // "1 of 3 done" says something only of a run the system cut short.
        let counted = end == .stopped && labels.count > 1
        let state = ExportActivityAttributes.ContentState(
            title: words.title, detail: words.detail,
            progress: finished ? 1 : last?.progress,
            phase: finished ? .finished : .stopped,
            done: counted ? ended : nil, total: counted ? labels.count : nil)
        let away = UIApplication.shared.applicationState != .active
        let policy: ActivityUIDismissalPolicy = away
            ? .after(Date().addingTimeInterval(Self.lingerSeconds))
            : .immediate
        Task { @MainActor in
            await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: policy)
            after()
        }
    }

    /// An activity of a run this process never saw end — the app was killed
    /// under it — says nothing true any more: gone at once.
    private func endLeftovers() {
        guard activitiesEnabled else { return }
        for leftover in Activity<ExportActivityAttributes>.activities where leftover.id != activity?.id {
            Task { await leftover.end(nil, dismissalPolicy: .immediate) }
        }
    }
    #endif
}
