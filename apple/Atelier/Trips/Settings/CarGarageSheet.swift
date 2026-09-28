// The garage as a sheet of its own, opened from a piece — port of
// `src/tools/roadtrip/CarGarageModal.tsx`: the Virée opener's panel says
// "Configure the car…" and this is where it lands, the car on its turntable
// at a size the inspector cannot give it.
//
// A DRAFT, unlike ⚙ Trip's Car pane, which writes on every switch: the sheet
// is opened while a map is being composed, and a car half-dressed behind a
// stage that redraws on every flag is a distraction — Done writes the trip
// ONCE (through `store.change`), Cancel, Escape and a swipe down leave it as
// it was, and Done on an unchanged car writes nothing. The panel inside is
// the same `CarGaragePanelView` as the Car pane, so the two homes cannot drift.

import SwiftUI
import AtelierKit

struct CarGarageSheet: View {
    let store: TripsStore
    let tripId: String

    @Environment(\.dismiss) private var dismiss
    /// The car as dressed here; nil until the first change (the trip's own car).
    @State private var draft: CarSpec?

    var body: some View {
        NavigationStack {
            Group {
                if let trip = store.trip(tripId) {
                    CarGaragePanelView(value: draft ?? trip.car, onChange: { draft = $0 })
                        .padding(.horizontal, 24)
                        .padding(.top, 16)
                        .toolbar { garageToolbar(trip) }
                } else {
                    TripSettingsAbsent(text: "This trip is not on this device any more, so there is no car to dress.")
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Close") { dismiss() }
                            }
                        }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                CarGarageFooter()
            }
            .navigationTitle("Garage")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .background(Palette.paper.surface)
        }
        .environment(\.palette, .paper)
        .tint(Palette.paper.accent)
        .modifier(TripSheetSizing(minWidth: 760, minHeight: 560))
    }

    @ToolbarContentBuilder
    private func garageToolbar(_ trip: TripDoc) -> some ToolbarContent {
        ToolbarItem(placement: .principal) {
            CarGarageTitle(trip: trip, car: draft ?? trip.car)
        }
        ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { dismiss() }
                .keyboardShortcut(.cancelAction)
        }
        ToolbarItem(placement: .confirmationAction) {
            Button("Done") { done(trip) }
                .keyboardShortcut(.defaultAction)
        }
    }

    /// The car as dressed, written once — or nothing, for a car unchanged.
    private func done(_ trip: TripDoc) {
        if let draft, !sameCarSpec(draft, trip.car) {
            var next = trip
            next.car = draft
            store.change(next, label: "trip:car")
        }
        dismiss()
    }
}

/// "Garage", the trip's name under it, the whole car in its tooltip.
private struct CarGarageTitle: View {
    let trip: TripDoc
    let car: CarSpec
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 1) {
            Text("Garage")
                .font(Brand.display(20))
                .foregroundStyle(palette.ink)
            Text(verbatim: trip.name)
                .font(Brand.mono(11))
                .foregroundStyle(palette.muted)
                .lineLimit(1)
        }
        .help(describeCar(car, carModel(car.model).name))
        .accessibilityElement(children: .combine)
    }
}

/// The sheet's one standing sentence.
private struct CarGarageFooter: View {
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 0) {
            Hairline()
            Text("Every Virée of this trip drives this car.")
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
        }
        .background(palette.surface)
    }
}

#Preview("Garage, from a piece") {
    Color.clear.sheet(isPresented: .constant(true)) {
        CarGarageSheet(store: TripSettingsFixtures.store(), tripId: TripSettingsFixtures.tripId)
    }
}
