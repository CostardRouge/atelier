// A trip's verbs, wherever the trip is drawn — a card, a row, the resume
// band: the web's `TripActions`, the ⋯ menu and the two questions it asks.
// One view, so the Bands view cannot offer a different set from the Cards
// view.
//
// The ⋯ is the ONLY home of the cover chooser on a card (a chip on the cover
// kept catching the press meant for the trip, and it is what keeps a `None`
// cover from being a one-way door). The two verbs that lose something are
// confirmed with what goes and what stays: a delete takes the days, stages
// and pieces for good; a move keeps the trip elsewhere and never carries its
// pictures.

import SwiftUI
import AtelierKit

/// What a trip's surfaces can ask of the gallery.
struct TripCardActions {
    var open: () -> Void
    var export: () -> Void
    var delete: () -> Void
    var move: (String) -> Void
    var chooseCover: () -> Void
}

struct TripActionsMenu: View {
    let trip: TripDoc
    let isOpen: Bool
    /// Kept on an instance and not mirrored here: no move from this device.
    let remoteOnly: Bool
    /// The other sources this trip could be kept on.
    let moveTargets: [SourceInfo]
    let actions: TripCardActions
    /// The resume band's larger trigger.
    var large = false

    @Environment(\.palette) private var palette
    @State private var confirmingDelete = false
    @State private var movingTo: SourceInfo?

    var body: some View {
        Menu {
            Button(isOpen ? "Resume" : remoteOnly ? "Open here" : "Open", action: actions.open)
            Button("Choose a cover…", action: actions.chooseCover)
            Button("Export the trip file", action: actions.export)
                .help("Save the whole trip as a \(tripFileExtension) file")
            if !remoteOnly {
                ForEach(moveTargets, id: \.id) { target in
                    Button("Keep on \(TripActionsMenu.label(target.id))…") { movingTo = target }
                }
            }
            Divider()
            Button("Delete this trip…", role: .destructive) { confirmingDelete = true }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: large ? 16 : 14, weight: .medium))
                .frame(width: large ? 36 : 28, height: large ? 36 : 28)
                .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .foregroundStyle(palette.muted)
        .accessibilityLabel("More actions for \(trip.name)")
        .confirmationDialog("Delete “\(trip.name)”?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive, action: actions.delete)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Its days, stages and pieces go with it, for good. An exported \(tripFileExtension) is the only copy that would survive.")
        }
        .confirmationDialog(movingTo.map { "Keep “\(trip.name)” on \(TripActionsMenu.label($0.id))?" } ?? "",
                            isPresented: Binding(get: { movingTo != nil }, set: { if !$0 { movingTo = nil } }),
                            titleVisibility: .visible) {
            Button("Move") {
                if let target = movingTo { actions.move(target.id) }
                movingTo = nil
            }
            Button("Cancel", role: .cancel) { movingTo = nil }
        } message: {
            Text("The trip will be kept there from now on and resume from any device connected to it. Its pictures never travel with it.")
        }
    }

    /// A source as a sentence names it: "this device", or the instance's host.
    @MainActor
    static func label(_ sourceId: String) -> String {
        ConnectionStore.shared.label(sourceId)
    }
}

#Preview("Trip actions") {
    TripActionsMenu(trip: createTripDoc("Australie", "2025-03-01", "2025-05-30"), isOpen: true, remoteOnly: false,
                    moveTargets: [],
                    actions: TripCardActions(open: {}, export: {}, delete: {}, move: { _ in }, chooseCover: {}))
        .padding()
}
