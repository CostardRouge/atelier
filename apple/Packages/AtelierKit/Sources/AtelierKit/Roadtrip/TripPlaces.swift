// Where a stage began, where it ended, and what to call it — all DERIVED from
// its ordered list of places, never stored beside it. Port of
// `src/shared/roadtrip/trip-places.ts`.
//
// The same discipline the rest of the model follows: a trip's days are derived
// from its two dates rather than kept as 310 rows, because a second copy of a
// fact is a second thing to migrate and a second thing to get wrong. A stage's
// start and end are `places[0]` and the last one; nothing else can disagree
// with them. And "empty means computed, never blank": a stage whose `name` is
// cleared falls back to the derived label instead of rendering nothing, so
// naming a stage by hand is never a one-way door. The trip's route ("Perth →
// Cairns") is derived the same way from its legs — nothing stores it since v27.
//
// Pure.

import Foundation

/// What joins two ends of a leg. A geometric arrow, not an emoji: this string
/// is drawn over a picture with a font stack nobody controls, and "📍" was
/// measured drawing NOTHING in a Chromium with no colour-emoji font. U+2192 is
/// monochrome, present everywhere, and takes the badge's own ink. The web's
/// `PLACE_ARROW`.
public let placeArrow = "→"

private func placeNamed(_ place: TripPlace) -> String {
    place.name.trimmingCharacters(in: .whitespacesAndNewlines)
}

/// The places worth showing — one with no name is a row someone started.
private func namedPlaces(_ stage: TripStage) -> [TripPlace] {
    stage.places.filter { !placeNamed($0).isEmpty }
}

/// Where the stage began: the first place it names, or nil when it names none.
public func stageStart(_ stage: TripStage) -> TripPlace? {
    namedPlaces(stage).first
}

/// Where the stage ended. With a single place this is the same one as
/// `stageStart`, which is the truth: you did not go anywhere.
public func stageEnd(_ stage: TripStage) -> TripPlace? {
    namedPlaces(stage).last
}

/// "Perth → Cairns" from two ends, or the one name when they are the same place.
private func routeWords(_ from: TripPlace?, _ to: TripPlace?) -> String {
    guard let from else { return "" }
    guard let to, to.id != from.id else { return placeNamed(from) }
    return "\(placeNamed(from)) \(placeArrow) \(placeNamed(to))"
}

/// What a badge calls this stage. The author's own `name` always wins; an empty
/// one derives "Perth → Cairns" from the ends, or the single place's name, or
/// an empty string when the stage names nothing at all — in which case the
/// caller falls back rather than inventing a place.
public func stageLabel(_ stage: TripStage) -> String {
    let own = stage.name.trimmingCharacters(in: .whitespacesAndNewlines)
    if !own.isEmpty { return own }
    return routeWords(stageStart(stage), stageEnd(stage))
}

/// The stage's region. The author's own wins; otherwise the region its places
/// AGREE on — one place in Western Australia and one in Queensland have no
/// common region, and printing either would be a quiet lie about the other.
public func stageRegionLabel(_ stage: TripStage) -> String {
    let own = stage.region.trimmingCharacters(in: .whitespacesAndNewlines)
    if !own.isEmpty { return own }
    let regions = namedPlaces(stage)
        .map { $0.region.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    guard let first = regions.first else { return "" }
    return regions.allSatisfy { $0 == first } ? first : ""
}

/// A place's region, falling back to its stage's — empty means "the stage's".
public func placeRegionLabel(_ place: TripPlace, _ stage: TripStage) -> String {
    let own = place.region.trimmingCharacters(in: .whitespacesAndNewlines)
    return own.isEmpty ? stageRegionLabel(stage) : own
}

/// The trip's two ends: the first place of its first stage that names one, and
/// the last place of its last. Stages are kept in the order the trip was lived,
/// so this is simply where it set out from and where it ended — derived, never
/// stored. With a single named place the two are the SAME place (one id),
/// which is the truth and what an editor must check before writing an end.
public func tripRouteEnds(_ stages: [TripStage]) -> (from: TripPlace?, to: TripPlace?) {
    var from: TripPlace? = nil
    var to: TripPlace? = nil
    for stage in stages {
        from = from ?? stageStart(stage)
        to = stageEnd(stage) ?? to
    }
    return (from, to)
}

public func tripRouteEnds(_ trip: TripDoc) -> (from: TripPlace?, to: TripPlace?) {
    tripRouteEnds(trip.stages)
}

/// The trip's route as a badge or a header reads it: "Perth → Cairns". The
/// web's `tripRouteLabel({ stages })` is the overload over the legs alone.
public func tripRouteLabel(_ stages: [TripStage]) -> String {
    let ends = tripRouteEnds(stages)
    return routeWords(ends.from, ends.to)
}

public func tripRouteLabel(_ trip: TripDoc) -> String {
    tripRouteLabel(trip.stages)
}

/// Coordinates as a human reads them back. Six decimals is what the EXIF
/// reader writes — roughly 10 cm, far past what a phone or a drone actually
/// knows, but it round-trips what we were given without rewriting it.
/// `toFixed(6)`, a half going away from zero.
public func formatCoords(_ coords: GeoPoint?) -> String {
    guard let coords else { return "" }
    return "\(ExifText.toFixed(coords.lat, 6)), \(ExifText.toFixed(coords.lon, 6))"
}
