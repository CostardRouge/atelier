// The trip file: a whole road trip on disk, as JSON — `<name>.roadtrip.json`.
// Port of `src/shared/roadtrip/trip-file.ts`, pure: building, serialising,
// parsing and applying; picking and saving the file are the app's.
//
// This is NOT the Studio's `.atelier.json`, and the difference is deliberate.
// A project file carries a project's portable half — a template you can mail.
// A trip has no such split: its stages, its days told, the words its badges
// say and the look they wear ARE the trip. So this is a **backup and a
// transfer, not a template**, and it carries everything except what is
// meaningless outside the device that wrote it:
// - `id` — a fresh one is minted on import, so reading one file twice gives
//   two trips rather than the second overwriting the first;
// - `TripPost.projectId` — it addresses a Studio project in THIS device's
//   store; carried across it would dangle and offer to open nothing;
// - `sourceId` — an imported trip belongs to the source that imports it;
// - the timestamps, re-stamped on import;
// - the post thumbnails, which live in their own store and are re-baked.
// `TripStage.origin` DOES travel — it names an instance by its host, so the
// next reconcile still works on another machine connected to the same Winnow,
// and dangles harmlessly elsewhere. Media refs travel too: their content hash
// is what finds the pictures again in a renamed folder.
//
// `version` is the TripDoc version the file was written at, so an older file
// replays the same migration chain a stored document does (`readTripDoc`); a
// file from a NEWER version is refused rather than half-read. Parsing never
// throws, and every refusal is a sentence a person can act on.
//
// Two things the web's file does not carry, ported as they are: the trip's
// `cameraNames` (the fields are listed one by one, and that one is not among
// them) and any top-level key the document carries unread.

import Foundation

/// Marks the file as ours; a stray `.json` is rejected on it. The web's `TRIP_FILE_KIND`.
public let tripFileKind = "atelier/road-trip"

/// Double extension: recognisable at a glance, still a plain `.json`.
public let tripFileExtension = ".roadtrip.json"

/// What the web's file picker accepts — the app's picker takes `.json` files.
public let tripFileAccept = ".json,application/json"

/// Everything a trip file carries — the document minus what is machine-bound
/// (the web's `TripPortable` plus the three header fields).
public struct TripFile: Equatable, Sendable {
    /// Always `tripFileKind`.
    public var kind: String
    /// TripDoc version this was written at — drives the migration on read.
    public var version: Int
    /// ISO timestamp, for the human reading the file.
    public var exportedAt: String
    public var name: String
    public var startDate: IsoDate
    public var endDate: IsoDate
    public var stages: [TripStage]
    public var posts: [TripPost]
    public var badgeWords: BadgeWords
    public var theme: StyleTheme?
    public var cta: CtaSlide
    public var hookDefaults: HookDefaultsByKind
    public var grade: TripGrade
    public var cover: TripCover
    public var developPresets: [DevelopPreset]
    public var car: CarSpec

    public init(version: Int = tripDocVersion, exportedAt: String, name: String, startDate: IsoDate, endDate: IsoDate,
                stages: [TripStage], posts: [TripPost], badgeWords: BadgeWords, theme: StyleTheme?, cta: CtaSlide,
                hookDefaults: HookDefaultsByKind, grade: TripGrade, cover: TripCover, developPresets: [DevelopPreset],
                car: CarSpec) {
        kind = tripFileKind
        self.version = version; self.exportedAt = exportedAt; self.name = name; self.startDate = startDate
        self.endDate = endDate; self.stages = stages; self.posts = posts; self.badgeWords = badgeWords
        self.theme = theme; self.cta = cta; self.hookDefaults = hookDefaults; self.grade = grade; self.cover = cover
        self.developPresets = developPresets; self.car = car
    }

    /// The file as JSON — never an `id`, a `sourceId` or a timestamp of the trip's.
    public var json: JSONValue {
        var defaults: [String: JSONValue] = [:]
        for (kind, look) in hookDefaults { defaults[kind.rawValue] = look.json }
        return .object([
            "kind": .string(kind),
            "version": .number(Double(version)),
            "exportedAt": .string(exportedAt),
            "name": .string(name),
            "startDate": .string(startDate),
            "endDate": .string(endDate),
            "stages": .array(stages.map(\.json)),
            "posts": .array(posts.map(\.json)),
            "badgeWords": badgeWords.json,
            "theme": theme?.json ?? .null,
            "cta": cta.json,
            "hookDefaults": .object(defaults),
            "grade": grade.json,
            "cover": cover.json,
            "developPresets": .array(developPresets.map(tripPresetJSON)),
            "car": car.json,
        ])
    }
}

/// Why a text is not a trip file — a sentence a person can act on.
public struct TripFileError: Error, Equatable, Sendable {
    public var message: String
    public init(_ message: String) { self.message = message }
}

/// Strip what only means something on the device that wrote it.
private func portablePost(_ post: TripPost) -> TripPost {
    var p = post
    p.projectId = nil
    return p
}

/// `new Date(ms).toISOString()`.
private func tripFileIsoString(_ ms: Double) -> String {
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return iso.string(from: Date(timeIntervalSince1970: ms / 1000))
}

public func toTripFile(_ trip: TripDoc, exportedAt: Double = nowMillis()) -> TripFile {
    TripFile(
        version: tripDocVersion,
        exportedAt: tripFileIsoString(exportedAt),
        name: trip.name,
        startDate: trip.startDate,
        endDate: trip.endDate,
        stages: trip.stages,
        posts: trip.posts.map(portablePost),
        badgeWords: trip.badgeWords,
        theme: trip.theme,
        cta: trip.cta,
        hookDefaults: trip.hookDefaults,
        // The grade travels: a look rides as its layers (a pack look by
        // reference), so a trip opened elsewhere renders with the same look.
        grade: trip.grade,
        // The cover travels, pins and all: they are post ids, and posts are in
        // the file. The thumbnails are not — an imported trip draws its rhythm
        // until its pictures are re-baked.
        cover: trip.cover,
        // The presets are the trip's habit of light, like its words.
        developPresets: trip.developPresets,
        car: trip.car
    )
}

/// Indented on purpose: the file is meant to be readable and diffable — two
/// spaces, `"key": value`, as the web's `JSON.stringify(file, null, 2)`, keys
/// sorted, newline-terminated.
public func serializeTripFile(_ file: TripFile) -> String {
    var out = ""
    tripFileWrite(file.json, indent: "", into: &out)
    return out + "\n"
}

/// `Été en Corse` → `ete-en-corse.roadtrip.json`: accents stripped (NFD, the
/// combining marks dropped), lowercased, every run of anything but `a-z0-9` one
/// dash, the ends trimmed of dashes, then the first 60 characters.
public func tripFileName(_ name: String) -> String {
    var folded = String.UnicodeScalarView()
    for scalar in name.decomposedStringWithCanonicalMapping.unicodeScalars
    where !(0x300...0x36F).contains(scalar.value) {
        folded.append(scalar)
    }
    var slug = ""
    var pendingDash = false
    for scalar in String(folded).lowercased().unicodeScalars {
        let v = scalar.value
        if (0x61...0x7A).contains(v) || (0x30...0x39).contains(v) {
            if pendingDash { slug.append("-") }
            pendingDash = false
            slug.unicodeScalars.append(scalar)
        } else if !slug.isEmpty {
            pendingDash = true
        }
    }
    slug = String(slug.prefix(60))
    return "\(slug.isEmpty ? "trip" : slug)\(tripFileExtension)"
}

/// Read a file's text into a trip file, or explain why it is not one. The
/// input comes from a disk and may be anything at all: this never throws.
public func parseTripFile(_ text: String, now: Double = nowMillis(),
                          makeId: () -> String = newTripId) -> Result<TripFile, TripFileError> {
    guard let raw = JSONValue.parse(text) else { return .failure(TripFileError("That file is not valid JSON.")) }
    guard let o = raw.objectValue else {
        return .failure(TripFileError("That file is not an Atelier road-trip file."))
    }
    guard o["kind"]?.stringValue == tripFileKind else {
        return .failure(TripFileError("That file is not an Atelier road-trip file (wrong or missing kind)."))
    }
    // `typeof raw.version === 'number'` — JSON carries no NaN.
    let version = o["version"]?.finiteNumber ?? 0
    if version > Double(tripDocVersion) {
        return .failure(TripFileError(
            "This file was written by a newer version of Atelier (format \(TripJS.number(version)), "
                + "this one reads up to \(tripDocVersion)). Update the app first."
        ))
    }
    // The two dates are the trip's spine: every day, every stage span and every
    // post's place is derived from them, so a file without them is not a trip.
    guard let startDate = o["startDate"]?.stringValue, let endDate = o["endDate"]?.stringValue,
          isIsoDate(startDate), isIsoDate(endDate) else {
        return .failure(TripFileError("The file has no trip dates."))
    }

    // Shape is sound. Replay the document migrations on a document built from
    // the file, so an older file lands on the current shape exactly as an older
    // stored trip does — and anything a past version did not write is filled by
    // the same defaults a new trip gets. A `destination` (before v27) is not read.
    let base = createTripDoc(o["name"]?.stringValue ?? "", startDate, endDate, now: now, id: makeId())
    var doc = base.json.objectValue ?? [:]
    doc["version"] = .number(version)
    doc["startDate"] = .string(startDate)
    doc["endDate"] = .string(endDate)
    for key in ["stages", "posts", "developPresets"] where o[key]?.arrayValue != nil { doc[key] = o[key] }
    for key in ["badgeWords", "theme", "cta", "hookDefaults", "grade", "cover"] where o[key]?.objectValue != nil {
        doc[key] = o[key]
    }
    // A validated read, never a cast: junk or nothing lands on the default car.
    doc["car"] = readCarSpec(o["car"]).json
    guard let migrated = readTripDoc(.object(doc), now: now, makeId: makeId) else {
        return .failure(TripFileError("That file is not an Atelier road-trip file."))
    }

    return .success(TripFile(
        version: tripDocVersion,
        exportedAt: o["exportedAt"]?.stringValue ?? "",
        name: migrated.name,
        startDate: migrated.startDate,
        endDate: migrated.endDate,
        stages: migrated.stages,
        // Belt and braces: a hand-edited file could carry a projectId that
        // means nothing here, and a dangling "Open in Studio" is worse than none.
        posts: migrated.posts.map(portablePost),
        badgeWords: migrated.badgeWords,
        theme: migrated.theme,
        cta: migrated.cta,
        hookDefaults: migrated.hookDefaults,
        grade: migrated.grade,
        cover: migrated.cover,
        developPresets: migrated.developPresets,
        car: migrated.car
    ))
}

/// A brand-new trip document from a file — the import path. A fresh `id` and
/// fresh timestamps, so importing the same file twice gives two trips instead
/// of silently overwriting one. It belongs to the source that imports it
/// (`sourceId`, this device unless told otherwise), never to the one that
/// wrote the file. Every portable field is spelt out: a line forgotten here
/// would silently drop what the file carried.
public func tripDocFromFile(_ file: TripFile, now: Double = nowMillis(), sourceId: String = defaultSourceId,
                            id: String = newTripId()) -> TripDoc {
    var doc = createTripDoc(file.name, file.startDate, file.endDate, sourceId: sourceId, now: now, id: id)
    doc.createdAt = now
    doc.updatedAt = now
    doc.stages = file.stages
    doc.posts = file.posts.map(portablePost)
    doc.badgeWords = file.badgeWords
    doc.theme = file.theme
    doc.cta = file.cta
    doc.hookDefaults = file.hookDefaults
    doc.grade = file.grade
    doc.cover = file.cover
    doc.developPresets = file.developPresets
    doc.car = file.car
    return doc
}

// MARK: - `JSON.stringify(value, null, 2)`, keys sorted

/// Keys in JavaScript's default sort order — UTF-16 code units.
private func tripFileKeyBefore(_ a: String, _ b: String) -> Bool {
    a.utf16.lexicographicallyPrecedes(b.utf16)
}

private func tripFileWrite(_ value: JSONValue, indent: String, into out: inout String) {
    switch value {
    case .null: out += "null"
    case .bool(let b): out += b ? "true" : "false"
    case .number(let n): out += tripFileNumber(n)
    case .string(let s): tripFileString(s, into: &out)
    case .array(let items):
        if items.isEmpty { out += "[]"; return }
        let inner = indent + "  "
        out += "[\n"
        for (i, item) in items.enumerated() {
            out += inner
            tripFileWrite(item, indent: inner, into: &out)
            out += i < items.count - 1 ? ",\n" : "\n"
        }
        out += indent + "]"
    case .object(let o):
        if o.isEmpty { out += "{}"; return }
        let inner = indent + "  "
        let keys = o.keys.sorted(by: tripFileKeyBefore)
        out += "{\n"
        for (i, key) in keys.enumerated() {
            out += inner
            tripFileString(key, into: &out)
            out += ": "
            tripFileWrite(o[key] ?? .null, indent: inner, into: &out)
            out += i < keys.count - 1 ? ",\n" : "\n"
        }
        out += indent + "}"
    }
}

/// A string as `JSON.stringify` quotes it: `"` and `\` escaped, the short
/// escapes for the five controls that have one, `\u00xx` for the other
/// controls, and everything else — `/` and every non-ASCII letter — literal.
private func tripFileString(_ s: String, into out: inout String) {
    out += "\""
    for scalar in s.unicodeScalars {
        switch scalar.value {
        case 0x22: out += "\\\""
        case 0x5C: out += "\\\\"
        case 0x08: out += "\\b"
        case 0x0C: out += "\\f"
        case 0x0A: out += "\\n"
        case 0x0D: out += "\\r"
        case 0x09: out += "\\t"
        case 0..<0x20:
            let hex = String(scalar.value, radix: 16)
            out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
        default: out.unicodeScalars.append(scalar)
        }
    }
    out += "\""
}

/// A number as JavaScript prints it: the shortest digits that round-trip
/// (Swift's own), laid out by `Number.prototype.toString`'s rules — plain from
/// 1e-6 up to 1e21, an exponent (`1e+21`, `1.5e-7`) outside. JSON has no NaN
/// or infinity; `JSON.stringify` writes them as `null`.
private func tripFileNumber(_ x: Double) -> String {
    guard x.isFinite else { return "null" }
    if x == 0 { return "0" }
    let negative = x < 0
    let text = "\(x.magnitude)"
    let halves = text.split(separator: "e", maxSplits: 1).map(String.init)
    let exponent = halves.count > 1 ? Int(halves[1]) ?? 0 : 0
    let mantissa = halves[0]
    var digits = Array(mantissa.replacingOccurrences(of: ".", with: ""))
    var point = mantissa.firstIndex(of: ".").map { mantissa.distance(from: mantissa.startIndex, to: $0) } ?? mantissa.count
    while digits.first == "0" && digits.count > 1 {
        digits.removeFirst()
        point -= 1
    }
    while digits.last == "0" && digits.count > 1 { digits.removeLast() }
    let k = digits.count
    let n = point + exponent
    let d = String(digits)
    let body: String
    if k <= n && n <= 21 {
        body = d + String(repeating: "0", count: n - k)
    } else if 0 < n && n <= 21 {
        body = String(digits[0..<n]) + "." + String(digits[n...])
    } else if -6 < n && n <= 0 {
        body = "0." + String(repeating: "0", count: -n) + d
    } else {
        let e = n - 1
        let sign = e < 0 ? "-" : "+"
        body = (k == 1 ? d : String(digits[0]) + "." + String(digits[1...])) + "e" + sign + String(abs(e))
    }
    return negative ? "-" + body : body
}
