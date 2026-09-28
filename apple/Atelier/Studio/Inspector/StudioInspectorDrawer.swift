// The Studio inspector on a PHONE — a DOCKED DRAWER under the stage, never a
// sheet over it (`frontend.md`, «A phone gets a SHEET or a DRAWER»): what the
// inspector changes — a readout's style, a look, an element's place — is what
// is being watched on the stage, and a sheet's wash would tint it. Its share
// is a fraction of the column (0.28 · 0.4 · 0.6, the web's `DRAWER_SNAPS`),
// dragged or tapped from its handle over the kernel's own snap arithmetic
// (`SheetSnap.swift`); a drag under the floor closes it. The five tabs are the
// drawer's OWN strip at the bottom of the screen — the app's tab bar hides
// inside an editor — a tap opens the drawer on that tab, a tap on the open one
// puts it down. It opens closed: the stage is what you came for.

import SwiftUI
import AtelierKit

struct StudioInspectorDrawer: View {
    @Bindable var editor: StudioEditor
    /// The column's height, measured by the host — what a fraction is of.
    let columnHeight: CGFloat
    @Binding var fraction: Double
    @Environment(\.palette) private var palette
    @State private var dragStart: Double?

    var body: some View {
        VStack(spacing: 0) {
            head
            Hairline()
            StudioInspector(editor: editor, showsTabs: false)
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

    private var head: some View {
        VStack(spacing: 6) {
            Capsule().fill(palette.lineStrong).frame(width: 36, height: 4).padding(.top, 6)
            HStack {
                Text(editor.tab.label)
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
    }

    private func close() {
        withAnimation(.easeOut(duration: 0.22)) { editor.inspectorOpen = false }
    }
}

/// The five tabs as the phone's bottom strip — the drawer's own. A cell is
/// marked only while the panel it opens is UP: one left marked over a closed
/// drawer says the screen is somewhere it is not.
struct StudioSectionStrip: View {
    @Bindable var editor: StudioEditor
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 0) {
            ForEach(StudioTab.allCases, id: \.self) { tab in
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
                        Image(systemName: StudioSectionStrip.symbol(tab)).font(.system(size: 16))
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

    static func symbol(_ tab: StudioTab) -> String {
        switch tab {
        case .overlay: return "square.on.square.dashed"
        case .style: return "textformat"
        case .grade: return "camera.filters"
        case .info: return "info.circle"
        case .export: return "square.and.arrow.up"
        }
    }
}
