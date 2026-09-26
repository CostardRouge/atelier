// A piece's OPENER — port of `src/shared/roadtrip/hooks/hook-variant.ts`: the
// half the trip document stores (the layer list, its default, the options
// record, a picture an opener's options name) and the CONTRACT a variant is
// written against (what it needs, what the shell hands it, what `prepare`
// returns, how several layers fold into one reader). The list of variants and
// `resolveHook` are `HookRegistry.swift`.
//
// The contract's three rules, enforced by its shape (`docs/hook-engine.md`):
// 1. `prepare` returns ONE value (`HookRender`) whose readers — the content,
//    the drawing and the score — all hold the plan it built once. Nothing
//    hands a plan around to be recomputed, so the numeral, the picture and
//    the tick in the ear cannot drift apart.
// 2. A variant rewrites named badge PIECES (`HookContentPatch`); it never
//    builds elements, so the theme, the ids and the hit-testing keep working
//    whatever draws.
// 3. A variant never fetches and never reads the store: `needs` and
//    `wantsPictures` declare what the shell resolves into `HookContext`.
//
// The PAINT is the app's (Core Graphics), and this is how the contract keeps
// rule 1 without it: `prepare` puts a DRAWING in its render — a value
// conforming to `HookDrawing` that holds the very plan its content and score
// closures captured (Défilé's is `ScrubDrawing`). The app keeps one painter
// that switches on the drawing's type, and `ResolvedHook.paint(g, t, frame,
// painter)` hands it every layer's drawing in order — the web's `paint` loop.
// The picker card (`Sketch`) and the options panel (`Panel`) are SwiftUI views
// the app keys by variant id; what a panel may ask the shell for is described
// here (`HookPictureChoice`, `HookPictureStatus`), the asking is the app's.
//
// Rules kept:
// - A layer's OPTIONS are a plain JSON record, never typed here: it is what
//   travels in `.roadtrip.json` and what a newer build may have written keys
//   into that this one does not know. A variant reads it through its own
//   defaults (`readOptions`), and a layer read back writes back exactly the
//   record it held.
// - The hook is a LIST from its first version with one entry today, so a
//   stack costs no second migration (`docs/hook-engine.md` §D3).
// - An id this build does not know is kept: it is skipped at resolve time, and
//   a trip written by a newer Atelier opens here and loses only its opener.

import Foundation

/// A variant's stored settings — a plain JSON record.
public typealias HookOptions = [String: JSONValue]

/// One entry of a piece's hook — a variant, and the settings it was given.
public struct HookLayer: Equatable, Sendable {
    public var id: String
    public var options: HookOptions

    public init(id: String, options: HookOptions = [:]) {
        self.id = id
        self.options = options
    }

    /// The layer as the document holds it.
    public var json: JSONValue {
        .object(["id": .string(id), "options": .object(options)])
    }
}

/// The variant every piece starts on: the badge, drawing nothing extra.
public let defaultHookId = "badge"

/// A fresh opener list: the badge alone.
public func defaultHookLayers() -> [HookLayer] {
    [HookLayer(id: defaultHookId, options: [:])]
}

/// Merge a variant's defaults UNDER what was stored — `{ ...defaults, ...options }`.
/// A variant never reads `options` directly: a document written before one of
/// its settings existed is the normal case, not an error.
public func readOptions(_ options: HookOptions, _ defaults: HookOptions) -> HookOptions {
    defaults.merging(options) { _, stored in stored }
}

/// A stored layer list read back. An entry that is not a record, or names no
/// variant, is dropped; a layer whose options are not a record keeps none.
public func readHookLayers(_ raw: JSONValue?) -> [HookLayer] {
    guard let list = raw?.arrayValue else { return [] }
    return list.compactMap { entry -> HookLayer? in
        guard let o = entry.objectValue, let id = o["id"]?.stringValue else { return nil }
        return HookLayer(id: id, options: o["options"]?.objectValue ?? [:])
    }
}

/// A picture the author picked for a variant, stored in its options: the ref
/// the shell finds the file again by, and the day it was shot.
public struct HookPickedPicture: Equatable, Sendable {
    public var ref: SavedMediaRef
    /// The day the picture was shot, `YYYY-MM-DD`.
    public var date: String
    /// The capture instant in ms, when known — orders one day's pictures.
    public var takenAt: Double?
    /// Where it was shot, when its EXIF (or the instance) says. Absent is the
    /// normal case for a camera without GPS, never an error.
    public var coords: GeoPoint?

    public init(ref: SavedMediaRef, date: String, takenAt: Double? = nil, coords: GeoPoint? = nil) {
        self.ref = ref; self.date = date; self.takenAt = takenAt; self.coords = coords
    }

    /// The picture as an opener's options hold it: `takenAt` and `coords` only when known.
    public var json: JSONValue {
        var o: [String: JSONValue] = ["ref": ref.json, "date": .string(date)]
        if let takenAt { o["takenAt"] = .number(takenAt) }
        if let coords { o["coords"] = .object(["lat": .number(coords.lat), "lon": .number(coords.lon)]) }
        return .object(o)
    }
}

// MARK: - the frame

/// The output frame, in device pixels. The web's `FrameBox`.
public typealias FrameBox = Size

/// A rectangle inside the output frame, in the frame's own pixels. The web's `FrameRect`.
public typealias FrameRect = Rect

// MARK: - what a variant needs the shell to resolve

/// Which pool a variant wants pictures from: the day this piece tells, the
/// piece's own other slides, or one per leg of the trip.
public enum HookMediaNeed: String, CaseIterable, Sendable {
    case day, deck, stage
}

/// What a variant needs the SHELL to resolve before it can prepare. Declaring
/// it is what lets an export pre-pass know what to fetch and decode, and what
/// lets the picker grey a variant a trip cannot feed.
public struct HookNeeds: Equatable, Sendable {
    /// The trip's per-day piece counts (`tripCoverage`).
    public var coverage: Bool
    /// The trip's legs, in the order they were lived.
    public var stages: Bool
    /// Places carrying coordinates — anything that draws a route or a map.
    public var places: Bool
    /// Pictures beyond the hook's own, and where they come from.
    public var media: HookMediaNeed?

    public init(coverage: Bool = false, stages: Bool = false, places: Bool = false, media: HookMediaNeed? = nil) {
        self.coverage = coverage; self.stages = stages; self.places = places; self.media = media
    }
}

// MARK: - what the shell hands a variant

/// One piece telling a day, as far as a hook needs to name it.
public struct HookDayPiece: Equatable, Sendable {
    public var id: String
    /// The piece's title, or empty.
    public var title: String
    public var published: Bool
    /// The SOURCE picture the piece's hook is composed over — the file, never
    /// the piece's finished hook: a flash of a composed hook shows another
    /// badge burned into it. Nil when the piece has no picture yet.
    public var media: SavedMediaRef?
    /// Where the hook's frame sits in its clip, when that picture is a clip.
    public var videoSeconds: Double

    public init(id: String, title: String = "", published: Bool = false, media: SavedMediaRef? = nil, videoSeconds: Double = 0) {
        self.id = id; self.title = title; self.published = published; self.media = media; self.videoSeconds = videoSeconds
    }
}

/// One day of the trip, as a hook reads it. Built by the shell from the
/// coverage and the stages (`HookCalendar.swift`), never by a variant.
public struct HookDay: Equatable, Sendable {
    public var date: IsoDate
    /// 1-based day of the trip.
    public var dayNumber: Int
    /// ANOTHER piece tells this day — the one being composed never counts.
    public var told: Bool
    /// A leg of the trip starts on this day.
    public var legStart: Bool
    /// The OTHER pieces telling this day, in the trip's order. Empty when
    /// `told` is false.
    public var pieces: [HookDayPiece]

    public init(date: IsoDate, dayNumber: Int, told: Bool = false, legStart: Bool = false, pieces: [HookDayPiece] = []) {
        self.date = date; self.dayNumber = dayNumber; self.told = told; self.legStart = legStart; self.pieces = pieces
    }
}

/// The key a picture is decoded under — what `HookContext.pictures` is keyed
/// by and what a variant's stop names. The source's own id first, the content
/// hash next, the name and size last: the order `findMedia` resolves in, so
/// two refs to one file share one decode.
public func hookPictureKey(_ ref: SavedMediaRef) -> String {
    if let assetId = ref.assetId, !assetId.isEmpty { return "id:\(assetId)" }
    if let hash = ref.hash, !hash.isEmpty { return "hash:\(hash)" }
    return "name:\(ref.name.lowercased()):\(ref.size)"
}

/// The shape a wanted picture is decoded to. `frame` crops it to the output's
/// own shape, for a picture that fills the frame; `own` keeps it whole at its
/// own aspect, for one drawn as a print (`PictureBudget.swift`).
public enum HookPictureShape: String, CaseIterable, Sendable {
    case frame, own
}

/// A picture a variant asks the shell for, under the key it will draw it by.
public struct HookPictureWant: Equatable, Sendable {
    /// `hookPictureKey(ref)`.
    public var key: String
    public var ref: SavedMediaRef
    /// For a clip: the second its frame is taken at. Ignored for a still.
    public var atSeconds: Double?
    /// The shape it is decoded to; nil reads `frame`.
    public var shape: HookPictureShape?

    public init(key: String, ref: SavedMediaRef, atSeconds: Double? = nil, shape: HookPictureShape? = nil) {
        self.key = key; self.ref = ref; self.atSeconds = atSeconds; self.shape = shape
    }
}

/// A located place of a leg — a place with no coordinates is left out of a
/// `HookStage`: it is a complete place, but nothing a drawing can put on a line.
public struct HookStagePlace: GeoLocated, Equatable, Sendable {
    public var name: String
    public var lat: Double
    public var lon: Double

    public init(name: String, lat: Double, lon: Double) {
        self.name = name; self.lat = lat; self.lon = lon
    }
}

/// One leg of the trip, as a hook reads it — its span and its LOCATED places
/// in the order they were lived.
public struct HookStage: Equatable, Sendable {
    public var startDate: IsoDate
    public var endDate: IsoDate
    /// What the badge calls this leg (`stageLabel`).
    public var label: String
    public var places: [HookStagePlace]

    public init(startDate: IsoDate, endDate: IsoDate, label: String = "", places: [HookStagePlace] = []) {
        self.startDate = startDate; self.endDate = endDate; self.label = label; self.places = places
    }
}

/// A decoded picture a variant may draw, with the size it was decoded at.
/// `image` is the app's (a `CGImage`, or a box around one) and opaque here:
/// the kernel reads only the size, which is all a plan's layout needs.
public struct HookPicture: Sendable {
    public var image: (any Sendable)?
    public var width: Double
    public var height: Double

    public init(image: (any Sendable)? = nil, width: Double, height: Double) {
        self.image = image; self.width = width; self.height = height
    }
}

/// Everything a variant is allowed to read, resolved by the shell from the
/// document (`hookContextFor`, the one place it is built).
public struct HookContext: Sendable {
    /// Frame aspect, width / height.
    public var aspect: Double
    /// The hook's own life in seconds — `PostBadge.durationSeconds`, what an
    /// exit animation lands on. A variant is TOLD how long it has; it never
    /// chooses, which is what stops two layers disagreeing.
    public var durationSeconds: Double
    /// The day this piece tells, `YYYY-MM-DD`.
    public var date: IsoDate
    /// The badge's computed content, before any variant rewrites a piece.
    public var content: BadgeContent?
    /// What the badge's numeral counts. A variant that steps the numeral
    /// through trip days leaves it alone under any other counter: "1, 3, 5…"
    /// in a numeral labelled as a day AT A PLACE would be a fabricated reading.
    public var counterMode: CounterMode?
    /// How long the hook slide is ON SCREEN (`PostBadge.hookSeconds`) — not
    /// the badge's life; what a variant compares its own length against.
    public var screenSeconds: Double?
    /// Every day of the trip, in order — filled when `needs.coverage` asks.
    public var calendar: [HookDay]?
    /// The trip's legs, in the order they were lived — filled for `needs.stages`.
    public var stages: [HookStage]?
    /// The pictures a variant asked for (`wantsPictures`), decoded, keyed by
    /// `hookPictureKey`. A key with no entry has nothing to show — not found,
    /// not reachable, or still loading; a variant draws nothing for it.
    public var pictures: [String: HookPicture]?
    /// The trip's car (`TripDoc.car`); a hand-built context without it drives
    /// the default car.
    public var car: CarSpec?

    public init(aspect: Double, durationSeconds: Double, date: IsoDate, content: BadgeContent? = nil,
                counterMode: CounterMode? = nil, screenSeconds: Double? = nil, calendar: [HookDay]? = nil,
                stages: [HookStage]? = nil, pictures: [String: HookPicture]? = nil, car: CarSpec? = nil) {
        self.aspect = aspect; self.durationSeconds = durationSeconds; self.date = date; self.content = content
        self.counterMode = counterMode; self.screenSeconds = screenSeconds; self.calendar = calendar
        self.stages = stages; self.pictures = pictures; self.car = car
    }
}

// MARK: - what prepare returns

/// What a layer says about ONE badge piece at a moment: new text, or hide it.
/// A piece the patch does not name is left as the badge computed it — the
/// web's `undefined` ("nothing to say") against its `null` ("hide").
public enum HookPieceWrite: Equatable, Sendable {
    case text(String)
    case hide
}

/// The pieces a layer rewrites at `t`, merged OVER the computed content. The
/// web's `Partial<Record<BadgePiece, string | null>>`.
public typealias HookContentPatch = [BadgePiece: HookPieceWrite]

/// What a prepared layer hands the app's painter: the plan `prepare` built,
/// the SAME one its content and score closures read. A marker protocol — the
/// app's painter switches on the concrete type (`ScrubDrawing`, …).
public protocol HookDrawing: Sendable {}

/// A prepared hook: the one value every downstream reader shares.
public struct HookRender: Sendable {
    /// Seconds this layer occupies. 0 means it plays nothing — the badge's own
    /// case, and the reason a hook with no variant costs no time.
    public var seconds: Double
    /// The pieces this layer rewrites at `t`. Nil = the badge says what it
    /// always said.
    public var content: (@Sendable (_ t: Double) -> HookContentPatch)?
    /// What the app paints between the picture and the shades, at the output's
    /// own size. Nil = this layer draws nothing.
    public var drawing: (any HookDrawing)?
    /// The bed, as times and voices, rendered offline at export.
    public var score: (@Sendable () -> [SoundEvent])?
    /// Over a clip that has sound of its own: mix the score into it (re-encoding
    /// the clip's sound) rather than leave it out. False keeps the clip's sound
    /// bit for bit — re-encoding someone's recording is never done behind their
    /// back. A clip with no sound takes the score as its track either way.
    public var mixWithSource: Bool

    public init(seconds: Double = 0, content: (@Sendable (_ t: Double) -> HookContentPatch)? = nil,
                drawing: (any HookDrawing)? = nil, score: (@Sendable () -> [SoundEvent])? = nil,
                mixWithSource: Bool = false) {
        self.seconds = seconds; self.content = content; self.drawing = drawing; self.score = score
        self.mixWithSource = mixWithSource
    }
}

// MARK: - what a panel may ask the shell for

/// How a variant wants the picture chooser to open.
public struct HookPictureChoice: Equatable, Sendable {
    /// Open on the piece's OWN day as well, rather than the days before it: a
    /// sweep is a run-up to the piece; an itinerary's stops are as often the
    /// day being told.
    public var includeThisDay: Bool
    /// The variant uses a picture shot AFTER this piece's day. Without it, such
    /// a picture is offered but marked as left off (`laterLeftOff`).
    public var keepsLater: Bool

    public init(includeThisDay: Bool = false, keepsLater: Bool = false) {
        self.includeThisDay = includeThisDay; self.keepsLater = keepsLater
    }
}

/// How the pictures a variant asked for are coming along.
public struct HookPictureStatus: Equatable, Sendable {
    /// Pictures still being found, fetched or decoded.
    public var pending: Int
    /// Keys that could not be drawn, each with one line saying why.
    public var problems: [String: String]

    public init(pending: Int = 0, problems: [String: String] = [:]) {
        self.pending = pending; self.problems = problems
    }
}

// MARK: - the variant

/// Which part of the frame a variant owns: a `frame` owner replaces the
/// picture (a scrub IS the picture while it sweeps), a `layer` draws over
/// whatever is already there. The one thing a stack will ever arbitrate.
public enum HookOwns: String, CaseIterable, Sendable {
    case frame, layer
}

/// A hook variant — a different drawing over the same document. Adding one is
/// a value like this and a line in `hookVariants`.
public struct HookVariant: Sendable {
    public var id: String
    /// Shown on the picker card.
    public var name: String
    public var tagline: String
    public var defaults: HookOptions
    /// The option keys that hold what the author gave ONE piece — the pictures
    /// a sweep flashes, an itinerary's stops — rather than how the opener is
    /// drawn. A look that leaves its trip (the house style) resets them to
    /// `defaults`: a picture ref from one journey is nothing in the next. Nil =
    /// every option is look.
    public var contentKeys: [String]?
    public var needs: HookNeeds
    public var owns: HookOwns
    public var prepare: @Sendable (_ options: HookOptions, _ ctx: HookContext) -> HookRender
    /// Why this variant cannot run on this piece, or nil when it can.
    public var unmet: (@Sendable (_ ctx: HookContext) -> String?)?
    /// The pictures this variant will actually draw, each under the key it will
    /// look it up by. The shell finds, fetches and decodes exactly these: a trip
    /// of 250 pieces must not decode 250 pictures for a sweep that stops twelve times.
    public var wantsPictures: (@Sendable (_ options: HookOptions, _ ctx: HookContext) -> [HookPictureWant])?
    /// Where this opener's drawing sits in the frame, so the stage can let it be
    /// pointed at and dragged. Editor-only, and deliberately NOT on
    /// `HookRender`: none of the renderers or exports has any business knowing
    /// where a pointer is. Nil = not grabbable; a press falls through to the picture.
    public var frameBox: (@Sendable (_ options: HookOptions, _ ctx: HookContext, _ frame: FrameBox) -> FrameRect?)?
    /// The same drawing moved by a drag — `dx` a fraction of the frame's width,
    /// `dy` of its height, INCREMENTAL. Pure: options in, options out. A variant
    /// with a `frameBox` and no `moveBy` can be selected but not moved.
    public var moveBy: (@Sendable (_ options: HookOptions, _ dx: Double, _ dy: Double) -> HookOptions)?

    public init(id: String, name: String, tagline: String, defaults: HookOptions = [:], contentKeys: [String]? = nil,
                needs: HookNeeds = HookNeeds(), owns: HookOwns,
                prepare: @escaping @Sendable (_ options: HookOptions, _ ctx: HookContext) -> HookRender,
                unmet: (@Sendable (_ ctx: HookContext) -> String?)? = nil,
                wantsPictures: (@Sendable (_ options: HookOptions, _ ctx: HookContext) -> [HookPictureWant])? = nil,
                frameBox: (@Sendable (_ options: HookOptions, _ ctx: HookContext, _ frame: FrameBox) -> FrameRect?)? = nil,
                moveBy: (@Sendable (_ options: HookOptions, _ dx: Double, _ dy: Double) -> HookOptions)? = nil) {
        self.id = id; self.name = name; self.tagline = tagline; self.defaults = defaults
        self.contentKeys = contentKeys; self.needs = needs; self.owns = owns; self.prepare = prepare
        self.unmet = unmet; self.wantsPictures = wantsPictures; self.frameBox = frameBox; self.moveBy = moveBy
    }
}

/// Choose a variant. Re-selecting the one already there keeps its settings —
/// a click on the card you are on must not silently reset the panel under it —
/// while a real change starts from that variant's own defaults. Only the first
/// layer is written: the stack is storage, not UI (§D3).
public func setHookVariant(_ layers: [HookLayer]?, _ variant: HookVariant) -> [HookLayer] {
    let rest = Array((layers ?? []).dropFirst())
    if let current = layers?.first, current.id == variant.id {
        return [HookLayer(id: current.id, options: current.options)] + rest
    }
    return [HookLayer(id: variant.id, options: variant.defaults)] + rest
}

/// Write the first layer's options, leaving any others alone.
public func setHookOptions(_ layers: [HookLayer]?, _ options: HookOptions) -> [HookLayer] {
    let rest = Array((layers ?? []).dropFirst())
    let id = layers?.first?.id ?? defaultHookId
    return [HookLayer(id: id, options: options)] + rest
}

// MARK: - several layers, read as one

/// The app's side of `paint`: draw one layer's drawing into `G` at `t`, at
/// the output frame's size.
public typealias HookPainter<G> = (_ g: G, _ drawing: any HookDrawing, _ t: Double, _ frame: FrameBox) -> Void

/// Several layers, read as one. What the renderers and the export consume.
public struct ResolvedHook: Sendable {
    /// Seconds the longest layer occupies; 0 when nothing plays.
    public let seconds: Double
    /// True when a layer rewrites badge text. A caller only builds elements per
    /// frame when this is set — the badge alone keeps its static elements.
    public let rewrites: Bool
    /// True when a layer replaces the picture rather than drawing over it.
    public let ownsFrame: Bool
    /// Some layer asked for its score to be mixed into a clip's own sound.
    public let mixWithSource: Bool
    private let layers: [HookRender]

    fileprivate init(layers: [HookRender], ownsFrame: Bool) {
        self.layers = layers
        self.ownsFrame = ownsFrame
        self.seconds = layers.reduce(0) { max($0, $1.seconds) }
        self.rewrites = layers.contains { $0.content != nil }
        self.mixWithSource = layers.contains { $0.mixWithSource && $0.score != nil }
    }

    /// The badge's content after every layer has had its say at `t`. Nil in,
    /// nil out: a hook never invents content out of nothing.
    public func contentAt(_ base: BadgeContent?, _ t: Double) -> BadgeContent? {
        guard var content = base else { return nil }
        for layer in layers {
            guard let patch = layer.content?(t) else { continue }
            for piece in BadgePiece.allCases {
                guard let write = patch[piece] else { continue }
                switch write {
                case .text(let text):
                    content.rewrite(piece, text)
                case .hide:
                    // The headline is the badge: every other piece may be
                    // hidden, that one may only be REWRITTEN.
                    if piece == .headline { continue }
                    content.rewrite(piece, nil)
                }
            }
        }
        return content
    }

    /// Every layer's drawing, in order — what `paint` hands the painter.
    public var drawings: [any HookDrawing] {
        layers.compactMap(\.drawing)
    }

    /// Paint every layer, in order, through the app's painter.
    public func paint<G>(_ g: G, _ t: Double, _ frame: FrameBox, _ painter: HookPainter<G>) {
        for drawing in drawings { painter(g, drawing, t, frame) }
    }

    /// Every layer's events, in time order (a stable sort, as the web's).
    public func score() -> [SoundEvent] {
        let events = layers.flatMap { $0.score?() ?? [] }
        return events.enumerated()
            .sorted { a, b in a.element.at < b.element.at || (a.element.at == b.element.at && a.offset < b.offset) }
            .map(\.element)
    }
}

extension BadgeContent {
    /// One piece rewritten; nil hides it. The headline is never hidden
    /// (`ResolvedHook.contentAt` never asks).
    fileprivate mutating func rewrite(_ piece: BadgePiece, _ text: String?) {
        switch piece {
        case .kicker: kicker = text
        case .label: label = text
        case .headline: if let text { headline = text }
        case .counter: counter = text
        case .caption: caption = text
        case .timing: timing = text
        case .exif: exif = text
        }
    }
}

/// Fold prepared layers into one reader. Content collisions resolve to the
/// LAST layer that speaks — the rule `stageAt` uses for overlapping legs, and
/// the only one that stays predictable when a stack is reordered.
public func foldHook(_ layers: [HookRender], _ ownsFrame: Bool) -> ResolvedHook {
    ResolvedHook(layers: layers, ownsFrame: ownsFrame)
}
