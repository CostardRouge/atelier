// PENDING TABS — every tab and the band have landed; what is left is the
// stand-ins' shared face, still worn by the openers' stand-ins
// (`PendingOpeners.swift`). This file goes with them.

import SwiftUI
import AtelierKit

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
