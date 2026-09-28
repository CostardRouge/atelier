// What took a photograph, as a set of FACTS a credit can pick from — port of
// `src/shared/exif/camera-facts.ts`: the body, the lens, the two focal
// lengths, the exposure triangle, the compensation and a drone's height above
// take-off — each already written the way the suite prints it (`ƒ/1.7`,
// `1/240`, `ISO 100`, a typographic minus).
//
// The rules it keeps:
// - The formatting is `exposureSummary`'s own, so the legacy fields — body,
//   lens, real focal, aperture, shutter, ISO — joined with ` · ` are the very
//   string `exposureSummary` gives, and a badge that never asked for a layout
//   keeps drawing it.
// - A fact the file does not record is ABSENT, never `—` and never guessed:
//   no focal length is derived from a crop factor, no body from a lens.
// - The one deliberate rewrite is the body's display NAME, and only from a
//   table the author wrote (`names`): a DJI still says `FC8482`, not "Mini 4
//   Pro", and a table of models shipped here would be an invented one.
// - The `ev` FACT leaves zero out, but `evStops` keeps it for a meter drawn
//   like a viewfinder's.

import Foundation

public enum CameraField: String, CaseIterable, Sendable, Codable {
    case body, lens, focal35, focal, aperture, shutter, iso, ev, altitude
}

/// One row of the web's `CAMERA_FIELDS` table.
public struct CameraFieldInfo: Equatable, Sendable {
    public var id: CameraField
    public var label: String
    /// Names what took it rather than how it was exposed.
    public var identity: Bool
    public init(id: CameraField, label: String, identity: Bool) {
        self.id = id; self.label = label; self.identity = identity
    }
}

/// The web's `CAMERA_FIELDS`, in its order.
public let cameraFields: [CameraFieldInfo] = [
    CameraFieldInfo(id: .body, label: "Body", identity: true),
    CameraFieldInfo(id: .lens, label: "Lens", identity: true),
    CameraFieldInfo(id: .focal35, label: "Focal length, 35 mm eq.", identity: false),
    CameraFieldInfo(id: .focal, label: "Focal length, real", identity: false),
    CameraFieldInfo(id: .aperture, label: "Aperture", identity: false),
    CameraFieldInfo(id: .shutter, label: "Shutter speed", identity: false),
    CameraFieldInfo(id: .iso, label: "ISO", identity: false),
    CameraFieldInfo(id: .ev, label: "Exposure compensation", identity: false),
    CameraFieldInfo(id: .altitude, label: "Height above take-off", identity: false),
]

/// The web's type guard over an `unknown` — a document value that may or may
/// not name a field.
public func isCameraField(_ value: JSONValue?) -> Bool {
    guard let s = value?.stringValue else { return false }
    return CameraField(rawValue: s) != nil
}

public func isIdentityField(_ field: CameraField) -> Bool {
    field == .body || field == .lens
}

/// The fields the credit drew before it could be composed, in its order:
/// `exposureSummary`'s line. A piece that never chose keeps exactly this.
public let legacyCameraFields: [CameraField] = [.body, .lens, .focal, .aperture, .shutter, .iso]

public struct CameraFact: Equatable, Sendable {
    public var field: CameraField
    /// As a line says it: `ƒ/1.7`, `ISO 100`, `+0.3 EV`, `24 mm`.
    public var value: String
    /// As it reads under its own label: `100` under ISO, `+0.3` under EV.
    public var bare: String
    public init(field: CameraField, value: String, bare: String) {
        self.field = field; self.value = value; self.bare = bare
    }
}

public struct CameraFacts: Equatable, Sendable {
    public var facts: [CameraField: CameraFact]
    /// The camera's compensation, ZERO INCLUDED, or nil when the file does not
    /// say. The `ev` FACT leaves zero out — a camera left on its own reading is
    /// the default, not a decision, and a line should not boast of it — but a
    /// meter drawn like a viewfinder's reads zero as its centre.
    public var evStops: Double?
    /// The body as the file names it, before any renaming — what a name is keyed by.
    public var rawBody: String?
    public init(facts: [CameraField: CameraFact] = [:], evStops: Double? = nil, rawBody: String? = nil) {
        self.facts = facts; self.evStops = evStops; self.rawBody = rawBody
    }
}

private func trimmedOrNil(_ s: String?) -> String? {
    guard let s else { return nil }
    let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
    return t.isEmpty ? nil : t
}

private func positive(_ n: Double?) -> Double? {
    guard let n, n.isFinite, n > 0 else { return nil }
    return n
}

/// The web walks `names` in insertion order and takes the first key that folds
/// to `raw`; a Swift dictionary has no insertion order, so the keys are walked
/// sorted — the two differ only on a table holding two spellings of one body.
private func renamed(_ raw: String, _ names: [String: String]?) -> String? {
    guard let names else { return nil }
    let want = raw.lowercased()
    for key in names.keys.sorted() {
        guard let name = names[key] else { continue }
        let folded = key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if folded == want, !trimmedName.isEmpty { return trimmedName }
    }
    return nil
}

/// The facts `exif` records. `names` renames a BODY the author has named —
/// keyed by the name the file gives (`cameraName`), matched case-insensitively
/// and ignoring an empty entry — and nothing else.
public func cameraFacts(_ exif: ExifData?, names: [String: String]? = nil) -> CameraFacts {
    var facts: [CameraField: CameraFact] = [:]
    func put(_ field: CameraField, _ value: String, _ bare: String? = nil) {
        facts[field] = CameraFact(field: field, value: value, bare: bare ?? value)
    }
    guard let exif else { return CameraFacts(facts: facts, evStops: nil, rawBody: nil) }

    let raw = trimmedOrNil(cameraName(exif))
    let body: String? = raw.map { renamed($0, names) ?? $0 }
    if let body { put(.body, body) }

    // A lens that repeats the body is dropped, as the summary drops it: a phone
    // names its lens after itself, and the same words twice are not two facts.
    let lens = trimmedOrNil(exif.lensModel) ?? trimmedOrNil(exif.lensMake)
    if let lens, lens != raw, lens != body { put(.lens, lens) }

    if let focal35 = positive(exif.focalLength35) { put(.focal35, "\(ExifText.rounded2(focal35)) mm") }
    if let focal = positive(exif.focalLength) { put(.focal, "\(ExifText.rounded2(focal)) mm") }
    if let fNumber = positive(exif.fNumber) { put(.aperture, "ƒ/\(ExifText.rounded2(fNumber))") }
    if let shutter = exifShutter(exif.exposureTime) { put(.shutter, shutter) }
    if let isoValue = positive(exif.iso) {
        let iso = ExifText.jsString(ExifText.jsRound(isoValue))
        put(.iso, "ISO \(iso)", iso)
    }
    let ev: Double? = exif.exposureBias.flatMap { $0.isFinite ? $0 : nil }
    if let ev, ExifText.jsRound(ev * 10) != 0 {
        put(.ev, "\(ExifText.signed(ev)) EV", ExifText.signed(ev))
    }
    if let rel = exif.relativeAltitude, rel.isFinite {
        let m = ExifText.jsRound(rel)
        let sign = m < 0 ? "−" : ""
        put(.altitude, "\(sign)\(ExifText.jsString(m.magnitude)) m")
    }

    return CameraFacts(facts: facts, evStops: ev, rawBody: raw)
}

/// The facts among `fields` the picture records, in `fields`' order.
public func pickFacts(_ facts: CameraFacts, _ fields: [CameraField]) -> [CameraFact] {
    var seen: Set<CameraField> = []
    var out: [CameraFact] = []
    for field in fields {
        if seen.contains(field) { continue }
        seen.insert(field)
        if let fact = facts.facts[field] { out.append(fact) }
    }
    return out
}

/// The credit as one line, `·`-joined — the legacy fields give `exposureSummary`'s.
public func factsLine(_ facts: CameraFacts, _ fields: [CameraField]) -> String {
    pickFacts(facts, fields).map { $0.value }.joined(separator: " · ")
}
