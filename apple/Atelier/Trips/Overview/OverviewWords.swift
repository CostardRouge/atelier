// The sentences the overview says about a day, in one place so the cell's
// accessible name, the hover card and the strip cannot disagree — the web's
// `cellTitle` / `stageLine` (`DayHeatmap.tsx`) and the few plurals around them.

import Foundation
import AtelierKit

enum OverviewWords {
    /// `n thing` / `n things`.
    static func count(_ n: Int, _ one: String, _ many: String? = nil) -> String {
        "\(n) \(n == 1 ? one : (many ?? one + "s"))"
    }

    /// What a day is, read out: "14 Mar 2025 · day 12 · Kalbarri · day 2/3 —
    /// 1 published, 2 drafts", or "— nothing told yet".
    static func cellTitle(_ cell: DayCell, _ stage: OverviewDayStage?) -> String {
        let leg = stage.map { " · \($0.line)" } ?? ""
        let when = "\(formatIsoDate(cell.date)) · day \(cell.dayNumber)\(leg)"
        if cell.posts.isEmpty { return "\(when) — nothing told yet" }
        let drafts = cell.posts.count - cell.published
        var parts: [String] = []
        if cell.published > 0 { parts.append("\(cell.published) published") }
        if drafts > 0 { parts.append(count(drafts, "draft")) }
        return "\(when) — \(parts.joined(separator: ", "))"
    }

    /// "1 reel · 2 single photo" — the kinds a day holds, in the kinds' order.
    static func kinds(_ posts: [TripPost]) -> String {
        postKinds.compactMap { kind -> String? in
            let n = posts.filter { $0.kind == kind.id }.count
            return n > 0 ? "\(n) \(kind.label.lowercased())" : nil
        }
        .joined(separator: " · ")
    }

    /// The hover card's second line: "2 published · 1 draft", or "draft only".
    static func publishedLine(_ cell: DayCell) -> String {
        let drafts = cell.posts.count - cell.published
        let head = cell.published > 0 ? "\(cell.published) published" : "draft only"
        return drafts > 0 && cell.published > 0 ? "\(head) · \(drafts) draft" : head
    }

    /// A piece's kind, as its pill says it.
    static func kindLabel(_ kind: PostKind) -> String {
        postKinds.first { $0.id == kind }?.label ?? kind.rawValue
    }

    /// "published 12 Mar 2025" — the date the author marked it out.
    static func published(_ ms: Double) -> String {
        let date = Date(timeIntervalSince1970: ms / 1000)
        return "published " + date.formatted(.dateTime.day().month(.abbreviated).year())
    }

    /// "Mon 14 Mar 2025" — the strip's date.
    static func weekdayDate(_ date: IsoDate) -> String {
        guard let wd = weekdayIndex(date) else { return formatIsoDate(date) }
        return "\(tripWeekdays[wd]) \(formatIsoDate(date))"
    }
}
