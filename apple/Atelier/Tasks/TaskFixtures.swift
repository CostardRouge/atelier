// Fixture tasks for the Tasks views' previews — three things running, old
// enough to be drawn: a run with a measured length and a Cancel, a fetch on a
// media's edge with its bytes, a RAW's sensor decode that nobody can measure.
// Nothing here is read by the app itself.

import Foundation
import AtelierKit

enum TaskFixtures {
    /// The media whose fetch is measured.
    static let measuredScope = "winnow.example/asset-202"
    /// The media whose decode sweeps.
    static let sweepingScope = "picture-dsc00123"

    /// Put the three tasks in the app's registry, a second old, and read them.
    @MainActor
    static func seed() {
        let registry = TaskRegistry.shared
        registry.clearTasks()
        let past = TaskCenter.nowMs() - 1000
        _ = registry.startTask(label: "Exporting 3 pictures", progress: 0.34, detail: "2/3 · DJI_0202.JPG",
                               cancel: {}, now: past)
        _ = registry.startTask(label: "Fetching DJI_0202.JPG", scope: measuredScope, progress: 0.25,
                               detail: "13 MB of 52 MB", cancel: {}, now: past)
        _ = registry.startTask(label: "Opening DSC00123.ARW", scope: sweepingScope, detail: "the sensor’s data",
                               now: past)
        TaskCenter.shared.refresh()
    }
}
