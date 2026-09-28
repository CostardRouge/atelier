// The legend over a pane of ⚙ Trip — the web's `SectionLegend`
// (`src/shared/ui/SectionLegend.tsx`): a mono eyebrow and, where the section
// has a standing explanation, an ⓘ that folds it away until it is asked for
// (closed by default, as the web's `InfoDot`). A control that needs no
// explanation gets the eyebrow alone — no ⓘ advertising nothing.

import SwiftUI

struct TripSettingsLegend: View {
    let label: String
    let paragraphs: [String]
    @State private var open = false

    init(_ label: String, paragraphs: [String] = []) {
        self.label = label
        self.paragraphs = paragraphs
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Eyebrow(label)
                if !paragraphs.isEmpty {
                    DevelopInfoDot(about: label.lowercased(), isOpen: $open)
                }
            }
            if open {
                DevelopNote(paragraphs: paragraphs)
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#Preview("Legend") {
    VStack(alignment: .leading, spacing: 20) {
        TripSettingsLegend("Words", paragraphs: [
            "Every word the badge can say. English is only the default — a deck in another language is these fields, not a second vocabulary in the code.",
        ])
        TripSettingsLegend("Time")
    }
    .padding(24)
    .frame(width: 420)
    .background(Palette.paper.surface)
}
