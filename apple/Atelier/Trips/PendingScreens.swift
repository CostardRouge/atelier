// PENDING SCREENS — the stand-ins the Trips shell pushes until the tasks that
// own them land, the way Develop's inspector was built (one block per task;
// that task DELETES ITS BLOCK and defines the real view under the SAME name
// and initialiser, the last one deletes the file). The initialisers are the
// CONTRACT the shell's `navigationDestination(for: TripsRoute.self)` calls.
// Everything here SAYS what is coming — never a blank.

import SwiftUI

// MARK: - OVERVIEW — owned by the overview task (`Trips/Overview/*`): the
// heading, the month calendar, the day strip and panel, the stages. Delete
// when it lands.

struct TripOverviewView: View {
    let store: TripsStore
    let tripId: String
    /// The open day, written back to the route so Back lands on it.
    @Binding var day: String?
    /// Opens a piece of this trip.
    var openPiece: (_ postId: String, _ day: String?) -> Void

    var body: some View {
        PendingTripsScreen(title: store.trip(tripId)?.name ?? "Trip",
                           text: "The trip's calendar, its days, its stages and its pieces are coming with their own task.")
    }
}

// MARK: - PIECE — owned by the piece editor task (`Trips/Piece/*`): the badge
// stage, the deck, the four tabs, the export. Delete when it lands.

struct PieceEditorView: View {
    let store: TripsStore
    let tripId: String
    let postId: String

    var body: some View {
        PendingTripsScreen(title: "Piece",
                           text: "The piece editor — the stage, the deck and its four tabs — is coming with its own task.")
    }
}

// MARK: - the stand-ins' shared face

struct PendingTripsScreen: View {
    let title: String
    let text: String
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(Brand.sans(20, weight: .semibold)).foregroundStyle(palette.ink)
            Text(text).font(Brand.sans(14)).foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(palette.paper)
    }
}
