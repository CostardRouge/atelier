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
