// The line a gallery prints for a connected instance it draws no group for —
// the web's `AbsentSourceNotes.tsx`, one view for the three galleries.
//
// An instance whose bucket does not keep this kind of document is left out on
// purpose, and until 2026-09-21 it was left out in SILENCE — how a roll kept
// on a Winnow could exist on one machine and be invisible on another. The
// sheet is re-asked first (`ConnectionStore.probeHidden`); this draws only
// what survives that, so the sentence is never a guess about a stale answer.

import SwiftUI
import AtelierKit

struct AbsentSourceNotes: View {
    let absent: [AbsentSource]
    @Environment(\.palette) private var palette

    var body: some View {
        let said = absent.filter { $0.text != nil }
        if !said.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(said, id: \.sourceId) { note in
                    Text(note.text ?? "")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.faint)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.bottom, 8)
        }
    }
}

#Preview {
    AbsentSourceNotes(absent: [
        AbsentSource(sourceId: "winnow.steeve.website",
                     text: "winnow.steeve.website does not keep rolls — asked again just now, so this is its own version and not a stale answer here."),
        AbsentSource(sourceId: "winnow.example", text: nil),
    ])
    .padding()
}
