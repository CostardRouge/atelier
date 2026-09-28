// PENDING TRIP PANELS — the stand-ins the overview and the piece editor host
// until the tasks that own them land (the PendingScreens pattern: one block per
// task, the owner DELETES ITS BLOCK and defines the real view under the SAME
// name and initialiser; the last one deletes the file). `TripSelection` is
// shared by the overview and the stages, and stays.

import SwiftUI

/// What the overview has selected — the day, the leg, the span on screen —
/// read and written by the calendar and by the stages alike, so a tap in one
/// moves the other. Days are the trip's own `YYYY-MM-DD`.
struct TripSelection: Equatable {
    /// The open day.
    var day: String?
    /// The open leg (a `TripStage` id).
    var stageId: String?
    /// The first and the last day on screen, where the view knows it.
    var spanFrom: String?
    var spanTo: String?
}

// MARK: - STAGES — owned by the stages task (`Trips/Stages/*`): the ruler, the
// stage card, the places editor, the legs sheet, and the itinerary from a
// Winnow (timeline, deduce, locate one picture). Delete when it lands.

/// The legs of a trip on a wide screen: the ruler over the span on screen and
/// the open leg's card. Every write goes through `store.change`.
struct StagesPanelView: View {
    let store: TripsStore
    let tripId: String
    @Binding var selection: TripSelection

    var body: some View {
        PendingTripsScreen(title: "Stages",
                           text: "The legs of this trip — the ruler, each leg's places, and its itinerary from a Winnow — are coming with their own task.")
    }
}

/// The legs of a trip on a phone: a sheet, a leg's dates dragged on the calendar.
struct LegsSheetView: View {
    let store: TripsStore
    let tripId: String
    @Binding var selection: TripSelection

    var body: some View {
        PendingTripsScreen(title: "Stages",
                           text: "The legs sheet is coming with its own task.")
    }
}
