// What the Winnow BROWSER holds — the instance tab's "browse all" sheet, the
// native twin of the state and effects of the web's `WinnowBrowser.tsx`.
//
// Three ways in: **by day** (the month's calendar, a count per day), **by
// folder** (a Winnow session, one shoot as it was ingested) and **by leg**
// (a timeline chapter, when the instance serves one — asked for by its
// calendar days, since Winnow has no chapter filter). One row of filters
// narrows all three, and the counts agree: Winnow applies the same filters
// everywhere. Nothing is downloaded until the ticked rows are ADDED — the
// proxy by default, the original on request with its weight said first.
//
// Rules kept:
// - The PLACE is remembered per instance (view, filters, month, the open day,
//   folder or leg, the fidelity) under the web's key (`browseStateKey`, the
//   kernel's `readBrowseState` / `writeBrowseState`), so a trip picked over
//   several sittings reopens where it was left. The TICKS are not: a list
//   restored from days ago is a list nobody just looked at.
// - The first answer of a fresh view jumps to the newest month that holds
//   media — a view opening on an empty month reads as a broken source.
// - Each row is fetched as a TASK scoped to it (`TaskCenter.tracked`, named
//   as `materialize` names it, weighed by its `file_size` for an original),
//   and lands in the pool at once: a failure or a Cancel keeps what landed,
//   and says so.

import Foundation
import Observation
import AtelierKit

@MainActor
@Observable
final class WinnowBrowserModel {
    @ObservationIgnored let connection: WinnowConnection
    @ObservationIgnored let client: WinnowClient
    @ObservationIgnored let library: LibraryStore
    /// The instance serves a timeline (`hasTimeline`); an older one has no legs.
    let timelineOffered: Bool

    var view: BrowseView
    var filter: FilterQuery
    private(set) var facets: WinnowFacets?

    var month: String
    private(set) var calendar: WinnowCalendar?
    var day: String?

    private(set) var sessions: [WinnowSession]?
    var session: WinnowSession?
    /// The folder to reopen once the list arrives.
    @ObservationIgnored private var wantedSessionId: Int?

    private(set) var chapters: [WinnowChapter]?
    var chapter: WinnowChapter?
    /// The leg to reopen once the timeline arrives.
    @ObservationIgnored private var wantedChapterId: String?

    private(set) var rows: [WinnowAssetRow]?
    var checked: Set<Int> = []
    var fidelity: Fidelity
    private(set) var problem: BrowseProblem?
    /// `2/12 · DJI_0101.JPG` while adding.
    private(set) var progress: String?
    /// The row being fetched — its task's scope, for the sheet's own Cancel.
    private(set) var running: String?
    @ObservationIgnored private var landed: Bool

    init(connection: WinnowConnection, client: WinnowClient, library: LibraryStore, today: String? = nil) {
        self.connection = connection
        self.client = client
        self.library = library
        timelineOffered = hasTimeline(connection.capabilities)
        let remembered = readBrowseState(WinnowBrowserMemory.read(), sourceId: connection.id)
        let wanted = remembered?.view ?? .day
        view = wanted == .chapter && !timelineOffered ? .day : wanted
        filter = remembered?.filter ?? FilterQuery()
        month = remembered?.month ?? monthKeyOf(today ?? todayIso(Date(), in: .current))
        day = remembered?.day
        wantedSessionId = remembered?.sessionId
        wantedChapterId = remembered?.chapterId
        fidelity = remembered?.fidelity ?? .proxy
        landed = remembered != nil
    }

    var host: String { connection.id }

    // MARK: - what decides each answer (a `.task(id:)` re-asks when it moves)

    private var filterKey: String {
        [filter.mediaType?.rawValue, filter.ext, filter.device, filter.half?.rawValue].map { $0 ?? "" }.joined(separator: "|")
    }

    var calendarKey: String { view == .day ? "\(month)|\(filterKey)" : "off" }
    var sessionsKey: String { view == .session ? filterKey : "off" }
    var chaptersKey: String { view == .chapter && timelineOffered ? filterKey : "off" }

    var rowsKey: String {
        switch view {
        case .day: return "day|\(day ?? "")|\(filterKey)"
        case .session: return "session|\(session.map { String($0.id) } ?? "")|\(filterKey)"
        case .chapter: return "chapter|\(chapter?.id ?? "")|\(filterKey)"
        }
    }

    /// What is remembered, as one value to watch.
    var stateKey: String {
        let folder: Int = session?.id ?? wantedSessionId ?? -1
        let leg: String = chapter?.id ?? wantedChapterId ?? ""
        let parts: [String] = [view.rawValue, filterKey, month, day ?? "", String(folder), leg, fidelity.rawValue]
        return parts.joined(separator: "|")
    }

    // MARK: - reading the instance

    /// The filter values, once: the pickers offer what the library holds. A
    /// failure leaves them empty — filtering is a convenience.
    func loadFacets() async {
        guard facets == nil else { return }
        facets = try? await client.facets()
    }

    func loadCalendar() async {
        guard view == .day else { return }
        calendar = nil
        problem = nil
        let span = monthSpan(month)
        do {
            let answer = try await client.calendar(span.from, span.to, filter)
            if Task.isCancelled { return }
            if !landed {
                landed = true
                if let bounds = answer.bounds, answer.days.isEmpty {
                    let newest = monthKeyOf(bounds.max)
                    // Moving the month re-asks; staying on it keeps this answer.
                    if newest != month {
                        month = newest
                        return
                    }
                }
            }
            calendar = answer
        } catch {
            report(error)
        }
    }

    func loadSessions() async {
        guard view == .session else { return }
        sessions = nil
        problem = nil
        do {
            let list = try await client.sessions(filter)
            if Task.isCancelled { return }
            sessions = list
            if let wanted = wantedSessionId {
                session = list.first { $0.id == wanted }
                wantedSessionId = nil
            }
        } catch {
            report(error)
        }
    }

    func loadChapters() async {
        guard view == .chapter, timelineOffered else { return }
        chapters = nil
        problem = nil
        do {
            let list = try await client.timeline(filter)
            if Task.isCancelled { return }
            chapters = list
            if let wanted = wantedChapterId {
                chapter = list.first { $0.id == wanted }
                wantedChapterId = nil
            } else if let open = chapter?.id {
                // The same leg under the new filters, or let it go.
                chapter = list.first { $0.id == open }
            }
        } catch {
            report(error)
        }
    }

    /// The rows of whatever is chosen — a day, a folder or a leg — every page.
    func loadRows() async {
        let chosenDay = view == .day ? day : nil
        let chosenSession = view == .session ? session : nil
        let chosenChapter = view == .chapter ? chapter : nil
        rows = nil
        checked = []
        guard chosenDay != nil || chosenSession != nil || chosenChapter != nil else { return }
        let query: AssetQuery?
        if let chosenDay {
            query = AssetQuery(dateFrom: chosenDay, dateTo: chosenDay, filter: filter)
        } else if let chosenChapter {
            // An undated leg has no days to ask for: nothing, rather than the
            // whole library an unnarrowed query would list.
            query = chapterDays(chosenChapter).map { AssetQuery(dateFrom: $0.dateFrom, dateTo: $0.dateTo, filter: filter) }
        } else {
            query = AssetQuery(sessionId: chosenSession?.id, filter: filter)
        }
        guard let query else {
            rows = []
            return
        }
        do {
            let all = try await client.allAssets(query)
            if Task.isCancelled { return }
            rows = all
        } catch {
            report(error)
        }
    }

    private func report(_ error: Error) {
        if Task.isCancelled || error is CancellationError { return }
        problem = browseProblem(error, baseUrl: client.config.baseUrl, loginUrl: client.loginUrl())
    }

    /// Write the place down for next time.
    func remember() {
        let state = BrowseState(view: view, filter: filter, month: month, day: day,
                                sessionId: session?.id ?? wantedSessionId,
                                chapterId: chapter?.id ?? wantedChapterId, fidelity: fidelity)
        WinnowBrowserMemory.write(writeBrowseState(WinnowBrowserMemory.read(), sourceId: host, state: state))
    }

    // MARK: - what the sheet says

    /// The open day, folder or leg, by name — nil while nothing is chosen.
    var heading: String? {
        switch view {
        case .day: return day
        case .session: return session?.name
        case .chapter: return chapter.map(chapterLabel)
        }
    }

    /// The month picker spans what the library holds, and always the month on screen.
    var years: [YearOptions] {
        let span = monthSpan(month)
        let first = "\(month)-01"
        guard let bounds = calendar?.bounds else { return monthOptions(first, span.to) }
        return monthOptions(bounds.min < first ? bounds.min : first, bounds.max > span.to ? bounds.max : span.to)
    }

    var canPrevMonth: Bool { calendar?.bounds.map { month > monthKeyOf($0.min) } ?? true }
    var canNextMonth: Bool { calendar?.bounds.map { month < monthKeyOf($0.max) } ?? true }

    var picked: [WinnowAssetRow] { (rows ?? []).filter { checked.contains($0.id) } }

    /// What an original download weighs; a proxy's weight is not known before.
    var pickedBytes: Int {
        fidelity == .original ? picked.reduce(0) { $0 + ($1.fileSize ?? 0) } : 0
    }

    var legNoteShown: LegNote? {
        guard view == .chapter, let chapter, let rows else { return nil }
        return legNote(chapter, rows: rows.count)
    }

    func toggle(_ id: Int) {
        if checked.contains(id) { checked.remove(id) } else { checked.insert(id) }
    }

    func toggleAll() {
        let all = Set((rows ?? []).map(\.id))
        checked = checked == all ? [] : all
    }

    /// Back to the list on a phone, where one pane is on screen.
    func closeChosen() {
        switch view {
        case .day: day = nil
        case .session: session = nil
        case .chapter: chapter = nil
        }
    }

    // MARK: - bringing them across

    /// Fetch the ticked rows one by one into the pool. True when every one
    /// landed — the sheet then closes; a failure or a Cancel stops the run and
    /// keeps what arrived, said in the problem line.
    func add() async -> Bool {
        let rows = picked
        guard !rows.isEmpty, progress == nil else { return false }
        problem = nil
        let fidelity = self.fidelity
        let client = self.client
        let host = self.host
        var arrived = 0
        defer {
            progress = nil
            running = nil
        }
        for (i, row) in rows.enumerated() {
            progress = "\(i + 1)/\(rows.count) · \(row.filename)"
            let scope = "\(host)/\(row.id)"
            running = scope
            let weight: Int64? = fidelity == .original ? row.fileSize.map { Int64($0) } : nil
            do {
                let files = try await TaskCenter.tracked(materializeTaskLabel(row, fidelity), scope: scope, bytes: weight) {
                    try await materialize(client, host, row, fidelity: fidelity, now: nowMillis())
                }
                library.addFetched(files)
                arrived += 1
            } catch is CancellationError {
                problem = BrowseProblem(text: "Stopped — \(arrived) of \(rows.count) added; what arrived stays in the library.")
                return false
            } catch {
                let said = browseProblem(error, baseUrl: client.config.baseUrl, loginUrl: client.loginUrl())
                let kept = arrived > 0 ? " \(arrived) of \(rows.count) arrived and stay in the library." : ""
                problem = BrowseProblem(text: said.text + kept, login: said.login)
                return false
            }
        }
        return true
    }
}

/// Where the browser's places are kept: one JSON object under the web's key,
/// every instance's place in it.
enum WinnowBrowserMemory {
    static func read() -> JSONValue? {
        UserDefaults.standard.string(forKey: browseStateKey).flatMap { JSONValue.parse($0) }
    }

    static func write(_ value: JSONValue) {
        UserDefaults.standard.set(value.serialized(), forKey: browseStateKey)
    }

    /// A connection removed takes its place with it (the web's
    /// `forgetBrowseState`, called where a connection is forgotten).
    static func forget(_ sourceId: String) {
        guard let next = forgetBrowseState(read(), sourceId: sourceId) else { return }
        write(next)
    }
}
