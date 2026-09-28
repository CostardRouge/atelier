// A piece for the openers' previews — a reel on day 12 of a trip up the west
// coast of Australia, three legs with located places, six earlier days told by
// other pieces, and the hook set to the variant asked for (the Itinerary with
// three stops, one holding a picture). No picture is in the Library of a
// preview, so every picture line says so. Nothing here is read by the app.

import Foundation
import AtelierKit

enum OpenerFixtures {
    static let tripId = "fixture-opener-trip"
    static let postId = "fixture-opener-piece"
    /// A fixed instant, so a preview reads the same every time.
    static let now: Double = 1_750_000_000_000

    private static func place(_ name: String, _ lat: Double, _ lon: Double) -> TripPlace {
        createTripPlace(name, coords: GeoPoint(lat: lat, lon: lon), id: "place-\(name)")
    }

    private static func picture(_ name: String) -> SavedMediaRef {
        SavedMediaRef(name: name, size: 4_200_000, lastModified: now, hash: "hash-\(name)")
    }

    static func trip(_ variantId: String) -> TripDoc {
        var doc = createTripDoc("West coast", "2025-03-01", "2025-03-14", now: now, id: tripId)
        doc.stages = [
            createTripStage("", "Western Australia", "2025-03-01", "2025-03-04",
                            places: [place("Perth", -31.95, 115.86), place("Kalbarri", -27.71, 114.16)], id: "leg-1"),
            createTripStage("Coral coast", "", "2025-03-05", "2025-03-08",
                            places: [place("Coral Bay", -23.14, 113.77), place("Exmouth", -21.93, 114.13)], id: "leg-2"),
            createTripStage("Pilbara", "", "2025-03-09", "2025-03-14",
                            places: [place("Karijini", -22.6, 118.3)], id: "leg-3"),
        ]
        var n = 0
        for date in ["2025-03-02", "2025-03-04", "2025-03-05", "2025-03-07", "2025-03-09", "2025-03-10"] {
            n += 1
            var post = createTripPost(.photo, date, "Day \(n)", now: now, makeId: { "told-\(n)" })
            post.media = picture("DJI_01\(n).JPG")
            doc.posts.append(post)
        }
        var piece = createTripPost(.reel, "2025-03-12", "Karijini gorges", now: now, makeId: { postId })
        piece.id = postId
        piece.media = picture("DJI_0200.JPG")
        if let variant = hookVariantById(variantId) {
            var layers = setHookVariant(piece.badge.hook, variant)
            if variantId == mapVariant.id {
                var o = mapOptions(layers.first?.options ?? [:])
                o.stops = [
                    MapStop(id: "stop-1", name: "Perth", lat: -31.95, lon: 115.86),
                    MapStop(id: "stop-2", name: "Kalbarri", lat: -27.71, lon: 114.16,
                            picture: HookPickedPicture(ref: picture("DJI_0102.JPG"), date: "2025-03-04")),
                    MapStop(id: "stop-3", name: "Exmouth", lat: -21.93, lon: 114.13),
                ]
                layers = setHookOptions(layers, o.json.objectValue ?? [:])
            }
            piece.badge.hook = layers
        }
        doc.posts.append(piece)
        return doc
    }

    /// The editor's model over a scratch store holding `trip(variantId)`.
    @MainActor
    static func model(_ variantId: String) -> PieceEditorModel {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("atelier-opener-preview-\(UUID().uuidString)", isDirectory: true)
        let sync = DocumentSync<TripDoc>(store: DocumentStore<TripDoc>(root: root), remoteFor: { _ in nil })
        let store = TripsStore(root: root, sync: sync)
        let doc = trip(variantId)
        store.documents.put(doc)
        store.adoptCreated(doc)
        return PieceEditorModel(store: store, tripId: tripId, postId: postId)
    }
}
