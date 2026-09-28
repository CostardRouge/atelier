// The Live Activity an export shows on the Lock Screen and in the Dynamic
// Island while it runs — the design canvas's «the Live Activity's three
// states» (running, finished, stopped), the honest face of "background".
//
// Compiled into TWO targets: the iOS app, which starts, updates and ends it
// (`Atelier/Tasks/BackgroundRun.swift`), and the WidgetKit extension that
// draws it (`apple/Widgets/`). So it imports nothing of the app's and nothing
// of the kernel's: the words arrive already said, from the kernel's
// `keptRunSummary` / `keptRunClosing`.

#if os(iOS)
import ActivityKit
import Foundation

struct ExportActivityAttributes: ActivityAttributes {
    /// What moves while the run goes on.
    struct ContentState: Codable, Hashable {
        enum Phase: String, Codable, Hashable {
            case running
            /// Every kept export ended on its own.
            case finished
            /// Stopped before the end — his Cancel, or the time iOS took
            /// away. What was done is kept, and the detail says which.
            case stopped
        }

        /// The export's own label ("Exporting 3 pictures"), or "N running".
        var title: String
        /// Its detail, or the labels of every export running.
        var detail: String?
        /// 0…1, or nil where nobody measured a length: the surfaces then
        /// show a still quarter and the time elapsed, never an invented fill.
        var progress: Double?
        var phase: Phase
        /// Exports of this run that ended, and all it has seen — nil for a
        /// run of one.
        var done: Int?
        var total: Int?
    }

    /// When the run began: the elapsed time a sweep shows in place of a
    /// percentage, counted by the system.
    var startedAt: Date
}
#endif
