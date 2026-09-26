// A CAMERA PLATE as a document stores it — port of the stored half of
// `src/shared/overlay/camera-plate.ts`: what the author chose (the facts, in
// order, one of eight layouts, where it sits, how big) and the plate's words.
//
// Types + reader only; the behaviour of `camera-plate.ts` (the runs in U, the
// widths in JetBrains Mono, the layouts, the elements handed to the overlay
// engine) is ported later INTO THIS FILE.
//
// Rules kept:
// - The SPEC is stored; the facts it is filled with never are — they are
//   measured from the picture at every render (`CameraFacts.swift`).
// - A stored spec is read defensively, field by field: a list that is not one
//   keeps the legacy six, an unknown field is dropped and a repeated one kept
//   once, the size clamped to 0.6…1.8, an unknown layout or place the default.
// - The WORDS are stored as they were TYPED, blanks included (a field that
//   snapped back to its default the moment it was emptied could not be
//   retyped); the drawing reads a blank as the English default
//   (`cameraWordsOf`).

import Foundation

public enum PlateLayout: String, CaseIterable, Sendable {
    case line, tiers, plate, ledger, caption, viewfinder, bar, margin
}

/// Under the badge's block, or in one cell of the frame's 3×3 grid.
public enum PlatePlace: Equatable, Sendable {
    case badge
    case cell(OverlayAnchor)

    public init?(rawValue: String) {
        if rawValue == "badge" { self = .badge; return }
        guard let anchor = OverlayAnchor(rawValue: rawValue) else { return nil }
        self = .cell(anchor)
    }

    public var rawValue: String {
        switch self {
        case .badge: return "badge"
        case .cell(let anchor): return anchor.rawValue
        }
    }
}

/// What the author chose. Stored; the facts it is filled with never are.
public struct CameraPlateSpec: Equatable, Sendable {
    /// The facts shown, in the order they are read.
    public var fields: [CameraField]
    public var layout: PlateLayout
    public var place: PlatePlace
    /// A multiple of the plate's own size, 0.6..1.8.
    public var size: Double

    public init(fields: [CameraField], layout: PlateLayout, place: PlatePlace, size: Double) {
        self.fields = fields; self.layout = layout; self.place = place; self.size = size
    }

    /// The spec as the document holds it.
    public var json: JSONValue {
        .object([
            "fields": .array(fields.map { .string($0.rawValue) }),
            "layout": .string(layout.rawValue),
            "place": .string(place.rawValue),
            "size": .number(size),
        ])
    }
}

public let minPlateSize = 0.6
public let maxPlateSize = 1.8

/// What a credit that never chose draws: the legacy line, under the badge.
public func defaultPlateSpec() -> CameraPlateSpec {
    CameraPlateSpec(fields: legacyCameraFields, layout: .line, place: .badge, size: 1)
}

/// A stored spec read defensively — junk lands on the defaults, field by field.
public func readPlateSpec(_ value: JSONValue?) -> CameraPlateSpec {
    let v = value?.objectValue ?? [:]
    var out = defaultPlateSpec()
    if let list = v["fields"]?.arrayValue {
        var seen = Set<CameraField>()
        out.fields = list.compactMap { entry -> CameraField? in
            guard let field = entry.stringValue.flatMap(CameraField.init(rawValue:)), !seen.contains(field) else { return nil }
            seen.insert(field)
            return field
        }
    }
    if let size = v["size"]?.finiteNumber { out.size = min(maxPlateSize, max(minPlateSize, size)) }
    if let layout = v["layout"]?.stringValue.flatMap(PlateLayout.init(rawValue:)) { out.layout = layout }
    if let place = v["place"]?.stringValue.flatMap(PlatePlace.init(rawValue:)) { out.place = place }
    return out
}

/// The plate's words. English by default and every one editable on the trip,
/// like the badge's own: a plate is published copy.
public struct CameraWords: Equatable, Sendable {
    /// What an italic caption opens with: "Shot on DJI Mini 4 Pro".
    public var shotOn: String
    /// Each fact's label, where a layout labels them.
    public var tags: [CameraField: String]

    public init(shotOn: String, tags: [CameraField: String]) {
        self.shotOn = shotOn
        self.tags = tags
    }

    /// The words as the document holds them — every tag the record has.
    public var json: JSONValue {
        var t: [String: JSONValue] = [:]
        for (field, word) in tags { t[field.rawValue] = .string(word) }
        return .object(["shotOn": .string(shotOn), "tags": .object(t)])
    }
}

/// The web's `DEFAULT_CAMERA_WORDS`.
public let defaultCameraWords = CameraWords(shotOn: "Shot on", tags: [
    .body: "Camera", .lens: "Lens", .focal35: "Focal", .focal: "Focal", .aperture: "Aperture",
    .shutter: "Shutter", .iso: "ISO", .ev: "EV", .altitude: "Height",
])

/// The web's `FRENCH_CAMERA_WORDS`.
public let frenchCameraWords = CameraWords(shotOn: "Pris au", tags: [
    .body: "Boîtier", .lens: "Objectif", .focal35: "Focale", .focal: "Focale", .aperture: "Ouverture",
    .shutter: "Vitesse", .iso: "ISO", .ev: "IL", .altitude: "Hauteur",
])

/// Words for DRAWING: every missing or blank one is the English default.
public func cameraWordsOf(_ words: CameraWords?) -> CameraWords {
    var tags = defaultCameraWords.tags
    for info in cameraFields {
        if let t = words?.tags[info.id], !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { tags[info.id] = t }
    }
    let shotOn = words?.shotOn ?? ""
    return CameraWords(
        shotOn: shotOn.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? defaultCameraWords.shotOn : shotOn,
        tags: tags
    )
}

/// Words as a trip STORES them, read back — what was typed, blanks included,
/// every tag the record lacks taking its English default (the trip settings'
/// own reading, `{ ...DEFAULT_CAMERA_WORDS.tags, ...stored.tags }`). Nil when
/// there is no record: a trip written before the plate existed has none.
public func readCameraWords(_ raw: JSONValue?) -> CameraWords? {
    guard let o = raw?.objectValue else { return nil }
    var tags = defaultCameraWords.tags
    let stored = o["tags"]?.objectValue ?? [:]
    for field in CameraField.allCases {
        if let word = stored[field.rawValue]?.stringValue { tags[field] = word }
    }
    return CameraWords(shotOn: o["shotOn"]?.stringValue ?? defaultCameraWords.shotOn, tags: tags)
}
