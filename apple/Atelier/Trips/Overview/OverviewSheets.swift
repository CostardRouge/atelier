// The phone's two sheets over the overview — the web's `BottomSheet`s in the
// compact branch of `TripOverview.tsx`:
//
// - THE DAY, pulled up from the strip (never by a tap on a cell — the
//   calendar is what you sweep): titled `Day n / N` with the date as its
//   hint, resting at 62 % and 92 % of the screen, the day panel's sheet
//   variant inside — the leg as a row that opens the legs, the pieces, and
//   the three verbs that tell the day.
// - THE STAGES, from the bottom bar's Stages cell: the legs as a list (the
//   stages task's `LegsSheetView`), titled `Stages` with `n legs`, resting at
//   72 % and 92 %. The open leg can be ADJUSTED ON THE CALENDAR from here —
//   the phone's replacement for the ruler's drag: the sheet drops and the
//   leg's ends carry grips. The verb is also handed to the sheet's own
//   content through the environment (`adjustLegOnCalendar`).

import SwiftUI
import AtelierKit

struct OverviewDaySheet: View {
    @Bindable var model: TripOverviewModel
    let thumbs: OverviewThumbs
    let actions: OverviewActions
    @Environment(\.palette) private var palette

    var body: some View {
        content
            .presentationDetents([.fraction(0.62), .fraction(0.92)])
            .presentationDragIndicator(.visible)
            .presentationBackground(palette.surface)
    }

    @ViewBuilder
    private var content: some View {
        if let trip = model.trip, let date = model.selectedDay(trip) {
            let derived = model.derived(trip)
            let cell = derived.byDate[date]
            VStack(alignment: .leading, spacing: 0) {
                header(cell: cell, date: date, total: derived.coverage.totalDays)
                ScrollView {
                    DayPanelView(
                        trip: trip,
                        date: date,
                        cell: cell,
                        images: thumbs.images,
                        variant: .sheet,
                        onStart: { kind in actions.start(kind, on: date) },
                        onOpen: { post in actions.open(post) },
                        onDuplicate: { post in model.duplicate(post) },
                        onTogglePublished: { post in model.togglePublished(post) },
                        onDelete: { post in model.delete(post.id) },
                        onEditLeg: { id in
                            model.dayOpen = false
                            model.openLegSheet(id)
                        }
                    )
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
                }
            }
        }
    }

    private func header(cell: DayCell?, date: IsoDate, total: Int) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("Day \(cell.map { String($0.dayNumber) } ?? "—") / \(total)")
                .font(Brand.display(22))
                .foregroundStyle(palette.ink)
            Text(formatIsoDate(date))
                .font(Brand.mono(11))
                .foregroundStyle(palette.muted)
            Spacer(minLength: 0)
            Button("Done") { model.dayOpen = false }
                .buttonStyle(DevelopLinkButtonStyle())
        }
        .padding(.horizontal, 16)
        .padding(.top, 18)
        .padding(.bottom, 8)
    }
}

struct OverviewLegsSheet: View {
    @Bindable var model: TripOverviewModel
    @Environment(\.palette) private var palette

    var body: some View {
        NavigationStack {
            LegsSheetView(store: model.store, tripId: model.tripId, selection: $model.selection)
                .environment(\.adjustLegOnCalendar, AdjustLegOnCalendarAction { id in model.startAdjust(id) })
                .navigationTitle("Stages")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .principal) { title }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { model.legsOpen = false }
                    }
                }
        }
        .presentationDetents([.fraction(0.72), .fraction(0.92)])
        .presentationDragIndicator(.visible)
    }

    private var title: some View {
        let count = model.trip?.stages.count ?? 0
        return VStack(spacing: 1) {
            Text("Stages")
                .font(Brand.sans(15, weight: .semibold))
                .foregroundStyle(palette.ink)
            Text(OverviewWords.count(count, "leg"))
                .font(Brand.mono(10))
                .foregroundStyle(palette.muted)
        }
    }
}

#Preview("Day sheet") {
    let store = TripOverviewFixtures.store()
    let model = TripOverviewModel(store: store, tripId: TripOverviewFixtures.tripId, day: "2025-03-02")
    Color.clear
        .sheet(isPresented: .constant(true)) {
            OverviewDaySheet(model: model, thumbs: OverviewThumbs(),
                             actions: OverviewActions(model: model, openPiece: { _, _ in }))
        }
}
