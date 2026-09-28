// Deduced legs, handed to the import that already knows what to do with them.
// Port of `src/shared/roadtrip/track-chapters.ts`.
//
// This is the whole seam of the itinerary deduction. `TimelineImport.swift`
// turns `TimelineChapter`s into stages, `diffTimeline` pairs them against the
// trip id → span → first place, and `applyTimelineDiff` writes only what the
// author ticked — and `TimelineChapter` is Atelier's own shape, not the wire's.
// So a deduction is not a second import: it is a second PRODUCER of that shape,
// and everything downstream is untouched.
//
// Three rules it holds:
// - **The chapter's title is always nil.** `stage.name` empty means COMPUTED,
//   and a leg with one place derives that place's name (`stageLabel`). The name
//   a deduction offers goes into **the place**, never into the leg, or the
//   label would lie the moment the place is renamed.
// - **A leg nobody can name gets NO place** — not an empty one, and not a
//   coordinate dressed as a name. It arrives with its dates and nothing else.
// - **The country never reaches the document.** `TripPlace.region` is an
//   editorial field whose empty value means "derived"; "AU" is a machine token.
//   It rides on `TrackChapter.city`, for a panel to show as a hint.
//
// Pure.

import Foundation

/// One deduced leg, in both languages at once: the chapter the import will
/// read, and everything a panel needs to draw the row and decide its tick.
public struct TrackChapter: Equatable, Sendable {
    public var chapter: TimelineChapter
    public var leg: TrackLeg
    /// Where the offered name came from; nil when nothing was near enough.
    public var city: GazetteerCity?

    public init(chapter: TimelineChapter, leg: TrackLeg, city: GazetteerCity?) {
        self.chapter = chapter; self.leg = leg; self.city = city
    }
}

public struct TrackChapterOptions: Equatable, Sendable {
    /// How far a leg may be from a city and still take its name; nil is the
    /// gazetteer's own reach.
    public var maxKm: Double?

    public init(maxKm: Double? = nil) { self.maxKm = maxKm }
}

/// The chapter id: the start date, under a `track:` prefix. Re-run the
/// deduction and a leg that still begins the same day matches on the fast path,
/// while one whose edges moved falls to the diff's span and first-place
/// matching. The prefix keeps a deduced leg from ever colliding with a chapter
/// seeded from an instance's timeline.
private func trackChapterId(_ leg: TrackLeg) -> String {
    "track:\(leg.startDate)"
}

/// A fingerprint that changes when the leg does — its span or its volume — so
/// the next reconcile sees a leg that moved even though its id did not.
private func trackRevision(_ leg: TrackLeg) -> String {
    "\(leg.startDate)|\(leg.endDate)|\(leg.count)"
}

public func trackChapters(_ legs: [TrackLeg], _ cities: [GazetteerCity],
                          _ options: TrackChapterOptions = TrackChapterOptions()) -> [TrackChapter] {
    legs.map { leg in
        let city = cities.isEmpty
            ? nil
            : nearestCity(cities, leg.centroid, maxKm: options.maxKm ?? gazetteerDefaultMaxKm)
        let places = city.map { [TimelinePlace(name: $0.name, region: nil, lat: $0.lat, lon: $0.lon)] } ?? []
        return TrackChapter(
            chapter: TimelineChapter(id: trackChapterId(leg), title: nil, startDate: leg.startDate, endDate: leg.endDate,
                                     places: places, revision: trackRevision(leg)),
            leg: leg,
            city: city
        )
    }
}

/// Just the chapters, which is what `importTimeline` takes.
public func chaptersOf(_ entries: [TrackChapter]) -> [TimelineChapter] {
    entries.map(\.chapter)
}

/// The legs a panel should leave UNTICKED, by chapter id: the ones the
/// arithmetic is least sure of — a stop on the way, or a leg resting only on
/// batch-guessed positions, which may have been guessed from a neighbouring
/// folder a day's drive away.
public func doubtful(_ entries: [TrackChapter]) -> Set<String> {
    Set(entries.filter { $0.leg.short || $0.leg.inferred }.map(\.chapter.id))
}
