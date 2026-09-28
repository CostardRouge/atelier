// One photograph, read as the place it was taken — and offered to the leg of
// its own day: «Situer cette photo». Port of
// `src/shared/roadtrip/locate-picture.ts`.
//
// The second gesture of the itinerary deduction (`SegmentTrack.swift` and
// `TrackChapters.swift` are the first): that one works a whole trip out from
// one position per day; this one answers the smaller question a single picture
// can settle — *where was I that day?* — for the leg the calendar already
// holds. Same index, same contest, same refusals; not a second geometry.
//
// Rules it inherits, each already binding on the deduction:
// - **The name goes into the PLACE, never into `stage.name`** — an empty leg
//   name means computed, and a leg holding one place derives its label.
// - **No country in the document**: it rides on `PictureLocation.city`.
// - **Null Island is refused**: `0, 0` is what a camera writes with no fix.
// - **Offered, never applied on its own**, and a picture dated outside the
//   trip is CALLED OUT rather than quietly clamped onto an edge.
//
// The picture's day and position come from its own EXIF (`readCapture`,
// `MediaDate.swift`, over `Exif/ExifParser.swift`) and are handed in; the name
// comes from the committed index (`Gazetteer.swift`), never from a lookup
// going out. What it writes, it writes through the editors that already
// exist: `startStageAt` mints a leg exactly as the calendar's menu does, and a
// place is appended the way the leg's own editor appends one.
//
// Pure. The written place's id is minted when the edit is APPLIED, as the web's
// `crypto.randomUUID()` is.

import Foundation

/// Why a picture yields nothing to accept — the six ways the answer is
/// honestly "not from this one".
public enum LocateSilence: String, CaseIterable, Sendable {
    /// Its EXIF says nothing about where it was, and no source vouched for one.
    case noPosition = "no-position"
    /// `0, 0`: a camera with no fix, refused rather than believed.
    case nullIsland = "null-island"
    /// Nothing says which day it belongs to, so there is no leg to offer it to.
    case noDate = "no-date"
    /// Its day is not one of the trip's — said, never clamped onto an edge.
    case outsideTrip = "outside-trip"
    /// Nothing in the city index is near enough to name the point.
    case noName = "no-name"
    /// The leg of that day already names that place.
    case already
}

/// What accepting would do.
public enum LocateProposalKind: String, CaseIterable, Sendable {
    /// The leg of that day names nothing yet, so this place becomes its label.
    case name
    /// It already names places, so this one joins them.
    case route
    /// No leg covers the day, so one begins there.
    case start
}

/// What accepting would do, in the trip's own words. One or none.
public struct LocateProposal: Sendable {
    public var id: LocateProposalKind
    /// The sentence, naming the REAL leg it would touch.
    public var label: String
    /// What it writes exactly, one line under the sentence.
    public var detail: String
    /// The edit, as every stage editor states it: (trip) → new stages.
    public var apply: @Sendable (TripDoc) -> StageEditResult

    public init(id: LocateProposalKind, label: String, detail: String,
                apply: @escaping @Sendable (TripDoc) -> StageEditResult) {
        self.id = id; self.label = label; self.detail = detail; self.apply = apply
    }
}

public struct PictureLocation: Sendable {
    /// What the index calls the point; nil when nothing was near enough.
    public var city: GazetteerCity?
    /// How far that city is from where the picture was taken, in km.
    public var km: Double?
    /// The day the proposal is about; nil when the picture does not say.
    public var date: IsoDate?
    /// The leg covering that day, when one does.
    public var stage: TripStage?
    public var proposal: LocateProposal?
    public var silence: LocateSilence?

    public init(city: GazetteerCity? = nil, km: Double? = nil, date: IsoDate? = nil, stage: TripStage? = nil,
                proposal: LocateProposal? = nil, silence: LocateSilence? = nil) {
        self.city = city; self.km = km; self.date = date; self.stage = stage; self.proposal = proposal
        self.silence = silence
    }
}

public struct LocateInput: Sendable {
    public var trip: TripDoc
    /// The day the picture says it was taken (`readCapture`), or nil.
    public var date: String?
    /// Where its EXIF says it was shot, or nil when nothing says.
    public var coords: GeoPoint?
    /// The committed index; an empty one simply names nothing.
    public var cities: [GazetteerCity]
    /// How far a picture may be from a city and still take its name.
    public var maxKm: Double?

    public init(trip: TripDoc, date: String?, coords: GeoPoint?, cities: [GazetteerCity], maxKm: Double? = nil) {
        self.trip = trip; self.date = date; self.coords = coords; self.cities = cities; self.maxKm = maxKm
    }
}

/// A leg as a sentence names it when it has no label: the span it covers.
private func legSpanWords(_ stage: TripStage) -> String {
    stage.startDate == stage.endDate
        ? formatIsoDate(stage.startDate)
        : "\(formatIsoDate(stage.startDate)) → \(formatIsoDate(stage.endDate))"
}

private func legName(_ stage: TripStage) -> String {
    let label = stageLabel(stage)
    return label.isEmpty ? "the leg of \(legSpanWords(stage))" : "“\(label)”"
}

/// The place as it would be written: the CITY's name and coordinates — the
/// pairing the deduction writes, and the one the Itinerary draws a stop at.
/// The region stays EMPTY: empty means derived, and "AU" is a machine token.
private func locatedPlace(_ city: GazetteerCity) -> TripPlace {
    createTripPlace(city.name, "", coords: GeoPoint(lat: city.lat, lon: city.lon))
}

/// Does this leg already say it went there? Names are compared as written.
private func legNames(_ stage: TripStage, _ city: GazetteerCity) -> Bool {
    let wanted = city.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return stage.places.contains { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == wanted }
}

private func usablePoint(_ coords: GeoPoint?) -> GeoPoint? {
    guard let coords, coords.lat.isFinite, coords.lon.isFinite else { return nil }
    if coords.lat < -90 || coords.lat > 90 || coords.lon < -180 || coords.lon > 180 { return nil }
    return coords
}

/// What one picture can say about this trip's itinerary, and the single edit
/// that would write it down. The refusals come in the order of the questions:
/// is there a position at all, is it a real one, which day is this, is that day
/// the trip's — then what is this place called. The name is looked up whatever
/// the date says, so a picture from the wrong year still tells the author
/// which place it was, and only the WRITE is refused.
public func locatePicture(_ input: LocateInput) -> PictureLocation {
    guard let point = usablePoint(input.coords) else { return PictureLocation(silence: .noPosition) }
    if point.lat == 0 && point.lon == 0 { return PictureLocation(silence: .nullIsland) }

    let city = input.cities.isEmpty
        ? nil
        : nearestCity(input.cities, point, maxKm: input.maxKm ?? gazetteerDefaultMaxKm)
    let km = city.map { haversineKm(point, $0) }

    guard let day = input.date.flatMap({ isIsoDate($0) ? $0 : nil }) else {
        return PictureLocation(city: city, km: km, silence: .noDate)
    }
    let trip = input.trip
    if !isWithin(trip.startDate, trip.endDate, day) {
        return PictureLocation(city: city, km: km, date: day, silence: .outsideTrip)
    }
    guard let city else { return PictureLocation(city: nil, km: km, date: day, silence: .noName) }

    let stage = stageAt(trip, day)
    if let stage, legNames(stage, city) {
        return PictureLocation(city: city, km: km, date: day, stage: stage, silence: .already)
    }

    if let stage {
        // Appending is the same write whether the leg named nothing (it is being
        // NAMED) or already had a route (it is being extended by a place whose
        // position in that route only the author knows); only the sentence differs.
        let first = stageLabel(stage).isEmpty
        let targetId = stage.id
        let proposal = LocateProposal(
            id: first ? .name : .route,
            label: first ? "Name \(legName(stage)) “\(city.name)”" : "Add \(city.name) to \(legName(stage))",
            detail: first
                ? "Its only place, so the leg takes that name — and gives it back if the place is renamed."
                : "Appended at the end of its route; reorder it in the leg itself."
        ) { t in
            StageEditResult(
                stages: t.stages.map { s in
                    guard s.id == targetId else { return s }
                    var next = s
                    next.places.append(locatedPlace(city))
                    return next
                },
                selectedId: targetId
            )
        }
        return PictureLocation(city: city, km: km, date: day, stage: stage, proposal: proposal)
    }

    // No leg covers that day: one begins there, exactly as the calendar's own
    // "Start a stage here" mints it, and the place is written onto it.
    let preview = startStageAt(trip, day)
    let minted = preview.stages.first { $0.id == preview.selectedId }
    let proposal = LocateProposal(
        id: .start,
        label: "Start a leg at \(city.name) on \(formatIsoDate(day))",
        detail: minted.map { "No leg covers that day. The new one would run \(legSpanWords($0))." }
            ?? "No leg covers that day."
    ) { t in
        let result = startStageAt(t, day)
        return StageEditResult(
            stages: result.stages.map { s in
                guard s.id == result.selectedId else { return s }
                var next = s
                next.places = [locatedPlace(city)]
                return next
            },
            selectedId: result.selectedId
        )
    }
    return PictureLocation(city: city, km: km, date: day, stage: nil, proposal: proposal)
}
