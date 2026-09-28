// The one row that turns a picture being looked at into WORK — the native
// twin of the web's `MediaActionRow.tsx`. The verbs come from the active tool
// (`MediaPublications`), so the shell offers them without knowing what a roll
// is, and a tool that publishes none draws nothing at all.
//
// The buttons come FIRST and the heading follows them as a sentence saying
// what they do («starts a new roll with this picture») — a label set over a
// single verb read `DEVELOP · Develop`. A LONE verb is the sheet's call to
// action (`lead`: the one ink pill) where the sheet has nothing better to
// offer; several verbs are a choice and none is promoted.

import SwiftUI
import AtelierKit

struct MediaActionRow: View {
    /// What the active tool offers, or nil.
    let offer: MediaActions?
    /// Something is already in flight: the row waits rather than queueing.
    var busy = false
    /// A lone verb is the call to action.
    var lead = false
    /// Run one verb — the caller makes the media ready first and closes the sheet after.
    let onRun: @MainActor (MediaAction) -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        if let offer, !offer.actions.isEmpty {
            let promote = lead && offer.actions.count == 1
            HStack(spacing: 8) {
                ForEach(offer.actions) { action in
                    Button { onRun(action) } label: {
                        Text(action.label.uppercased())
                            .font(Brand.mono(10, weight: .medium))
                            .kerning(1)
                            .foregroundStyle(promote ? palette.paper : palette.ink)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(promote ? palette.ink : palette.paper, in: Capsule())
                            .overlay(Capsule().stroke(promote ? palette.ink : palette.lineStrong, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                    .opacity(busy ? 0.5 : 1)
                    .help(action.hint ?? action.label)
                }
                Text(offer.heading)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .lineLimit(2)
            }
        }
    }
}

#Preview("One verb, leading") {
    MediaActionRow(offer: LibraryFixtures.developOffer, lead: true, onRun: { _ in })
        .padding()
}
