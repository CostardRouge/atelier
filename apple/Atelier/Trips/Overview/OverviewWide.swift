// The overview on a wide screen — the web's B6 board (`TripOverview.tsx`,
// `docs/roadtrip-overview-mobile.md` §8.5): the same blocks as the phone,
// side by side — three to a row above 1180 pt, two below (as many as fit at a
// 34 pt cell) — the year map above them and the stages between, detailing
// the months the calendar shows (the loupe read from the scroll). The open
// day sits in a right column where there is room for one, under the
// calendar where there is not.
//
// The bar holds undo / redo (always both drawn), the sync pill, Rungs |
// Pictures, and Trip settings — the dates and the cover. The heading under it
// IS the summary: the name (renamed in place), the route and the dates (a
// click edits them), and the three figures.
//
// "Adjust on the calendar" is not offered here: the stages' ruler is, and its
// drag is kept.

import SwiftUI
import AtelierKit

struct OverviewWide: View {
    @Bindable var model: TripOverviewModel
    let derived: OverviewDerived
    let thumbs: OverviewThumbs
    let actions: OverviewActions
    let width: CGFloat

    @Environment(\.palette) private var palette

    /// The web's `expanded` layout.
    static let expandedWidth: CGFloat = 1180
    /// The right column's width (22 rem).
    static let asideWidth: CGFloat = 352

    var body: some View {
        chrome(column)
    }

    private var expanded: Bool { width >= Self.expandedWidth }

    private var column: some View {
        let trip = derived.trip
        let selected = model.selectedDay(trip)
        return VStack(alignment: .leading, spacing: 0) {
            OverviewHeading(derived: derived,
                            onRename: { model.rename($0) },
                            onEditDates: { model.datesOpen = true },
                            onSilence: { model.selectDate($0) })
                .padding(.horizontal, 20)
                .padding(.top, 8)
            HStack(alignment: .top, spacing: 20) {
                calendar(trip, selected)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                if expanded {
                    ScrollView {
                        dayPanel(selected)
                            .padding(.bottom, 16)
                    }
                    .frame(width: Self.asideWidth)
                    .accessibilityLabel("The open day")
                }
            }
            .padding(.leading, 16)
            .padding(.trailing, expanded ? 20 : 16)
        }
    }

    private func calendar(_ trip: TripDoc, _ selected: IsoDate?) -> some View {
        MonthCalendarView(
            derived: derived,
            shown: trip,
            selected: selected,
            selectedLegId: model.openLegId(trip),
            adjust: nil,
            pictures: actions.pictures(derived, thumbs.images),
            columns: expanded ? 3 : 2,
            gutter: 4,
            onSelect: { date in model.selectDate(date) },
            onOpenLeg: { id in model.openStage(id) },
            onVisible: { key in model.setVisible(key) },
            menu: { date in actions.menu(date, compact: false) },
            onEdge: { _, _ in },
            between: {
                StagesPanelView(store: model.store, tripId: model.tripId, selection: $model.selection)
                    .padding(.horizontal, 4)
                    .padding(.bottom, 12)
            },
            tail: {
                if !expanded {
                    dayPanel(selected)
                        .padding(.top, 16)
                }
            }
        )
    }

    @ViewBuilder
    private func dayPanel(_ selected: IsoDate?) -> some View {
        if let selected {
            DayPanelView(
                trip: derived.trip,
                date: selected,
                cell: derived.byDate[selected],
                images: thumbs.images,
                variant: .card,
                onStart: { kind in actions.start(kind, on: selected) },
                onOpen: { post in actions.open(post) },
                onDuplicate: { post in model.duplicate(post) },
                onTogglePublished: { post in model.togglePublished(post) },
                onDelete: { post in model.delete(post.id) }
            )
        }
    }

    private func chrome(_ content: some View) -> some View {
        content
            .toolbar {
                #if os(iOS)
                // The name is the heading's; the bar keeps it for Back alone.
                ToolbarItem(placement: .principal) {
                    Color.clear.frame(width: 1, height: 1)
                }
                #endif
                ToolbarItemGroup(placement: .primaryAction) {
                    ControlGroup {
                        Button {
                            model.store.undo()
                        } label: {
                            Label("Undo", systemImage: "arrow.uturn.backward")
                        }
                        .disabled(!model.store.canUndo)
                        .help("Undo (⌘Z)")
                        Button {
                            model.store.redo()
                        } label: {
                            Label("Redo", systemImage: "arrow.uturn.forward")
                        }
                        .disabled(!model.store.canRedo)
                        .help("Redo (⇧⌘Z)")
                    }
                    DocumentSyncPill(sync: model.store.sync)
                    OverviewViewToggle(model: model, iconsOnly: false)
                    Button {
                        model.datesOpen = true
                    } label: {
                        Label("Trip settings", systemImage: "gearshape")
                            .labelStyle(.titleAndIcon)
                    }
                    .help("The trip's dates, route and cover")
                }
            }
    }
}

#Preview("Overview, wide") {
    NavigationStack {
        TripOverviewView(store: TripOverviewFixtures.store(), tripId: TripOverviewFixtures.tripId,
                         day: .constant("2025-04-10"), openPiece: { _, _ in })
    }
    .frame(width: 1280, height: 820)
}
