// The gallery's way into the cover panel — the web's `TripCoverModal.tsx`: a
// cover is looked at in the gallery, so it is chosen from the card there too
// ("Choose a cover…" in its ⋯). The panel's other home is the trip's dates
// sheet. Done hands back the cover with every pin that names no piece
// forgotten (`prunePins`); Return saves and Escape cancels, as the web's
// dialog keys do.

import SwiftUI
import AtelierKit

struct TripCoverSheet: View {
    let trip: TripDoc
    let thumbs: TripThumbs
    let version: Int
    let onCancel: () -> Void
    let onSave: (TripCover) -> Void

    @Environment(\.palette) private var palette
    @State private var cover: TripCover

    init(trip: TripDoc, thumbs: TripThumbs, version: Int, onCancel: @escaping () -> Void,
         onSave: @escaping (TripCover) -> Void) {
        self.trip = trip
        self.thumbs = thumbs
        self.version = version
        self.onCancel = onCancel
        self.onSave = onSave
        _cover = State(initialValue: trip.cover)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("How \(trip.name.isEmpty ? "this trip" : trip.name) shows itself in the gallery.")
                        .font(Brand.sans(14))
                        .foregroundStyle(palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    TripCoverPanel(trip: trip, cover: $cover, thumbs: thumbs, version: version)
                }
                .padding(24)
            }
            .background(palette.surface)
            .navigationTitle("Cover")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .keyboardShortcut(.cancelAction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { onSave(prunePins(trip, cover)) }
                        .keyboardShortcut(.defaultAction)
                }
            }
        }
        .accessibilityLabel("Cover for \(trip.name)")
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 520)
        #endif
    }
}

#Preview("Choose a cover") {
    TripCoverSheet(trip: createTripDoc("Australie", "2025-03-01", "2025-05-30"),
                   thumbs: TripThumbs(root: FileManager.default.temporaryDirectory.appendingPathComponent("atelier-preview")),
                   version: 0, onCancel: {}, onSave: { _ in })
}
