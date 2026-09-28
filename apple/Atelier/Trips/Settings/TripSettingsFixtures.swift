// The trip the ⚙ Trip previews edit: a store over a temporary folder, the
// trip open in it (so `store.change` writes, as it does under the piece
// editor), one carousel piece closing on the trip's card, and a body renamed.

import Foundation
import AtelierKit

@MainActor
enum TripSettingsFixtures {
    static let tripId = "trip-preview"
    static let postId = "post-preview"

    static func trip() -> TripDoc {
        var badge = defaultPostBadge(.carousel)
        badge.referenceDate = "2025-03-14"
        let post = TripPost(id: postId, kind: .carousel, date: "2025-03-14", title: "Kalbarri", badge: badge,
                            includeCta: true, createdAt: 0)
        var doc = TripDoc(id: tripId, name: "Australie", startDate: "2025-03-01", endDate: "2025-04-30",
                          posts: [post], createdAt: 0, updatedAt: 0)
        doc.cameraNames = ["FC8482": "Mini 4 Pro", "ILCE-7CM2": ""]
        return doc
    }

    /// A store with the fixture trip OPEN — writes land, as under the editor.
    static func store(_ change: (inout TripDoc) -> Void = { _ in }) -> TripsStore {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("atelier-trip-settings-\(UUID().uuidString)", isDirectory: true)
        let store = TripsStore(root: root, connections: ConnectionStore.preview())
        var doc = trip()
        change(&doc)
        store.adoptCreated(doc)
        return store
    }
}
