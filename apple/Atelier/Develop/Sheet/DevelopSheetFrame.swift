// The develop SHEET's layout — the web's `DevelopSheet.tsx` without its
// dialog chrome (the navigation bar is the title, Cancel and Done): the
// PICTURE side — the bar (what it is, the clipboard, `A/B`, the zoom), the
// stage, the caption — beside the host's COLUMN of panels, which scrolls on
// its own.
//
// Two layouts, split where the web's is (820 points, measured on the sheet
// itself — a sheet on an iPad is narrower than the iPad): side by side on a
// wide sheet, the column a fixed 352 points; stacked on a narrow one, the
// picture taking a fixed share of the sheet's height (the web's
// `--app-h * 0.38`) and the column scrolling UNDER it, so a drag on the
// picture is always the picture's and never the scroll's.
//
// The host hands its picture to `DevelopSheetPicture`, its draft as a binding
// and its panels as the column; the sheet's keys (`DevelopSheetKeys`) and the
// clipboard's listener live here, so both hosts get them the same way.

import SwiftUI
import AtelierKit

/// Where the sheet splits into two columns — the web's `max-[820px]`.
private let developSheetSplit: CGFloat = 820

struct DevelopSheetFrame<Column: View>: View {
    @Bindable var picture: DevelopSheetPicture
    @Binding var draft: DevelopSettings
    /// A picture was handed over (or is on its way): an empty frame says "decoding…".
    let hasPicture: Bool
    /// What an empty frame says — the host knows where a picture comes from.
    let emptyText: String
    let onTold: (String) -> Void
    let column: () -> Column

    init(picture: DevelopSheetPicture, draft: Binding<DevelopSettings>, hasPicture: Bool, emptyText: String,
         onTold: @escaping (String) -> Void, @ViewBuilder column: @escaping () -> Column) {
        self._picture = Bindable(picture)
        self._draft = draft
        self.hasPicture = hasPicture
        self.emptyText = emptyText
        self.onTold = onTold
        self.column = column
    }

    var body: some View {
        GeometryReader { geo in
            let compact = geo.size.width < developSheetSplit
            if compact {
                stacked(geo.size)
            } else {
                sideBySide
            }
        }
        .modifier(DevelopSheetKeys(picture: picture, draft: $draft, onTold: onTold))
        .onAppear { picture.open() }
        .onDisappear { picture.close() }
    }

    private func stacked(_ size: CGSize) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            pictureSide(compact: true, stageHeight: max(200, size.height * 0.38))
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 8)
            Hairline()
            ScrollView {
                column()
                    .padding(12)
            }
        }
    }

    private var sideBySide: some View {
        HStack(alignment: .top, spacing: 16) {
            pictureSide(compact: false, stageHeight: nil)
            ScrollView {
                column()
                    .padding(.trailing, 6)
            }
            .frame(width: 352)
        }
        .padding(16)
    }

    /// The bar, the stage and the caption. `stageHeight` nil lets the stage
    /// take whatever the side has left.
    private func pictureSide(compact: Bool, stageHeight: CGFloat?) -> some View {
        let fidelity = picture.fidelity(draft.base)
        return VStack(alignment: .leading, spacing: 8) {
            DevelopSheetBar(picture: picture, draft: $draft, chip: fidelity.chip, compact: compact, onTold: onTold)
            DevelopSheetStage(picture: picture, draft: $draft, hasPicture: hasPicture,
                              emptyText: emptyText, onTold: onTold)
                .frame(height: stageHeight)
            DevelopSheetCaption(picture: picture, draft: draft, note: fidelity.note)
        }
    }
}

#Preview("Sheet frame") {
    DevelopSheetFramePreview()
        .frame(width: 900, height: 620)
        .background(Palette.darkroom.surface)
        .darkroom()
}

private struct DevelopSheetFramePreview: View {
    @State private var picture = DevelopSheetPicture()
    @State private var draft = DevelopSettings.default

    var body: some View {
        DevelopSheetFrame(picture: picture, draft: $draft, hasPicture: false,
                          emptyText: "No picture to develop yet.", onTold: { _ in }) {
            VStack(alignment: .leading) {
                DevelopHistogramView(histogram: DevelopPanelFixtures.histogram)
                DevelopSlidersSection(settings: $draft, foldPrefix: "preview.")
            }
        }
    }
}
