// Where you were looking in a source's browser, remembered per instance —
// port of `src/shared/sources/winnow/browse-state.ts`.
//
// Adding media is not one act: a trip is picked over several sittings, a day
// at a time, under the same narrowing. What is remembered is the PLACE —
// view, filters, month, the open day or folder — and the fidelity, a
// preference. What is deliberately NOT remembered is the **selection**: "Add
// 12 to library" downloads gigabytes, and a tick list restored from days ago
// is a list nobody just looked at.
//
// The web keeps every instance's place in ONE `localStorage` entry
// (`browseStateKey`), a JSON object keyed by source id. The storage is the
// app's (`UserDefaults`, a file); what is here is reading that object back,
// guarded, and the object a write or a forget leaves behind — so a failed or
// absent store degrades to "start fresh", which is exactly the web's.

import Foundation

public enum BrowseView: String, Equatable, Sendable, CaseIterable {
    case day, session, chapter
}

public struct BrowseState: Equatable, Sendable {
    public var view: BrowseView
    public var filter: FilterQuery
    /// `YYYY-MM`.
    public var month: String
    /// The open day, `YYYY-MM-DD`, or nil.
    public var day: String?
    /// The open folder's Winnow session id, or nil.
    public var sessionId: Int?
    /// The open timeline chapter's id, or nil.
    public var chapterId: String?
    public var fidelity: Fidelity

    public init(view: BrowseView = .day, filter: FilterQuery = FilterQuery(), month: String, day: String? = nil,
                sessionId: Int? = nil, chapterId: String? = nil, fidelity: Fidelity = .proxy) {
        self.view = view; self.filter = filter; self.month = month; self.day = day
        self.sessionId = sessionId; self.chapterId = chapterId; self.fidelity = fidelity
    }

    /// The place as the web writes it — `JSON.stringify(state)`: the filter
    /// carries only the keys it has, the open things are `null` when closed.
    public var json: JSONValue {
        var f: [String: JSONValue] = [:]
        if let t = filter.mediaType { f["mediaType"] = .string(t.rawValue) }
        if let e = filter.ext { f["ext"] = .string(e) }
        if let d = filter.device { f["device"] = .string(d) }
        if let h = filter.half { f["half"] = .string(h.rawValue) }
        return .object([
            "view": .string(view.rawValue),
            "filter": .object(f),
            "month": .string(month),
            "day": day.map { .string($0) } ?? .null,
            "sessionId": sessionId.map { .number(Double($0)) } ?? .null,
            "chapterId": chapterId.map { .string($0) } ?? .null,
            "fidelity": .string(fidelity.rawValue),
        ])
    }
}

/// The storage key the web keeps every instance's place under.
public let browseStateKey = "atelier.sources.winnow.browse.v1"

/// `^\d{4}-\d{2}$` / `^\d{4}-\d{2}-\d{2}$`.
private func matchesDigits(_ text: String, _ pattern: [Int]) -> Bool {
    let b = Array(text.utf8)
    let length = pattern.reduce(0, +) + pattern.count - 1
    guard b.count == length else { return false }
    var i = 0
    for (k, run) in pattern.enumerated() {
        if k > 0 {
            guard b[i] == UInt8(ascii: "-") else { return false }
            i += 1
        }
        for _ in 0..<run {
            guard b[i] >= 48, b[i] <= 57 else { return false }
            i += 1
        }
    }
    return true
}

/// One instance's place, read back out of the stored object — rejecting
/// anything that is not the shape written. A stored month of "banana" would
/// build a calendar of nothing, so this is a guard, not a formality; a
/// malformed day or filter value is dropped without losing the rest.
public func readBrowseState(_ store: JSONValue?, sourceId: String) -> BrowseState? {
    guard let s = store?.objectValue?[sourceId]?.objectValue,
          let month = s["month"]?.stringValue, matchesDigits(month, [4, 2]) else { return nil }
    let f = s["filter"]?.objectValue ?? [:]
    var filter = FilterQuery()
    if let t = f["mediaType"]?.stringValue, let type = WinnowMediaType(rawValue: t) { filter.mediaType = type }
    filter.ext = winnowText(f["ext"])
    filter.device = winnowText(f["device"])
    filter.half = f["half"]?.stringValue.flatMap(LibraryHalf.init(rawValue:))
    let viewText = s["view"]?.stringValue
    let view: BrowseView = viewText == "session" ? .session : viewText == "chapter" ? .chapter : .day
    let day = s["day"]?.stringValue.flatMap { matchesDigits($0, [4, 2, 2]) ? $0 : nil }
    return BrowseState(
        view: view,
        filter: filter,
        month: month,
        day: day,
        sessionId: winnowInt(s["sessionId"]),
        chapterId: winnowText(s["chapterId"]),
        fidelity: s["fidelity"]?.stringValue == "original" ? .original : .proxy
    )
}

/// The stored object once this instance's place is written — over whatever
/// was unreadable, which is overwritten rather than kept.
public func writeBrowseState(_ store: JSONValue?, sourceId: String, state: BrowseState) -> JSONValue {
    var all = store?.objectValue ?? [:]
    all[sourceId] = state.json
    return .object(all)
}

/// The stored object without this instance's place — used when its connection
/// is removed — or nil when there was nothing readable to forget (leave the
/// store as it is).
public func forgetBrowseState(_ store: JSONValue?, sourceId: String) -> JSONValue? {
    guard var all = store?.objectValue else { return nil }
    all.removeValue(forKey: sourceId)
    return .object(all)
}
