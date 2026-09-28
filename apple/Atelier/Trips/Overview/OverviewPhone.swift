// The overview on a phone — `docs/roadtrip-overview-mobile.md` §8, the web's
// compact branch of `TripOverview.tsx`: the calendar is the ONE day surface
// and takes the column.
//
// - The bar: back, the trip's name (renamed in place), `told/total`, the
//   Rungs | Pictures icons, the sync pill of a trip kept on an instance.
// - One mono line — what went out, what waits, the longest silence as a link
//   — or, while a leg is adjusted, the band naming it with Cancel and Done.
// - The calendar, a seventh of the width per day, one block per month.
// - Above the bottom bar: the day strip (a tap on a cell only SELECTS; the
//   strip pulls the day up), or the adjusted leg's two steppers.
// - The bottom bar holds the overview's own cells — Stages and Trip, sheets
//   both — and the undo pair, where a thumb reaches them.

import SwiftUI
import AtelierKit

struct OverviewPhone: View {
    @Bindable var model: TripOverviewModel
    let derived: OverviewDerived
    let thumbs: OverviewThumbs
    let actions: OverviewActions

    @Environment(\.palette) private var palette

    var body: some View {
        chrome(column)
    }

    private var column: some View {
        let trip = derived.trip
        let selected = model.selectedDay(trip)
        return VStack(spacing: 0) {
            topLine
                .padding(.horizontal, 12)
                .padding(.top, 6)
                .padding(.bottom, 4)
            MonthCalendarView(
                derived: derived,
                shown: model.shown(trip),
                selected: selected,
                selectedLegId: model.openLegId(trip),
                adjust: model.adjusting,
                pictures: actions.pictures(derived, thumbs.images),
                columns: 1,
                gutter: 8,
                onSelect: { date in
                    if model.adjusting != nil { model.tapWhileAdjusting(date) } else { model.selectDate(date) }
                },
                onOpenLeg: { id in model.openLegSheet(id) },
                onVisible: { key in model.setVisible(key) },
                menu: { date in actions.menu(date, compact: true) },
                onEdge: { edge, date in model.moveEdge(edge, to: date) },
                between: { EmptyView() },
                tail: { EmptyView() }
            )
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            bottom(selected)
        }
    }

    @ViewBuilder
    private var topLine: some View {
        if let adjust = model.adjusting {
            let index = derived.trip.stages.firstIndex { $0.id == adjust.id } ?? 0
            AdjustLegBand(draft: adjust.draft, index: index,
                          onCancel: { model.finishAdjust(keep: false) },
                          onDone: { model.finishAdjust(keep: true) })
        } else {
            OverviewPhoneLine(derived: derived, onSilence: { model.selectDate($0) })
        }
    }

    @ViewBuilder
    private func bottom(_ selected: IsoDate?) -> some View {
        if let adjust = model.adjusting {
            AdjustSteppers(draft: adjust.draft, onEdge: { edge, date in model.moveEdge(edge, to: date) })
        } else if let selected {
            DayStripView(date: selected, cell: derived.byDate[selected], stage: derived.stage(selected),
                         images: thumbs.images, onOpen: { model.dayOpen = true })
        }
    }

    /// The bar's items and the bottom bar's cells.
    private func chrome(_ content: some View) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .principal) {
                    TripNameField(name: derived.trip.name, size: 19, onRename: { model.rename($0) })
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    DocumentSyncPill(sync: model.store.sync)
                    toldPill
                    OverviewViewToggle(model: model, iconsOnly: true)
                }
                #if os(iOS)
                ToolbarItemGroup(placement: .bottomBar) {
                    cells
                }
                #endif
            }
    }

    private var toldPill: some View {
        let coverage = derived.coverage
        return (Text("\(coverage.toldDays)").foregroundStyle(palette.inkSoft)
            + Text("/\(coverage.totalDays)").foregroundStyle(palette.muted))
            .font(Brand.mono(12))
            .monospacedDigit()
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: Brand.controlRadius).fill(palette.paper2))
            .help("Days told, of the trip's days")
            .accessibilityLabel("\(coverage.toldDays) of \(coverage.totalDays) days told")
    }

    /// Stages and Trip, marked only while their sheet is up; then undo / redo.
    @ViewBuilder
    private var cells: some View {
        Button {
            model.legsOpen = true
        } label: {
            Label("Stages", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                .labelStyle(.titleAndIcon)
        }
        .disabled(model.adjusting != nil)
        Button {
            model.datesOpen = true
        } label: {
            Label("Trip", systemImage: "calendar")
                .labelStyle(.titleAndIcon)
        }
        .disabled(model.adjusting != nil)
        Spacer()
        Button {
            model.store.undo()
        } label: {
            Label("Undo", systemImage: "arrow.uturn.backward")
        }
        .disabled(!model.store.canUndo)
        Button {
            model.store.redo()
        } label: {
            Label("Redo", systemImage: "arrow.uturn.forward")
        }
        .disabled(!model.store.canRedo)
    }
}

/// Rungs or Pictures — ONE control for the whole trip, remembered by the
/// device: each day as its rung, or each told day as the hook of its piece.
struct OverviewViewToggle: View {
    @Bindable var model: TripOverviewModel
    /// The phone's bar draws the two icons alone.
    let iconsOnly: Bool

    var body: some View {
        Picker("How the days are drawn", selection: Binding(get: { model.viewMode },
                                                            set: { model.setViewMode($0) })) {
            option(.rungs, "Rungs", "square.grid.3x3")
                .help("Each day as its rung: nothing, drafted, published once, twice, more")
            option(.pictures, "Pictures", "photo")
                .help("Each told day as the hook of its piece")
        }
        .pickerStyle(.segmented)
        .fixedSize()
    }

    @ViewBuilder
    private func option(_ mode: CalendarViewMode, _ title: String, _ symbol: String) -> some View {
        if iconsOnly {
            Image(systemName: symbol)
                .accessibilityLabel(title)
                .tag(mode)
        } else {
            Label(title, systemImage: symbol)
                .tag(mode)
        }
    }
}

#Preview("Overview on a phone") {
    NavigationStack {
        TripOverviewView(store: TripOverviewFixtures.store(), tripId: TripOverviewFixtures.tripId,
                         day: .constant("2025-03-12"), openPiece: { _, _ in })
    }
    .frame(width: 390, height: 844)
}
