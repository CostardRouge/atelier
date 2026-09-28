// The open leg — the native twin of the web's `StageCard` (`StagesPanel.tsx`):
// its tint and number, a two-step Delete and a close; the name and the region,
// whose placeholders are the DERIVED values; the Arrived / Left dates held
// inside the trip; the problem in red or what the leg really says; «Adjust on
// the calendar» where the host offers it (the phone's replacement for the
// ruler's drag); and the places it went through.
//
// Rules kept (`roadtrip.md`, «A Road Trip stage is a LEG carrying an ORDERED
// list of located places»):
// - Empty means COMPUTED, never blank: an empty name field shows "Perth →
//   Cairns", the label the badge would really draw, so clearing it is never a
//   one-way door; the region likewise shows the one its places agree on.
// - Every keystroke writes the trip through the one funnel (`StagesEdit`);
//   edits inside 700 ms merge into one undo step, as on the web.
// - The dates are the same two fields the ruler drags, so the two never
//   disagree; a picker's range never runs past the trip or the other date.

import SwiftUI
import AtelierKit

struct StageCardView: View {
    let store: TripsStore
    let tripId: String
    let stageId: String
    @Binding var selection: TripSelection
    /// Adjust the dates on the calendar itself — offered by the legs sheet on
    /// a phone, never by the wide screen, which has the ruler.
    var onAdjust: (() -> Void)? = nil

    @Environment(\.palette) private var palette
    @State private var confirming = false

    var body: some View {
        if let trip = store.trip(tripId), let index = trip.stages.firstIndex(where: { $0.id == stageId }) {
            card(trip, trip.stages[index], index)
                .onChange(of: stageId) { _, _ in confirming = false }
        }
    }

    private func card(_ trip: TripDoc, _ stage: TripStage, _ index: Int) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            heading(stage, index)
            fields(trip, stage)
            dates(trip, stage)
            line(trip, stage)
            if let onAdjust {
                Button(action: onAdjust) {
                    Label("Adjust on the calendar", systemImage: "arrow.left.and.right")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(StagesButtonStyle(kind: .primary))
            }
            PlacesEditorView(store: store, tripId: tripId, stageId: stageId)
        }
        .padding(.top, 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Stage \(index + 1)")
    }

    private func heading(_ stage: TripStage, _ index: Int) -> some View {
        HStack(spacing: 8) {
            Circle()
                .fill(StagesColor.tint(index))
                .frame(width: 10, height: 10)
            Text(stageCardHeading(stage, index: index).uppercased())
                .font(Brand.mono(11, weight: .medium))
                .kerning(1.4)
                .foregroundStyle(palette.muted)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if confirming {
                Button("Delete") { delete(stage) }
                    .buttonStyle(StagesButtonStyle(kind: .danger, small: true))
                Button("Keep") { confirming = false }
                    .buttonStyle(StagesButtonStyle(kind: .ghost, small: true))
            } else {
                Button("Delete") { confirming = true }
                    .buttonStyle(StagesButtonStyle(kind: .ghost, small: true))
                    .accessibilityLabel("Delete \(stage.name.isEmpty ? "this stage" : stage.name)")
            }
            Button {
                selection.stageId = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(palette.muted)
            .accessibilityLabel("Close this stage")
        }
    }

    private func fields(_ trip: TripDoc, _ stage: TripStage) -> some View {
        // What the badge would REALLY say with the field empty — never an
        // invented example unless the leg names nothing yet.
        var unnamed = stage
        unnamed.name = ""
        var unregioned = stage
        unregioned.region = ""
        let derivedName = stageLabel(unnamed)
        let derivedRegion = stageRegionLabel(unregioned)
        let name = Binding<String>(
            get: { stage.name },
            set: { next in edit(stage) { $0.name = next } }
        )
        let region = Binding<String>(
            get: { stage.region },
            set: { next in edit(stage) { $0.region = next } }
        )
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                nameField(name, derivedName)
                regionField(region, derivedRegion)
            }
            VStack(alignment: .leading, spacing: 8) {
                nameField(name, derivedName)
                regionField(region, derivedRegion)
            }
        }
    }

    private func nameField(_ text: Binding<String>, _ derived: String) -> some View {
        TextField("Stage name", text: text, prompt: Text(derived.isEmpty ? "The Red Centre" : derived))
            .textFieldStyle(.roundedBorder)
            .font(Brand.sans(14))
            .frame(minWidth: 128)
            .accessibilityLabel("Stage name")
    }

    private func regionField(_ text: Binding<String>, _ derived: String) -> some View {
        TextField("Region", text: text, prompt: Text(derived.isEmpty ? "Western Australia" : derived))
            .textFieldStyle(.roundedBorder)
            .font(Brand.sans(14))
            .frame(minWidth: 128)
            .accessibilityLabel("Region")
    }

    /// Arrived → Left, each held inside the trip and on its side of the other.
    private func dates(_ trip: TripDoc, _ stage: TripStage) -> some View {
        HStack(spacing: 8) {
            datePicker("Arrived", stage.startDate, StagesDate.range(trip.startDate, stage.endDate)) { iso in
                edit(stage) { $0.startDate = iso }
            }
            Text("→")
                .font(Brand.mono(12))
                .foregroundStyle(palette.faint)
                .accessibilityHidden(true)
            datePicker("Left", stage.endDate, StagesDate.range(stage.startDate, trip.endDate)) { iso in
                edit(stage) { $0.endDate = iso }
            }
            Spacer(minLength: 0)
        }
        .environment(\.timeZone, StagesDate.utc)
    }

    @ViewBuilder
    private func datePicker(_ title: String, _ value: IsoDate, _ range: ClosedRange<Date>?,
                            _ write: @escaping (IsoDate) -> Void) -> some View {
        let binding = Binding<Date>(
            get: { StagesDate.date(value) ?? Date() },
            set: { write(StagesDate.iso($0)) }
        )
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(Brand.mono(9, weight: .medium))
                .kerning(1)
                .foregroundStyle(palette.faint)
            if let range {
                DatePicker(title, selection: binding, in: range, displayedComponents: .date)
                    .labelsHidden()
            } else {
                DatePicker(title, selection: binding, displayedComponents: .date)
                    .labelsHidden()
            }
        }
    }

    private func line(_ trip: TripDoc, _ stage: TripStage) -> some View {
        let said = stageCardLine(trip, stage)
        return Text(said.text)
            .font(Brand.mono(11))
            .foregroundStyle(said.problem ? palette.danger : palette.faint)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - writes

    private func edit(_ stage: TripStage, _ change: (inout TripStage) -> Void) {
        // Always from the trip as it now stands: a binding's closure may hold
        // the leg from an older render.
        let current = store.trip(tripId)?.stages.first { $0.id == stage.id } ?? stage
        var next = current
        change(&next)
        StagesEdit.write(store, tripId, stage: next)
    }

    private func delete(_ stage: TripStage) {
        guard let trip = store.trip(tripId) else { return }
        StagesEdit.write(store, tripId, trip.stages.filter { $0.id != stage.id })
        store.sealHistory()
        confirming = false
        selection.stageId = nil
    }
}

#Preview("Stage card") {
    StagesPreviewHost { store, selection in
        StageCardView(store: store, tripId: StagesFixtures.trip.id,
                      stageId: StagesFixtures.trip.stages[0].id, selection: selection, onAdjust: {})
            .padding(16)
    }
}
