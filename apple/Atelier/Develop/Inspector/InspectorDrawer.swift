// The inspector on a PHONE — a DOCKED DRAWER under the stage, never a sheet
// over it (`frontend.md`, «A phone gets a SHEET or a DRAWER»): a sheet's wash
// tints the very colour being set, and a slider needs no room to be read.
// Its share is a fraction of the COLUMN — 0.4 by default, 0.28 and 0.6 the
// other rests — dragged or tapped from its handle over the kernel's own snap
// arithmetic (`SheetSnap.swift`), a drag under its floor closing it. It runs
// edge to edge with a rounded top, rises and falls, and the five sections
// are its OWN strip at the bottom of the screen (the design canvas: the
// inspector's sections become the drawer's strip while the tab bar hides
// inside an editor) — a tap opens the drawer on that section, a tap on the
// open one puts it down.

import SwiftUI
import AtelierKit

/// The drawer's rests, smallest first — the web's `DRAWER_SNAPS`.
let drawerSnaps: SnapPoints = [0.28, 0.4, 0.6]

struct InspectorDrawer: View {
    @Bindable var editor: RollEditor
    /// The column's height, measured by the host — what a fraction is of.
    let columnHeight: CGFloat
    @Binding var fraction: Double
    @Environment(\.palette) private var palette
    @State private var dragStart: Double?

    var body: some View {
        VStack(spacing: 0) {
            head
            Hairline()
            InspectorView(editor: editor, showsTabs: false)
        }
        .frame(height: max(0, columnHeight * CGFloat(fraction)))
        .background(palette.surface)
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: Brand.paperRadius, topTrailingRadius: Brand.paperRadius))
        .overlay(
            UnevenRoundedRectangle(topLeadingRadius: Brand.paperRadius, topTrailingRadius: Brand.paperRadius)
                .stroke(palette.line, lineWidth: 1)
        )
        .shadow(color: palette.frame.opacity(0.4), radius: 10, y: -2)
    }

    /// The grip and the title row: the whole head drags and taps, the ✕ apart.
    private var head: some View {
        VStack(spacing: 6) {
            Capsule().fill(palette.lineStrong).frame(width: 36, height: 4).padding(.top, 6)
            HStack {
                Text(title)
                    .font(Brand.sans(14, weight: .semibold))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
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
        .gesture(
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
        )
        .onTapGesture {
            withAnimation(.easeOut(duration: 0.22)) { fraction = nextSnap(fraction, drawerSnaps) }
        }
        .sensoryFeedback(DevelopHaptics.snap, trigger: fraction == 0.28 || fraction == 0.4 || fraction == 0.6)
    }

    private var title: String {
        let tab = editor.tab.label
        guard let p = editor.picture else { return tab }
        return "\(tab) · \(pictureLabel(p))"
    }

    private func close() {
        withAnimation(.easeOut(duration: 0.22)) { editor.inspectorOpen = false }
    }
}

/// The five sections as the phone's bottom strip — the drawer's own.
struct SectionStrip: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 0) {
            ForEach(WorkbenchTab.allCases, id: \.self) { tab in
                let active = editor.inspectorOpen && editor.tab == tab
                Button {
                    withAnimation(.easeOut(duration: 0.22)) {
                        if active {
                            editor.inspectorOpen = false
                        } else {
                            editor.tab = tab
                            editor.inspectorOpen = true
                        }
                    }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: symbol(tab)).font(.system(size: 16))
                        Text(tab.label).font(Brand.sans(10, weight: .medium))
                    }
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .foregroundStyle(active ? palette.accentInk : palette.muted)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .background(palette.paper2)
        .overlay(alignment: .top) { Hairline() }
        .sensoryFeedback(DevelopHaptics.snap, trigger: editor.tab)
    }

    private func symbol(_ tab: WorkbenchTab) -> String {
        switch tab {
        case .adjust: return "slider.horizontal.3"
        case .detail: return "circle.dotted"
        case .layers: return "square.3.layers.3d"
        case .crop: return "crop"
        case .export: return "square.and.arrow.up"
        }
    }
}
