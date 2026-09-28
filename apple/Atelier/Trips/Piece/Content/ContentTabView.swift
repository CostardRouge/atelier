// The piece editor's CONTENT tab — the web's `panels/ContentTab.tsx`: what
// the piece SAYS. The badge's words on the hook, the caption on a content
// picture, how each slide goes out, the day every number is counted from, and
// — on the hook — the counter, the line about when and the camera credit.
//
// Laid out in the inspector's grammar: folding sections (`DevelopSection`,
// remembered on this device as the web's `InspectorSection` is) of
// label-and-control rows, every standing paragraph behind the section's ⓘ.
//
// Rules kept (`roadtrip.md`):
// - Every counter and temporal mode shows the line it would really draw for
//   THIS post, or why it cannot — a fabricated example reads as a broken
//   feature: each menu option carries that line, the chosen one is repeated
//   under it.
// - The day belongs to the PIECE, not to a slide: its section is never inside
//   the hook-only branch, so it does not vanish on a carousel's second picture.
// - Every write goes through the model (`patchBadge`, `patchSlide`,
//   `updatePost`, `changeTrip`) — one undo step per burst under the piece's
//   label.
// - While any of the tab's fields types, the editor's keys stand down
//   (`textEditing`): ONE focus for the tab, so moving from one field to the
//   next never reads as "nothing types" in between.
//
// Replaces the Content block of `PendingTabs.swift` under the same name and
// initialiser.

import SwiftUI
import AtelierKit

/// The tab's fields that type.
enum ContentTextField: Hashable {
    /// The hook piece's text, or a content picture's caption — what a click on
    /// the stage focuses.
    case text
    /// The body's name on the trip, in the camera credit.
    case body
}

struct ContentTabView: View {
    let model: PieceEditorModel
    @FocusState private var field: ContentTextField?
    @Environment(\.palette) private var palette

    var body: some View {
        content
            .onChange(of: field) { _, now in model.textEditing = now != nil }
            .onDisappear {
                if field != nil { model.textEditing = false }
            }
    }

    @ViewBuilder
    private var content: some View {
        if let trip = model.trip, let post = model.post, let slide = model.slide {
            VStack(alignment: .leading, spacing: 0) {
                PieceSlideSection(model: model, post: post, slide: slide, focus: $field)
                PieceDaySection(model: model, trip: trip, post: post)
                if slide.kind == .hook {
                    PieceCounterSection(model: model, trip: trip, post: post)
                    PieceTimeSection(model: model, trip: trip, post: post)
                    PieceCameraSection(model: model, trip: trip, post: post, focus: $field)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            // The editor itself says the piece is gone; the tab says nothing
            // it could not back.
            Text(verbatim: "This piece is gone.")
                .font(Brand.sans(13))
                .foregroundStyle(palette.muted)
        }
    }
}

/// A preview's host for a section that takes the tab's focus.
struct ContentFocusPreview<Content: View>: View {
    @FocusState private var field: ContentTextField?
    @ViewBuilder let content: (FocusState<ContentTextField?>.Binding) -> Content

    var body: some View {
        content($field)
    }
}

#Preview("Content — hook") {
    let model = PieceEditorFixtures.model()
    ScrollView {
        ContentTabView(model: model)
            .padding(16)
    }
    .frame(width: 380, height: 760)
    .darkroom()
}

#Preview("Content — a picture") {
    let model = PieceEditorFixtures.model()
    ScrollView {
        ContentTabView(model: model)
            .padding(16)
            .onAppear { model.openSlide(1) }
    }
    .frame(width: 380, height: 560)
    .darkroom()
}
