// A picture's correction as ONE settled inspector row — port of the web's
// `src/shared/develop/DevelopSection.tsx` (a different thing from this
// folder's `DevelopSection`, the fold every Adjust block wears): the sentence
// the workbench writes (`describeDevelop`), the way in (`Develop…`) and the
// way back to as shot. The sliders live in the workbench, never here — an
// inspector that grew nine sliders would be the accordion the editors
// retired.
//
// Trips' Picture tab and the Studio's Grade tab draw it; only the id, the ⓘ
// and what "open" does differ. Its fold is remembered on the device, like
// every inspector section outside Develop.

import SwiftUI
import AtelierKit

struct DevelopSettledRow: View {
    let id: String
    let badge: String?
    let info: [String]
    let develop: DevelopSettings?
    let canOpen: Bool
    let openTitle: String
    let onOpen: () -> Void
    let onReset: () -> Void
    @Environment(\.palette) private var palette

    /// - Parameters:
    ///   - id: the section's id, which keeps its fold remembered per editor.
    ///   - badge: a small tag after the title — which cell of a collage the row is about.
    ///   - develop: the stored develop; nil is as shot.
    ///   - canOpen: a picture to develop is in hand.
    init(id: String, badge: String? = nil, info: [String] = [], develop: DevelopSettings?, canOpen: Bool,
         openTitle: String = "Open the Develop sheet", onOpen: @escaping () -> Void, onReset: @escaping () -> Void) {
        self.id = id
        self.badge = badge
        self.info = info
        self.develop = develop
        self.canOpen = canOpen
        self.openTitle = openTitle
        self.onOpen = onOpen
        self.onReset = onReset
    }

    var body: some View {
        let sentence = describeDevelop(develop)
        DevelopSection(id: id, title: "Develop", badge: badge, info: info, remember: .local) {
            HStack(spacing: 8) {
                Text("Correction")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.inkSoft)
                Text(sentence)
                    .font(Brand.mono(12))
                    .foregroundStyle(develop != nil ? palette.inkSoft : palette.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .help(sentence)
                if develop != nil {
                    Button(action: onReset) {
                        Image(systemName: "arrow.counterclockwise")
                            .font(Brand.sans(12, weight: .semibold))
                            .frame(width: 24, height: 24)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(palette.muted)
                    .accessibilityLabel("Back to as shot")
                    .help("Back to as shot")
                }
                Button("Develop…", action: onOpen)
                    .buttonStyle(DevelopPillButtonStyle())
                    .disabled(!canOpen)
                    .help(openTitle)
            }
        }
    }
}

#Preview("Settled row") {
    DevelopPreviewState(Optional(DevelopPanelFixtures.develop)) { develop in
        DevelopSettledRow(id: "preview.develop", info: ["This picture's own correction."],
                          develop: develop.wrappedValue, canOpen: true,
                          onOpen: {}, onReset: { develop.wrappedValue = nil })
        DevelopSettledRow(id: "preview.develop.empty", badge: "Cell 2", develop: nil, canOpen: false,
                          onOpen: {}, onReset: {})
    }
}
