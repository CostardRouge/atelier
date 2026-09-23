// A ROLL — the Develop tool's document: a named set of pictures, each with its
// own develop, look and crop, plus how the roll exports. Port of
// `src/shared/develop/roll-types.ts` (v5) and `roll-file.ts`.
//
// THE SAME DOCUMENT as the web app's, read and written on the same JSON shape,
// so a roll kept on a Winnow opens on the phone, on the Mac and in the browser
// alike. Every read goes through `readRollDoc`: a stored roll, a pulled one and
// a file land on the current shape; a field this port does not yet interpret
// (a keystone, a lens, the detail passes, the repair patches, the adjustment
// layers, a grade's film texture) is carried through UNTOUCHED as JSON, never
// dropped — a roll edited here must not lose what the web app wrote.

import Foundation

/// Bumped with a migration in `readRollDoc`, never without. The web's history
/// of the shape is in `roll-types.ts`.
public let rollDocVersion = 5

/// A media REF — hash-carrying, never bytes.
public struct SavedMediaRef: Codable, Equatable, Sendable {
    public var name: String
    public var size: Int
    public var lastModified: Double
    /// Id in the source that holds this file, when it came from one.
    public var assetId: String?
    /// Partial content hash (`shared/lib/partial-hash.ts`), when computed.
    public var hash: String?

    public init(name: String, size: Int, lastModified: Double, assetId: String? = nil, hash: String? = nil) {
        self.name = name; self.size = size; self.lastModified = lastModified; self.assetId = assetId; self.hash = hash
    }
}

/// One entry of a stored look.
public struct SavedLutLayer: Codable, Equatable, Sendable {
    public var id: String
    public var source: String
    public var name: String
    /// A film stock's settings, a pack reference, or — on old documents — a
    /// whole inlined `.cube`; nil for built-ins.
    public var customText: String?
    public var intensity: Double
    public var enabled: Bool

    public init(id: String, source: String, name: String, customText: String? = nil, intensity: Double = 1, enabled: Bool = true) {
        self.id = id; self.source = source; self.name = name; self.customText = customText; self.intensity = intensity; self.enabled = enabled
    }
}

/// A picture's look, after its own develop.
public struct RollGrade: Equatable, Sendable {
    public var layers: [SavedLutLayer]
    public var output: OutputTransform
    /// Grain and halation, carried through as written (`shared/film/`).
    public var film: JSONValue?

    public init(layers: [SavedLutLayer] = [], output: OutputTransform = .none, film: JSONValue? = nil) {
        self.layers = layers; self.output = output; self.film = film
    }
}

public struct RollExport: Equatable, Sendable {
    /// The delivered long edge in pixels, or nil for the source's own size.
    public var longEdge: Int?
    /// JPEG quality, 0.5..1.
    public var quality: Double
    /// Replace a file the folder already holds under the export's name; OFF by default.
    public var replace: Bool
    /// Deliver an Ultra HDR JPEG for a picture developed on its RAW.
    public var hdr: Bool
    /// How far above white the map may reach, in stops.
    public var hdrStops: Int

    public init(longEdge: Int? = nil, quality: Double = 0.92, replace: Bool = false, hdr: Bool = false, hdrStops: Int = 2) {
        self.longEdge = longEdge; self.quality = quality; self.replace = replace; self.hdr = hdr; self.hdrStops = hdrStops
    }

    public static let `default` = RollExport()
    public static let longEdgeLimits = (min: 256, max: 16384)
    public static let qualityLimits = (min: 0.5, max: 1.0)
    public static let hdrStopsLimits = (min: 1, max: 4)
}

public struct RollPicture: Equatable, Sendable {
    public var id: String
    public var ref: SavedMediaRef
    /// Nil is as shot. Never inherited by the next picture.
    public var develop: DevelopSettings?
    /// The look, or nil for none (v5): the picture's own.
    public var grade: RollGrade?
    /// Nil is uncropped. Crop · straighten · flip.
    public var framing: Framing?
    /// `original`, or one of the suite's aspect ids (`9:16`, `4:5`, …).
    public var aspect: String
    /// WHICH FILE of the capture this picture is developed from, below the sensor.
    public var rendition: String?
    /// Fields written by the web app that this port carries through as JSON:
    /// `border`, `keystone`, `lens`, `detail`, `repair`, `layers`. Read and
    /// written verbatim; nil where the document holds nothing.
    public var carried: [String: JSONValue]

    public init(id: String, ref: SavedMediaRef, develop: DevelopSettings? = nil, grade: RollGrade? = nil,
                framing: Framing? = nil, aspect: String = "original", rendition: String? = nil,
                carried: [String: JSONValue] = [:]) {
        self.id = id; self.ref = ref; self.develop = develop; self.grade = grade; self.framing = framing
        self.aspect = aspect; self.rendition = rendition; self.carried = carried
    }
}

public struct RollDoc: Equatable, Sendable {
    public var id: String
    public var version: Int
    public var name: String
    /// The ONE source this roll is kept on. Never in the roll file.
    public var sourceId: String
    public var createdAt: Double
    public var updatedAt: Double
    /// The filmstrip's order.
    public var pictures: [RollPicture]
    public var export: RollExport

    public init(id: String, version: Int = rollDocVersion, name: String, sourceId: String, createdAt: Double, updatedAt: Double,
                pictures: [RollPicture] = [], export: RollExport = .default) {
        self.id = id; self.version = version; self.name = name; self.sourceId = sourceId
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.pictures = pictures; self.export = export
    }
}

/// The local source's id — the same string the web app uses for `local`.
public let defaultSourceId = "local"

public func newRollId() -> String { UUID().uuidString.lowercased() }

/// Milliseconds since the epoch, the web's `Date.now()`.
public func nowMillis() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }

public func createRollDoc(name: String, sourceId: String = defaultSourceId, now: Double = nowMillis(), id: String = newRollId()) -> RollDoc {
    RollDoc(id: id, name: name.trimmingCharacters(in: .whitespacesAndNewlines), sourceId: sourceId, createdAt: now, updatedAt: now)
}

public func createRollPicture(_ ref: SavedMediaRef, id: String = newRollId()) -> RollPicture {
    RollPicture(id: id, ref: ref)
}

// MARK: - reading what was stored

private let carriedKeys = ["border", "keystone", "lens", "detail", "repair", "layers"]

/// A stored media ref, or nil when it names nothing. Unknown keys are left behind.
public func readMediaRef(_ raw: JSONValue?) -> SavedMediaRef? {
    guard let o = raw?.objectValue, let name = o["name"]?.stringValue, !name.isEmpty else { return nil }
    var ref = SavedMediaRef(name: name, size: max(0, Int(o["size"]?.finiteNumber ?? 0)), lastModified: o["lastModified"]?.finiteNumber ?? 0)
    if let assetId = o["assetId"]?.stringValue, !assetId.isEmpty { ref.assetId = assetId }
    if let hash = o["hash"]?.stringValue, !hash.isEmpty { ref.hash = hash }
    return ref
}

private func readLayer(_ raw: JSONValue) -> SavedLutLayer? {
    guard let o = raw.objectValue, let id = o["id"]?.stringValue, let source = o["source"]?.stringValue else { return nil }
    return SavedLutLayer(
        id: id, source: source,
        name: o["name"]?.stringValue ?? id,
        customText: o["customText"]?.stringValue,
        intensity: min(maxLayerIntensity, max(0, o["intensity"]?.finiteNumber ?? 1)),
        enabled: o["enabled"]?.boolValue != false
    )
}

public func readRollGrade(_ raw: JSONValue?) -> RollGrade? {
    guard let o = raw?.objectValue else { return nil }
    let layers = (o["layers"]?.arrayValue ?? []).compactMap(readLayer)
    // An unknown transform reads as none, the way every other reader reads junk.
    var output = OutputTransform.none
    if let name = o["output"]?.stringValue, let known = OutputTransform(rawValue: name) { output = known }
    var film: JSONValue? = nil
    if let f = o["film"], f.objectValue != nil { film = f }
    // A look with nothing in it is no look. A TEXTURE alone is a look.
    if layers.isEmpty && output == OutputTransform.none && film == nil { return nil }
    return RollGrade(layers: layers, output: output, film: film)
}

public func readRollExport(_ raw: JSONValue?) -> RollExport {
    guard let o = raw?.objectValue else { return .default }
    var out = RollExport.default
    if let e = o["longEdge"]?.finiteNumber {
        out.longEdge = Int(min(Double(RollExport.longEdgeLimits.max), max(Double(RollExport.longEdgeLimits.min), e)).rounded())
    }
    out.quality = min(RollExport.qualityLimits.max, max(RollExport.qualityLimits.min, o["quality"]?.finiteNumber ?? RollExport.default.quality))
    out.replace = o["replace"]?.boolValue == true
    out.hdr = o["hdr"]?.boolValue == true
    let stops = o["hdrStops"]?.finiteNumber ?? Double(RollExport.default.hdrStops)
    out.hdrStops = Int(min(Double(RollExport.hdrStopsLimits.max), max(Double(RollExport.hdrStopsLimits.min), stops)).rounded())
    return out
}

private func readFraming(_ raw: JSONValue?) -> Framing? {
    guard let raw, raw != .null else { return nil }
    let f = normaliseFraming(raw)
    return isDefaultFraming(f) ? nil : f
}

private func readPicture(_ raw: JSONValue, rollGrade: RollGrade?) -> RollPicture? {
    guard let o = raw.objectValue, let ref = readMediaRef(o["ref"]) else { return nil }
    // What the web app writes for "nothing" — null, or an empty list for the
    // two lists — is carried as nothing, so reading a roll back is the identity.
    var carried: [String: JSONValue] = [:]
    for key in carriedKeys {
        if let v = o[key], v != .null, v != .array([]) { carried[key] = v }
    }
    let aspect = o["aspect"]?.stringValue.flatMap { isStoredAspect($0) ? $0 : nil } ?? "original"
    let grade: RollGrade?
    if o["grade"] != nil { grade = readRollGrade(o["grade"]) } else { grade = rollGrade }
    return RollPicture(
        id: (o["id"]?.stringValue).flatMap { $0.isEmpty ? nil : $0 } ?? newRollId(),
        ref: ref,
        develop: developOrNull(o["develop"]),
        grade: grade,
        framing: readFraming(o["framing"]),
        aspect: aspect,
        rendition: (o["rendition"]?.stringValue).flatMap { $0.isEmpty ? nil : $0 },
        carried: carried
    )
}

/// The aspect ids a roll may store: `original` or one of the suite's presets.
public let aspectPresets: [(id: String, label: String, w: Double, h: Double)] = [
    ("9:16", "Reels · TikTok · Shorts", 9, 16),
    ("16:9", "YouTube · landscape", 16, 9),
    ("1:1", "Square post", 1, 1),
    ("4:5", "Portrait post", 4, 5),
    ("3:2", "Classic 3:2", 3, 2),
    ("2:3", "Classic 2:3", 2, 3),
    ("4:3", "Classic 4:3", 4, 3),
    ("3:4", "Classic 3:4", 3, 4),
]

public func isStoredAspect(_ id: String) -> Bool {
    id == "original" || aspectPresets.contains { $0.id == id }
}

/// A stored or received roll read onto the current shape, or nil when what
/// arrived is not a roll at all. A roll written before v5 hands its one look to
/// every picture that carries none.
public func readRollDoc(_ raw: JSONValue?, fallbackSourceId: String = defaultSourceId, now: Double = nowMillis()) -> RollDoc? {
    guard let o = raw?.objectValue, let id = o["id"]?.stringValue, !id.isEmpty, let list = o["pictures"]?.arrayValue else { return nil }
    let version = o["version"]?.finiteNumber ?? 1
    let rollGrade = version < 5 ? readRollGrade(o["grade"]) : nil
    var seen = Set<String>()
    var pictures: [RollPicture] = []
    for item in list {
        guard let picture = readPicture(item, rollGrade: rollGrade), !seen.contains(picture.id) else { continue }
        seen.insert(picture.id)
        pictures.append(picture)
    }
    return RollDoc(
        id: id,
        version: rollDocVersion,
        name: o["name"]?.stringValue ?? "",
        sourceId: (o["sourceId"]?.stringValue).flatMap { $0.isEmpty ? nil : $0 } ?? fallbackSourceId,
        createdAt: o["createdAt"]?.finiteNumber ?? now,
        updatedAt: o["updatedAt"]?.finiteNumber ?? now,
        pictures: pictures,
        export: readRollExport(o["export"])
    )
}

// MARK: - writing

extension SavedMediaRef {
    public var json: JSONValue {
        var o: [String: JSONValue] = ["name": .string(name), "size": .number(Double(size)), "lastModified": .number(lastModified)]
        if let assetId { o["assetId"] = .string(assetId) }
        if let hash { o["hash"] = .string(hash) }
        return .object(o)
    }
}

extension SavedLutLayer {
    public var json: JSONValue {
        .object(["id": .string(id), "source": .string(source), "name": .string(name),
                 "customText": customText.map { .string($0) } ?? .null,
                 "intensity": .number(intensity), "enabled": .bool(enabled)])
    }
}

extension RollGrade {
    public var json: JSONValue {
        .object(["layers": .array(layers.map(\.json)), "output": .string(output.rawValue), "film": film ?? .null])
    }
}

extension RollExport {
    public var json: JSONValue {
        .object(["longEdge": longEdge.map { .number(Double($0)) } ?? .null, "quality": .number(quality),
                 "replace": .bool(replace), "hdr": .bool(hdr), "hdrStops": .number(Double(hdrStops))])
    }
}

extension Framing {
    public var json: JSONValue {
        .object(["scale": .number(scale), "x": .number(x), "y": .number(y), "rotation": .number(rotation),
                 "flipX": .bool(flipX), "flipY": .bool(flipY), "fit": .string(fit.rawValue)])
    }
}

extension DevelopSettings {
    public var json: JSONValue {
        guard let data = try? JSONEncoder().encode(self), let v = JSONValue.parse(data) else { return .null }
        return v
    }
}

extension RollPicture {
    public var json: JSONValue {
        var o: [String: JSONValue] = [
            "id": .string(id),
            "ref": ref.json,
            "develop": develop?.json ?? .null,
            "grade": grade?.json ?? .null,
            "framing": framing?.json ?? .null,
            "aspect": .string(aspect),
            "rendition": rendition.map { .string($0) } ?? .null,
        ]
        // What the web app writes for an untouched field, so a roll made here
        // reads as one made there: null for the records, an empty list for the lists.
        o["border"] = carried["border"] ?? .null
        o["keystone"] = carried["keystone"] ?? .null
        o["lens"] = carried["lens"] ?? .null
        o["detail"] = carried["detail"] ?? .null
        o["repair"] = carried["repair"] ?? .array([])
        o["layers"] = carried["layers"] ?? .array([])
        return .object(o)
    }
}

extension RollDoc {
    /// The document as JSON — what the store keeps and the instance receives.
    public var json: JSONValue {
        .object([
            "id": .string(id), "version": .number(Double(version)), "name": .string(name), "sourceId": .string(sourceId),
            "createdAt": .number(createdAt), "updatedAt": .number(updatedAt),
            "pictures": .array(pictures.map(\.json)), "export": export.json,
        ])
    }
}

// MARK: - editing

/// Two refs to one picture: the same source id, the same content, or the same name and size.
public func sameMediaRef(_ a: SavedMediaRef, _ b: SavedMediaRef) -> Bool {
    if let x = a.assetId, let y = b.assetId { return x == y }
    if let x = a.hash, let y = b.hash { return x == y }
    return a.name.lowercased() == b.name.lowercased() && a.size == b.size
}

/// The roll with `refs` appended, each once.
public func addPictures(_ roll: RollDoc, _ refs: [SavedMediaRef], now: Double = nowMillis(), makeId: () -> String = newRollId) -> RollDoc {
    var pictures = roll.pictures
    for ref in refs {
        if pictures.contains(where: { sameMediaRef($0.ref, ref) }) { continue }
        pictures.append(createRollPicture(ref, id: makeId()))
    }
    if pictures.count == roll.pictures.count { return roll }
    var out = roll
    out.pictures = pictures
    out.updatedAt = now
    return out
}

public func removePictures(_ roll: RollDoc, _ ids: [String], now: Double = nowMillis()) -> RollDoc {
    let drop = Set(ids)
    let pictures = roll.pictures.filter { !drop.contains($0.id) }
    if pictures.count == roll.pictures.count { return roll }
    var out = roll
    out.pictures = pictures
    out.updatedAt = now
    return out
}

/// Move one picture to `to` in the strip; out-of-range indices are clamped.
public func movePicture(_ roll: RollDoc, from: Int, to: Int, now: Double = nowMillis()) -> RollDoc {
    let n = roll.pictures.count
    if from < 0 || from >= n { return roll }
    let target = max(0, min(n - 1, to))
    if target == from { return roll }
    var pictures = roll.pictures
    let moved = pictures.remove(at: from)
    pictures.insert(moved, at: target)
    var out = roll
    out.pictures = pictures
    out.updatedAt = now
    return out
}

/// One picture's own fields changed; its id and ref never move.
public func patchPicture(_ roll: RollDoc, _ id: String, now: Double = nowMillis(), _ patch: (inout RollPicture) -> Void) -> RollDoc {
    guard let i = roll.pictures.firstIndex(where: { $0.id == id }) else { return roll }
    var out = roll
    patch(&out.pictures[i])
    out.updatedAt = now
    return out
}

/// What the gallery card says: "18 of 42 developed".
public func rollProgress(_ roll: RollDoc) -> (total: Int, developed: Int) {
    (roll.pictures.count, roll.pictures.filter {
        $0.develop != nil || $0.grade != nil || $0.framing != nil || $0.aspect != "original" || $0.carried["border"] != nil
    }.count)
}

// MARK: - the roll file

/// Marks the file as ours; a stray `.json` is rejected on it.
public let rollFileKind = "atelier/develop-roll"
public let rollFileExtension = ".roll.json"

public enum RollFileError: Error, Equatable {
    case notJSON
    case notARoll(String)
    case newerVersion(Int)
    case noPictures

    public var message: String {
        switch self {
        case .notJSON: return "That file is not valid JSON."
        case .notARoll(let why): return why
        case .newerVersion(let v):
            return "This file was written by a newer version of Atelier (format \(v), this one reads up to \(rollDocVersion)). Update the app first."
        case .noPictures: return "The file has no pictures list."
        }
    }
}

/// A roll as a `.roll.json` carries it — the document minus what is machine-bound.
public func rollFileJSON(_ roll: RollDoc, exportedAt: Date = Date()) -> JSONValue {
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return .object([
        "kind": .string(rollFileKind), "version": .number(Double(rollDocVersion)), "exportedAt": .string(iso.string(from: exportedAt)),
        "name": .string(roll.name), "pictures": .array(roll.pictures.map(\.json)), "export": roll.export.json,
    ])
}

/// `Islande — jour 3` → `islande-jour-3.roll.json`.
public func rollFileName(_ name: String) -> String {
    let folded = name.folding(options: [.diacriticInsensitive], locale: nil).lowercased()
    var slug = ""
    var pendingDash = false
    for ch in folded {
        if ch.isASCII && (ch.isLetter || ch.isNumber) {
            if pendingDash && !slug.isEmpty { slug.append("-") }
            pendingDash = false
            slug.append(ch)
        } else {
            pendingDash = true
        }
    }
    slug = String(slug.prefix(60))
    while slug.hasSuffix("-") { slug.removeLast() }
    return "\(slug.isEmpty ? "roll" : slug)\(rollFileExtension)"
}

/// A file's text into a roll — a NEW roll, with a fresh id, fresh timestamps
/// and the importing source — or the reason it is not one. Never throws on
/// junk; every refusal is something a person can act on.
public func parseRollFile(_ text: String, sourceId: String = defaultSourceId, now: Double = nowMillis()) -> Result<RollDoc, RollFileError> {
    guard let raw = JSONValue.parse(text) else { return .failure(.notJSON) }
    guard let body = raw.objectValue else { return .failure(.notARoll("That file is not an Atelier roll.")) }
    guard body["kind"]?.stringValue == rollFileKind else {
        return .failure(.notARoll("That file is not an Atelier roll (wrong or missing kind)."))
    }
    let version = Int(body["version"]?.finiteNumber ?? 0)
    if version > rollDocVersion { return .failure(.newerVersion(version)) }
    guard body["pictures"]?.arrayValue != nil else { return .failure(.noPictures) }
    var withId = body
    withId["id"] = .string("file")
    guard let read = readRollDoc(.object(withId), fallbackSourceId: sourceId, now: now) else {
        return .failure(.notARoll("That file is not an Atelier roll."))
    }
    var doc = createRollDoc(name: read.name, sourceId: sourceId, now: now)
    doc.pictures = read.pictures
    doc.export = read.export
    return .success(doc)
}
