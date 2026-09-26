// The HOUSE STYLE — the look a brand-new trip starts from, once the maintainer
// has saved one from a trip he likes. Port of
// `src/shared/roadtrip/house-style.ts`.
//
// On the web it is ONE committed file, `src/shared/roadtrip/house-style.json`,
// written by a dev-server-only endpoint; the app READS it — bundled beside
// the binary when there is one (loading the bundle is the app's) — and dresses
// a NEW trip in it (`applyHouseStyle`). The writer is ported too
// (`houseStyleFrom`, `serializeHouseStyle`), for parity and for a native
// "save as house style" later; its text is sorted-key JSON, not the web's
// insertion order, so a file written here reads back the same everywhere but
// diffs against a web-written one by key order.
//
// Rules kept:
// - It carries the trip's VOICE and nothing that tells one journey: the words,
//   the title style, the closing card, the look each kind of piece starts
//   from, the grade and the car. Never the name, the dates, the legs, the
//   pieces, the cover or the develop presets.
// - What an opener was given for ONE piece (`HookVariant.contentKeys`) goes
//   back to the variant's default; an id this build does not know cannot be
//   cleaned and is kept as it is.
// - An UPLOADED look is dropped from the grade (its whole `.cube` rides in the
//   layer) and named in the snapshot; a film stock's settings stay.
// - A shade's id is made stable (`shade-1`…), so a re-save is an empty diff.
// - A file from a NEWER build is refused rather than half-read; an older one
//   is replayed through the trip migrations inside a blank trip, and a block
//   the file lacks keeps the factory's. `theme: null` is a choice, not a
//   missing block.
// - It is applied to a NEW trip only — never an existing one, an import or a
//   duplicate: the caller decides where, `applyHouseStyle` only copies.

import Foundation

/// Tells the house style apart from any other JSON in the repository.
public let houseStyleKind = "atelier.trip-house-style"

/// Where the web's dev server writes it, relative to the repository.
public let houseStylePath = "src/shared/roadtrip/house-style.json"

/// The fields of `TripDoc` a house style carries — and the only ones.
public struct TripHouseStyle: Equatable, Sendable {
    public var badgeWords: BadgeWords
    public var theme: StyleTheme?
    public var cta: CtaSlide
    public var hookDefaults: HookDefaultsByKind
    public var grade: TripGrade
    public var car: CarSpec

    public init(badgeWords: BadgeWords, theme: StyleTheme?, cta: CtaSlide, hookDefaults: HookDefaultsByKind,
                grade: TripGrade, car: CarSpec) {
        self.badgeWords = badgeWords; self.theme = theme; self.cta = cta; self.hookDefaults = hookDefaults
        self.grade = grade; self.car = car
    }

    /// The style as the file holds it — the six blocks, a missing theme as null.
    public var json: JSONValue {
        var defaults: [String: JSONValue] = [:]
        for (kind, look) in hookDefaults { defaults[kind.rawValue] = look.json }
        return .object([
            "badgeWords": badgeWords.json,
            "theme": theme?.json ?? .null,
            "cta": cta.json,
            "hookDefaults": .object(defaults),
            "grade": grade.json,
            "car": car.json,
        ])
    }
}

/// The six keys, as the file names them.
private let houseStyleKeys = ["badgeWords", "theme", "cta", "hookDefaults", "grade", "car"]

public struct HouseStyleFile: Equatable, Sendable {
    public var kind: String
    /// The `tripDocVersion` it was written at: what lets a later build migrate it.
    public var version: Int
    public var style: TripHouseStyle

    public init(kind: String = houseStyleKind, version: Int, style: TripHouseStyle) {
        self.kind = kind; self.version = version; self.style = style
    }

    public var json: JSONValue {
        .object(["kind": .string(kind), "version": .number(Double(version)), "style": style.json])
    }
}

public struct HouseStyleSnapshot: Equatable, Sendable {
    public var file: HouseStyleFile
    /// The uploaded looks the grade had and the house style leaves behind, by name.
    public var uploadedLooks: [String]

    public init(file: HouseStyleFile, uploadedLooks: [String]) {
        self.file = file; self.uploadedLooks = uploadedLooks
    }
}

/// The style's own fields out of a document, nothing else.
private func pickStyle(_ doc: TripDoc) -> TripHouseStyle {
    TripHouseStyle(badgeWords: doc.badgeWords, theme: doc.theme, cta: doc.cta, hookDefaults: doc.hookDefaults,
                   grade: doc.grade, car: doc.car)
}

/// An opener with what it was given for one piece put back to the variant's default.
private func forgetContent(_ layer: HookLayer) -> HookLayer {
    // An id this build does not know cannot be read, so it cannot be cleaned.
    guard let variant = hookVariantById(layer.id), let keys = variant.contentKeys, !keys.isEmpty else { return layer }
    var options = layer.options
    for key in keys { options[key] = variant.defaults[key] }
    return HookLayer(id: layer.id, options: options)
}

private func styleDefaults(_ defaults: HookDefaults) -> HookDefaults {
    var out = defaults
    // A fresh piece mints its own shade ids; the stored ones only need to be
    // stable, so a re-save of the same trip is an empty diff.
    out.shades = defaults.shades.enumerated().map { i, shade in
        var s = shade
        s.id = "shade-\(i + 1)"
        return s
    }
    out.hook = defaults.hook.map(forgetContent)
    return out
}

/// The trip's look as a file to commit, and what it had to leave behind.
public func houseStyleFrom(_ trip: TripDoc) -> HouseStyleSnapshot {
    var style = pickStyle(trip)
    style.hookDefaults = style.hookDefaults.mapValues(styleDefaults)
    // An uploaded cube's whole lattice cannot be committed; a film stock's
    // settings can, and are exactly what a house style is for.
    let uploaded = style.grade.layers.filter { isUploadedLook($0) }
    style.grade.layers = style.grade.layers.filter { !isUploadedLook($0) }
    return HouseStyleSnapshot(
        file: HouseStyleFile(version: tripDocVersion, style: style),
        uploadedLooks: uploaded.map(\.name)
    )
}

/// The file's text: pretty JSON and a final newline.
public func serializeHouseStyle(_ file: HouseStyleFile) -> String {
    file.json.serialized(pretty: true) + "\n"
}

/// The house style a parsed file holds, on the CURRENT shape — or nil when it
/// is not one, or was written by a newer build.
public func readHouseStyle(_ raw: JSONValue?) -> TripHouseStyle? {
    guard let o = raw?.objectValue, o["kind"] == .string(houseStyleKind) else { return nil }
    guard let stored = o["style"]?.objectValue else { return nil }
    guard case .number(let version)? = o["version"], version.isFinite, version == version.rounded() else { return nil }
    if version < 1 || version > Double(tripDocVersion) { return nil }
    let blank = createTripDoc("", "2000-01-01", "2000-01-01")
    var merged = blank.json.objectValue ?? [:]
    // Presence, not value: a stored `theme: null` is a choice.
    for key in houseStyleKeys where stored.keys.contains(key) { merged[key] = stored[key] }
    merged["version"] = .number(version)
    guard let doc = readTripDoc(.object(merged)) else { return nil }
    return pickStyle(doc)
}

/// A new trip dressed in the house style; nil leaves it on the factory look.
public func applyHouseStyle(_ doc: TripDoc, _ style: TripHouseStyle?) -> TripDoc {
    guard let style else { return doc }
    var out = doc
    out.badgeWords = style.badgeWords
    out.theme = style.theme
    out.cta = style.cta
    out.hookDefaults = style.hookDefaults
    out.grade = style.grade
    out.car = style.car
    return out
}
