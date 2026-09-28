// The words of the Winnow BROWSER — the Library instance tab's "browse all"
// sheet — port of what `src/app/WinnowBrowser.tsx` computes inline (its
// exported `chapterLabel`, its `chapterDates`, the folder and leg lines, the
// leg's note, the fidelity line, `explain`, and `materialize.ts`'s task label).
//
// The component has no spec of its own; `BrowseWordsTests` pins these lines.
// They are pure — a chapter, a session, a count in, a sentence out — so they
// live here rather than in the sheet that draws them.

import Foundation

/// What a chapter is called in the list: its title, else its route, else its id.
public func chapterLabel(_ chapter: WinnowChapter) -> String {
    let title = chapter.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !title.isEmpty { return title }
    let names = chapter.places.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    guard let first = names.first, let last = names.last else { return "chapter \(chapter.id)" }
    return first == last ? first : "\(first) \(placeArrow) \(last)"
}

/// A chapter's places, in order, as its tooltip names them — empty for none.
public func chapterRoute(_ chapter: WinnowChapter) -> String {
    chapter.places.map(\.name).filter { !$0.isEmpty }.joined(separator: " \(placeArrow) ")
}

/// The web's `shortDate`: the day of an instant, or `—`.
private func browseDay(_ iso: String?) -> String {
    guard let iso, !iso.isEmpty else { return "—" }
    return String(iso.prefix(10))
}

/// JavaScript's `${n}`: an integer-valued number prints without `.0`.
private func browseNumber(_ x: Double) -> String {
    if x.isFinite, x == x.rounded(), abs(x) < 1e15 { return String(Int64(x)) }
    return "\(x)"
}

/// `2025-11-05 → 2025-11-08 · 42 media · 3 ▶` — a leg's line in the list: its
/// two days (one when it spans one, `—` when it is undated), its count, its clips.
public func chapterFactsLine(_ chapter: WinnowChapter) -> String {
    let dates: String
    if let start = chapter.startDate, !start.isEmpty, let end = chapter.endDate, !end.isEmpty, start != end {
        dates = "\(browseDay(start)) → \(browseDay(end))"
    } else {
        dates = browseDay(chapter.startDate ?? chapter.endDate)
    }
    let clips = (chapter.videoCount ?? 0) > 0 ? " · \(chapter.videoCount ?? 0) ▶" : ""
    return "\(dates) · \(chapter.assetCount) media\(clips)"
}

/// `2025-11-05 → 2025-11-06 · 120 media · FC8482` — a folder's line: the day it
/// was shot, the last one when it differs, its count, the device it hints at.
public func sessionFactsLine(_ session: WinnowSession) -> String {
    let first = browseDay(session.capturedAtMin)
    var line = first
    if let last = session.capturedAtMax, !last.isEmpty, String(last.prefix(10)) != first {
        line += " → \(browseDay(last))"
    }
    line += " · \(session.assetCount) media"
    if let device = session.deviceHint, !device.isEmpty { line += " · \(device)" }
    return line
}

/// What a leg's rows really are, said beside them. Winnow serves no chapter
/// filter, so the rows are its calendar DAYS — on a travel day shared with the
/// next leg, both legs' media carry the same date.
public struct LegNote: Equatable, Sendable {
    /// The line.
    public var text: String
    /// Its explanation, on hover.
    public var why: String

    public init(text: String, why: String) { self.text = text; self.why = why }
}

/// The note under a leg's rows once `rows` of them are listed.
public func legNote(_ chapter: WinnowChapter, rows: Int) -> LegNote {
    let zone: String
    if let hours = chapter.tzOffsetHours {
        zone = "days as lived · UTC\(hours >= 0 ? "+" : "")\(browseNumber(hours))"
    } else {
        zone = "days read at UTC — nothing in this leg carries a position"
    }
    if rows == chapter.assetCount { return LegNote(text: zone, why: zone) }
    return LegNote(
        text: "the leg holds \(chapter.assetCount) · \(zone)",
        why: "This instance filters by calendar day, not by leg, so a day this leg shares with its neighbour brings that leg's media too."
    )
}

/// The line beside `proxies · originals`: what bringing them costs.
public func browseFidelityLine(_ fidelity: Fidelity, picked: Int, bytes: Int) -> String {
    if fidelity == .proxy { return "proxies are what you edit on; exports can fetch originals later" }
    return picked > 0 ? "\(formatBytes(bytes)) to download" : "full-size files"
}

/// One line a person can act on, for whatever the client threw — the web's
/// `explain`, with the sign-in link when that is the answer.
public struct BrowseProblem: Equatable, Sendable {
    public var text: String
    public var login: String?

    public init(text: String, login: String? = nil) { self.text = text; self.login = login }
}

public func browseProblem(_ error: Error, baseUrl: String, loginUrl: String) -> BrowseProblem {
    if let winnow = error as? WinnowError {
        switch winnow.kind {
        case .unauthenticated:
            return BrowseProblem(text: "Not signed in to \(baseUrl).", login: loginUrl)
        case .notfound:
            // The timeline is the one route an instance can simply not have:
            // no capability announces it, so a 404 means "too old for legs".
            return BrowseProblem(text: "\(baseUrl) does not serve a timeline — it has no legs to read.")
        default:
            return BrowseProblem(text: winnow.message)
        }
    }
    return BrowseProblem(text: (error as? LocalizedError)?.errorDescription ?? String(describing: error))
}

/// The task a row's fetch is — `materialize.ts`'s label: the proxy is said,
/// the original is the file itself.
public func materializeTaskLabel(_ row: WinnowAssetRow, _ fidelity: Fidelity) -> String {
    "Fetching \(row.filename)\(fidelity == .proxy ? "’s proxy" : "")"
}
