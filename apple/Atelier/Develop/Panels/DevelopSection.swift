// A section of the Develop inspector — port of `DevelopFold`
// (`src/shared/develop/DevelopFold.tsx`) over the suite's one foldable
// section (`InspectorSection`, `src/shared/ui/Inspector.tsx`), with the
// Develop rules (2026-09-23, the maintainer's ask once the Adjust tab had
// grown past a dozen blocks):
//
// - a titled block parted from the next by a rule, FOLDED by a tap anywhere
//   on its header band — the title, the empty stretch and the chevron alike;
// - **folded or not is remembered for the SESSION**, never on the roll
//   (`@SceneStorage`, the web's `sessionStorage`): it survives stepping from
//   one picture to the next, and a new window starts from the defaults;
// - **a folded section never hides an edit**: `marked` puts the accent dot
//   after its title whenever something in it departs from as shot;
// - the standing prose sits behind an ⓘ beside the title;
// - `foldable: false` draws the same header with no chevron — a section too
//   small to be worth folding (Auto's one row of verbs, Fringing's one slider)
//   still reads like its neighbours.
//
// What is folded by default is what a pass over a picture reaches for LAST —
// levels, the curve, the mixer, the wheels, the vignette; each section says so
// through `defaultOpen`. (The web's `DevelopSection.tsx` is a different thing,
// the settled row Trips and the Studio draw: `DevelopSettledRow.swift`.)

import SwiftUI
import AtelierKit

/// Where a fold is remembered: for this window's session (the Develop
/// inspector's rule), or for good on this device (every other inspector's).
enum DevelopFoldMemory {
    case session, local
}

struct DevelopSection<Actions: View, Content: View>: View {
    private let title: String
    private let badge: String?
    private let info: [String]
    private let marked: Bool
    private let foldable: Bool
    private let memory: DevelopFoldMemory
    private let actions: Actions
    private let content: Content

    @SceneStorage private var sessionOpen: Bool
    @AppStorage private var localOpen: Bool
    @State private var infoOpen = false
    @Environment(\.palette) private var palette

    /// - Parameters:
    ///   - id: the block's id (`light`, `curve`, `layer.curve`…) — what keeps its fold.
    ///   - badge: a small tag after the title.
    ///   - info: the standing prose behind the ⓘ, one paragraph per entry.
    ///   - marked: something in the section departs from its default.
    ///   - actions: controls pinned at the right of the header, drawn while open.
    init(id: String, title: String, badge: String? = nil, info: [String] = [], marked: Bool = false,
         defaultOpen: Bool = true, foldable: Bool = true, remember: DevelopFoldMemory = .session,
         @ViewBuilder actions: () -> Actions, @ViewBuilder content: () -> Content) {
        self.title = title
        self.badge = badge
        self.info = info
        self.marked = marked
        self.foldable = foldable
        self.memory = remember
        self.actions = actions()
        self.content = content()
        let key = "atelier.inspector.develop.\(id)"
        _sessionOpen = SceneStorage(wrappedValue: defaultOpen, key)
        _localOpen = AppStorage(wrappedValue: defaultOpen, key)
    }

    private var isOpen: Bool {
        guard foldable else { return true }
        return memory == .session ? sessionOpen : localOpen
    }

    private func toggle() {
        guard foldable else { return }
        withAnimation(.easeOut(duration: 0.2)) {
            switch memory {
            case .session: sessionOpen.toggle()
            case .local: localOpen.toggle()
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Hairline()
            VStack(alignment: .leading, spacing: 0) {
                band
                if infoOpen && !info.isEmpty {
                    DevelopNote(paragraphs: info)
                        .padding(.top, 6)
                        .transition(.opacity)
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

    /// The header band: the whole of it folds, not only the chevron. The ⓘ
    /// and the actions are buttons of their own and keep their taps.
    private var band: some View {
        HStack(spacing: 8) {
            Text(title)
                .font(Brand.sans(14, weight: .semibold))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .accessibilityAddTraits(foldable ? [.isHeader, .isButton] : .isHeader)
                .accessibilityValue(foldable ? (isOpen ? "expanded" : "collapsed") : "")
                .accessibilityAction { toggle() }
            if marked {
                Circle()
                    .fill(palette.accent)
                    .frame(width: 6, height: 6)
                    .accessibilityLabel("changed")
                    .help("Something here is set")
            }
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
            if isOpen {
                actions
            }
            if foldable {
                Image(systemName: "chevron.down")
                    .font(Brand.sans(12, weight: .semibold))
                    .foregroundStyle(palette.muted)
                    .rotationEffect(.degrees(isOpen ? 0 : -90))
                    .frame(width: 28, height: 28)
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: 28)
        .contentShape(Rectangle())
        .onTapGesture { toggle() }
    }
}

extension DevelopSection where Actions == EmptyView {
    init(id: String, title: String, badge: String? = nil, info: [String] = [], marked: Bool = false,
         defaultOpen: Bool = true, foldable: Bool = true, remember: DevelopFoldMemory = .session,
         @ViewBuilder content: () -> Content) {
        self.init(id: id, title: title, badge: badge, info: info, marked: marked, defaultOpen: defaultOpen,
                  foldable: foldable, remember: remember, actions: { EmptyView() }, content: content)
    }
}

#Preview("Section frame") {
    DevelopPreviewState(true) { _ in
        DevelopSection(id: "preview.light", title: "Light",
                       info: ["Exposure is a gain in stops, in scene light."], marked: true) {
            DevelopRangeSlider("Exposure", value: 0.7, in: -3...3, step: 0.05, printed: "+0.70 EV") { _ in }
        }
        DevelopSection(id: "preview.curve", title: "Curve", defaultOpen: false) {
            Text("folded by default")
        }
        DevelopSection(id: "preview.auto", title: "Auto", info: ["One row of verbs."], foldable: false) {
            Button("Auto tone") {}.buttonStyle(DevelopPillButtonStyle())
        }
        DevelopSection(id: "preview.look", title: "Look", badge: "Cell 2", actions: {
            Button("Reset") {}.buttonStyle(DevelopLinkButtonStyle())
        }) {
            Text("a section with an action in its header")
        }
    }
}
