// ⚙ Trip → Closing card — the web's "cta" pane of `TripSettingsModal.tsx`:
// the legend, then `CtaPanel` writing the trip's `cta` on every keystroke, its
// QR problem read from the card as laid out for the piece in hand. Native
// addition: the card itself beside its fields (`CtaCardPreview`), since on a
// phone the full-screen sheet covers the stage the web judges it on.

import SwiftUI
import AtelierKit

struct TripCtaPane: View {
    let trip: TripDoc
    /// The frame the card is previewed in — the piece's, else a carousel's 4:5.
    let aspect: Double
    /// The line a tap on the card asked for.
    var focusRole: CtaRole? = nil
    let write: (TripDoc) -> Void

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var wide: Bool { sizeClass == .regular }
    #else
    private var wide: Bool { true }
    #endif

    var body: some View {
        let layout = ctaLayout(trip.cta, aspect)
        return VStack(alignment: .leading, spacing: 16) {
            TripSettingsLegend("Closing card", paragraphs: [
                "The slide every deck of this trip can close with — one template, never re-authored per piece. Whether a given piece uses it is decided on its own slide rail.",
            ])
            if wide {
                HStack(alignment: .top, spacing: 28) {
                    panel(layout.qrProblem)
                        .frame(maxWidth: 448, alignment: .leading)
                    CtaCardPreview(trip: trip, aspect: aspect)
                        .frame(width: 220)
                }
            } else {
                CtaCardPreview(trip: trip, aspect: aspect)
                    .frame(maxWidth: 220, maxHeight: 300)
                    .frame(maxWidth: .infinity)
                panel(layout.qrProblem)
            }
        }
    }

    private func panel(_ problem: String?) -> some View {
        CtaPanelView(cta: trip.cta, onChange: { cta in
            var next = trip
            next.cta = cta
            write(next)
        }, problem: problem, focusRole: focusRole)
    }
}

// MARK: - previews

private struct TripCtaPreview: View {
    let store: TripsStore

    var body: some View {
        ScrollView {
            if let trip = store.trip(TripSettingsFixtures.tripId) {
                TripCtaPane(trip: trip, aspect: 4.0 / 5) { store.change($0, label: "trip:cta") }
                    .padding(24)
            }
        }
        .frame(minWidth: 360, minHeight: 640)
        .background(Palette.paper.surface)
    }
}

#Preview("Closing card") { TripCtaPreview(store: TripSettingsFixtures.store()) }
