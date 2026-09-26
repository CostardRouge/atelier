// A lens profile as a PICTURE carries it — `RollPicture.lensProfile`. Port of
// `src/shared/lens/lens-profile.ts`.
//
// What is stored is the RESOLVED terms (`LensProfileTerms`, the lens pass's own
// units, for this picture's focal length and aperture), with the names they
// came from. Not a reference to the database: the export, a second device and
// a `.roll.json` then draw the same correction with no fetch and no cache, and
// a later change to Lensfun never moves a picture already developed — preview
// = export by construction.
//
// **A profile is CALIBRATION, not an edit** — the rule the RAW base follows.
// It is a fact about the glass, so it is not copied to another picture by the
// settings sheet, not cleared by Reset, and not what makes a picture "edited"
// for the delivery rule; it IS part of the export fingerprint.
//
// **Where it applies.** Lensfun measures the lens on RAW data. A camera's own
// JPEG — and the render inside a RAW — is often corrected in the body already,
// and correcting it again would bend it the other way. So a profile applies on
// the SENSOR by itself, and on a render only where the author said so
// (`onRender`).
//
// Three states, kept apart exactly as the web keeps them: ABSENT (never
// decided: an automatic lookup may still apply one), NULL (the author took it
// off — or a record too broken to draw), and a profile. `readLensProfile`
// answers with a double optional: `.none` absent, `.some(nil)` null.

import Foundation

public struct LensProfileApplied: Equatable, Sendable {
    /// `Sony FE 24-70mm f/4 ZA OSS` — the database's lens, maker and model.
    public var lens: String
    /// `Sony ILCE-7CM2` — the body it was matched through.
    public var camera: String
    /// The picture's own, which the terms were interpolated at.
    public var focal: Double
    public var aperture: Double?
    public var terms: LensProfileTerms
    /// What the database had for this lens: a part it lacked is the identity in `terms`.
    public var has: LensProfileHas
    /// Applied on a camera RENDER too, by the author's choice — see above.
    public var onRender: Bool

    public init(lens: String, camera: String, focal: Double, aperture: Double?, terms: LensProfileTerms,
                has: LensProfileHas, onRender: Bool) {
        self.lens = lens; self.camera = camera; self.focal = focal; self.aperture = aperture
        self.terms = terms; self.has = has; self.onRender = onRender
    }

    /// The record as the document holds it — what `JSON.stringify` writes of
    /// the web's object (a missing aperture is `null`).
    public var json: JSONValue {
        func list(_ v: [Double]) -> JSONValue { .array(v.map { .number($0) }) }
        return .object([
            "lens": .string(lens),
            "camera": .string(camera),
            "focal": .number(focal),
            "aperture": aperture.map { .number($0) } ?? .null,
            "terms": .object([
                "distortion": list(terms.distortion),
                "tcaRed": list(terms.tcaRed),
                "tcaBlue": list(terms.tcaBlue),
                "vignette": list(terms.vignette),
            ]),
            "has": .object([
                "distortion": .bool(has.distortion),
                "tca": .bool(has.tca),
                "vignette": .bool(has.vignette),
            ]),
            "onRender": .bool(onRender),
        ])
    }
}

private func finite(_ v: JSONValue?) -> Double? {
    v?.finiteNumber
}

private func tuple(_ v: JSONValue?, _ n: Int, _ fallback: [Double]) -> [Double]? {
    guard let a = v?.arrayValue, a.count == n else { return nil }
    return a.enumerated().map { i, x in finite(x) ?? fallback[i] }
}

/// The first `n` UTF-16 code units, as `String.prototype.slice(0, n)`.
private func slice(_ s: String, _ n: Int) -> String {
    if s.utf16.count <= n { return s }
    return String(decoding: Array(s.utf16.prefix(n)), as: UTF16.self)
}

/// A stored profile read back — `.none` when the field is absent (never
/// decided), `.some(nil)` when the author took it off or the record is too
/// broken to draw, else the profile.
public func readLensProfile(_ raw: JSONValue?) -> LensProfileApplied?? {
    guard let raw else { return .none }
    guard let src = raw.objectValue else { return .some(nil) }
    let t = src["terms"]?.objectValue ?? [:]
    let distortion = tuple(t["distortion"], 4, [0, 0, 0, 0])
    let tcaRed = tuple(t["tcaRed"], 3, [1, 0, 0])
    let tcaBlue = tuple(t["tcaBlue"], 3, [1, 0, 0])
    let vignette = tuple(t["vignette"], 3, [0, 0, 0])
    let focal = finite(src["focal"])
    guard let distortion, let tcaRed, let tcaBlue, let vignette, let focal,
          let lens = src["lens"]?.stringValue else { return .some(nil) }
    let has = src["has"]?.objectValue ?? [:]
    return .some(LensProfileApplied(
        lens: slice(lens, 120),
        camera: src["camera"]?.stringValue.map { slice($0, 120) } ?? "",
        focal: focal,
        aperture: finite(src["aperture"]),
        terms: LensProfileTerms(distortion: distortion, tcaRed: tcaRed, tcaBlue: tcaBlue, vignette: vignette),
        has: LensProfileHas(
            distortion: has["distortion"] == .bool(true),
            tca: has["tca"] == .bool(true),
            vignette: has["vignette"] == .bool(true)
        ),
        onRender: src["onRender"] == .bool(true)
    ))
}

/// The terms a picture's render draws with: its profile where it applies, else none.
public func profileInEffect(_ profile: LensProfileApplied?, _ onSensor: Bool) -> LensProfileTerms? {
    guard let profile, !isIdentityProfile(profile.terms) else { return nil }
    return onSensor || profile.onRender ? profile.terms : nil
}

/// `distortion · fringing · vignetting` — what a profile corrects, as a line says it.
public func describeProfileParts(_ has: LensProfileHas) -> String {
    var parts: [String] = []
    if has.distortion { parts.append("distortion") }
    if has.tca { parts.append("fringing") }
    if has.vignette { parts.append("vignetting") }
    return parts.isEmpty ? "nothing measured" : parts.joined(separator: " · ")
}

/// The key a lookup is cached under: the body and the lens, as the EXIF names them.
public func lensKey(_ make: String, _ model: String, _ lensModel: String?) -> String {
    func squash(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        for c in s.lowercased().unicodeScalars
        where (c.value >= 0x61 && c.value <= 0x7A) || (c.value >= 0x30 && c.value <= 0x39) || c == "." {
            out.append(c)
        }
        return String(out)
    }
    return "\(squash(make))|\(squash(model))|\(squash(lensModel ?? ""))"
}
