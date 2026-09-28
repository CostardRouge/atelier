// The Content tab's SLIDE section — the first block of the web's
// `panels/ContentTab.tsx`: what the open slide says, and how it goes out.
//
// - On the hook: the TEXT of the badge piece in hand (the piece picker above
//   the tab, or a click on the stage, chooses which), its computed line as
//   the placeholder. Empty follows the trip: an emptied override gives the
//   computed value back, never a blank (`applyOverrides` trims it).
// - On a content picture: its caption.
// - On the closing card: the trip's own card, edited in the trip's sheet.
// - Then how the slide is delivered (`SlideDeliveryRows`), except on the
//   closing card, whose medium is structural.
//
// A click on a badge piece or a caption line on the stage asks this field to
// take the focus (`focusRequest` + `focusSeq`); the focus is the TAB's
// (`ContentTabView`), which tells the editor's keys to stand down.

import SwiftUI
import AtelierKit

struct PieceSlideSection: View {
    let model: PieceEditorModel
    let post: TripPost
    let slide: DeckSlide
    /// The tab's one focus.
    let focus: FocusState<ContentTextField?>.Binding

    private var isHook: Bool { slide.kind == .hook }

    var body: some View {
        DevelopSection(id: "piece.slide", title: "Slide", badge: slideName, info: info, remember: .local) {
            if isHook { hookText }
            if slide.kind == .content { captionField }
            if slide.kind == .cta { cardRow }
            if slide.kind != .cta {
                SlideDeliveryRows(model: model, post: post, slide: slide)
            }
        }
        .onAppear { takeFocus() }
        .onChange(of: model.focusSeq) { _, _ in takeFocus() }
    }

    private var slideName: String {
        switch slide.kind {
        case .hook: return "Hook"
        case .cta: return "Closing card"
        case .content: return "Picture \(slide.position)"
        }
    }

    private var info: [String] {
        var paragraphs = [
            "A slide goes out as a video when something on it moves — an animated badge, a clip — and as an image otherwise. Say so explicitly when you want the other one: a still of an animated hook is how a piece gets its grid picture, and a photograph held for a few seconds is how it opens a reel.",
        ]
        if isHook {
            paragraphs.append("The text is what this piece of the badge says. Leave it empty and it follows the trip — clearing it always gives the computed value back.")
        }
        return paragraphs
    }

    // MARK: - the hook's piece

    private var hookText: some View {
        let piece = model.piece
        let placeholder = model.content.flatMap { $0[piece] } ?? "(nothing here)"
        return ContentFieldRow("Text") {
            TextField("Text", text: overrideBinding(piece), prompt: Text(verbatim: placeholder))
                .textFieldStyle(.roundedBorder)
                .font(Brand.sans(13))
                .focused(focus, equals: .text)
                .onSubmit { focus.wrappedValue = nil }
                .accessibilityLabel("Text")
        } hint: {
            if model.content == nil {
                ContentHint("This trip’s dates read backwards, so there is no total to count towards. Fix them and the badge comes back.",
                            tone: .danger)
            }
        }
    }

    /// The piece's override, every keystroke written — merged into one undo
    /// step under the piece's label. An empty string is stored as the web
    /// stores it, and reads as "computed".
    private func overrideBinding(_ piece: BadgePiece) -> Binding<String> {
        Binding(
            get: { model.post?.badge.textOverrides[piece] ?? "" },
            set: { next in model.patchBadge { $0.textOverrides[piece] = next } }
        )
    }

    // MARK: - a content picture's caption

    private var captionField: some View {
        ContentFieldRow("Caption") {
            TextField("Caption", text: captionBinding, prompt: Text(verbatim: "A line over this picture — optional"))
                .textFieldStyle(.roundedBorder)
                .font(Brand.sans(13))
                .focused(focus, equals: .text)
                .onSubmit { focus.wrappedValue = nil }
                .accessibilityLabel("Caption")
        }
    }

    private var captionBinding: Binding<String> {
        Binding(
            get: { model.slide?.caption ?? "" },
            set: { next in model.patchSlide { $0.caption = next } }
        )
    }

    // MARK: - the closing card

    private var cardRow: some View {
        ContentFieldRow("Card") {
            Button("Edit in the trip’s settings") { model.editClosingCard() }
                .buttonStyle(DevelopPillButtonStyle())
        } hint: {
            ContentHint("The trip’s call to action, shared by every deck that closes with it.")
        }
    }

    // MARK: - the focus a stage click asks for

    /// A click on a badge piece or a caption line asked this tab to focus its
    /// text: the field takes it once the view is up, and the request is spent.
    private func takeFocus() {
        guard model.focusRequest == .text else { return }
        model.focusTaken()
        guard slide.kind != .cta else { return }
        // A field that has only just appeared cannot take the focus in the
        // same pass that built it.
        let focus = self.focus
        Task { @MainActor in focus.wrappedValue = .text }
    }
}

#Preview("Slide — hook") {
    let model = PieceEditorFixtures.model()
    ContentFocusPreview { focus in
        if let post = model.post, let slide = model.slides.first {
            PieceSlideSection(model: model, post: post, slide: slide, focus: focus)
        }
    }
    .frame(width: 360)
    .padding(16)
    .darkroom()
}

#Preview("Slide — caption") {
    let model = PieceEditorFixtures.model()
    ContentFocusPreview { focus in
        if let post = model.post, let slide = model.slides.dropFirst().first {
            PieceSlideSection(model: model, post: post, slide: slide, focus: focus)
        }
    }
    .frame(width: 360)
    .padding(16)
    .darkroom()
}
