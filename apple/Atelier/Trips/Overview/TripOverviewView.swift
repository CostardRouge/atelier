// The trip seen whole — the web's `TripOverview.tsx`: the counts, the calendar
// of its days, and whichever day is open. The calendar is the reason the
// screen exists: it answers "what have I never told" at a glance, which a
// year-old trip and thousands of photos make impossible to answer from memory.
//
// Two layouts over one model (`TripOverviewModel`):
// - a PHONE (`OverviewPhone`, `docs/roadtrip-overview-mobile.md` §8): the
//   name in the bar with `told/total` and the Rungs|Pictures icons, one mono
//   line, the calendar taking the column, the day strip above the bottom
//   bar pulling up into the day sheet, and the Stages and Trip cells on the
//   bottom bar opening sheets — the legs as a list, the dates;
// - a WIDE screen (`OverviewWide`): the heading as the summary, the year map
//   and the stages over the calendar's blocks side by side, the open day in a
//   right column above 1180 pt and under the calendar below it.
//
// The shell (`TripsTool`) pushes this by its contract, and owns what is
// around it: the task pill, the banners, the undo manager, the push on the
// way out. This screen writes the trip through `TripsStore.change` alone and
// keeps the open day in the route (`day`), so Back from a piece lands on it.

import SwiftUI
import AtelierKit

struct TripOverviewView: View {
    let store: TripsStore
    let tripId: String
    /// The open day, written back to the route so Back lands on it.
    @Binding var day: String?
    /// Opens a piece of this trip.
    var openPiece: (_ postId: String, _ day: String?) -> Void

    @State private var model: TripOverviewModel
    @State private var thumbs = OverviewThumbs()
    @Environment(\.palette) private var palette
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    init(store: TripsStore, tripId: String, day: Binding<String?>,
         openPiece: @escaping (_ postId: String, _ day: String?) -> Void) {
        self.store = store
        self.tripId = tripId
        _day = day
        self.openPiece = openPiece
        _model = State(initialValue: TripOverviewModel(store: store, tripId: tripId, day: day.wrappedValue))
    }

    private var compact: Bool {
        #if os(iOS)
        return sizeClass == .compact
        #else
        return false
        #endif
    }

    var body: some View {
        sheets(routed(published(screen)))
    }

    /// The open day, told to the shell: the Library's instance tab lists it —
    /// so a day's pictures can be looked at before a piece exists for it —
    /// and the sheet showing one of them large offers to start a piece on it.
    private func published(_ content: some View) -> some View {
        let trip = model.trip
        let selected = trip.flatMap { model.selectedDay($0) }
        return content
            .publishMediaScope(mediaScope(trip, selected))
            .publishMediaActions(mediaOffer(trip, selected))
    }

    /// The selected day as the Library's span. Nothing is waiting for a
    /// picture here — looking at the day's media is the point — so a click
    /// in the Library shows it large (`browse`).
    private func mediaScope(_ trip: TripDoc?, _ selected: IsoDate?) -> MediaScope? {
        guard let trip, let selected else { return nil }
        return MediaScope(from: selected, to: selected, label: formatIsoDate(selected), publisher: "Trips",
                          intent: .browse, within: ScopeWithin(from: trip.startDate, to: trip.endDate, label: trip.name))
    }

    /// The verbs offered under any picture looked at large: one tap makes the
    /// piece on the OPEN day (a piece is keyed by the day it tells, not by the
    /// file it shows) with the trip's look for that kind, and opens it; the
    /// active picture reaches its slide by the path that already exists.
    private func mediaOffer(_ trip: TripDoc?, _ selected: IsoDate?) -> MediaActions? {
        guard let trip, let selected else { return nil }
        let actions = OverviewActions(model: model, openPiece: openPiece)
        let verbs = postKinds.map { kind in
            MediaAction(id: kind.id.rawValue, label: kind.label, hint: "\(kind.hint) — from this picture") { _ in
                actions.start(kind.id, on: selected)
            }
        }
        return MediaActions(key: "trips-overview:\(trip.id):\(selected)",
                            heading: "start a piece on \(formatIsoDate(selected))",
                            actions: verbs)
    }

    @ViewBuilder
    private var screen: some View {
        if let trip = model.trip {
            let derived = model.derived(trip)
            let actions = OverviewActions(model: model, openPiece: openPiece)
            Group {
                if compact {
                    OverviewPhone(model: model, derived: derived, thumbs: thumbs, actions: actions)
                } else {
                    GeometryReader { box in
                        OverviewWide(model: model, derived: derived, thumbs: thumbs, actions: actions,
                                     width: box.size.width)
                    }
                }
            }
            .background(palette.paper)
            .navigationTitle(trip.name)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .onChange(of: ThumbRequest(ids: wantedThumbs(trip, derived), version: store.thumbsVersion),
                      initial: true) { _, request in
                thumbs.want(Set(request.ids), version: request.version, from: store.thumbs)
            }
        } else {
            ContentUnavailableView {
                Label("This trip is not here", systemImage: "map")
            } description: {
                Text("It was deleted, or moved while this screen was open. Go back to the trips.")
            }
            .background(palette.paper)
        }
    }

    /// The route's day and the calendar's selection, kept one: a day selected
    /// here is written to the route; a day the route names from elsewhere is
    /// selected here. Opening the trip is the shell's (`TripsShell.open`);
    /// only a stack restored with NO trip open opens it from here.
    private func routed(_ content: some View) -> some View {
        content
            .onChange(of: model.selection.day) { _, next in
                if day != next { day = next }
            }
            .onChange(of: day) { _, next in
                if let next, next != model.selection.day { model.selectDate(next) }
            }
            .task {
                if store.open == nil, let doc = store.trip(tripId) {
                    await store.openTrip(doc)
                }
            }
    }

    /// The day sheet and the legs sheet (a phone), the dates sheet (every width).
    private func sheets(_ content: some View) -> some View {
        content
            .sheet(isPresented: $model.dayOpen) {
                OverviewDaySheet(model: model, thumbs: thumbs,
                                 actions: OverviewActions(model: model, openPiece: openPiece))
            }
            .sheet(isPresented: $model.legsOpen) {
                OverviewLegsSheet(model: model)
            }
            .sheet(isPresented: $model.datesOpen) {
                if let trip = model.trip {
                    TripDetailsSheet(trip: trip, store: store,
                                     onCancel: { model.datesOpen = false },
                                     onSubmit: { model.saveDetails($0) })
                }
            }
    }

    /// The hooks the screen draws: the open day's pieces, and in the Pictures
    /// view the month on screen and its neighbours.
    private func wantedThumbs(_ trip: TripDoc, _ derived: OverviewDerived) -> [String] {
        var ids = Set(model.windowPosts(trip).map(\.id))
        if let date = model.selectedDay(trip), let cell = derived.byDate[date] {
            for post in cell.posts { ids.insert(post.id) }
        }
        return ids.sorted()
    }
}

/// What the thumbnails are asked for — a change of either reads again.
private struct ThumbRequest: Equatable {
    var ids: [String]
    var version: Int
}

/// The verbs both layouts share: start a piece and open it, open a piece,
/// the day's menu.
struct OverviewActions {
    let model: TripOverviewModel
    let openPiece: (_ postId: String, _ day: String?) -> Void

    /// Start a piece of `kind` on `date` and open it straight away.
    @MainActor
    func start(_ kind: PostKind, on date: IsoDate) {
        guard let post = model.startPiece(kind, on: date) else { return }
        model.dayOpen = false
        openPiece(post.id, date)
    }

    /// Open a piece from the day on screen.
    @MainActor
    func open(_ post: TripPost) {
        model.dayOpen = false
        let day = model.trip.flatMap { model.selectedDay($0) } ?? post.date
        openPiece(post.id, day)
    }

    /// A long press (the Mac: a right-click) on a day: TELL it first — a piece
    /// started here lands on the day pressed, not on the day open, and opens
    /// straight away — then edit its leg, each item naming the real leg it
    /// would touch. While a leg is adjusted, the menu moves the draft's ends.
    @MainActor
    func menu(_ date: IsoDate, compact: Bool) -> [OverviewMenuSection] {
        guard let trip = model.trip else { return [] }
        if model.adjusting != nil {
            return [OverviewMenuSection(id: "adjust", title: "The leg being adjusted", items: [
                OverviewMenuItem(id: "start", label: "Arrived on this day") { model.moveEdge(.start, to: date) },
                OverviewMenuItem(id: "end", label: "Left on this day") { model.moveEdge(.end, to: date) },
            ])]
        }
        let tell = OverviewMenuSection(id: "tell", title: "Tell this day", items: postKinds.map { kind in
            OverviewMenuItem(id: kind.id.rawValue, label: kind.label) { start(kind.id, on: date) }
        })
        var stageItems = dayStageActions(trip, date).map { action in
            OverviewMenuItem(id: action.id.rawValue, label: action.label) { model.apply(action) }
        }
        // A phone has no ruler: the leg a day belongs to is also adjusted
        // from the day itself, on the calendar.
        if compact, let covering = stageAt(trip, date) {
            let label = stageLabel(covering)
            let name = label.isEmpty ? "this leg" : "“\(label)”"
            stageItems.append(OverviewMenuItem(id: "adjust", label: "Adjust \(name) on the calendar") {
                model.startAdjust(covering.id)
            })
        }
        guard !stageItems.isEmpty else { return [tell] }
        return [tell, OverviewMenuSection(id: "stage", title: "Stage", items: stageItems)]
    }

    /// What a told day shows in the Pictures view: the hook of a published
    /// piece first, else the first with a hook at all; nothing (its rung)
    /// while none is read.
    @MainActor
    func pictures(_ derived: OverviewDerived, _ images: [String: CGImage]) -> [IsoDate: OverviewDayPicture]? {
        guard model.viewMode == .pictures else { return nil }
        var out: [IsoDate: OverviewDayPicture] = [:]
        for day in derived.coverage.days where !day.posts.isEmpty {
            let pick = day.posts.first { $0.publishedAt != nil && images[$0.id] != nil }
                ?? day.posts.first { images[$0.id] != nil }
            guard let pick, let image = images[pick.id] else { continue }
            out[day.date] = OverviewDayPicture(image: image, count: day.posts.count, published: day.published > 0)
        }
        return out
    }
}

// MARK: - asking the overview to adjust a leg

/// The overview's verb for a leg's dates dragged on the calendar — handed to
/// the legs sheet through the environment, so the stages' own "Adjust on the
/// calendar" can reach the calendar that hosts it.
struct AdjustLegOnCalendarAction {
    let run: (_ stageId: String) -> Void
    func callAsFunction(_ stageId: String) { run(stageId) }
}

private struct AdjustLegOnCalendarKey: EnvironmentKey {
    static let defaultValue: AdjustLegOnCalendarAction? = nil
}

extension EnvironmentValues {
    /// Set by the overview on the legs sheet; nil anywhere else.
    var adjustLegOnCalendar: AdjustLegOnCalendarAction? {
        get { self[AdjustLegOnCalendarKey.self] }
        set { self[AdjustLegOnCalendarKey.self] = newValue }
    }
}

#Preview("Overview") {
    NavigationStack {
        TripOverviewView(store: TripOverviewFixtures.store(), tripId: TripOverviewFixtures.tripId,
                         day: .constant("2025-03-02"), openPiece: { _, _ in })
    }
}
