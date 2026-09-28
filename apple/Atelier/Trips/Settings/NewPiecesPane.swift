// ⚙ Trip → New pieces — the look a new piece of each KIND starts from, the
// web's "defaults" pane of `TripSettingsModal.tsx`.
//
// Rules kept (`roadtrip.md`, «A trip remembers the look it gives a new piece
// of each kind»):
// - What is kept is the frame, the opener, the placement, the shades, the
//   per-piece styling and what a piece counts (`hookDefaultsFrom`); what a
//   piece says about a particular DAY is never inherited.
// - "Apply it to this piece" is the web's `patchBadge({...defaultPostBadge(kind,
//   saved), referenceDate, videoTimeSeconds, textOverrides})`, spread OVER the
//   piece's badge: the day, the clip's frame and the author's own words stay
//   the piece's, and so does its camera plate when the default carries none
//   (the one key `defaultPostBadge` leaves out rather than resets). Everything
//   else is the default's — its framing, develop, grade and collage reset, as
//   on the web.
// - A default is filed under the kind of the piece in hand.
//
// Opened from a piece (`post` given) it is the web's pane exactly. Opened with
// no piece, it cannot save one, and SAYS so: each kind's state is listed with
// its Forget verb.

import SwiftUI
import AtelierKit

struct NewPiecesPane: View {
    let trip: TripDoc
    /// The piece the sheet was opened from — whose kind a default is filed under.
    let post: TripPost?
    let write: (TripDoc) -> Void
    /// A piece rewritten (the web's `patchBadge`, through `store.updatePost`).
    let writePost: (TripPost) -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        if let post {
            piece(post)
        } else {
            everyKind
        }
    }

    // MARK: - from a piece

    private func piece(_ post: TripPost) -> some View {
        let kind = NewPiecesPane.kindLabel(post.kind)
        let saved = trip.hookDefaults[post.kind]
        return VStack(alignment: .leading, spacing: 14) {
            TripSettingsLegend("New pieces · \(kind)", paragraphs: [
                "The frame, the opener, the placement, the shades, the per-piece styling and what a piece counts — kept for the next \(kind) of this trip. What a piece says about a particular day is never inherited.",
            ])
            PresetChipFlow(spacing: 8) {
                Button("Save this piece as the default") { save(post) }
                    .buttonStyle(DevelopPillButtonStyle())
                if let saved {
                    Button("Apply it to this piece") { apply(saved, to: post) }
                        .buttonStyle(DevelopPillButtonStyle())
                    Button("Forget it") { forget(post.kind) }
                        .buttonStyle(DevelopLinkButtonStyle())
                }
            }
            if saved == nil {
                Text("Nothing saved yet — new pieces start from the factory look.")
                    .font(Brand.sans(11))
                    .foregroundStyle(palette.faint)
            }
        }
        .sensoryFeedback(.success, trigger: saved != nil)
    }

    private func save(_ post: TripPost) {
        var next = trip
        next.hookDefaults[post.kind] = hookDefaultsFrom(post.badge)
        write(next)
    }

    private func apply(_ saved: HookDefaults, to post: TripPost) {
        let old = post.badge
        var badge = defaultPostBadge(post.kind, saved)
        // The day, the frame of the clip and the author's own words belong to
        // this piece, not to the default.
        badge.referenceDate = old.referenceDate
        badge.videoTimeSeconds = old.videoTimeSeconds
        badge.textOverrides = old.textOverrides
        // A spread over the piece's badge keeps what the default does not set.
        if saved.camera == nil { badge.camera = old.camera }
        badge.carried = old.carried
        var next = post
        next.badge = badge
        writePost(next)
    }

    private func forget(_ kind: PostKind) {
        var next = trip
        next.hookDefaults.removeValue(forKey: kind)
        write(next)
    }

    // MARK: - with no piece

    private var everyKind: some View {
        VStack(alignment: .leading, spacing: 14) {
            TripSettingsLegend("New pieces", paragraphs: [
                "The frame, the opener, the placement, the shades, the per-piece styling and what a piece counts — kept for the next piece of each kind. What a piece says about a particular day is never inherited.",
            ])
            Text("A look is saved from a piece: open ⚙ Trip from the piece whose look the next ones should start from.")
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(postKinds, id: \.id) { option in
                    kindRow(option)
                    Hairline()
                }
            }
            .frame(maxWidth: 520, alignment: .leading)
        }
    }

    private func kindRow(_ option: PostKindOption) -> some View {
        let saved = trip.hookDefaults[option.id] != nil
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: option.label)
                    .font(Brand.sans(14, weight: .semibold))
                    .foregroundStyle(palette.ink)
                Text(saved ? "Its own saved look." : "The factory look.")
                    .font(Brand.sans(12))
                    .foregroundStyle(saved ? palette.inkSoft : palette.faint)
            }
            Spacer(minLength: 8)
            if saved {
                Button("Forget it") { forget(option.id) }
                    .buttonStyle(DevelopLinkButtonStyle())
                    .accessibilityLabel("Forget the \(option.label.lowercased()) default")
            }
        }
        .padding(.vertical, 10)
    }

    /// The kind as a sentence says it — the web's `label.toLowerCase()`.
    static func kindLabel(_ kind: PostKind) -> String {
        postKinds.first { $0.id == kind }?.label.lowercased() ?? kind.rawValue
    }
}

// MARK: - previews

private struct NewPiecesPreview: View {
    let store: TripsStore
    let fromPiece: Bool

    var body: some View {
        ScrollView {
            if let trip = store.trip(TripSettingsFixtures.tripId) {
                let post = fromPiece ? trip.posts.first : nil
                NewPiecesPane(trip: trip, post: post,
                              write: { store.change($0, label: "trip:defaults") },
                              writePost: { store.updatePost($0) })
                    .padding(24)
            }
        }
        .frame(minWidth: 360, minHeight: 420)
        .background(Palette.paper.surface)
    }
}

#Preview("From a piece") { NewPiecesPreview(store: TripSettingsFixtures.store(), fromPiece: true) }

#Preview("With no piece") {
    NewPiecesPreview(store: TripSettingsFixtures.store { trip in
        trip.hookDefaults[.reel] = hookDefaultsFrom(defaultPostBadge(.reel))
    }, fromPiece: false)
}
