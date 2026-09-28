// The trip's legs as a list — the phone's answer to the stage ruler, which
// needs 6 points a day a phone does not have. The native twin of the web's
// `LegsSheet.tsx` (`docs/roadtrip-overview-mobile.md` §8.3).
//
// Rules kept (`roadtrip.md`, «On a phone the ruler is not drawn at all»):
// - Every leg is a row in lived order — its tint, its name (or «Unnamed
//   stage», muted), its span, its length, how many of its days are told, and
//   its coverage as a small barcode sampled to 26 bars — and the one opened
//   unfolds the very `StageCardView` the wide screen edits with.
// - A run of days no leg covers is a row too, with the `+ cover` the ruler
//   draws over a gap: nothing the ruler offered is lost — only the drag, which
//   «Adjust on the calendar» hands to the calendar itself: the overview's own
//   gesture, reached through the environment (`\.adjustLegOnCalendar`, which
//   the overview sets on this sheet and nothing else does — so the button is
//   drawn only where a calendar can answer it; the sheet closes behind it).
// - The host draws the sheet's chrome (its title, «Done», its detents); this
//   view is the list.
// - «From <instance>», «Deduce» and «+ Stage» sit in the header, as on the
//   wide screen; «+ Stage» starts on the first day no leg covers.
// - Every edit goes through `store.change` (`StagesEdit`).

import SwiftUI
import AtelierKit

struct LegsSheetView: View {
    let store: TripsStore
    let tripId: String
    @Binding var selection: TripSelection

    @Environment(ConnectionStore.self) private var connections
    @Environment(\.palette) private var palette
    /// The overview's «Adjust on the calendar»; nil where no calendar hosts this.
    @Environment(\.adjustLegOnCalendar) private var adjustLeg
    @State private var sheet: StagesSheet?
    @State private var spanNote: String?

    var body: some View {
        ScrollView {
            if let trip = store.trip(tripId) {
                list(trip)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 24)
            }
        }
        .background(palette.paper)
        .stagesModal(item: $sheet) { sheet in
            sheetView(sheet)
        }
    }

    private func list(_ trip: TripDoc) -> some View {
        let rungs = StagesColor.rungs(trip)
        let rows = legsSheetRows(trip)
        return VStack(alignment: .leading, spacing: 8) {
            header(trip)
            if trip.stages.isEmpty {
                Text("No legs yet — add one with the + above, or cover the days below.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
            }
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    switch row {
                    case .gap(let gap):
                        gapRow(trip, gap)
                    case .leg(let stage, let index):
                        legRow(stage, index, rungs)
                    }
                    Hairline()
                }
            }
            Text("Two stages may overlap: a travel day belongs to the one you left and the one you reached.")
                .font(Brand.mono(11))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)
            if let spanNote {
                StagesNote(text: spanNote) { self.spanNote = nil }
            }
        }
    }

    private func header(_ trip: TripDoc) -> some View {
        StagesFlow(spacing: 8, lineSpacing: 8) {
            Text(legsSheetSummary(trip))
                .font(Brand.mono(11))
                .monospacedDigit()
                .foregroundStyle(palette.muted)
                .padding(.trailing, 8)
            ForEach(connections.stagesTimelineSources, id: \.self) { id in
                Button {
                    sheet = .complete(sourceId: id)
                } label: {
                    Label("From \(id)", systemImage: "arrow.down.circle")
                }
                .buttonStyle(StagesButtonStyle(small: true))
                .accessibilityHint("Compare these stages with \(id)'s timeline and take what you want")
            }
            ForEach(connections.stagesDeduceSources, id: \.self) { id in
                Button {
                    sheet = .deduce(sourceId: id)
                } label: {
                    Label("Deduce", systemImage: "magnifyingglass")
                }
                .buttonStyle(StagesButtonStyle(small: true))
                .accessibilityHint("Work these legs out from where \(id) says each day was")
            }
            Button {
                add(trip)
            } label: {
                Label("Stage", systemImage: "plus")
            }
            .buttonStyle(StagesButtonStyle(kind: .primary, small: true))
        }
    }

    // MARK: - rows

    private func gapRow(_ trip: TripDoc, _ gap: RulerGap) -> some View {
        let what = Text(legsGapLine(gap)).font(Brand.sans(14)).foregroundStyle(palette.muted)
        let when = Text(" · " + diffSpanDates(gap.startDate, gap.endDate)).font(Brand.mono(11)).foregroundStyle(palette.faint)
        return HStack(spacing: 10) {
            Circle()
                .strokeBorder(palette.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
                .frame(width: 9, height: 9)
            (what + when)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("+ cover") { cover(trip, gap) }
                .buttonStyle(StagesButtonStyle(small: true))
                .accessibilityHint("Add a stage covering \(diffSpanDates(gap.startDate, gap.endDate))")
        }
        .frame(minHeight: 48)
    }

    private func legRow(_ stage: TripStage, _ index: Int, _ rungs: [IsoDate: Int]) -> some View {
        let open = stage.id == selection.stageId
        let days = spanLength(stage.startDate, stage.endDate) ?? 0
        let told = enumerateDays(stage.startDate, stage.endDate).filter { (rungs[$0] ?? 0) > 0 }.count
        let label = stageLabel(stage)
        let line = "\(formatIsoDate(stage.startDate)) → \(formatIsoDate(stage.endDate)) · \(days) d · \(told) told"
        var adjustThis: (() -> Void)?
        if let adjustLeg { adjustThis = { adjustLeg(stage.id) } }
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                selection.stageId = open ? nil : stage.id
            } label: {
                HStack(spacing: 10) {
                    Circle()
                        .fill(StagesColor.tint(index))
                        .frame(width: 9, height: 9)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(label.isEmpty ? "Unnamed stage" : label)
                            .font(Brand.sans(14, weight: open ? .semibold : .regular))
                            .foregroundStyle(label.isEmpty ? palette.muted : palette.ink)
                            .lineLimit(1)
                        Text(line)
                            .font(Brand.mono(11))
                            .monospacedDigit()
                            .foregroundStyle(palette.muted)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    barcode(stage, rungs)
                    Image(systemName: open ? "chevron.down" : "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(palette.faint)
                        .frame(width: 16)
                }
                .frame(minHeight: 54)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(label.isEmpty ? "Unnamed stage" : label), \(line)")
            .accessibilityValue(open ? "open" : "closed")
            if open {
                StageCardView(store: store, tripId: tripId, stageId: stage.id, selection: $selection,
                              onAdjust: adjustThis)
                    .id(stage.id)
                    .padding(.bottom, 12)
            }
        }
    }

    /// The leg's own coverage, one bar a day — sampled past 26.
    private func barcode(_ stage: TripStage, _ rungs: [IsoDate: Int]) -> some View {
        HStack(spacing: 1) {
            ForEach(legBarcodeDays(stage), id: \.self) { day in
                RoundedRectangle(cornerRadius: 1)
                    .fill(StagesColor.rung(rungs[day] ?? 0, palette))
                    .frame(width: 3, height: 20)
            }
        }
        .accessibilityHidden(true)
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

    // MARK: - edits

    private func add(_ trip: TripDoc) {
        let result = startStageAt(trip, newStageDay(trip))
        StagesEdit.write(store, tripId, result.stages)
        store.sealHistory()
        selection.stageId = result.selectedId
    }

    private func cover(_ trip: TripDoc, _ gap: RulerGap) {
        let stage = stageOverGap(trip, gap.startDate, gap.endDate)
        StagesEdit.write(store, tripId, insertStageInOrder(trip.stages, stage))
        store.sealHistory()
        selection.stageId = stage.id
    }

    private func applied(_ doc: TripDoc, _ widened: Bool) {
        spanNote = widened ? spanWidenedSentence(doc) : nil
    }
}

#Preview("Legs — phone") {
    StagesPreviewHost { store, selection in
        LegsSheetView(store: store, tripId: StagesFixtures.trip.id, selection: selection)
            .frame(width: 390, height: 780)
    }
}
