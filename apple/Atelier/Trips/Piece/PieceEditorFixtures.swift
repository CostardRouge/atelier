// A piece for the piece editor's previews — a carousel on a trip's second
// day: the hook, two content slides with captions, the closing card. No
// picture is in it (a preview has no Library), so the stage draws the badge
// over the frame's ground and the Picture tab says the slide holds none.
// Nothing here is read by the app itself.

import Foundation
import AtelierKit

enum PieceEditorFixtures {
    static let tripId = "fixture-piece-trip"
    static let postId = "fixture-piece"
    /// A fixed instant, so a preview reads the same every time.
    static let now: Double = 1_750_000_000_000

    static func trip() -> TripDoc {
        var doc = createTripDoc("Australia", "2025-03-01", "2025-05-20", now: now, id: tripId)
        var post = createTripPost(.carousel, "2025-03-02", "Perth at dawn", now: now, makeId: { postId })
        post.id = postId
        var first = createPostSlide(id: "slide-1")
        first.caption = "Kings Park before the heat"
        var second = createPostSlide(id: "slide-2")
        second.caption = "The Swan from Elizabeth Quay"
        post.slides = [first, second]
        post.includeCta = true
        doc.posts = [post]
        return doc
    }

    /// A store over a scratch folder holding `trip()`, open.
    @MainActor
    static func store() -> TripsStore {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("atelier-piece-preview-\(UUID().uuidString)", isDirectory: true)
        let sync = DocumentSync<TripDoc>(store: DocumentStore<TripDoc>(root: root), remoteFor: { _ in nil })
        let store = TripsStore(root: root, sync: sync)
        let doc = trip()
        store.documents.put(doc)
        store.adoptCreated(doc)
        return store
    }

    /// The editor's model over `store()`, with no Library.
    @MainActor
    static func model() -> PieceEditorModel {
        PieceEditorModel(store: store(), tripId: tripId, postId: postId)
    }
}
