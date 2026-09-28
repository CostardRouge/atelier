// A grade as a DOCUMENT stores it — its shape, its identity, reading one back
// out of untrusted JSON — and the pure half of turning its layers into the
// ones a bake takes. Port of `src/shared/lut/saved-grade.ts`, plus the
// arithmetic of `restore-grade.ts`'s `restoreLayers` with its two fetches
// (a built-in's `.cube`, a pack look's lattice from the vault) handed in by
// the caller: a phone reads a built-in from its bundle and a pack look from
// its own vault, and neither is the kernel's business.
//
// Rules kept:
// - `gradeKey` reads each layer's IDENTITY, never an uploaded cube's text (an
//   id is minted with its text, which never changes after) — except a FILM
//   layer's settings and a PACK layer's reference, whose text is what says
//   which look it is. The film TEXTURE is folded in too: it changes nothing
//   about the cube, which is exactly why a key over the cube alone would serve
//   the pre-film picture (`render-film.md`).
// - `gradeOrNull`: junk is NO grade; an EMPTY grade is a real departure (the
//   picture that wears no look while the trip wears one) and reads as itself.
// - `restoreLayers`: a look that no longer exists does not come back — a
//   missing look must be visible, never silently neutral — except a PACK look,
//   which comes back in its place carrying `missing` (`media-pipeline.md`).

import Foundation

/// A grade exactly as a document stores it — the Studio's `lutStack` +
/// `outputTransform`, a trip's `grade`, a roll picture's look. Structural: it
/// never learns whose document it came from.
public struct SavedGrade: Equatable, Sendable {
    public var layers: [SavedLutLayer]
    public var output: OutputTransform
    /// Grain and halation, or nil for none. It lives beside the layers because
    /// it is spatial, drawn by the render graph after the cube, and must
    /// cascade with the rung exactly as a look does.
    public var film: FilmTexture?

    public init(layers: [SavedLutLayer] = [], output: OutputTransform = .none, film: FilmTexture? = nil) {
        self.layers = layers; self.output = output; self.film = film
    }
}

extension SavedGrade {
    /// A roll picture's look (`Roll.swift`, whose texture is carried as JSON)
    /// as the structural grade every reader here takes.
    public init(_ grade: RollGrade) {
        self.init(layers: grade.layers, output: grade.output, film: filmTextureOrNull(grade.film))
    }

    /// Written as the web writes it: `film` null when there is none.
    public var json: JSONValue {
        .object(["layers": .array(layers.map(\.json)), "output": .string(output.rawValue),
                 "film": film?.json ?? .null])
    }
}

/// The `source` of a film layer — `FilmLayer.swift` owns the layer.
private let savedFilmSource = "film"

/// A number spelled as JavaScript's template literal spells it.
private func keyNumber(_ v: Double) -> String {
    if v.isNaN { return "NaN" }
    if v.isInfinite { return v > 0 ? "Infinity" : "-Infinity" }
    return JSONValue.number(v).serialized()
}

/// A stable key for a stored grade — what makes "these two pictures wear the
/// same look" a string compare, and what a bake cache is keyed on.
public func gradeKey(_ grade: SavedGrade?) -> String {
    guard let grade else { return "-" }
    let layers = grade.layers.map { l -> String in
        var key = "\(l.id):\(l.source):\(keyNumber(l.intensity)):\(l.enabled ? 1 : 0)"
        if l.source == savedFilmSource || l.source == packSource { key += ":\(l.customText ?? "")" }
        return key
    }
    return ([grade.output.rawValue, filmTextureKey(grade.film)] + layers).joined(separator: "|")
}

/// True for a look UPLOADED from a `.cube` — text a house style cannot carry
/// and a file format would inline. A film layer carries text too, but it is
/// settings; a pack layer's is a ~120-byte reference, never a lattice.
public func isUploadedLook(source: String, customText: String?) -> Bool {
    if source == savedFilmSource || source == packSource { return false }
    return customText != nil
}

public func isUploadedLook(_ layer: SavedLutLayer) -> Bool {
    isUploadedLook(source: layer.source, customText: layer.customText)
}

/// A grade read defensively out of a stored document or an imported file.
public func gradeOrNull(_ value: JSONValue?) -> SavedGrade? {
    guard let raw = value?.objectValue, let rawLayers = raw["layers"]?.arrayValue else { return nil }
    // An unknown transform is not applied on a guess.
    var output = OutputTransform.none
    if let name = raw["output"]?.stringValue, let known = OutputTransform(rawValue: name) { output = known }
    return SavedGrade(
        layers: rawLayers.compactMap(readSavedLayer),
        output: output,
        film: filmTextureOrNull(raw["film"])
    )
}

/// One stored layer, or nil when it has no identity (an `id` and a `source`,
/// both strings). The rest is clamped to something bakeable — exactly the
/// web's reader, which unlike the roll's keeps the name empty and a finite
/// strength as written.
private func readSavedLayer(_ raw: JSONValue) -> SavedLutLayer? {
    guard let o = raw.objectValue, let id = o["id"]?.stringValue, let source = o["source"]?.stringValue else {
        return nil
    }
    return SavedLutLayer(
        id: id,
        source: source,
        name: o["name"]?.stringValue ?? "",
        customText: o["customText"]?.stringValue,
        intensity: o["intensity"]?.finiteNumber ?? 1,
        // Absent means ON: a layer nobody switched off is a layer that grades.
        enabled: o["enabled"]?.boolValue != false
    )
}

// MARK: - resolving a stored grade's layers (`restore-grade.ts`'s arithmetic)

/// What the app's vault answers for a pack reference: the lattice, or why this
/// device cannot grade with it — `lookName` is the name the vault knows the
/// look by (`packLookName`), used when the layer carries none.
public enum PackLookAnswer: Sendable {
    case lattice(CubeLut, lookName: String?)
    case missing(reason: String, lookName: String?)
}

/// A stored grade's layers, resolved and ready to bake.
public struct RestoredLayers: Sendable {
    public var layers: [LutLayer]
    /// The raw text of every layer that carries some — an old inlined `.cube`,
    /// a film stock's settings, a pack reference — by layer id, so a revert
    /// puts the same text back.
    public var customText: [String: String]

    public init(layers: [LutLayer] = [], customText: [String: String] = [:]) {
        self.layers = layers; self.customText = customText
    }
}

/// A stored grade's layers, parsed and ready to bake, in order.
///
/// - `builtin` answers a built-in id (the source without its `builtin:`
///   prefix) with its parsed cube and name, or nil when this build has no such
///   look or it could not be read — and that layer does not come back.
/// - `pack` answers a pack reference; a layer whose reference cannot be read
///   does not come back, while one the vault cannot resolve comes back in its
///   place with an identity cube and `missing`, skipped by the bake.
/// - A FILM layer is generated from its settings, never fetched.
/// - A `custom` layer is an inlined `.cube` from before uploads went into the
///   vault — a READ path that must stay, since such documents exist.
public func restoreLayers(
    _ saved: [SavedLutLayer],
    builtin: (String) -> (lut: CubeLut, name: String)?,
    pack: (PackRef) -> PackLookAnswer
) -> RestoredLayers {
    var out = RestoredLayers()
    for s in saved {
        if isFilmLayer(s) {
            guard let layer = filmLayerFromSaved(s), let text = s.customText, !text.isEmpty else { continue }
            out.customText[s.id] = text
            out.layers.append(layer)
        } else if isPackLayer(s) {
            guard let ref = readPackRef(s.customText), let text = s.customText else { continue }
            out.customText[s.id] = text
            switch pack(ref) {
            case let .lattice(lut, lookName):
                let name = firstNonEmpty(s.name, lookName) ?? "Pack look"
                out.layers.append(LutLayer(id: s.id, source: s.source, name: name, lut: lut,
                                           intensity: s.intensity, enabled: s.enabled))
            case let .missing(reason, lookName):
                let name = firstNonEmpty(s.name, lookName) ?? "Pack look"
                out.layers.append(LutLayer(id: s.id, source: s.source, name: name, lut: CubeLut.identity(),
                                           intensity: s.intensity, enabled: s.enabled, missing: reason))
            }
        } else if s.source == "custom" {
            guard let text = s.customText, let parsed = parseCube(text) else { continue }
            out.customText[s.id] = text
            out.layers.append(LutLayer(id: s.id, source: s.source, name: s.name, lut: parsed,
                                       intensity: s.intensity, enabled: s.enabled))
        } else {
            let id = s.source.hasPrefix("builtin:") ? String(s.source.dropFirst("builtin:".count)) : s.source
            guard let found = builtin(id) else { continue }
            out.layers.append(LutLayer(id: s.id, source: s.source, name: s.name.isEmpty ? found.name : s.name,
                                       lut: found.lut, intensity: s.intensity, enabled: s.enabled))
        }
    }
    return out
}

/// JavaScript's `a || b`: the first of the two that is a non-empty string.
private func firstNonEmpty(_ a: String?, _ b: String?) -> String? {
    if let a, !a.isEmpty { return a }
    if let b, !b.isEmpty { return b }
    return nil
}
