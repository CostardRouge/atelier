// The overview's state and its writes — the logic of the web's
// `TripOverview.tsx` that is not layout: what is selected, which leg is open,
// which month is on screen, the leg being adjusted on the calendar, and every
// edit the screen makes, each going out through `TripsStore.change` (the one
// funnel, so it saves, marks a remote trip dirty and is one undo step).
//
// Rules kept (`roadtrip.md`, `docs/roadtrip-overview-mobile.md` §8):
// - The DAY lives in the route: the selection is written back to it, so
//   coming back from a piece lands on the day you were on.
// - The leg open follows every day clicked that a leg covers — the calendar
//   is the other way into a stage — while a click on an uncovered day leaves
//   it as it was. Opening a leg says WHICH leg rather than deriving one from
//   its first day: on a travel day two legs overlap and `stageAt` answers
//   with the later one.
// - A new piece is ONE gesture: the look the trip last gave that kind, no
//   name yet (it is named in the editor), no picture written onto it — and
//   it opens straight away.
// - A leg ADJUSTED on the calendar is a DRAFT of its dates, written to the
//   trip on Done and dropped on Cancel (the garage's rule for a modal edit);
//   the kernel's `resizeStage` keeps it inside the trip and never reversed.
// - Rungs or Pictures is ONE toggle, remembered by the device
//   (`atelier.roadtrip.calendar.view`, the web's key) and never on the
//   document — the gallery's Cards / Bands rule.
// - Every arithmetic is the kernel's: `tripCoverage`, `tripBlocks`,
//   `stageAt`, `stageDayNumber`, `dayStageActions`, `resizeStage`,
//   `nearerEdge`; the dates sheet's answer is `TripsStore.saveDetails`.

import Foundation
import Observation
import AtelierKit

/// How the calendar draws a day.
enum CalendarViewMode: String {
    /// Each day as its rung: nothing, drafted, published once, twice, more.
    case rungs
    /// Each told day as the hook of its piece.
    case pictures

    static let storageKey = "atelier.roadtrip.calendar.view"
}

/// The leg a day belongs to, as the calendar, the strip and the card name it
/// — the web's `DayStage`.
struct OverviewDayStage: Equatable {
    /// `stageLabel` — empty for a leg that names nothing, never invented.
    var label: String
    /// The leg's index in the trip's stages, for its tint.
    var index: Int
    /// Where the day sits inside the leg, 1-based: "day 2/3".
    var day: Int
    var total: Int

    /// "Kalbarri · day 2/3", or "day 2/3" for a leg that names nothing.
    var line: String {
        let where_ = "day \(day)/\(total)"
        return label.isEmpty ? where_ : "\(label) · \(where_)"
    }
}

/// A leg being adjusted on the calendar: its id and the draft of its dates.
struct AdjustDraft: Equatable {
    var id: String
    var draft: TripStage
}

/// What one trip's overview derives from the document, built once per version
/// of it.
struct OverviewDerived {
    let trip: TripDoc
    let coverage: TripCoverage
    let byDate: [IsoDate: DayCell]
    /// Each day's leg — the LAST covering stage wins, as `stageAt` resolves it.
    let dayStages: [IsoDate: OverviewDayStage]
    let blocks: [MonthBlock]
    /// A short trip is ONE block of its weeks, and has no year map.
    let short: Bool

    init(_ trip: TripDoc) {
        self.trip = trip
        let coverage = tripCoverage(trip)
        self.coverage = coverage
        var byDate: [IsoDate: DayCell] = [:]
        for day in coverage.days { byDate[day.date] = day }
        self.byDate = byDate
        var stages: [IsoDate: OverviewDayStage] = [:]
        for (index, stage) in trip.stages.enumerated() {
            let label = stageLabel(stage)
            for day in enumerateDays(stage.startDate, stage.endDate) {
                guard isWithin(trip.startDate, trip.endDate, day),
                      let at = stageDayNumber(stage, day) else { continue }
                stages[day] = OverviewDayStage(label: label, index: index, day: at.day, total: at.total)
            }
        }
        self.dayStages = stages
        let blocks = tripBlocks(trip.startDate, trip.endDate)
        self.blocks = blocks
        self.short = blocks.count == 1 && blocks[0].key == "weeks"
    }

    /// The day's leg card line, when a leg covers it.
    func stage(_ date: IsoDate) -> OverviewDayStage? { dayStages[date] }

    /// Pieces not yet out.
    var drafted: Int { coverage.posts - coverage.publishedPosts }
}

@MainActor
@Observable
final class TripOverviewModel {
    let store: TripsStore
    let tripId: String

    /// The day, the leg and the span on screen — shared with the stages.
    var selection: TripSelection
    private(set) var viewMode: CalendarViewMode
    /// The leg whose dates are being dragged on the calendar (a phone).
    var adjusting: AdjustDraft?
    /// The block on screen (`YYYY-MM`, or `weeks` for a short trip).
    private(set) var visibleKey: String?

    // The sheets.
    var datesOpen = false
    var dayOpen = false
    var legsOpen = false

    @ObservationIgnored private var cached: OverviewDerived?

    init(store: TripsStore, tripId: String, day: IsoDate?) {
        self.store = store
        self.tripId = tripId
        let trip = store.trip(tripId)
        let first = day ?? trip?.startDate
        let leg = first.flatMap { date in trip.flatMap { stageAt($0, date)?.id } }
        selection = TripSelection(day: first, stageId: leg, spanFrom: nil, spanTo: nil)
        let saved = UserDefaults.standard.string(forKey: CalendarViewMode.storageKey)
        viewMode = saved == CalendarViewMode.pictures.rawValue ? .pictures : .rungs
    }

    /// The trip as it is now — the open one when it is this one.
    var trip: TripDoc? { store.trip(tripId) }

    /// What the screen derives from `trip`, rebuilt only when it changed.
    func derived(_ trip: TripDoc) -> OverviewDerived {
        if let cached, cached.trip == trip { return cached }
        let next = OverviewDerived(trip)
        cached = next
        return next
    }

    /// The day shown: the route's, else the trip's first.
    func selectedDay(_ trip: TripDoc) -> IsoDate? {
        guard let day = selection.day, isWithin(trip.startDate, trip.endDate, day) else {
            return enumerateDays(trip.startDate, trip.endDate).first
        }
        return day
    }

    /// The open leg, when it still exists.
    func openLegId(_ trip: TripDoc) -> String? {
        guard let id = selection.stageId, trip.stages.contains(where: { $0.id == id }) else { return nil }
        return id
    }

    /// Rungs or Pictures, remembered by this device.
    func setViewMode(_ mode: CalendarViewMode) {
        guard mode != viewMode else { return }
        viewMode = mode
        UserDefaults.standard.set(mode.rawValue, forKey: CalendarViewMode.storageKey)
    }

    // MARK: - selecting

    /// A day tapped on the calendar: selected, and its leg opened when one covers it.
    func selectDate(_ date: IsoDate) {
        selection.day = date
        if let trip, let covering = stageAt(trip, date) { selection.stageId = covering.id }
    }

    /// A leg opened by its ribbon on a wide screen: the leg, on its first day.
    func openStage(_ id: String) {
        guard let stage = trip?.stages.first(where: { $0.id == id }) else { return }
        selection.stageId = stage.id
        selection.day = stage.startDate
    }

    /// A leg opened on a phone: marked, and the legs sheet raised.
    func openLegSheet(_ id: String) {
        selection.stageId = id
        legsOpen = true
    }

    /// The block on screen moved: the Pictures window and the stages' span follow.
    func setVisible(_ key: String) {
        guard key != visibleKey else { return }
        visibleKey = key
        guard let trip else { return }
        let span = spanOnScreen(key, trip)
        selection.spanFrom = span?.from
        selection.spanTo = span?.to
    }

    /// The month on screen and its two neighbours, clamped to the trip — the
    /// ruler's detail on a wide screen. Nil for a short trip's one block.
    func spanOnScreen(_ key: String, _ trip: TripDoc) -> (from: IsoDate, to: IsoDate)? {
        guard let parsed = OverviewMonths.parse(key) else { return nil }
        let (year, month) = parsed
        let first = OverviewMonths.start(year, month - 1)
        guard let end = addDays(OverviewMonths.start(year, month + 2), -1) else { return nil }
        let from = first < trip.startDate ? trip.startDate : first
        let to = end > trip.endDate ? trip.endDate : end
        return (from, to)
    }

    /// The pieces whose hooks the Pictures view reads: the month on screen and
    /// its two neighbours, never the whole trip's.
    func windowPosts(_ trip: TripDoc) -> [TripPost] {
        guard viewMode == .pictures, let key = visibleKey else { return [] }
        if key == "weeks" { return trip.posts }
        guard let parsed = OverviewMonths.parse(key) else { return [] }
        let ordinal = parsed.0 * 12 + (parsed.1 - 1)
        return trip.posts.filter { post in
            guard let f = isoDateFields(post.date) else { return false }
            return abs(f.year * 12 + (f.month - 1) - ordinal) <= 1
        }
    }

    // MARK: - writing

    private func write(_ edit: (inout TripDoc) -> Void) {
        guard var doc = trip else { return }
        edit(&doc)
        doc.updatedAt = nowMillis()
        store.change(doc, label: "trip")
    }

    /// The trip renamed in place; an emptied name gives the old one back.
    func rename(_ name: String) {
        let next = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !next.isEmpty, next != trip?.name else { return }
        write { $0.name = next }
    }

    func setStages(_ stages: [TripStage]) {
        write { $0.stages = stages }
    }

    /// Start a piece on `date` and hand it back to be opened.
    func startPiece(_ kind: PostKind, on date: IsoDate) -> TripPost? {
        guard let trip else { return nil }
        let post = createTripPost(kind, date, "", defaults: trip.hookDefaults[kind])
        write { $0.posts.append(post) }
        store.sealHistory()
        return post
    }

    /// A copy of a piece on its own day.
    func duplicate(_ post: TripPost) {
        let copy = duplicateTripPost(post)
        write { $0.posts.append(copy) }
    }

    /// Mark published / back to draft.
    func togglePublished(_ post: TripPost) {
        var next = post
        next.publishedAt = post.publishedAt == nil ? nowMillis() : nil
        store.updatePost(next)
    }

    /// Delete a piece, and its hook with it.
    func delete(_ postId: String) {
        store.deletePost(postId)
    }

    /// A stage action from a day's menu: written, and the leg it touched opened.
    func apply(_ action: DayStageAction) {
        guard let trip else { return }
        let result = action.apply(trip)
        setStages(result.stages)
        selection.stageId = result.selectedId
    }

    /// The dates sheet's answer (`TripsStore.saveDetails`: the span, its legs
    /// brought inside it, the cover). The open day follows when it left the
    /// trip: the route says where you are, and the calendar no longer draws it.
    func saveDetails(_ details: TripDetails) {
        datesOpen = false
        guard let next = store.saveDetails(details) else { return }
        if let day = selection.day, !isWithin(next.startDate, next.endDate, day) {
            selection.day = next.startDate
        }
    }

    // MARK: - adjusting a leg on the calendar

    /// Enter the mode for leg `id`: the sheets drop, the leg is opened.
    func startAdjust(_ id: String) {
        guard let stage = trip?.stages.first(where: { $0.id == id }) else { return }
        legsOpen = false
        dayOpen = false
        selection.stageId = id
        adjusting = AdjustDraft(id: id, draft: stage)
    }

    /// An edge of the draft moved to `date` — by a grip, a tap or a stepper.
    func moveEdge(_ edge: StageEdge, to date: IsoDate) {
        guard let trip, var current = adjusting else { return }
        let next = resizeStage(trip, current.draft, edge, date)
        guard next != current.draft else { return }
        current.draft = next
        adjusting = current
    }

    /// A day tapped while adjusting: the nearer edge moves there.
    func tapWhileAdjusting(_ date: IsoDate) {
        guard let current = adjusting else { return }
        moveEdge(nearerEdge(current.draft, date), to: date)
    }

    /// Done writes the draft; Cancel drops it.
    func finishAdjust(keep: Bool) {
        guard let current = adjusting else { return }
        adjusting = nil
        guard keep, let trip else { return }
        setStages(trip.stages.map { $0.id == current.id ? current.draft : $0 })
        store.sealHistory()
    }

    /// The trip as the calendar draws it: the DRAFT where the trip holds the
    /// adjusted leg.
    func shown(_ trip: TripDoc) -> TripDoc {
        guard let current = adjusting else { return trip }
        var shown = trip
        shown.stages = trip.stages.map { $0.id == current.id ? current.draft : $0 }
        return shown
    }
}

/// A `YYYY-MM` block key read back, and the first day of a month by number —
/// months past December or before January roll the year.
enum OverviewMonths {
    /// (year, month 1…12), or nil for `weeks` and anything else.
    static func parse(_ key: String) -> (Int, Int)? {
        let parts = key.split(separator: "-")
        guard parts.count == 2, let year = Int(parts[0]), let month = Int(parts[1]),
              (1...12).contains(month) else { return nil }
        return (year, month)
    }

    /// `YYYY-MM-01` for month `month` (1-based, any integer) of `year`.
    static func start(_ year: Int, _ month: Int) -> IsoDate {
        let zero = month - 1
        let y = year + Int((Double(zero) / 12).rounded(.down))
        let m = ((zero % 12) + 12) % 12 + 1
        let yy = String(format: "%04d", y)
        let mm = String(format: "%02d", m)
        return "\(yy)-\(mm)-01"
    }
}
