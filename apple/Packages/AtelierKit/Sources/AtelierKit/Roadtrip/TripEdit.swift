// Editing a trip's SPAN after it was created — the one thing the creation
// sheet asks for and nothing could change afterwards. Port of
// `src/shared/roadtrip/trip-edit.ts`.
//
// It is load-bearing: the dates are what every badge counts from ("day 27 /
// 310"), so a typo in either was a trip to recreate. The SPAN is the ruler's
// own frame (`StageEdit.swift`), so a leg can never sit outside it: shrinking
// the trip TRIMS the legs it still covers and REMOVES the ones it no longer
// reaches. Posts are NEVER touched — a post is the author's work and its date
// is the key of the whole model; one left outside simply stops being drawn
// (`postDays` clamps), and the caller says so before saving (`spanImpact`)
// rather than deleting anything. The route is not edited here: a place is a
// leg's, and the legs are edited where they are drawn.
//
// Pure. `updatedAt` is the caller's, as everywhere else in this tool.

import Foundation

/// What moving the trip's dates would do to what is already in it. Shown
/// before saving: a trip told over a year must never lose a leg or hide a
/// piece without the author having read the sentence first.
public struct SpanImpact: Equatable, Sendable {
    /// Legs the new span still covers, but only partly — they will be trimmed.
    public var trimmedStages: Int
    /// Legs the new span does not reach at all — they will be removed.
    public var droppedStages: Int
    /// Pieces that would sit outside the trip. They are KEPT, just not drawn.
    public var strandedPosts: Int

    public init(trimmedStages: Int, droppedStages: Int, strandedPosts: Int) {
        self.trimmedStages = trimmedStages; self.droppedStages = droppedStages; self.strandedPosts = strandedPosts
    }
}

public func spanImpact(_ trip: TripDoc, _ startDate: IsoDate, _ endDate: IsoDate) -> SpanImpact {
    var trimmed = 0
    var dropped = 0
    for stage in trip.stages {
        if stage.endDate < startDate || stage.startDate > endDate {
            dropped += 1
        } else if stage.startDate < startDate || stage.endDate > endDate {
            trimmed += 1
        }
    }
    let stranded = trip.posts.filter { post in
        // The days a post covers by its own dates, unclamped.
        var end = post.date
        if let own = post.endDate, !own.isEmpty, own > post.date { end = own }
        return end < startDate || post.date > endDate
    }.count
    return SpanImpact(trimmedStages: trimmed, droppedStages: dropped, strandedPosts: stranded)
}

/// True when the impact is worth a sentence — nothing to say is the normal case.
public func hasImpact(_ impact: SpanImpact) -> Bool {
    impact.trimmedStages > 0 || impact.droppedStages > 0 || impact.strandedPosts > 0
}

/// The legs, brought inside a new span: trimmed where they overhang, dropped
/// where they fall outside entirely. Order is kept — it is the order the trip
/// was lived, which `stageAt` and the route both read. A leg the span does not
/// touch comes back exactly as it was.
public func retimeStages(_ stages: [TripStage], _ startDate: IsoDate, _ endDate: IsoDate) -> [TripStage] {
    var out: [TripStage] = []
    for stage in stages {
        if stage.endDate < startDate || stage.startDate > endDate { continue }
        var kept = stage
        if stage.startDate < startDate { kept.startDate = startDate }
        if stage.endDate > endDate { kept.endDate = endDate }
        out.append(kept)
    }
    return out
}

/// What the sheet hands back when a trip's dates are edited.
public struct TripDetailsEdit: Equatable, Sendable {
    public var startDate: IsoDate
    public var endDate: IsoDate

    public init(startDate: IsoDate, endDate: IsoDate) { self.startDate = startDate; self.endDate = endDate }
}

/// The whole edit, applied: the new span, and the legs brought inside it.
public func applyTripDetails(_ trip: TripDoc, _ edit: TripDetailsEdit) -> TripDoc {
    var next = trip
    next.startDate = edit.startDate
    next.endDate = edit.endDate
    next.stages = retimeStages(trip.stages, edit.startDate, edit.endDate)
    return next
}
