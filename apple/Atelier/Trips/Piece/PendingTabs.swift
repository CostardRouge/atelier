// PENDING TABS — the stand-ins the piece editor hosts until the tasks that
// own them land (the PendingScreens pattern: one block per task, that task
// DELETES ITS BLOCK and defines the real view under the SAME name and
// initialiser; the last one deletes the file). Each takes the model, which
// carries the selection, every write, the clock and the verbs
// (`PieceEditorModel*.swift`). Everything here SAYS what is coming, and shows
// the one fact it cannot leave blank — never an empty panel.

import SwiftUI
import AtelierKit

// MARK: - PICTURE — owned by the Picture tab's task (`panels/PictureTab.tsx`,
// `LayoutSection.tsx`, `CollageMotionSection.tsx`, `FrameStrip.tsx`, the
// pan & zoom section): the file and its in point, the layout, the framing,
// the motion, the develop, the format, the grade's rung. The develop SHEET
// below is the same task's. Delete both when they land.

struct PictureTabView: View {
    let model: PieceEditorModel

    var body: some View {
        PieceTabPending(title: "Picture",
                        text: "The framing, the layout, the picture's move, its develop, the format and the grade are coming with the Picture tab's own task. Drag the picture on the stage to reframe it, pinch to zoom it in its frame.") {
            PieceTabFact(label: "File", value: fileLine)
            if let summary = model.refetchSummary {
                PieceTabFact(label: "Layout", value: summary)
            }
        }
    }

    /// The web's file row: the name, or what became of it.
    private var fileLine: String {
        if model.isCta { return "The closing card carries no photograph." }
        guard let media = model.cellMedia else { return "None" }
        if let recovery = model.recovery {
            if recovery.state == .fetching { return "It lives on \(recovery.sourceId) — fetching it back…" }
            return recovery.problem ?? "It could not be fetched back."
        }
        if model.missing { return "Not in the Library right now — the slide keeps its place" }
        return media.name
    }
}

/// The develop sheet over the SELECTED cell — the Picture tab's task.
struct PieceDevelopSheet: View {
    let model: PieceEditorModel
    @Environment(\.palette) private var palette

    var body: some View {
        NavigationStack {
            PieceTabPending(title: "Develop",
                            text: "The develop sheet — its sliders, its look header and its apply-to verbs — is coming with the Picture tab's own task.") {
                PieceTabFact(label: "Done", value: model.developFooterHint)
            }
            .padding(16)
            .background(palette.surface)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { model.developOpen = false }
                }
            }
        }
    }
}

// MARK: - THE BAND — owned by the transport task (`DeckStrip.tsx`,
// `use-deck-transport.ts`'s band, the cut, the speed and loop pills, the
// sound, the motion marks): «Aiguille», the piece under a fixed needle. The
// clock itself is `PieceDeckClock`, landed. Until the band does, this row
// plays, steps and edits the deck. Delete when it lands.

struct PieceDeckBand: View {
    let model: PieceEditorModel
    let compact: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 8) {
            Button {
                model.togglePlay()
            } label: {
                Image(systemName: model.stagePlaying ? "pause.fill" : "play.fill")
                    .frame(width: 34, height: 34)
            }
            .buttonStyle(DevelopPillButtonStyle())
            .accessibilityLabel(model.stagePlaying ? "Pause" : "Play the piece")
            Text("\(PieceDeckBand.clock(model.deck.time)) / \(PieceDeckBand.clock(model.deck.seconds))")
                .font(Brand.mono(11))
                .monospacedDigit()
                .foregroundStyle(palette.muted)
                .fixedSize()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(model.slides.enumerated()), id: \.offset) { i, slide in
                        chip(i, slide)
                    }
                }
            }
            Button {
                model.addSlide()
            } label: {
                Image(systemName: "plus").frame(width: 28, height: 28)
            }
            .buttonStyle(DevelopPillButtonStyle())
            .accessibilityLabel("Add the ticked picture as a new slide")
            menu
        }
        .frame(minHeight: compact ? 40 : 32)
    }

    private func chip(_ i: Int, _ slide: DeckSlide) -> some View {
        let open = i == model.slideIndex
        let label = slide.kind == .hook ? "Hook" : slide.kind == .cta ? "End" : "\(slide.position)"
        return Button {
            model.deck.goTo(i, 0)
        } label: {
            Text(label)
                .font(Brand.mono(11, weight: open ? .semibold : .regular))
                .padding(.horizontal, 10)
                .frame(minHeight: 28)
                .foregroundStyle(open ? palette.accentInk : palette.inkSoft)
                .background(Capsule().fill(palette.paper))
                .overlay(Capsule().stroke(open ? palette.accent : palette.lineStrong, lineWidth: open ? 2 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(open ? .isSelected : [])
    }

    private var menu: some View {
        let content = model.slide?.kind == .content
        let ci = model.slideIndex - 1
        let count = model.post?.slides.count ?? 0
        return Menu {
            if content {
                Button("Move earlier") { model.moveSlide(from: ci, to: ci - 1) }.disabled(ci <= 0)
                Button("Move later") { model.moveSlide(from: ci, to: ci + 1) }.disabled(ci >= count - 1)
                Divider()
            }
            if model.post?.includeCta == true {
                Button("End on the last picture") { model.setIncludeCta(false) }
                Button("Edit the closing card…") { model.editClosingCard() }
            } else {
                Button("Close with the call to action") { model.setIncludeCta(true) }
            }
            if content {
                Divider()
                Button("Remove this picture", role: .destructive) { model.removeSlide() }
            }
        } label: {
            Image(systemName: "ellipsis").frame(width: 28, height: 28)
        }
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityLabel("More for this slide")
    }

    /// `00:04.2`.
    static func clock(_ seconds: Double) -> String {
        let t = max(0, seconds)
        let minutes = Int(t / 60)
        return String(format: "%02d:%04.1f", minutes, t - Double(minutes) * 60)
    }
}

// MARK: - the stand-ins' shared face

struct PieceTabPending<Facts: View>: View {
    let title: String
    let text: String
    @ViewBuilder let facts: () -> Facts
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(Brand.sans(15, weight: .semibold)).foregroundStyle(palette.ink)
            Text(text).font(Brand.sans(13)).foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            facts()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PieceTabFact: View {
    let label: String
    let value: String
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased()).font(Brand.mono(9)).kerning(1).foregroundStyle(palette.faint)
            Text(value).font(Brand.sans(13)).foregroundStyle(palette.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

#Preview("Tabs and band") {
    let model = PieceEditorFixtures.model()
    VStack(alignment: .leading, spacing: 20) {
        ContentTabView(model: model)
        PictureTabView(model: model)
        ExportTabView(model: model)
        PieceDeckBand(model: model, compact: false)
    }
    .frame(width: 520)
    .padding(16)
    .darkroom()
}
