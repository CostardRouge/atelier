// The piece's INSPECTOR — the web's `PanelHost` + the four tabs of
// `PostEditor.tsx` (Content · Look · Picture · Export) and `PiecePicker.tsx`:
//
// - wide: a segmented strip of the four tabs, the piece picker under it on
//   the hook's Content and Look, and the tab's body scrolling on its own so
//   the badge stays in view while its controls are worked through;
// - phone: the four tabs are the editor's own bottom strip — a cell is marked
//   only while the panel it opens is UP (one left marked over a closed panel
//   says the screen is somewhere it is not); Content, Look and Export are a
//   SHEET, Picture a DOCKED DRAWER sharing the column.
//
// The piece picker is rendered ONCE above the body: the Content and Look tabs
// both edit "the piece in hand", and a click on the stage picks one too —
// that click is the better way; this is the keyboard's and VoiceOver's.
//
// Each tab's body is a SLOT (`ContentTabView`, `LookTabView`,
// `PictureTabView`, `ExportTabView`, `PendingTabs.swift` until their tasks
// land) taking the model, which carries the selection, every write, the
// clock and the verbs.

import SwiftUI
import AtelierKit

struct PieceInspector: View {
    @Bindable var model: PieceEditorModel
    /// The segmented strip on top — a wide screen's; on a phone the bottom
    /// strip is the tabs.
    let showsTabs: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if showsTabs {
                Picker("Piece inspector", selection: $model.tab) {
                    ForEach(PieceTab.allCases) { tab in
                        Text(tab.label).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            if model.isHook && (model.tab == .content || model.tab == .look) {
                PiecePickerRow(model: model)
            }
            ScrollView {
                PieceTabBody(model: model)
                    .padding(.bottom, 24)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }
}

/// The open tab's body — its slot.
struct PieceTabBody: View {
    let model: PieceEditorModel

    var body: some View {
        switch model.tab {
        case .content: ContentTabView(model: model)
        case .look: LookTabView(model: model)
        case .picture: PictureTabView(model: model)
        case .export: ExportTabView(model: model)
        }
    }
}

/// "Piece — Or click it on the picture": the badge piece in hand, as ONE control.
struct PiecePickerRow: View {
    @Bindable var model: PieceEditorModel
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Piece")
                    .font(Brand.sans(12, weight: .semibold))
                    .foregroundStyle(palette.ink)
                Text("Or click it on the picture.")
                    .font(Brand.sans(11))
                    .foregroundStyle(palette.muted)
            }
            Spacer(minLength: 8)
            Picker("Badge piece", selection: piece) {
                ForEach(badgePieces, id: \.id) { option in
                    Text(option.label).tag(option.id)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .fixedSize()
        }
    }

    private var piece: Binding<BadgePiece> {
        Binding(get: { model.piece }, set: { model.selectPiece($0) })
    }
}

// MARK: - the phone's strip, sheet and drawer

/// The four tabs as the phone's bottom strip — the editor's own; the app's
/// tab bar hides inside an editor.
struct PieceTabStrip: View {
    @Bindable var model: PieceEditorModel
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 0) {
            ForEach(PieceTab.allCases) { tab in
                cell(tab)
            }
        }
        .background(palette.paper2)
        .overlay(alignment: .top) { Hairline() }
        .sensoryFeedback(DevelopHaptics.snap, trigger: model.tab)
    }

    private func cell(_ tab: PieceTab) -> some View {
        let active = model.inspectorOpen && model.tab == tab
        return Button {
            withAnimation(.easeOut(duration: 0.22)) {
                if active {
                    model.inspectorOpen = false
                } else {
                    model.openTab(tab)
                }
            }
        } label: {
            VStack(spacing: 3) {
                Image(systemName: PieceTabStrip.symbol(tab)).font(.system(size: 16))
                Text(tab.label).font(Brand.sans(10, weight: .medium))
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundStyle(active ? palette.accentInk : palette.muted)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.label)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    static func symbol(_ tab: PieceTab) -> String {
        switch tab {
        case .content: return "text.alignleft"
        case .look: return "textformat"
        case .picture: return "photo"
        case .export: return "square.and.arrow.up"
        }
    }
}

/// Content, Look and Export on a phone: a sheet — panels you pick FROM.
struct PieceInspectorSheet: View {
    @Bindable var model: PieceEditorModel
    @Environment(\.palette) private var palette

    var body: some View {
        NavigationStack {
            PieceInspector(model: model, showsTabs: false)
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .background(palette.surface)
                .navigationTitle(model.tab.label)
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { model.inspectorOpen = false }
                    }
                }
        }
        .presentationDetents([.medium, .large])
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
    }
}

/// Picture on a phone: a DOCKED DRAWER under the stage, never a sheet over it
/// — the framing, the cards of a move, the develop are judged on the picture
/// above, and a sheet's wash over it would lie. Its share of the column is
/// dragged or tapped between the Develop drawer's snaps.
struct PieceInspectorDrawer: View {
    @Bindable var model: PieceEditorModel
    /// The column's height, measured by the host — what a fraction is of.
    let columnHeight: CGFloat
    @Binding var fraction: Double
    @Environment(\.palette) private var palette
    @State private var dragStart: Double?

    var body: some View {
        VStack(spacing: 0) {
            head
            Hairline()
            PieceInspector(model: model, showsTabs: false)
                .padding(.horizontal, 14)
                .padding(.top, 8)
        }
        .frame(height: max(0, columnHeight * CGFloat(fraction)))
        .background(palette.surface)
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: Brand.paperRadius, topTrailingRadius: Brand.paperRadius))
        .overlay(
            UnevenRoundedRectangle(topLeadingRadius: Brand.paperRadius, topTrailingRadius: Brand.paperRadius)
                .stroke(palette.line, lineWidth: 1)
        )
    }

    private var head: some View {
        VStack(spacing: 6) {
            Capsule().fill(palette.lineStrong).frame(width: 36, height: 4).padding(.top, 6)
            HStack {
                Text(model.tab.label)
                    .font(Brand.sans(14, weight: .semibold))
                    .foregroundStyle(palette.ink)
                Spacer(minLength: 8)
                Button {
                    close()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(palette.muted)
                .accessibilityLabel("Close the inspector")
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 4)
        }
        .contentShape(Rectangle())
        .gesture(resize)
        .onTapGesture {
            withAnimation(.easeOut(duration: 0.22)) { fraction = nextSnap(fraction, drawerSnaps) }
        }
    }

    private var resize: some Gesture {
        DragGesture(minimumDistance: 4, coordinateSpace: .global)
            .onChanged { value in
                let start = dragStart ?? fraction
                if dragStart == nil { dragStart = start }
                fraction = dragFraction(start, Double(value.translation.height), Double(columnHeight))
            }
            .onEnded { _ in
                dragStart = nil
                if let rest = snapAfterDrag(fraction, drawerSnaps) {
                    withAnimation(.easeOut(duration: 0.22)) { fraction = rest }
                } else {
                    close()
                }
            }
    }

    private func close() {
        withAnimation(.easeOut(duration: 0.22)) { model.inspectorOpen = false }
    }
}

#Preview("Inspector") {
    PieceInspector(model: PieceEditorFixtures.model(), showsTabs: true)
        .frame(width: 352, height: 560)
        .padding(12)
        .darkroom()
}

#Preview("Phone strip") {
    VStack(spacing: 0) {
        Spacer()
        PieceTabStrip(model: PieceEditorFixtures.model())
    }
    .frame(width: 390, height: 200)
    .darkroom()
}
