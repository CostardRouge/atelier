// Fixture data for the Stages previews — a trip told over six weeks of
// Western Australia, with overlapping legs, a gap, places with and without
// coordinates, and a few pieces drafted and published — and the host every
// preview hangs off: a store over a temporary folder holding the trip open,
// a selection, and a stub instance that answers nothing.

import SwiftUI
import AtelierKit

enum StagesFixtures {
    static let trip: TripDoc = {
        var doc = createTripDoc("Australie", "2025-11-01", "2025-12-12", now: 1_762_000_000_000,
                                id: "stages-preview-trip")
        let perth = createTripPlace("Perth", "", coords: GeoPoint(lat: -31.9522, lon: 115.8614), id: "p-perth")
        let kalbarri = createTripPlace("Kalbarri", "", coords: GeoPoint(lat: -27.7105, lon: 114.165), id: "p-kalbarri")
        let monkey = createTripPlace("Monkey Mia", "", id: "p-monkey")
        let exmouth = createTripPlace("Exmouth", "", coords: GeoPoint(lat: -21.9303, lon: 114.1225), id: "p-exmouth")
        var coast = createTripStage("", "Western Australia", "2025-11-01", "2025-11-06",
                                    places: [perth, kalbarri], id: "s-coast")
        coast.region = "Western Australia"
        let shark = createTripStage("Shark Bay", "", "2025-11-06", "2025-11-11", places: [monkey], id: "s-shark")
        let ningaloo = createTripStage("", "", "2025-11-15", "2025-11-24", places: [exmouth], id: "s-ningaloo")
        doc.stages = [coast, shark, ningaloo]
        var reel = createTripPost(.reel, "2025-11-02", "Pinnacles at dawn", now: 1_762_000_000_000,
                                  makeId: { "post-reel" })
        reel.publishedAt = 1_762_100_000_000
        let photo = createTripPost(.photo, "2025-11-08", "", now: 1_762_000_000_000, makeId: { "post-photo" })
        var twice = createTripPost(.carousel, "2025-11-16", "Reef", now: 1_762_000_000_000, makeId: { "post-a" })
        twice.publishedAt = 1_762_200_000_000
        var again = createTripPost(.photo, "2025-11-16", "Reef, again", now: 1_762_000_000_000, makeId: { "post-b" })
        again.publishedAt = 1_762_300_000_000
        doc.posts = [reel, photo, twice, again]
        return doc
    }()

    /// A store over a temporary folder, the fixture trip open in it.
    @MainActor
    static func store(_ trip: TripDoc = trip, connections: ConnectionStore) -> TripsStore {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("atelier-stages-preview-\(UUID().uuidString)", isDirectory: true)
        let store = TripsStore(root: root, connections: connections)
        _ = store.documents.put(trip)
        store.adoptCreated(trip)
        return store
    }
}

/// Holds a store, a selection and a stub instance for a preview.
struct StagesPreviewHost<Content: View>: View {
    @ViewBuilder let content: (TripsStore, Binding<TripSelection>) -> Content

    @State private var connections: ConnectionStore?
    @State private var store: TripsStore?
    @State private var selection = TripSelection(day: "2025-11-08", stageId: "s-shark",
                                                 spanFrom: nil, spanTo: nil)

    var body: some View {
        Group {
            if let store {
                content(store, $selection)
            } else {
                Color.clear
            }
        }
        .environment(connections)
        .background(Palette.paper.paper)
        .onAppear {
            guard store == nil else { return }
            let stub = ConnectionStore.preview(connections: [
                (host: "winnow.example", sheet: ConnectionStore.previewSheet),
            ])
            connections = stub
            store = StagesFixtures.store(connections: stub)
        }
    }
}
