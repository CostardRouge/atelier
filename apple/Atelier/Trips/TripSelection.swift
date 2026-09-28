// What the overview has selected — shared by the calendar and the stages, so a
// tap in one moves the other. Once the contract file that carried it while the
// screens were built in parallel (`PendingTripPanels.swift`); every stand-in
// there has been replaced by its real view.

import Foundation

/// The day, the leg and the span on screen, read and written by the calendar
/// and by the stages alike. Days are the trip's own `YYYY-MM-DD`.
struct TripSelection: Equatable {
    /// The open day.
    var day: String?
    /// The open leg (a `TripStage` id).
    var stageId: String?
    /// The first and the last day on screen, where the view knows it.
    var spanFrom: String?
    var spanTo: String?
}
