// The road-trip DOCUMENT — port of `src/shared/roadtrip/trip-types.ts` (v28):
// the trip, its stages (legs) with their places, its posts (pieces) with their
// badge and slides, and everything a trip keeps beside them. The migrations
// from every earlier version, and the reader that runs them, are
// `TripMigrations.swift`.
//
// THE SAME DOCUMENT as the web app's, read and written on the same JSON shape:
// a trip kept in the browser, on a Winnow or in a `.roadtrip.json` opens here
// as it opens there, and a trip written here opens there unchanged. Every read
// goes through `readTripDoc` (a `JSONValue`, never a strict decode); a key
// this port does not know is CARRIED through on the record that held it and
// written back verbatim, and every writer writes what the web writes — nulls
// where the web writes nulls, an optional field only when set.
//
// The model's rules, kept:
// - A trip holds STAGES and POSTS. There is no stored day: a day is a date
//   inside the trip's span, derived on read (`TripDays.swift`).
// - A post is keyed by the DATE it tells, never by a file name; its media ref
//   is a hint for re-finding the file, never its identity.
// - A stage's places are the leg as it was LIVED, in order: the first is where
//   it began, the last where it ended — the only record of a start and an end.
// - What is about ONE photograph — its framing, its motion, its develop, its
//   grade, its collage, the clip's in point and speed, the reference day, the
//   author's text overrides — is never inherited by the next piece: a trip's
//   remembered look (`HookDefaults`) carries the rest.
// - "Empty means computed, never blank": an emptied text override, a stage's
//   empty name, a post's null grade (follow the trip) all give the derived
//   value back.
// - The look a badge wears is the TRIP's (`theme`, `neutral` by default — the
//   one preset measured legible over every photograph), and so is the car,
//   the closing card, the words and the develop presets.
// - `Date.now()` and `crypto.randomUUID()` are PARAMETERS here (`now`,
//   `makeId`/`id`), defaulting to the clock and a fresh lowercase UUID.

import Foundation

/// Bumped with a migration in `TripMigrations.swift`, never without.
public let tripDocVersion = 28

/// A grade, in the Studio's own terms: an ordered stack of LUT layers, the
/// output transform and the film texture. The interpolation mode is NOT
/// here: it is a render preference of the machine, never of a document.
public typealias TripGrade = SavedGrade

/// No look at all — what a new trip wears.
public func emptyGrade() -> TripGrade {
    SavedGrade(layers: [], output: .none, film: nil)
}

/// The look every badge of a trip starts with: the only preset that stays
/// legible over every photograph (the flat vermilion vanishes on warm footage).
/// `TripDoc`'s initialiser spells it out, a default argument being public.
let defaultTripThemePreset = "neutral"

/// A fresh id — the web's `newId`: a lowercase UUID, what `crypto.randomUUID()` mints.
public func newTripId() -> String {
    UUID().uuidString.lowercased()
}

private func trimmed(_ s: String) -> String {
    s.trimmingCharacters(in: .whitespacesAndNewlines)
}

/// An id read back, or a fresh one when there is none.
private func idOf(_ raw: JSONValue?, _ makeId: () -> String) -> String {
    raw?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? makeId()
}

private func word<T: RawRepresentable>(_ raw: JSONValue?, _ fallback: T) -> T where T.RawValue == String {
    raw?.stringValue.flatMap(T.init(rawValue:)) ?? fallback
}

/// Every key of `o` that `known` does not name.
private func unknownKeys(_ o: [String: JSONValue], _ known: Set<String>) -> [String: JSONValue] {
    o.filter { !known.contains($0.key) }
}

/// A ref read as the collage reads one: a name is required; a size or a date
/// that is not a finite number is 0; an empty id or hash is left out.
private func tripMediaRef(_ raw: JSONValue?) -> SavedMediaRef? {
    guard let r = raw?.objectValue, let name = r["name"]?.stringValue, !name.isEmpty else { return nil }
    let size = r["size"]?.finiteNumber ?? 0
    var ref = SavedMediaRef(name: name, size: abs(size) < 9e15 ? Int(size) : 0,
                            lastModified: r["lastModified"]?.finiteNumber ?? 0)
    if let assetId = r["assetId"]?.stringValue, !assetId.isEmpty { ref.assetId = assetId }
    if let hash = r["hash"]?.stringValue, !hash.isEmpty { ref.hash = hash }
    return ref
}

private func nullable(_ s: String?) -> JSONValue { s.map(JSONValue.string) ?? .null }
private func nullable(_ n: Double?) -> JSONValue { n.map(JSONValue.number) ?? .null }

// MARK: - posts' kinds

/// What a post is delivered as. Drives the badge layout, not the storage.
public enum PostKind: String, CaseIterable, Sendable {
    case reel, carousel, photo
}

public struct PostKindOption: Equatable, Sendable {
    public let id: PostKind
    public let label: String
    public let hint: String
}

/// The web's `POST_KINDS`.
public let postKinds: [PostKindOption] = [
    PostKindOption(id: .reel, label: "Reel", hint: "One video, hook burned into the opening"),
    PostKindOption(id: .carousel, label: "Carousel", hint: "Several slides: intro, content, call to action"),
    PostKindOption(id: .photo, label: "Single photo", hint: "One image with its badge"),
]

/// The frame each kind of post is delivered in, unless the author says otherwise.
private func aspectForKind(_ kind: PostKind) -> String {
    kind == .reel ? "9:16" : "4:5"
}

// MARK: - stages and places

/// One point on the map, named. A place is a POINT INSIDE a stage, never a
/// dated thing of its own. `coords` follows EXIF (decimal degrees, south and
/// west negative); nil is the normal case for a place typed by hand.
public struct TripPlace: Equatable, Sendable {
    public var id: String
    /// The place as it is said out loud ("Kalbarri").
    public var name: String
    /// Region or country. Empty means "the stage's own".
    public var region: String
    public var coords: GeoPoint?
    public var carried: [String: JSONValue]

    public init(id: String, name: String, region: String = "", coords: GeoPoint? = nil, carried: [String: JSONValue] = [:]) {
        self.id = id; self.name = name; self.region = region; self.coords = coords; self.carried = carried
    }

    public var json: JSONValue {
        var o = carried
        o["id"] = .string(id)
        o["name"] = .string(name)
        o["region"] = .string(region)
        o["coords"] = coords.map { .object(["lat": .number($0.lat), "lon": .number($0.lon)]) } ?? .null
        return .object(o)
    }
}

/// Where a stage was SEEDED from — a Winnow timeline chapter. A hint for the
/// next reconcile, never a pointer the reader dereferences.
public struct StageOrigin: Equatable, Sendable {
    /// The instance's host.
    public var sourceId: String
    /// The chapter's id on that instance — never reused as the stage's id.
    public var chapterId: String
    /// Whatever the instance offers to detect a re-clustered chapter.
    public var revision: String?
    /// When this stage was last seeded or accepted from the chapter.
    public var importedAt: Double

    public init(sourceId: String, chapterId: String, revision: String? = nil, importedAt: Double) {
        self.sourceId = sourceId; self.chapterId = chapterId; self.revision = revision; self.importedAt = importedAt
    }

    public var json: JSONValue {
        var o: [String: JSONValue] = [
            "sourceId": .string(sourceId), "chapterId": .string(chapterId), "importedAt": .number(importedAt),
        ]
        if let revision { o["revision"] = .string(revision) }
        return .object(o)
    }
}

/// A leg of the trip, with its own span and the places it went through, in
/// the order they were lived.
public struct TripStage: Equatable, Sendable {
    public var id: String
    /// The leg's own label. EMPTY means computed from the places, never blank.
    public var name: String
    /// Freely typed region or country. Empty = the region its places agree on.
    public var region: String
    public var startDate: IsoDate
    public var endDate: IsoDate
    public var places: [TripPlace]
    /// Set when the stage was seeded from a timeline chapter; nil by hand.
    public var origin: StageOrigin?
    public var carried: [String: JSONValue]

    public init(id: String, name: String, region: String, startDate: IsoDate, endDate: IsoDate,
                places: [TripPlace] = [], origin: StageOrigin? = nil, carried: [String: JSONValue] = [:]) {
        self.id = id; self.name = name; self.region = region; self.startDate = startDate; self.endDate = endDate
        self.places = places; self.origin = origin; self.carried = carried
    }

    /// The stage as the document holds it — `origin` only when seeded.
    public var json: JSONValue {
        var o = carried
        o["id"] = .string(id)
        o["name"] = .string(name)
        o["region"] = .string(region)
        o["startDate"] = .string(startDate)
        o["endDate"] = .string(endDate)
        o["places"] = .array(places.map(\.json))
        if let origin { o["origin"] = origin.json } else { o["origin"] = nil }
        return .object(o)
    }
}

// MARK: - the badge

/// What a slide is DELIVERED as: `auto` comes out a video when something on
/// it moves and an image otherwise; the two explicit values are the author's.
public enum SlideMedium: String, CaseIterable, Sendable {
    case auto, image, video
}

/// How long a slide is on screen, when nothing says otherwise.
public let defaultSlideSeconds = 3.0

/// How one post's badge counts and where it sits — and, on the hook, how its
/// picture is framed, moved, corrected and graded.
public struct PostBadge: Equatable, Sendable {
    public var mode: CounterMode
    public var layout: BadgeLayout
    /// What the kicker says about WHEN (`TimeAgo.swift`).
    public var timeAgo: TimeAgoMode
    /// The day this post is read on; nil = whatever today actually is.
    public var referenceDate: IsoDate?
    /// Set the place behind the marker glyph.
    public var showPin: Bool
    /// Credit the camera under the badge — measured from the picture at every
    /// render, never stored.
    public var showExif: Bool
    /// How the credit is COMPOSED; nil keeps the plain line of six facts.
    public var camera: CameraPlateSpec?
    /// How long the hook lasts, in seconds — what an exit animation lands on.
    public var durationSeconds: Double
    public var medium: SlideMedium
    /// How long the hook slide is ON SCREEN — not `durationSeconds`.
    public var hookSeconds: Double
    /// The darkening laid over the picture, under the badge.
    public var shades: [Shade]
    /// The frame the badge is composed for, an aspect preset id.
    public var aspectId: String
    /// Where the hook's clip STARTS. Ignored for a photo.
    public var videoTimeSeconds: Double
    /// The speed the hook's clip plays at. Ignored for a photo.
    public var videoSpeed: Double
    /// How the hook's picture sits in the frame. Never inherited.
    public var framing: Framing
    /// How the hook's picture MOVES in its frame, or nil to hold still. Never inherited.
    public var motion: FramingMotion?
    /// The hook picture's own correction; nil is as shot. Never inherited.
    public var develop: DevelopSettings?
    /// The hook picture's own grade; nil follows the piece. Never inherited.
    public var grade: TripGrade?
    /// ONE entrance for every piece, or nil for each piece's own.
    public var cascade: BadgeCascade?
    /// Several pictures in the hook's frame, or nil for the one. Never inherited.
    public var collage: SlideCollage?
    /// Free text replacing a computed piece. Empty means computed, never blank.
    public var textOverrides: [BadgePiece: String]
    /// How each piece departs from the trip's theme.
    public var pieceStyles: BadgePieceStyles
    /// The OPENER — a list, only the first entry written today.
    public var hook: [HookLayer]
    public var carried: [String: JSONValue]

    public init(mode: CounterMode = .day, layout: BadgeLayout = defaultBadgeLayout, timeAgo: TimeAgoMode = .off,
                referenceDate: IsoDate? = nil, showPin: Bool = false, showExif: Bool = false, camera: CameraPlateSpec? = nil,
                durationSeconds: Double = defaultBadgeDuration, medium: SlideMedium = .auto,
                hookSeconds: Double = defaultHookSeconds(defaultBadgeDuration), shades: [Shade] = [],
                aspectId: String = "4:5", videoTimeSeconds: Double = 0, videoSpeed: Double = 1,
                framing: Framing = .default, motion: FramingMotion? = nil, develop: DevelopSettings? = nil,
                grade: TripGrade? = nil, cascade: BadgeCascade? = nil, collage: SlideCollage? = nil,
                textOverrides: [BadgePiece: String] = [:], pieceStyles: BadgePieceStyles = [:],
                hook: [HookLayer] = defaultHookLayers(), carried: [String: JSONValue] = [:]) {
        self.mode = mode; self.layout = layout; self.timeAgo = timeAgo; self.referenceDate = referenceDate
        self.showPin = showPin; self.showExif = showExif; self.camera = camera; self.durationSeconds = durationSeconds
        self.medium = medium; self.hookSeconds = hookSeconds; self.shades = shades; self.aspectId = aspectId
        self.videoTimeSeconds = videoTimeSeconds; self.videoSpeed = videoSpeed; self.framing = framing
        self.motion = motion; self.develop = develop; self.grade = grade; self.cascade = cascade
        self.collage = collage; self.textOverrides = textOverrides; self.pieceStyles = pieceStyles
        self.hook = hook; self.carried = carried
    }

    public var json: JSONValue {
        var o = carried
        o["mode"] = .string(mode.rawValue)
        o["layout"] = layout.json
        o["timeAgo"] = .string(timeAgo.rawValue)
        o["referenceDate"] = nullable(referenceDate)
        o["showPin"] = .bool(showPin)
        o["showExif"] = .bool(showExif)
        if let camera { o["camera"] = camera.json } else { o["camera"] = nil }
        o["durationSeconds"] = .number(durationSeconds)
        o["medium"] = .string(medium.rawValue)
        o["hookSeconds"] = .number(hookSeconds)
        o["shades"] = .array(shades.map(\.json))
        o["aspectId"] = .string(aspectId)
        o["videoTimeSeconds"] = .number(videoTimeSeconds)
        o["videoSpeed"] = .number(videoSpeed)
        o["framing"] = framing.json
        o["motion"] = motion?.json ?? .null
        o["develop"] = develop?.json ?? .null
        o["grade"] = grade?.json ?? .null
        o["cascade"] = cascade?.json ?? .null
        o["collage"] = collage?.json ?? .null
        o["textOverrides"] = textOverridesJSON(textOverrides)
        o["pieceStyles"] = badgePieceStylesJSON(pieceStyles)
        o["hook"] = .array(hook.map(\.json))
        return .object(o)
    }
}

/// The overrides as the document holds them.
public func textOverridesJSON(_ overrides: [BadgePiece: String]) -> JSONValue {
    var o: [String: JSONValue] = [:]
    for (piece, text) in overrides { o[piece.rawValue] = .string(text) }
    return .object(o)
}

/// Stored overrides read back; a key that names no piece, or a value that is
/// not text, is left out. An empty one is kept — it means "computed".
public func readTextOverrides(_ raw: JSONValue?) -> [BadgePiece: String] {
    var out: [BadgePiece: String] = [:]
    for (key, value) in raw?.objectValue ?? [:] {
        guard let piece = BadgePiece(rawValue: key), let text = value.stringValue else { continue }
        out[piece] = text
    }
    return out
}

/// The LOOK a trip gives a new piece of one kind — everything about how a hook
/// is composed, and nothing about which day it tells. It holds the counter
/// mode and the temporal mode too: editorial habits, not facts about a picture.
public struct HookDefaults: Equatable, Sendable {
    public var aspectId: String
    public var mode: CounterMode
    public var timeAgo: TimeAgoMode
    public var showPin: Bool
    public var showExif: Bool
    public var camera: CameraPlateSpec?
    public var durationSeconds: Double
    public var medium: SlideMedium
    public var hookSeconds: Double
    public var layout: BadgeLayout
    public var pieceStyles: BadgePieceStyles
    public var cascade: BadgeCascade?
    public var shades: [Shade]
    /// The opener a new piece of this kind starts on.
    public var hook: [HookLayer]
    public var carried: [String: JSONValue]

    public init(aspectId: String, mode: CounterMode, timeAgo: TimeAgoMode, showPin: Bool, showExif: Bool,
                camera: CameraPlateSpec? = nil, durationSeconds: Double, medium: SlideMedium, hookSeconds: Double,
                layout: BadgeLayout, pieceStyles: BadgePieceStyles, cascade: BadgeCascade?, shades: [Shade],
                hook: [HookLayer], carried: [String: JSONValue] = [:]) {
        self.aspectId = aspectId; self.mode = mode; self.timeAgo = timeAgo; self.showPin = showPin
        self.showExif = showExif; self.camera = camera; self.durationSeconds = durationSeconds; self.medium = medium
        self.hookSeconds = hookSeconds; self.layout = layout; self.pieceStyles = pieceStyles; self.cascade = cascade
        self.shades = shades; self.hook = hook; self.carried = carried
    }

    public var json: JSONValue {
        var o = carried
        o["aspectId"] = .string(aspectId)
        o["mode"] = .string(mode.rawValue)
        o["timeAgo"] = .string(timeAgo.rawValue)
        o["showPin"] = .bool(showPin)
        o["showExif"] = .bool(showExif)
        if let camera { o["camera"] = camera.json } else { o["camera"] = nil }
        o["durationSeconds"] = .number(durationSeconds)
        o["medium"] = .string(medium.rawValue)
        o["hookSeconds"] = .number(hookSeconds)
        o["layout"] = layout.json
        o["pieceStyles"] = badgePieceStylesJSON(pieceStyles)
        o["cascade"] = cascade?.json ?? .null
        o["shades"] = .array(shades.map(\.json))
        o["hook"] = .array(hook.map(\.json))
        return .object(o)
    }
}

/// The looks a trip remembers, per kind. A kind never saved has none.
public typealias HookDefaultsByKind = [PostKind: HookDefaults]

/// What a piece's look is, lifted out of it so it can be saved on the trip.
/// Every shade gets its own id: two documents sharing one is how a list starts
/// editing the wrong row.
public func hookDefaultsFrom(_ badge: PostBadge, makeId: () -> String = newTripId) -> HookDefaults {
    HookDefaults(
        aspectId: badge.aspectId, mode: badge.mode, timeAgo: badge.timeAgo, showPin: badge.showPin,
        showExif: badge.showExif, camera: badge.camera, durationSeconds: badge.durationSeconds,
        medium: badge.medium, hookSeconds: badge.hookSeconds, layout: badge.layout, pieceStyles: badge.pieceStyles,
        cascade: badge.cascade, shades: badge.shades.map { var s = $0; s.id = makeId(); return s },
        hook: badge.hook
    )
}

/// A fresh badge for a piece of `kind`, dressed in the trip's remembered look
/// when it has one. What belongs to one day — the reference day, the clip's
/// frame and speed, the framing, the motion, the develop, the grade, the
/// collage, the author's own words — is never inherited.
public func defaultPostBadge(_ kind: PostKind = .photo, _ defaults: HookDefaults? = nil,
                             makeId: () -> String = newTripId) -> PostBadge {
    let duration = defaults?.durationSeconds ?? defaultBadgeDuration
    return PostBadge(
        mode: defaults?.mode ?? .day,
        layout: defaults?.layout ?? defaultBadgeLayout,
        timeAgo: defaults?.timeAgo ?? .off,
        referenceDate: nil,
        showPin: defaults?.showPin ?? false,
        showExif: defaults?.showExif ?? false,
        camera: defaults?.camera,
        durationSeconds: duration,
        medium: defaults?.medium ?? .auto,
        hookSeconds: defaults?.hookSeconds ?? defaultHookSeconds(duration),
        shades: (defaults?.shades ?? []).map { var s = $0; s.id = makeId(); return s },
        aspectId: defaults?.aspectId ?? aspectForKind(kind),
        videoTimeSeconds: 0,
        videoSpeed: 1,
        framing: .default,
        motion: nil,
        develop: nil,
        grade: nil,
        cascade: defaults?.cascade,
        collage: nil,
        textOverrides: [:],
        pieceStyles: defaults?.pieceStyles ?? [:],
        hook: defaults?.hook ?? defaultHookLayers()
    )
}

// MARK: - slides and posts

/// A picture after the hook, in a carousel. It carries no badge.
public struct PostSlide: Equatable, Sendable {
    public var id: String
    public var media: SavedMediaRef?
    /// Where the picture is taken from its clip — and the IN point of what is encoded.
    public var videoTimeSeconds: Double
    /// The speed the clip plays at.
    public var videoSpeed: Double
    public var framing: Framing
    public var motion: FramingMotion?
    /// This picture's own correction, or nil for as shot.
    public var develop: DevelopSettings?
    /// This picture's own grade, or nil to follow the piece.
    public var grade: TripGrade?
    /// Several pictures in this slide's frame, this one first.
    public var collage: SlideCollage?
    /// The author's own line over this picture; empty draws nothing.
    public var caption: String
    public var medium: SlideMedium
    /// How long it is on screen when it is delivered as a video.
    public var seconds: Double
    public var carried: [String: JSONValue]

    public init(id: String, media: SavedMediaRef? = nil, videoTimeSeconds: Double = 0, videoSpeed: Double = 1,
                framing: Framing = .default, motion: FramingMotion? = nil, develop: DevelopSettings? = nil,
                grade: TripGrade? = nil, collage: SlideCollage? = nil, caption: String = "",
                medium: SlideMedium = .auto, seconds: Double = defaultSlideSeconds, carried: [String: JSONValue] = [:]) {
        self.id = id; self.media = media; self.videoTimeSeconds = videoTimeSeconds; self.videoSpeed = videoSpeed
        self.framing = framing; self.motion = motion; self.develop = develop; self.grade = grade
        self.collage = collage; self.caption = caption; self.medium = medium; self.seconds = seconds; self.carried = carried
    }

    public var json: JSONValue {
        var o = carried
        o["id"] = .string(id)
        o["media"] = media?.json ?? .null
        o["videoTimeSeconds"] = .number(videoTimeSeconds)
        o["videoSpeed"] = .number(videoSpeed)
        o["framing"] = framing.json
        o["motion"] = motion?.json ?? .null
        o["develop"] = develop?.json ?? .null
        o["grade"] = grade?.json ?? .null
        o["collage"] = collage?.json ?? .null
        o["caption"] = .string(caption)
        o["medium"] = .string(medium.rawValue)
        o["seconds"] = .number(seconds)
        return .object(o)
    }
}

public func createPostSlide(_ media: SavedMediaRef? = nil, id: String = newTripId()) -> PostSlide {
    PostSlide(id: id, media: media)
}

public struct TripPost: Equatable, Sendable {
    public var id: String
    public var kind: PostKind
    /// The trip day this post tells — the key of the whole model.
    public var date: IsoDate
    /// Last day when the post covers several; nil for one day.
    public var endDate: IsoDate?
    /// Working title, for finding it again in a list. Not published copy.
    public var title: String
    /// The picture the badge goes over — a HINT for re-finding the file.
    public var media: SavedMediaRef?
    public var badge: PostBadge
    /// The pictures after the hook. Empty for a single photo or a reel.
    public var slides: [PostSlide]
    /// Close the deck with the trip's call-to-action slide.
    public var includeCta: Bool
    /// The Studio project this piece is composed in, when there is one.
    public var projectId: String?
    /// This piece's own grade, or nil to FOLLOW THE TRIP's.
    public var grade: TripGrade?
    /// When it actually went out (ms), or nil while it is a draft.
    public var publishedAt: Double?
    public var createdAt: Double
    public var carried: [String: JSONValue]

    public init(id: String, kind: PostKind, date: IsoDate, endDate: IsoDate? = nil, title: String = "",
                media: SavedMediaRef? = nil, badge: PostBadge, slides: [PostSlide] = [], includeCta: Bool = false,
                projectId: String? = nil, grade: TripGrade? = nil, publishedAt: Double? = nil, createdAt: Double,
                carried: [String: JSONValue] = [:]) {
        self.id = id; self.kind = kind; self.date = date; self.endDate = endDate; self.title = title
        self.media = media; self.badge = badge; self.slides = slides; self.includeCta = includeCta
        self.projectId = projectId; self.grade = grade; self.publishedAt = publishedAt; self.createdAt = createdAt
        self.carried = carried
    }

    public var json: JSONValue {
        var o = carried
        o["id"] = .string(id)
        o["kind"] = .string(kind.rawValue)
        o["date"] = .string(date)
        o["endDate"] = nullable(endDate)
        o["title"] = .string(title)
        o["media"] = media?.json ?? .null
        o["badge"] = badge.json
        o["slides"] = .array(slides.map(\.json))
        o["includeCta"] = .bool(includeCta)
        o["projectId"] = nullable(projectId)
        o["grade"] = grade?.json ?? .null
        o["publishedAt"] = nullable(publishedAt)
        o["createdAt"] = .number(createdAt)
        return .object(o)
    }
}

// MARK: - the cover

/// How a trip draws itself in the gallery; each falls back to the next when
/// the pictures it wants do not exist.
public enum CoverLayout: String, CaseIterable, Sendable {
    case mosaic, cover, rhythm, none
}

/// How many pictures a layout draws. The web's `COVER_TILES`.
public let coverTiles: [CoverLayout: Int] = [.mosaic: 3, .cover: 1, .rhythm: 0, .none: 0]

public struct TripCover: Equatable, Sendable {
    public var layout: CoverLayout
    /// Pieces that LEAD the cover, in order — a preference, never a dependency.
    public var pinned: [String]

    public init(layout: CoverLayout = .mosaic, pinned: [String] = []) {
        self.layout = layout
        self.pinned = pinned
    }

    /// The web's `DEFAULT_TRIP_COVER`.
    public static let `default` = TripCover()

    public var json: JSONValue {
        .object(["layout": .string(layout.rawValue), "pinned": .array(pinned.map(JSONValue.string))])
    }
}

/// A fresh cover.
public func defaultTripCover() -> TripCover {
    TripCover()
}

// MARK: - the trip

public struct TripDoc: Equatable, Sendable {
    public var version: Int
    public var id: String
    /// What the trip is called on a badge ("Australie").
    public var name: String
    public var startDate: IsoDate
    public var endDate: IsoDate
    public var stages: [TripStage]
    public var posts: [TripPost]
    /// Every word the badges say.
    public var badgeWords: BadgeWords
    /// What the badges call each camera BODY, keyed by the name its files give.
    /// Nil on every trip written before it existed.
    public var cameraNames: [String: String]?
    /// The title style every badge of this trip wears; nil is none.
    public var theme: StyleTheme?
    /// The closing slide, edited once for the whole trip.
    public var cta: CtaSlide
    /// The look a new piece of each kind starts from.
    public var hookDefaults: HookDefaultsByKind
    /// The trip's look on the PICTURE.
    public var grade: TripGrade
    public var cover: TripCover
    /// Named develops saved from a picture, applied — never followed.
    public var developPresets: [DevelopPreset]
    /// The car every Virée of this trip drives.
    public var car: CarSpec
    // --- bound half ---
    /// The ONE source this trip is kept on. Never in `.roadtrip.json`.
    public var sourceId: String
    public var createdAt: Double
    public var updatedAt: Double
    public var carried: [String: JSONValue]

    public init(version: Int = tripDocVersion, id: String, name: String, startDate: IsoDate, endDate: IsoDate,
                stages: [TripStage] = [], posts: [TripPost] = [], badgeWords: BadgeWords = defaultBadgeWords,
                cameraNames: [String: String]? = nil, theme: StyleTheme? = themeFromPreset("neutral"),
                cta: CtaSlide = defaultCta, hookDefaults: HookDefaultsByKind = [:], grade: TripGrade = emptyGrade(),
                cover: TripCover = .default, developPresets: [DevelopPreset] = [], car: CarSpec = defaultCarSpec(),
                sourceId: String = defaultSourceId, createdAt: Double, updatedAt: Double, carried: [String: JSONValue] = [:]) {
        self.version = version; self.id = id; self.name = name; self.startDate = startDate; self.endDate = endDate
        self.stages = stages; self.posts = posts; self.badgeWords = badgeWords; self.cameraNames = cameraNames
        self.theme = theme; self.cta = cta; self.hookDefaults = hookDefaults; self.grade = grade; self.cover = cover
        self.developPresets = developPresets; self.car = car; self.sourceId = sourceId
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.carried = carried
    }

    /// The document as JSON — what the store keeps and the instance receives.
    public var json: JSONValue {
        var o = carried
        o["version"] = .number(Double(version))
        o["id"] = .string(id)
        o["name"] = .string(name)
        o["startDate"] = .string(startDate)
        o["endDate"] = .string(endDate)
        o["stages"] = .array(stages.map(\.json))
        o["posts"] = .array(posts.map(\.json))
        o["badgeWords"] = badgeWords.json
        if let cameraNames {
            o["cameraNames"] = .object(cameraNames.mapValues(JSONValue.string))
        } else {
            o["cameraNames"] = nil
        }
        o["theme"] = theme?.json ?? .null
        o["cta"] = cta.json
        var defaults: [String: JSONValue] = [:]
        for (kind, look) in hookDefaults { defaults[kind.rawValue] = look.json }
        o["hookDefaults"] = .object(defaults)
        o["grade"] = grade.json
        o["cover"] = cover.json
        o["developPresets"] = .array(developPresets.map(tripPresetJSON))
        o["car"] = car.json
        o["sourceId"] = .string(sourceId)
        o["createdAt"] = .number(createdAt)
        o["updatedAt"] = .number(updatedAt)
        return .object(o)
    }
}

/// A preset as the trip stores it — its look only when it has one.
func tripPresetJSON(_ p: DevelopPreset) -> JSONValue {
    var o: [String: JSONValue] = ["id": .string(p.id), "name": .string(p.name), "settings": p.settings.json]
    if let look = p.look { o["look"] = look }
    return .object(o)
}

// MARK: - factories

/// A new trip: no leg at all (a place belongs to a leg, and the legs are drawn
/// on the calendar once the trip exists), English words, the neutral look,
/// the default closing card and car, no grade, nothing remembered.
public func createTripDoc(_ name: String, _ startDate: IsoDate, _ endDate: IsoDate, sourceId: String = defaultSourceId,
                          now: Double = nowMillis(), id: String = newTripId()) -> TripDoc {
    TripDoc(id: id, name: trimmed(name), startDate: startDate, endDate: endDate, sourceId: sourceId,
            createdAt: now, updatedAt: now)
}

/// A copy of a piece, on the same day, ready to be re-cut. Not carried: the
/// publication, the Studio link, and the id — of the piece and of every slide
/// and shade inside it.
public func duplicateTripPost(_ post: TripPost, suffix: String = " (copy)", now: Double = nowMillis(),
                              makeId: () -> String = newTripId) -> TripPost {
    var copy = post
    copy.id = makeId()
    let title = trimmed(post.title)
    copy.title = title.isEmpty ? "" : title + suffix
    copy.badge.shades = post.badge.shades.map { var s = $0; s.id = makeId(); return s }
    copy.slides = post.slides.map { var s = $0; s.id = makeId(); return s }
    copy.projectId = nil
    copy.publishedAt = nil
    copy.createdAt = now
    return copy
}

/// A new piece. It never starts with a closing card, whatever the kind: a
/// slide nobody composed does not belong in a deck by default.
public func createTripPost(_ kind: PostKind, _ date: IsoDate, _ title: String, endDate: IsoDate? = nil,
                           defaults: HookDefaults? = nil, now: Double = nowMillis(),
                           makeId: () -> String = newTripId) -> TripPost {
    let id = makeId()
    return TripPost(id: id, kind: kind, date: date, endDate: endDate, title: trimmed(title), media: nil,
                    badge: defaultPostBadge(kind, defaults, makeId: makeId), slides: [], includeCta: false,
                    projectId: nil, grade: nil, publishedAt: nil, createdAt: now)
}

public func createTripStage(_ name: String, _ region: String, _ startDate: IsoDate, _ endDate: IsoDate,
                            places: [TripPlace] = [], id: String = newTripId()) -> TripStage {
    TripStage(id: id, name: trimmed(name), region: trimmed(region), startDate: startDate, endDate: endDate, places: places)
}

public func createTripPlace(_ name: String = "", _ region: String = "", coords: GeoPoint? = nil,
                            id: String = newTripId()) -> TripPlace {
    TripPlace(id: id, name: trimmed(name), region: trimmed(region), coords: coords)
}

/// Why a span cannot be used, in a sentence a human can act on — or nil when
/// it is fine. Dates reach this from text inputs, so an impossible date and a
/// trip that ends before it starts are ordinary input, not bugs.
public func spanProblem(_ startDate: String, _ endDate: String, what: String = "trip") -> String? {
    if !isIsoDate(startDate) { return "Pick a start date for the \(what)." }
    if !isIsoDate(endDate) { return "Pick an end date for the \(what)." }
    if startDate > endDate { return "The \(what) ends before it starts." }
    return nil
}

/// Same, plus the requirement that a stage sits inside its trip.
public func stageProblem(_ trip: TripDoc, _ stage: TripStage) -> String? {
    if let span = spanProblem(stage.startDate, stage.endDate, what: "stage") { return span }
    if !isWithin(trip.startDate, trip.endDate, stage.startDate) { return "That stage starts before the trip does." }
    if !isWithin(trip.startDate, trip.endDate, stage.endDate) { return "That stage ends after the trip does." }
    return nil
}

// MARK: - reading a current record
//
// These read a record already on the CURRENT shape (the migrations have run:
// `readTripDoc` in `TripMigrations.swift`). The web trusts a current document
// and reads it as it is; here every field is typed, so a missing or junk one
// takes the factory's value — "anything a past version never wrote gets the
// same default a new trip gets" — and an unknown key is carried.

private let placeKeys: Set<String> = ["id", "name", "region", "coords"]

public func readTripPlace(_ raw: JSONValue?, makeId: () -> String = newTripId) -> TripPlace? {
    guard let o = raw?.objectValue else { return nil }
    var coords: GeoPoint? = nil
    if let c = o["coords"]?.objectValue, let lat = c["lat"]?.finiteNumber, let lon = c["lon"]?.finiteNumber {
        coords = GeoPoint(lat: lat, lon: lon)
    }
    return TripPlace(id: idOf(o["id"], makeId), name: o["name"]?.stringValue ?? "",
                     region: o["region"]?.stringValue ?? "", coords: coords, carried: unknownKeys(o, placeKeys))
}

public func readStageOrigin(_ raw: JSONValue?) -> StageOrigin? {
    guard let o = raw?.objectValue else { return nil }
    return StageOrigin(sourceId: o["sourceId"]?.stringValue ?? "", chapterId: o["chapterId"]?.stringValue ?? "",
                       revision: o["revision"]?.stringValue, importedAt: o["importedAt"]?.finiteNumber ?? 0)
}

private let stageKeys: Set<String> = ["id", "name", "region", "startDate", "endDate", "places", "origin"]

public func readTripStage(_ raw: JSONValue?, makeId: () -> String = newTripId) -> TripStage? {
    guard let o = raw?.objectValue else { return nil }
    return TripStage(
        id: idOf(o["id"], makeId), name: o["name"]?.stringValue ?? "", region: o["region"]?.stringValue ?? "",
        startDate: o["startDate"]?.stringValue ?? "", endDate: o["endDate"]?.stringValue ?? "",
        places: (o["places"]?.arrayValue ?? []).compactMap { readTripPlace($0, makeId: makeId) },
        origin: readStageOrigin(o["origin"]), carried: unknownKeys(o, stageKeys)
    )
}

private let badgeKeys: Set<String> = [
    "mode", "layout", "timeAgo", "referenceDate", "showPin", "showExif", "camera", "durationSeconds", "medium",
    "hookSeconds", "shades", "aspectId", "videoTimeSeconds", "videoSpeed", "framing", "motion", "develop", "grade",
    "cascade", "collage", "textOverrides", "pieceStyles", "hook",
]

/// A stored badge read back, the factory badge of `kind` standing in for what
/// it lacks. A missing screen time is derived from the badge's own hold, the
/// way the migrations derive it.
public func readPostBadge(_ raw: JSONValue?, kind: PostKind = .photo, makeId: () -> String = newTripId) -> PostBadge {
    let o = raw?.objectValue ?? [:]
    let d = defaultPostBadge(kind)
    var b = d
    b.mode = word(o["mode"], d.mode)
    if o["layout"]?.objectValue != nil { b.layout = readBadgeLayout(o["layout"]) }
    b.timeAgo = word(o["timeAgo"], d.timeAgo)
    b.referenceDate = o["referenceDate"]?.stringValue
    b.showPin = o["showPin"]?.boolValue ?? d.showPin
    b.showExif = o["showExif"]?.boolValue ?? d.showExif
    b.camera = o["camera"]?.objectValue != nil ? readPlateSpec(o["camera"]) : nil
    b.durationSeconds = o["durationSeconds"]?.finiteNumber ?? d.durationSeconds
    b.medium = word(o["medium"], d.medium)
    b.hookSeconds = o["hookSeconds"]?.finiteNumber ?? defaultHookSeconds(b.durationSeconds)
    b.shades = readShades(o["shades"], makeId: makeId)
    b.aspectId = o["aspectId"]?.stringValue ?? d.aspectId
    b.videoTimeSeconds = o["videoTimeSeconds"]?.finiteNumber ?? d.videoTimeSeconds
    b.videoSpeed = o["videoSpeed"]?.finiteNumber ?? d.videoSpeed
    b.framing = normaliseFraming(o["framing"])
    b.motion = readMotion(o["motion"])
    b.develop = developOrNull(o["develop"])
    b.grade = gradeOrNull(o["grade"])
    b.cascade = readCascade(o["cascade"])
    b.collage = readCollage(o["collage"])
    b.textOverrides = readTextOverrides(o["textOverrides"])
    b.pieceStyles = readBadgePieceStyles(o["pieceStyles"])
    if o["hook"] != nil { b.hook = readHookLayers(o["hook"]) }
    b.carried = unknownKeys(o, badgeKeys)
    return b
}

private let hookDefaultsKeys: Set<String> = [
    "aspectId", "mode", "timeAgo", "showPin", "showExif", "camera", "durationSeconds", "medium", "hookSeconds",
    "layout", "pieceStyles", "cascade", "shades", "hook",
]

/// A remembered look read back, or nil when it is not a record; the factory
/// look of `kind` stands in for what it lacks.
public func readHookDefaults(_ raw: JSONValue?, kind: PostKind, makeId: () -> String = newTripId) -> HookDefaults? {
    guard let o = raw?.objectValue else { return nil }
    var d = hookDefaultsFrom(defaultPostBadge(kind), makeId: makeId)
    d.aspectId = o["aspectId"]?.stringValue ?? d.aspectId
    d.mode = word(o["mode"], d.mode)
    d.timeAgo = word(o["timeAgo"], d.timeAgo)
    d.showPin = o["showPin"]?.boolValue ?? d.showPin
    d.showExif = o["showExif"]?.boolValue ?? d.showExif
    d.camera = o["camera"]?.objectValue != nil ? readPlateSpec(o["camera"]) : nil
    d.durationSeconds = o["durationSeconds"]?.finiteNumber ?? d.durationSeconds
    d.medium = word(o["medium"], d.medium)
    d.hookSeconds = o["hookSeconds"]?.finiteNumber ?? defaultHookSeconds(d.durationSeconds)
    if o["layout"]?.objectValue != nil { d.layout = readBadgeLayout(o["layout"]) }
    d.pieceStyles = readBadgePieceStyles(o["pieceStyles"])
    d.cascade = readCascade(o["cascade"])
    d.shades = readShades(o["shades"], makeId: makeId)
    if o["hook"] != nil { d.hook = readHookLayers(o["hook"]) }
    d.carried = unknownKeys(o, hookDefaultsKeys)
    return d
}

private let slideKeys: Set<String> = [
    "id", "media", "videoTimeSeconds", "videoSpeed", "framing", "motion", "develop", "grade", "collage",
    "caption", "medium", "seconds",
]

public func readPostSlide(_ raw: JSONValue?, makeId: () -> String = newTripId) -> PostSlide? {
    guard let o = raw?.objectValue else { return nil }
    return PostSlide(
        id: idOf(o["id"], makeId), media: tripMediaRef(o["media"]),
        videoTimeSeconds: o["videoTimeSeconds"]?.finiteNumber ?? 0, videoSpeed: o["videoSpeed"]?.finiteNumber ?? 1,
        framing: normaliseFraming(o["framing"]), motion: readMotion(o["motion"]), develop: developOrNull(o["develop"]),
        grade: gradeOrNull(o["grade"]), collage: readCollage(o["collage"]), caption: o["caption"]?.stringValue ?? "",
        medium: word(o["medium"], SlideMedium.auto), seconds: o["seconds"]?.finiteNumber ?? defaultSlideSeconds,
        carried: unknownKeys(o, slideKeys)
    )
}

private let postKeys: Set<String> = [
    "id", "kind", "date", "endDate", "title", "media", "badge", "slides", "includeCta", "projectId", "grade",
    "publishedAt", "createdAt",
]

public func readTripPost(_ raw: JSONValue?, now: Double = nowMillis(), makeId: () -> String = newTripId) -> TripPost? {
    guard let o = raw?.objectValue else { return nil }
    let kind = word(o["kind"], PostKind.photo)
    return TripPost(
        id: idOf(o["id"], makeId), kind: kind, date: o["date"]?.stringValue ?? "", endDate: o["endDate"]?.stringValue,
        title: o["title"]?.stringValue ?? "", media: tripMediaRef(o["media"]),
        badge: readPostBadge(o["badge"], kind: kind, makeId: makeId),
        slides: (o["slides"]?.arrayValue ?? []).compactMap { readPostSlide($0, makeId: makeId) },
        includeCta: o["includeCta"]?.boolValue == true, projectId: o["projectId"]?.stringValue,
        grade: gradeOrNull(o["grade"]), publishedAt: o["publishedAt"]?.finiteNumber,
        createdAt: o["createdAt"]?.finiteNumber ?? now, carried: unknownKeys(o, postKeys)
    )
}

public func readTripCover(_ raw: JSONValue?) -> TripCover {
    let o = raw?.objectValue ?? [:]
    return TripCover(layout: word(o["layout"], CoverLayout.mosaic),
                     pinned: (o["pinned"]?.arrayValue ?? []).compactMap(\.stringValue))
}

private let tripKeys: Set<String> = [
    "version", "id", "name", "startDate", "endDate", "stages", "posts", "badgeWords", "cameraNames", "theme",
    "cta", "hookDefaults", "grade", "cover", "developPresets", "car", "sourceId", "createdAt", "updatedAt",
]

/// A trip on the CURRENT shape read into its record, or nil when it is not a
/// record or names no id. `readTripDoc` runs the migrations first; call this
/// only on what they returned.
func tripDocFromCurrent(_ o: [String: JSONValue], now: Double, makeId: () -> String) -> TripDoc? {
    guard let id = o["id"]?.stringValue, !id.isEmpty else { return nil }
    var cameraNames: [String: String]? = nil
    if let names = o["cameraNames"]?.objectValue {
        cameraNames = names.compactMapValues(\.stringValue)
    }
    var hookDefaults: HookDefaultsByKind = [:]
    for (key, value) in o["hookDefaults"]?.objectValue ?? [:] {
        guard let kind = PostKind(rawValue: key), let look = readHookDefaults(value, kind: kind, makeId: makeId) else { continue }
        hookDefaults[kind] = look
    }
    let version = JSLoose.number(o["version"])
    return TripDoc(
        version: version.isFinite && abs(version) < 1e9 ? Int(version) : tripDocVersion,
        id: id,
        name: o["name"]?.stringValue ?? "",
        startDate: o["startDate"]?.stringValue ?? "",
        endDate: o["endDate"]?.stringValue ?? "",
        stages: (o["stages"]?.arrayValue ?? []).compactMap { readTripStage($0, makeId: makeId) },
        posts: (o["posts"]?.arrayValue ?? []).compactMap { readTripPost($0, now: now, makeId: makeId) },
        badgeWords: readBadgeWords(o["badgeWords"]),
        cameraNames: cameraNames,
        theme: readStyleTheme(o["theme"]),
        cta: readCtaSlide(o["cta"]),
        hookDefaults: hookDefaults,
        grade: gradeOrNull(o["grade"]) ?? emptyGrade(),
        cover: readTripCover(o["cover"]),
        developPresets: normaliseDevelopPresets(o["developPresets"]),
        car: readCarSpec(o["car"]),
        sourceId: o["sourceId"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? defaultSourceId,
        createdAt: o["createdAt"]?.finiteNumber ?? now,
        updatedAt: o["updatedAt"]?.finiteNumber ?? now,
        carried: unknownKeys(o, tripKeys)
    )
}
