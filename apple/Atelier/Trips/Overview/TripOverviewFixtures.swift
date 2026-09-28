// A trip for the overview's previews — 81 days across three months, three
// legs (one named, one named by its places, one a gap away), and a handful of
// pieces, some published, one day told twice. Nothing here is read by the
// app itself.

import Foundation
import AtelierKit

enum TripOverviewFixtures {
    static let tripId = "fixture-trip"
    /// A fixed instant, so a preview reads the same every time.
    static let now: Double = 1_750_000_000_000

    static func trip() -> TripDoc {
        var doc = createTripDoc("Australia", "2025-03-01", "2025-05-20", now: now, id: tripId)
        doc.stages = [
            createTripStage("", "Western Australia", "2025-03-01", "2025-03-05",
                            places: [createTripPlace("Perth", id: "p1"), createTripPlace("Kalbarri", id: "p2")],
                            id: "s1"),
            createTripStage("Shark Bay", "", "2025-03-05", "2025-03-18", id: "s2"),
            createTripStage("Pilbara", "", "2025-04-02", "2025-04-29", id: "s3"),
        ]
        var n = 0
        func post(_ kind: PostKind, _ date: IsoDate, _ title: String, published: Bool) -> TripPost {
            n += 1
            var p = createTripPost(kind, date, title, now: now, makeId: { "post-\(n)-\(UUID().uuidString.prefix(4))" })
            p.id = "post-\(n)"
            if published { p.publishedAt = now }
            return p
        }
        doc.posts = [
            post(.reel, "2025-03-02", "Perth at dawn", published: true),
            post(.photo, "2025-03-02", "", published: true),
            post(.carousel, "2025-03-04", "Kalbarri gorges", published: false),
            post(.photo, "2025-03-12", "Monkey Mia", published: true),
            post(.reel, "2025-04-10", "Karijini", published: false),
            post(.carousel, "2025-05-18", "The way home", published: true),
        ]
        return doc
    }

    /// A store over a scratch folder holding `trip()`, open.
    @MainActor
    static func store() -> TripsStore {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("atelier-overview-preview-\(UUID().uuidString)", isDirectory: true)
        let sync = DocumentSync<TripDoc>(store: DocumentStore<TripDoc>(root: root), remoteFor: { _ in nil })
        let store = TripsStore(root: root, sync: sync)
        let doc = trip()
        store.documents.put(doc)
        store.adoptCreated(doc)
        return store
    }
}
