// The piece editor's PICTURE tab — the web's
// `src/tools/roadtrip/panels/PictureTab.tsx`: WHICH picture, what shape it is
// delivered in, and how it is treated — the file and the moment it opens on,
// the cells of a collage and how they arrive, the framing, the move, the
// develop, the deck's format and the grade.
//
// Rules kept (`roadtrip.md`):
// - WHERE a picture comes from is the Library's business — including an
//   instance's own day, which its tab lists for the span this editor
//   publishes; this tab says so and draws no second strip of that day;
// - the Layout sits ABOVE the framing, because the framing, the move and the
//   develop below follow the cell selected there (or on the stage); a later
//   cell is named on each of them ("Cell 2");
// - a clip's in point is chosen on a filmstrip that slides the whole stretch
//   along the clip and keeps its length; the cut and the speed are the band's;
// - the develop is ONE settled row (the sentence, Develop…, back to as shot),
//   per SLIDE like the framing, never inherited by the next picture;
// - the closing card carries no photograph and says so; its grade chips have
//   no Picture rung;
// - the frame is a property of the PIECE and shows on every slide.

import SwiftUI
import AtelierKit

struct PictureTabView: View {
    let model: PieceEditorModel

    /// The tag the per-cell sections wear when the inspector is about a later cell.
    private var cellBadge: String? {
        model.collage != nil && model.cellIndex > 0 ? "Cell \(model.cellIndex + 1)" : nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PiecePictureFileSection(model: model)
            if !model.isCta {
                PieceLayoutSection(model: model)
                if let collage = model.collage {
                    PieceCollageMotionSection(collage: collage, seconds: model.slide?.seconds ?? 0) { model.setCollage($0) }
                }
                PieceFramingSection(model: model, badge: cellBadge)
                PiecePanZoomSection(model: model, badge: cellBadge)
                developRow
            }
            PieceFormatSection(model: model)
            PieceGradeSection(model: model)
        }
    }

    /// The picture's own CORRECTION, one settled row: the sentence the sheet
    /// writes, the way in, and the way back to as shot.
    private var developRow: some View {
        let canOpen = model.cellRef != nil
        return DevelopSettledRow(
            id: "piece.develop", badge: cellBadge,
            info: ["This slide’s own correction — exposure, tone, colour — applied before the grade below. It belongs to this photograph and is never inherited by the next one."],
            develop: model.cellDevelop, canOpen: canOpen,
            openTitle: canOpen ? "Open the Develop sheet" : "Tick a picture first",
            onOpen: { model.developOpen = true },
            onReset: { model.setDevelop(nil) }
        )
    }
}

/// The Picture section: the file the open slide (or the selected cell)
/// composes over, what became of it, and a clip's in point.
struct PiecePictureFileSection: View {
    let model: PieceEditorModel
    @Environment(\.palette) private var palette

    private var info: [String] {
        guard !model.isCta else { return [] }
        var out = ["This slide composes over whatever is ticked in the Library, and picking another one there re-points the slide."]
        if let connection = ConnectionStore.shared.connections.first {
            let instance = shortHost(connection.id)
            out.append("Its \(instance) tab already lists what that instance holds for this piece’s own day — the day is the query, so no date is ever picked by hand. A tap there brings one picture across; a drag puts it straight on a cell.")
        }
        return out
    }

    var body: some View {
        DevelopSection(id: "piece.picture", title: "Picture", info: info, remember: .local) {
            if model.isCta {
                Text("The closing card carries no photograph: a flat ground is what keeps the QR readable and the sentence unmissable.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                fileRow
                inPointRow
            }
        }
    }

    // MARK: - the file

    private var fileRow: some View {
        let file = model.cellRef
        // Without a collage the slide's own ref names it even while the
        // Library does not hold it; a cell names only what is in hand.
        let stored: String? = model.collage == nil ? model.slide?.media?.name : nil
        let name = file?.name ?? stored ?? "None"
        let recovery = model.recovery
        return VStack(alignment: .leading, spacing: 4) {
            OverlayPanelRow("File") {
                Text(name)
                    .font(Brand.mono(12))
                    .foregroundStyle(file != nil ? palette.inkSoft : palette.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            }
            if let recovery, recovery.state == .failed {
                failure(recovery)
            } else if file == nil {
                OverlayPanelHint(emptyHint(recovery))
                    .padding(.leading, OverlayPanelMetrics.label + OverlayPanelMetrics.gap)
            }
        }
    }

    /// What a slide with no file in hand says.
    private func emptyHint(_ recovery: PieceRecovery?) -> String {
        if let recovery, recovery.state == .fetching {
            return "It lives on \(recovery.sourceId) — fetching it back…"
        }
        if model.missing { return "Not in the Library right now. The slide keeps its place in the deck." }
        return "Tick a photo or a clip in the Library."
    }

    /// A fetch that failed: the reason, and where to sign in when that is it.
    private func failure(_ recovery: PieceRecovery) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(recovery.problem ?? "It could not be fetched back.")
                .font(Brand.sans(11))
                .foregroundStyle(palette.danger)
                .fixedSize(horizontal: false, vertical: true)
            if let login = recovery.loginUrl, let url = URL(string: login) {
                Link("Sign in there", destination: url)
                    .font(Brand.sans(11, weight: .semibold))
                    .underline()
                    .foregroundStyle(palette.danger)
            }
        }
        .padding(.leading, OverlayPanelMetrics.label + OverlayPanelMetrics.gap)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }

    // MARK: - the in point

    /// The filmstrip moves the IN point and keeps the slide's length — it
    /// slides the whole stretch along the clip. The bar under the picture is
    /// where a cut is made, and where the speed is chosen.
    @ViewBuilder
    private var inPointRow: some View {
        if model.isVideo, model.duration > 0, let url = model.leadURL, let slide = model.slide {
            VStack(alignment: .leading, spacing: 4) {
                PieceFrameStrip(url: url, duration: model.duration, value: slide.videoTimeSeconds,
                                label: "In point") { model.setInPoint($0) }
                OverlayPanelHint("Where the slide’s stretch of the clip starts; it keeps its length.")
            }
        }
    }
}

#Preview("Picture tab") {
    ScrollView {
        PictureTabView(model: PieceEditorFixtures.model())
            .padding(16)
    }
    .frame(width: 380, height: 760)
    .environment(LookLibrary.shared)
    .darkroom()
}
