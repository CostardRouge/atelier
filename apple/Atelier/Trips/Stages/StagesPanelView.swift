// The legs of a trip on a wide screen — the native twin of the web's
// `StagesPanel.tsx`: the legend (the span on screen, or how many legs) with
// what a stage IS behind its ⓘ, «From <instance»» and «Deduce» where an
// instance can answer, «+ Stage», the ruler, a hint until the ruler has been
// used once, and the open leg's card.
//
// Rules kept (`roadtrip.md`, «The legs are a horizontal RULER», «The stage
// ruler is ONE gesture surface»):
// - Selection is the overview's (`TripSelection`), not this panel's: opening a
//   leg goes to the day it began and names WHICH leg (on a travel day two
//   overlap), a day tapped on the track opens that day and the leg covering
//   it, and the calendar writing the same selection moves the ruler.
// - The ruler follows the months the calendar shows (`selection.spanFrom` …
//   `spanTo`, written by the overview as its calendar scrolls; a long trip
//   only — a short one draws the whole trip). As on the web today, the ruler
//   is handed no pan: the calendar's scroll IS the loupe, and a swipe on the
//   ruler leaves it where the calendar put it.
// - «+ Stage» starts where the story has a hole — the first uncovered day on
//   screen, else the span's end — and opens the new leg: a leg added
//   off-screen is a leg the author cannot see appear.
// - Every edit goes through `store.change` (`StagesEdit`); a drag is ONE undo
//   step, sealed when the hand lifts.
// - The gesture hint retires itself once the track has been USED (a leg
//   opened, a day tapped, a leg dragged, a gap filled) — learned per device,
//   the web's `atelier.learned.roadtrip.stage-ruler` — and stays behind the ⓘ.
// - Stages may overlap on purpose: a travel day belongs to the place left and
//   the one reached, and `stageAt` gives it to where you ended up.

import SwiftUI
import AtelierKit

struct StagesPanelView: View {
    let store: TripsStore
    let tripId: String
    @Binding var selection: TripSelection
    /// The open leg's card is drawn by the host elsewhere (a wide screen's
    /// right column, `StageCardView`) rather than under the ruler.
    var showsCard = true

    @Environment(ConnectionStore.self) private var connections
    @Environment(\.palette) private var palette
    @AppStorage("atelier.learned.roadtrip.stage-ruler") private var learnedFlag = ""
    @State private var sheet: StagesSheet?
    @State private var spanNote: String?

    var body: some View {
        if let trip = store.trip(tripId) {
            panel(trip)
                .stagesModal(item: $sheet) { sheet in
                    sheetView(sheet)
                }
        }
    }

    private func panel(_ trip: TripDoc) -> some View {
        let span = shownSpan(trip)
        let selected = trip.stages.first { $0.id == selection.stageId }
        let learned = learnedFlag == "yes"
        return VStack(alignment: .leading, spacing: 12) {
            header(trip, span)
            StageRulerView(
                trip: trip,
                span: span,
                selectedId: selected?.id,
                cursorDate: selection.day,
                rungs: StagesColor.rungs(trip),
                onOpenStage: { stage in
                    learn()
                    open(stage)
                },
                onScrub: { date in
                    learn()
                    scrub(date)
                },
                onChange: { stages in
                    learn()
                    StagesEdit.write(store, tripId, stages)
                },
                onGestureEnd: { store.sealHistory() }
            )
            if trip.stages.isEmpty {
                Text(StagesWords.empty)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else if selected == nil && !learned {
                Text(StagesWords.hint(following: span != nil))
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.faint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let selected, showsCard {
                StageCardView(store: store, tripId: tripId, stageId: selected.id, selection: $selection)
                    .id(selected.id)
            }
            if let spanNote {
                StagesNote(text: spanNote) { self.spanNote = nil }
            }
        }
        .padding(.top, 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Stages")
    }

    private func header(_ trip: TripDoc, _ span: TripSpan?) -> some View {
        HStack(spacing: 10) {
            StagesLegend(label: stagesLegend(trip, span: span), paragraphs: StagesWords.about(following: span != nil))
                .frame(maxWidth: .infinity, alignment: .leading)
            // The timeline of a connected Winnow proposes what this list lacks
            // — a diff the author accepts leg by leg, never a sync.
            ForEach(connections.stagesTimelineSources, id: \.self) { id in
                Button {
                    sheet = .complete(sourceId: id)
                } label: {
                    Label("From \(id)", systemImage: "arrow.down.circle")
                }
                .buttonStyle(StagesButtonStyle())
                .help("Compare these stages with \(id)'s timeline and take what you want")
            }
            // The days themselves propose the legs: one position per day, read
            // over this trip's span. No picture is fetched and no post is made.
            ForEach(connections.stagesDeduceSources, id: \.self) { id in
                Button {
                    sheet = .deduce(sourceId: id)
                } label: {
                    Label("Deduce", systemImage: "magnifyingglass")
                }
                .buttonStyle(StagesButtonStyle())
                .help("Work these legs out from where \(id) says each day was")
            }
            Button {
                add(trip, span)
            } label: {
                Label("Stage", systemImage: "plus")
            }
            .buttonStyle(StagesButtonStyle(kind: .primary))
        }
    }

    @ViewBuilder
    private func sheetView(_ sheet: StagesSheet) -> some View {
        switch sheet {
        case .deduce(let id):
            DeduceStagesSheet(store: store, tripId: tripId, sourceId: id, onApplied: applied,
                              onClose: { self.sheet = nil })
                .environment(connections)
        case .complete(let id):
            TimelineImportSheet(store: store, sourceId: id, mode: .complete(tripId: tripId), onApplied: applied,
                                onClose: { self.sheet = nil })
                .environment(connections)
        }
    }

    // MARK: - the selection

    /// The months the calendar shows, on a long trip; nil draws the whole trip.
    private func shownSpan(_ trip: TripDoc) -> TripSpan? {
        guard let from = selection.spanFrom, let to = selection.spanTo, isIsoDate(from), isIsoDate(to),
              let total = spanLength(trip.startDate, trip.endDate), !isShortTrip(total) else { return nil }
        let lo = max(from, trip.startDate)
        let hi = min(to, trip.endDate)
        return lo <= hi ? TripSpan(startDate: lo, endDate: hi) : nil
    }

    /// A leg opened: it, and the day it began.
    private func open(_ stage: TripStage) {
        selection.stageId = stage.id
        selection.day = stage.startDate
    }

    /// A day asked for: it, and the leg covering it — a day no leg covers
    /// leaves the open leg as it was.
    private func scrub(_ date: IsoDate) {
        selection.day = date
        if let trip = store.trip(tripId), let covering = stageAt(trip, date) {
            selection.stageId = covering.id
        }
    }

    private func learn() {
        if learnedFlag != "yes" { learnedFlag = "yes" }
    }

    // MARK: - edits

    private func add(_ trip: TripDoc, _ span: TripSpan?) {
        let result = startStageAt(trip, newStageDay(trip, span: span))
        StagesEdit.write(store, tripId, result.stages)
        store.sealHistory()
        learn()
        if let added = result.stages.first(where: { $0.id == result.selectedId }) { open(added) }
    }

    private func applied(_ doc: TripDoc, _ widened: Bool) {
        spanNote = widened ? spanWidenedSentence(doc) : nil
    }
}

/// The panel's standing words — the web's, with the calendar's gesture named
/// as this platform makes it.
enum StagesWords {
    #if os(macOS)
    private static let dayGesture = "right-click a day on the calendar"
    private static let legGesture = "drag a leg, or either of its edges, to move its dates"
    #else
    private static let dayGesture = "touch and hold a day on the calendar"
    private static let legGesture = "hold a leg, or either of its edges, then drag to move its dates"
    #endif

    static var empty: String {
        "No legs yet — add one with the + above, or \(dayGesture)."
    }

    static func hint(following: Bool) -> String {
        "Tap a leg to edit it and go to its first day · tap anywhere else on the track to open that day · "
            + legGesture
            + (following ? " · the track follows the months the calendar shows" : "")
            + " · \(dayGesture) to start or end a stage there"
    }

    static func about(following: Bool) -> [String] {
        let first = dayGesture.prefix(1).uppercased() + dayGesture.dropFirst()
        return [
            "A stage is a leg of the trip and the days you were on it. A badge can name it, count the days you stayed, or say which day of the stop a picture is.",
            "List the places it went through and its name writes itself — “Perth → Cairns”.",
            "On the track: tap a leg to edit it and go to its first day · tap anywhere else to open that day · "
                + legGesture + (following ? " · the track follows the months the calendar shows" : "")
                + ". \(first) to start or end a stage there.",
        ]
    }
}

#Preview("Stages — wide") {
    StagesPreviewHost { store, selection in
        ScrollView {
            StagesPanelView(store: store, tripId: StagesFixtures.trip.id, selection: selection)
                .padding(20)
        }
        .frame(width: 900, height: 700)
    }
}
