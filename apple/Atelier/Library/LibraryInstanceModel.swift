// The Library's INSTANCE tab — a VIEW of what the connected Winnow holds for
// the span the active tool is on, never a pool of its own (`architecture.md`,
// «The Library has two tabs, and the instance's tab is a VIEW»; the
// maintainer's *"plus besoin de clean button"*). The native twin of the state
// `AssetSidebar.tsx` keeps for that tab and of `use-scope-rows.ts`,
// `use-pick.ts` and `use-neighbour-days.ts`.
//
// - The span is what a tool PUBLISHES (`MediaPublications`), else a day picked
//   here; the stepper's arrows look BESIDE the tool's day without moving it —
//   an override ANCHORED to what was published, dropped by itself when the
//   tool opens another day (the kernel's `scope-override`). Nothing of it is
//   remembered: a remembered override is the pile the tab exists to avoid.
// - The rows are asked LIVE (`allAssets`, capped at 400), re-asked when the
//   span or the half changes, never while the tab is closed. A new span
//   forgets the last answer first, so a day never shows another day's pictures.
// - `half` (All · Incoming · Gallery) is SENT to the instance, never applied
//   to the answer — the cap would truncate before a local filter could run —
//   and remembered (`atelier.library.winnow.half`), both halves by default.
// - A picture crosses one click at a time (`pick`): the PROXY by default,
//   its `.srt` alongside, vouched for with the original's hash and dated at
//   the capture (`materialize`), an ordinary pool asset from then on. A row
//   already in the pool is activated, never fetched twice. The fetch is a
//   TASK with a Cancel (`TaskCenter.tracked`), scoped to the row.
// - The lightbox's two edge cards name the nearest day WITH media each way
//   (`day-walk`): a 62-day window, then the rest of the way to the library's
//   bounds, in the same half as the tab.

import Foundation
import Observation
import AtelierKit

/// One line a person can act on, and the sign-in link when that is the answer.
struct RowsProblem: Equatable {
    var text: String
    var login: String?
}

@MainActor
@Observable
final class LibraryInstanceModel {
    @ObservationIgnored let library: LibraryStore
    @ObservationIgnored let connections: ConnectionStore

    /// What the active tool publishes — fed by the panel from the bus.
    var published: MediaScope?
    /// The day picked here when no tool says anything.
    private(set) var manualDay: String
    /// A day looked at beside the tool's own, anchored to it.
    private(set) var dayOverride: DayOverride?
    /// Which half of the instance's library — nil is both.
    private(set) var half: LibraryHalf?

    /// Nil while asking; `[]` for a span the instance holds nothing on.
    private(set) var rows: [WinnowAssetRow]?
    private(set) var problem: RowsProblem?
    /// The row being fetched right now.
    private(set) var fetching: Int?
    var pickProblem: RowsProblem?
    /// The nearest day with media each way, for the lightbox's edge cards.
    private(set) var before: NeighbourDay = .asking
    private(set) var after: NeighbourDay = .asking

    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var neighbourCache: [String: NeighbourDay] = [:]

    static let halfKey = "atelier.library.winnow.half"

    init(library: LibraryStore, connections: ConnectionStore, today: String? = nil) {
        self.library = library
        self.connections = connections
        manualDay = today ?? todayIso(Date(), in: .current)
        half = UserDefaults.standard.string(forKey: LibraryInstanceModel.halfKey).flatMap { LibraryHalf(rawValue: $0) }
    }

    // MARK: - the instance

    /// The FIRST connection — the one every media surface talks to until
    /// multi-instance is designed (`ConnectionStore.first`).
    var connection: WinnowConnection? { connections.first }
    var client: WinnowClient? { connections.firstClient }

    /// `"<host>/<id>"` → the Library asset it became.
    var inLibrary: [String: String] {
        guard let host = connection?.id else { return [:] }
        return library.inLibrary(host)
    }

    // MARK: - the span

    var viewed: ViewedSpan {
        viewedSpan(published?.span, dayOverride, manualDay)
    }

    var span: DaySpan {
        let v = viewed
        return DaySpan(from: v.from, to: v.to)
    }

    /// Look at one day: the tool's, another beside it, or one picked by hand.
    func goToDay(_ iso: String) {
        if let anchor = viewed.anchor {
            dayOverride = overrideTo(anchor, iso)
        } else {
            manualDay = iso
        }
    }

    /// Back to what the tool has open.
    func resetOverride() {
        dayOverride = nil
    }

    func setHalf(_ next: LibraryHalf?) {
        half = next
        UserDefaults.standard.set(next?.rawValue ?? "all", forKey: LibraryInstanceModel.halfKey)
    }

    // MARK: - the rows

    /// What decides the answer — a `.task(id:)` re-asks when it moves.
    func rowsKey(enabled: Bool) -> String {
        guard enabled, let host = connection?.id else { return "off" }
        let s = span
        return "\(host)|\(s.from)|\(s.to)|\(half?.rawValue ?? "all")|\(generation)"
    }

    /// Ask the instance for the span's media. Forgets the last answer first.
    func loadRows(enabled: Bool) async {
        rows = nil
        problem = nil
        guard enabled, let client, let host = connection?.id else { return }
        let s = span
        let query = AssetQuery(dateFrom: s.from, dateTo: s.to, filter: FilterQuery(half: half))
        do {
            let all = try await client.allAssets(query, cap: 400)
            if Task.isCancelled { return }
            rows = all
        } catch is CancellationError {
            return
        } catch {
            if Task.isCancelled { return }
            rows = []
            problem = describe(error, host: host, client: client)
        }
    }

    /// Ask again — after a sign-in, say.
    func reload() {
        pickProblem = nil
        generation += 1
    }

    private func describe(_ error: Error, host: String, client: WinnowClient) -> RowsProblem {
        if let winnow = error as? WinnowError, winnow.kind == .unauthenticated {
            return RowsProblem(text: "Not signed in to \(host).", login: client.loginUrl())
        }
        let said = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
        return RowsProblem(text: deviceWords(said), login: nil)
    }

    // MARK: - bringing one picture across

    /// Fetch this row into the pool — the proxy, its log alongside — or
    /// re-activate it when it is already there. The asset it landed on, or
    /// nil when nothing arrived: a verb chained onto a fetch must not run on
    /// one that failed.
    func pick(_ row: WinnowAssetRow) async -> String? {
        guard let client, let host = connection?.id else { return nil }
        if let have = inLibrary["\(host)/\(row.id)"] {
            library.activate(have)
            return have
        }
        guard fetching == nil else { return nil }
        fetching = row.id
        pickProblem = nil
        defer { fetching = nil }
        do {
            // A task scoped to the row — its tile and the lightbox draw it, the
            // pill's Cancel ends the transfer — named as the web's
            // `materialize` names it. The proxy's weight is not the row's
            // `file_size` (the original's), so the answer's length rules.
            let files = try await TaskCenter.tracked(materializeTaskLabel(row, .proxy), scope: "\(host)/\(row.id)") {
                try await materialize(client, host, row, fidelity: .proxy, now: nowMillis())
            }
            guard !files.isEmpty, let id = library.addFetched(files) else { return nil }
            library.activate(id)
            return id
        } catch is CancellationError {
            return nil
        } catch {
            pickProblem = describe(error, host: host, client: client)
            return nil
        }
    }

    // MARK: - the days beside

    func neighboursKey(enabled: Bool) -> String {
        guard enabled, let host = connection?.id else { return "off" }
        let s = span
        return "\(host)|\(s.from)|\(s.to)|\(half?.rawValue ?? "all")"
    }

    /// The nearest day with media before and after the span. Answers are
    /// kept while the lightbox is open and forgotten when it closes: counts
    /// move as the instance ingests.
    func loadNeighbours(enabled: Bool) async {
        before = .asking
        after = .asking
        guard enabled, let client else {
            neighbourCache = [:]
            return
        }
        let today = todayIso(Date(), in: .current)
        let here = span
        let filter = FilterQuery(half: half)
        async let earlier = walk(.before, here, filter, client, today)
        async let later = walk(.after, here, filter, client, today)
        let found = await (earlier, later)
        if Task.isCancelled { return }
        before = found.0
        after = found.1
    }

    private func walk(_ side: WalkSide, _ here: DaySpan, _ filter: FilterQuery, _ client: WinnowClient,
                      _ today: String) async -> NeighbourDay {
        let key = "\(side.rawValue)|\(here.from)|\(here.to)|\(filter.half?.rawValue ?? "all")"
        if let hit = neighbourCache[key] { return hit }
        guard let first = firstWindow(here, side, today) else { return .nothing }
        do {
            let calendar = try await client.calendar(first.from, first.to, filter)
            var found = nearestMediaDay(calendar.days.map { MediaDay(date: $0.date, count: $0.count) }, here, side)
            if found == nil, let rest = restWindow(first, side, calendar.bounds, today) {
                let more = try await client.calendar(rest.from, rest.to, filter)
                found = nearestMediaDay(more.days.map { MediaDay(date: $0.date, count: $0.count) }, here, side)
            }
            let answer: NeighbourDay = found.map { NeighbourDay.day(date: $0.date, count: $0.count) } ?? .nothing
            neighbourCache[key] = answer
            return answer
        } catch {
            return .failed
        }
    }

    func neighbour(_ side: WalkSide) -> NeighbourDay {
        side == .before ? before : after
    }
}
