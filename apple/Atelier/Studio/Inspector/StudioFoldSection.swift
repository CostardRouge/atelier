// An inspector section whose fold is OWNED BY THE CALLER — the web's
// controlled `InspectorSection` (`open` / `onOpenChange`), which the Studio
// uses for exactly two blocks: "Add an element", because the inspector
// unmounts its tabs and a palette re-collapsing on every trip to Style is
// maddening (it starts open only on an empty deck), and "Elements", whose
// header carries the deck's verbs. Drawn exactly as `DevelopSection` draws a
// block — a rule above, the whole band folding, the ⓘ and the actions apart —
// so the two kinds of section read as one column.

import SwiftUI
import AtelierKit

struct StudioFoldSection<Actions: View, Content: View>: View {
    private let title: String
    private let badge: String?
    private let info: [String]
    @Binding private var isOpen: Bool
    private let actions: Actions
    private let content: Content
    @State private var infoOpen = false
    @Environment(\.palette) private var palette

    init(title: String, badge: String? = nil, info: [String] = [], isOpen: Binding<Bool>,
         @ViewBuilder actions: () -> Actions, @ViewBuilder content: () -> Content) {
        self.title = title
        self.badge = badge
        self.info = info
        _isOpen = isOpen
        self.actions = actions()
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Hairline()
            VStack(alignment: .leading, spacing: 0) {
                band
                if infoOpen && !info.isEmpty {
                    DevelopNote(paragraphs: info)
                        .padding(.top, 6)
                }
                if isOpen {
                    VStack(alignment: .leading, spacing: 10) {
                        content
                    }
                    .padding(.top, 10)
                    .transition(.opacity)
                }
            }
            .padding(.vertical, 12)
        }
    }

    private var band: some View {
        HStack(spacing: 8) {
            Text(title)
                .font(Brand.sans(14, weight: .semibold))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .accessibilityAddTraits([.isHeader, .isButton])
                .accessibilityValue(isOpen ? "expanded" : "collapsed")
                .accessibilityAction { toggle() }
            if let badge {
                Text(badge.uppercased())
                    .font(Brand.mono(9))
                    .kerning(1)
                    .foregroundStyle(palette.muted)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(palette.lineStrong, lineWidth: 1))
            }
            if !info.isEmpty {
                DevelopInfoDot(about: title.lowercased(), isOpen: $infoOpen)
            }
            Spacer(minLength: 0)
            if isOpen { actions }
            Image(systemName: "chevron.down")
                .font(Brand.sans(12, weight: .semibold))
                .foregroundStyle(palette.muted)
                .rotationEffect(.degrees(isOpen ? 0 : -90))
                .frame(width: 28, height: 28)
                .accessibilityHidden(true)
        }
        .frame(minHeight: 28)
        .contentShape(Rectangle())
        .onTapGesture { toggle() }
    }

    private func toggle() {
        withAnimation(.easeOut(duration: 0.2)) { isOpen.toggle() }
    }
}

extension StudioFoldSection where Actions == EmptyView {
    init(title: String, badge: String? = nil, info: [String] = [], isOpen: Binding<Bool>,
         @ViewBuilder content: () -> Content) {
        self.init(title: title, badge: badge, info: info, isOpen: isOpen, actions: { EmptyView() }, content: content)
    }
}

#Preview("Controlled fold") {
    DevelopPreviewState(true) { open in
        StudioFoldSection(title: "Elements", badge: "3", isOpen: open, actions: {
            Button("Reset deck") {}.buttonStyle(DevelopLinkButtonStyle())
        }) {
            Text("the deck")
        }
    }
}
