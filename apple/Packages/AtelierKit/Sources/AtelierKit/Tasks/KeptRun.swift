// What a RUN kept alive past the foreground says about itself — the words
// and the numbers the app hands to iOS 26's continued processing task (the
// system's own progress UI) and to the Live Activity, both drawn by
// `apple/Atelier/Tasks/BackgroundRun.swift`. Native only: a browser tab has
// no background, so this has no web twin; it lives here, pure, so its words
// and its arithmetic are specs rather than a view's guesses.
//
// A run is every task the app KEPT (an export) from the first one starting
// to the last one ending. Rules kept (`tasks.md`):
// - A length nobody measured is nil: the summary's `progress` is the
//   registry's own `overallProgress` over the kept tasks still running, so
//   one sweeping task makes the whole run sweep.
// - The system's progress object cannot sweep, so its UNITS count what is
//   known and nothing more: a kept task that ended is whole, a running one
//   counts what it measured, and one with no length counts nothing yet —
//   the bar holds still rather than inventing motion.
// - The registry says a task ENDED, never how: a failure cannot be told from
//   a success, so the closing words say "Finished", and name only the two
//   endings the app itself knows about — a Cancel he pressed, and the time
//   the system took away.

import Foundation

/// How many units one kept task weighs in the system's progress object.
public let keptRunUnits: Int64 = 1000

/// A kept run, in the words and numbers its surfaces say.
public struct KeptRunSummary: Equatable {
    /// The one task's label, or "N running" — the pill's own word.
    public var title: String
    /// The one task's detail, or every running label, oldest first.
    public var detail: String?
    /// 0…1 over the running kept tasks, nil the moment one of them has no length.
    public var progress: Double?
    /// Kept tasks that ended in this run.
    public var done: Int
    /// Kept tasks this run has seen: ended and running.
    public var total: Int
    /// The system progress object's completed units.
    public var unitsDone: Int64
    /// Its total units: `keptRunUnits` per kept task seen.
    public var unitsTotal: Int64

    public init(title: String, detail: String?, progress: Double?, done: Int, total: Int,
                unitsDone: Int64, unitsTotal: Int64) {
        self.title = title
        self.detail = detail
        self.progress = progress
        self.done = done
        self.total = total
        self.unitsDone = unitsDone
        self.unitsTotal = unitsTotal
    }
}

/// The summary of a run whose kept tasks still running are `running`
/// (oldest first) and of which `ended` have already ended.
public func keptRunSummary(_ running: [TaskRegistry.Task], ended: Int) -> KeptRunSummary {
    let over = max(0, ended)
    let title: String
    let detail: String?
    switch running.count {
    case 0:
        title = tasksSentence(running)
        detail = nil
    case 1:
        title = running[0].label
        let said = running[0].detail ?? ""
        detail = said.isEmpty ? nil : said
    default:
        title = pillWord(running)
        detail = running.map(\.label).joined(separator: " · ")
    }
    var measured = 0.0
    for t in running { measured += t.progress ?? 0 }
    let whole = Double(keptRunUnits)
    let unitsDone = Int64(over) * keptRunUnits + Int64((measured * whole).rounded(.down))
    let unitsTotal = Int64(over + running.count) * keptRunUnits
    return KeptRunSummary(title: title, detail: detail, progress: overallProgress(running),
                          done: over, total: over + running.count,
                          unitsDone: unitsDone, unitsTotal: unitsTotal)
}

/// How a kept run ended, as far as the app can know.
public enum KeptRunEnd: Equatable {
    /// Every kept task ended on its own.
    case finished
    /// He pressed a kept task's Cancel on the way.
    case cancelled
    /// The system took the time away (or he stopped the system's own UI):
    /// every kept task was asked to stop at its safe point.
    case stopped
}

/// The last words of a run whose kept tasks were `labels`, oldest first.
public func keptRunClosing(_ labels: [String], end: KeptRunEnd) -> (title: String, detail: String) {
    let title: String
    switch labels.count {
    case 0: title = "Nothing running"
    case 1: title = labels[0]
    default: title = "\(labels.count) exports"
    }
    switch end {
    case .finished:
        return (title, labels.count > 1 ? "All finished" : "Finished")
    case .cancelled:
        return (title, "Cancelled — what was done is kept")
    case .stopped:
        return (title, "Stopped in the background — what was done is kept")
    }
}
