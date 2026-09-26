// The trip, as a hook variant is allowed to read it — built by the SHELL,
// never by a variant (a variant never reads the store: `HookVariant.swift`).
// Port of `src/shared/roadtrip/hooks/hook-calendar.ts`.
//
// Pure readings of the document:
// - `hookCalendar` — every day of the trip, whether ANOTHER piece tells it,
//   whether a leg starts on it, and the pieces that tell it with the SOURCE
//   picture each is composed over. The piece being composed never counts as
//   telling its own day: a sweep that stopped on the hero's own day as a
//   "told" day would flash the picture already on the frame.
// - `standingPiece` — the ONE piece whose picture stands for a day told
//   several times: the published one, else the first. A day told three times
//   flashes once.
// - `hookStages` — the legs, with the places a drawing can use.
// - `currentLegIndex` — which leg a day belongs to: the LAST match, the rule
//   `stageAt` uses. A reading of the trip, not of a drawing, so it lives here.

import Foundation

/// Every day of the trip as a hook reads it, the piece `excludePostId` never
/// counting as telling its own day.
public func hookCalendar(_ trip: TripDoc, _ excludePostId: String?) -> [HookDay] {
    let legStarts = Set(trip.stages.map(\.startDate))
    return tripCoverage(trip).days.map { cell in
        let others = cell.posts.filter { $0.id != excludePostId }
        return HookDay(
            date: cell.date,
            dayNumber: cell.dayNumber,
            told: !others.isEmpty,
            legStart: legStarts.contains(cell.date),
            pieces: others.map { post in
                HookDayPiece(
                    id: post.id,
                    title: post.title.trimmingCharacters(in: .whitespacesAndNewlines),
                    published: post.publishedAt != nil,
                    media: post.media,
                    videoSeconds: post.badge.videoTimeSeconds.isFinite ? post.badge.videoTimeSeconds : 0
                )
            }
        )
    }
}

/// The piece whose picture stands for `day`: the published one with a
/// picture, else the first with a picture — and when none has one, the
/// published piece or the first (which then has nothing to show). A draft's
/// picture never hides a published one's.
public func standingPiece(_ day: HookDay) -> HookDayPiece? {
    func pick(_ pieces: [HookDayPiece]) -> HookDayPiece? {
        pieces.first { $0.published } ?? pieces.first
    }
    return pick(day.pieces.filter { $0.media != nil }) ?? pick(day.pieces)
}

/// The legs, with only the places a drawing can use — those with coordinates.
public func hookStages(_ trip: TripDoc) -> [HookStage] {
    trip.stages.map { stage in
        HookStage(
            startDate: stage.startDate,
            endDate: stage.endDate,
            label: stageLabel(stage),
            places: stage.places.compactMap { place -> HookStagePlace? in
                guard let c = place.coords, c.lat.isFinite, c.lon.isFinite else { return nil }
                return HookStagePlace(name: place.name, lat: c.lat, lon: c.lon)
            }
        )
    }
}

/// Which leg a day belongs to: the LAST match, the rule `stageAt` uses.
public func currentLegIndex(_ stages: [HookStage], _ date: IsoDate) -> Int? {
    var found: Int? = nil
    for (i, stage) in stages.enumerated() where stage.startDate <= date && date <= stage.endDate {
        found = i
    }
    return found
}
