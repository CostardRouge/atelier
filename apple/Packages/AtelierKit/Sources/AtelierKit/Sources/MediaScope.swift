// What the active tool is working on, told to the shell — the value half of
// `src/shared/sources/media-scope.tsx` (`MediaScope`, `sameScope`,
// `isSingleDay`).
//
// The Library's instance tab lists what a connected source holds for a span
// of days — a Trips piece's day, a leg — but the Library belongs to the shell
// and a tool must never be reached into for its state (`architecture.md`,
// «The Library has two tabs»). So the tool PUBLISHES the span and the shell
// READS it. Deliberately a plain span of `YYYY-MM-DD` strings, not a tool's
// own date type: a generic seam must not take the shape of one tool. Whoever
// publishes owns the label, because only the publisher knows what the span
// means.
//
// Nothing here fetches anything. The publication itself (the web's React
// context, a SwiftUI environment object in the app) and the second thing the
// same seam carries — `MediaActions`, verbs holding closures — are the app's.

import Foundation

/// What a click on one of the source's tiles MEANS while a scope is open.
///
/// `pick` — something on screen is waiting for a picture (a piece's slide), so
/// a click fetches it and makes it active. `browse` — nothing is waiting, so a
/// click shows the picture large and the fetch becomes a button in there.
/// Absent reads as `browse`: nobody said anything is waiting.
public enum ScopeIntent: String, Equatable, Sendable, CaseIterable {
    case pick, browse
}

/// The wider span a scope belongs to, when there is one worth drawing — a
/// trip's two dates around a piece's day. Only a MARK: the Library shades it
/// in its month and lists nothing by it.
public struct ScopeWithin: Equatable, Sendable {
    public var from: String
    public var to: String
    public var label: String

    public init(from: String, to: String, label: String) {
        self.from = from; self.to = to; self.label = label
    }
}

public struct MediaScope: Equatable, Sendable {
    /// Inclusive calendar span, `YYYY-MM-DD` each.
    public var from: String
    public var to: String
    /// What to call it, as the publisher would: "12 Feb 2026".
    public var label: String
    /// Who is asking, for the Library to say — "Trips".
    public var publisher: String
    public var intent: ScopeIntent?
    public var within: ScopeWithin?

    public init(from: String, to: String, label: String, publisher: String,
                intent: ScopeIntent? = nil, within: ScopeWithin? = nil) {
        self.from = from; self.to = to; self.label = label; self.publisher = publisher
        self.intent = intent; self.within = within
    }

    /// The span as the scope override reads it.
    public var span: DaySpan { DaySpan(from: from, to: to) }
}

/// True when both name the same span with the same words — a missing intent
/// read as `browse`, so a publisher that never says one does not churn.
public func sameScope(_ a: MediaScope?, _ b: MediaScope?) -> Bool {
    guard let a, let b else { return a == nil && b == nil }
    let span = a.from == b.from && a.to == b.to
    let words = a.label == b.label && a.publisher == b.publisher
    let intent = (a.intent ?? .browse) == (b.intent ?? .browse)
    return span && words && intent && a.within == b.within
}

/// A single day is a span that starts where it ends.
public func isSingleDay(_ scope: MediaScope) -> Bool {
    scope.from == scope.to
}
