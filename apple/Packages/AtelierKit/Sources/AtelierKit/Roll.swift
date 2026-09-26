// A ROLL — the Develop tool's document: a named set of pictures, each with its
// own develop, look and crop, plus how the roll exports. Port of
// `src/shared/develop/roll-types.ts` (v6), `export-targets.ts` and `roll-file.ts`.
//
// THE SAME DOCUMENT as the web app's, read and written on the same JSON shape,
// so a roll kept on a Winnow opens on the phone, on the Mac and in the browser
// alike. Every read goes through `readRollDoc`: a stored roll, a pulled one and
// a file land on the current shape; a field this port does not yet interpret
// (a border, a keystone, a lens and its profile, the detail passes, the
// post-crop vignette, the repair patches, the adjustment layers, a grade's film
// texture, the export's metadata choice and watermark) is carried through
// UNTOUCHED as JSON, never dropped — a roll edited here must not lose what the
// web app wrote.

import Foundation

/// Bumped with a migration in `readRollDoc`, never without. The web's history
/// of the shape is in `roll-types.ts`: v5 gave each picture its own look, v6
/// made the export a list of TARGETS.
public let rollDocVersion = 6

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

// MARK: - export targets (v6)

public enum SizeMode: String, CaseIterable, Sendable {
    case long, short, megapixels, percent
}

/// A size is a CAP, read against the picture's own delivered frame; it never upscales.
public struct ExportSize: Hashable, Sendable {
    public var mode: SizeMode
    public var value: Double
    public init(mode: SizeMode, value: Double) { self.mode = mode; self.value = value }
}

/// Sharpening for the SCREEN, applied to the delivered file after it is resized.
public enum OutputSharpen: String, CaseIterable, Sendable {
    case off, low, standard, high
}

/// Where a run writes and at what size: the FIRST target into the folder
/// chosen at the click, each other one into a sub-folder named after it —
/// the files' own names never change.
public struct ExportTarget: Equatable, Sendable {
    public var name: String
    /// Nil is the picture's own size.
    public var size: ExportSize?
    /// JPEG quality, 0.5..1.
    public var quality: Double
    public var sharpen: OutputSharpen
    /// Draw the roll's watermark on this target's files.
    public var watermark: Bool

    public init(name: String = "", size: ExportSize? = nil, quality: Double = 0.92, sharpen: OutputSharpen = .off, watermark: Bool = false) {
        self.name = name; self.size = size; self.quality = quality; self.sharpen = sharpen; self.watermark = watermark
    }

    public static let `default` = ExportTarget()
}

/// A run writes each picture this many times at most.
public let maxTargets = 4
public let qualityLimits = (min: 0.5, max: 1.0)

public func sizeLimits(_ mode: SizeMode) -> (min: Double, max: Double) {
    switch mode {
    case .long: return (256, 16384)
    case .short: return (128, 16384)
    case .megapixels: return (0.1, 200)
    case .percent: return (5, 100)
    }
}

/// The long edge a size asks of a delivered frame (its full size, no cap), or
/// nil for no cap. Never MORE than the frame's own long edge: a size is a
/// ceiling, and a small picture asked for a large one delivers what it has.
public func longEdgeFor(_ size: ExportSize?, width: Double, height: Double) -> Int? {
    guard let size else { return nil }
    let long = max(width, height)
    let short = min(width, height)
    guard long > 0, short > 0 else { return nil }
    let ratio = long / short
    let asked: Double
    switch size.mode {
    case .short: asked = size.value * ratio
    case .megapixels: asked = (size.value * 1e6 * ratio).squareRoot()
    case .percent: asked = long * size.value / 100
    case .long: asked = size.value
    }
    let edge = Int(asked.rounded())
    return Double(edge) >= long ? nil : max(1, edge)
}

/// `2048 px long edge` · `1080 px short edge` · `2 MP` · `50 %` · `full size`.
public func describeSize(_ size: ExportSize?) -> String {
    guard let size else { return "full size" }
    switch size.mode {
    case .short: return "\(Int(size.value.rounded())) px short edge"
    case .megapixels:
        let v = (size.value * 10).rounded() / 10
        return v == v.rounded() ? "\(Int(v)) MP" : "\(v) MP"
    case .percent: return "\(Int(size.value.rounded())) %"
    case .long: return "\(Int(size.value.rounded())) px long edge"
    }
}

/// The sub-folder a target writes into: its name made safe for a file system,
/// else `Target 2`.
public func targetFolder(_ name: String, index: Int) -> String {
    let forbidden = Set("\\/:*?\"<>|")
    var cleaned = ""
    for scalar in name.unicodeScalars {
        if scalar.value < 32 || forbidden.contains(Character(scalar)) { cleaned.append(" ") } else { cleaned.unicodeScalars.append(scalar) }
    }
    let collapsed = cleaned.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    var safe = Substring(collapsed)
    while safe.hasPrefix(".") { safe = safe.dropFirst() }
    let cut = String(safe.prefix(64)).trimmingCharacters(in: .whitespaces)
    return cut.isEmpty ? "Target \(index + 1)" : cut
}

/// The size read back safely, or nil for the picture's own.
public func readSize(_ raw: JSONValue?) -> ExportSize? {
    guard let o = raw?.objectValue, let modeName = o["mode"]?.stringValue, let mode = SizeMode(rawValue: modeName),
          let v = o["value"]?.finiteNumber else { return nil }
    let limits = sizeLimits(mode)
    let value = min(limits.max, max(limits.min, v))
    return ExportSize(mode: mode, value: mode == .megapixels ? (value * 10).rounded() / 10 : value.rounded())
}

public func readTarget(_ raw: JSONValue?) -> ExportTarget? {
    guard let o = raw?.objectValue else { return nil }
    var out = ExportTarget.default
    if let name = o["name"]?.stringValue { out.name = String(name.prefix(64)) }
    out.size = readSize(o["size"])
    out.quality = min(qualityLimits.max, max(qualityLimits.min, o["quality"]?.finiteNumber ?? ExportTarget.default.quality))
    if let s = o["sharpen"]?.stringValue, let level = OutputSharpen(rawValue: s) { out.sharpen = level }
    out.watermark = o["watermark"]?.boolValue == true
    return out
}

/// A stored list read back: junk dropped, capped, never empty. A roll written
/// before targets existed (v5 and earlier) had ONE long edge and one quality —
/// the legacy pair — which become its only target, so it exports as it did.
public func readTargets(_ raw: JSONValue?, legacyLongEdge: Double? = nil, legacyQuality: Double? = nil) -> [ExportTarget] {
    let read = Array((raw?.arrayValue ?? []).compactMap { readTarget($0) }.prefix(maxTargets))
    if !read.isEmpty { return read }
    var only = ExportTarget.default
    if let edge = legacyLongEdge {
        only.size = readSize(.object(["mode": "long", "value": .number(edge)]))
    }
    only.quality = min(qualityLimits.max, max(qualityLimits.min, legacyQuality ?? ExportTarget.default.quality))
    return [only]
}

public struct RollExport: Equatable, Sendable {
    /// Never empty.
    public var targets: [ExportTarget]
    /// Replace a file the folder already holds under the export's name; OFF by default.
    public var replace: Bool
    /// Deliver an Ultra HDR JPEG for a picture developed on its RAW.
    public var hdr: Bool
    /// How far above white the map may reach, in stops.
    public var hdrStops: Int
    /// Which groups of metadata leave (`exif/meta-groups.ts`), carried as
    /// written; absent reads as All on the web, the GPS leaving by default.
    public var metadata: JSONValue?
    /// The watermark's style (`watermark.ts`), carried as written.
    public var watermark: JSONValue?

    public init(targets: [ExportTarget] = [.default], replace: Bool = false, hdr: Bool = false, hdrStops: Int = 2,
                metadata: JSONValue? = nil, watermark: JSONValue? = nil) {
        self.targets = targets.isEmpty ? [.default] : targets
        self.replace = replace; self.hdr = hdr; self.hdrStops = hdrStops; self.metadata = metadata; self.watermark = watermark
    }

    public static let `default` = RollExport()
    public static let hdrStopsLimits = (min: 1, max: 4)

    /// The FIRST target — what v5 held as one long edge and one quality.
    public var primary: ExportTarget {
        get { targets.first ?? .default }
        set { if targets.isEmpty { targets = [newValue] } else { targets[0] = newValue } }
    }
}

// MARK: - pictures

/// Whether a picture LEAVES in an export: `auto` follows the roll's rule (it
/// leaves when edited), `yes` and `no` are the author's call, `ignore` takes
/// it out of the roll's WORK. An output instruction, never a rating.
public enum DeliverState: String, CaseIterable, Sendable {
    case auto, yes, no, ignore
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
    public var deliver: DeliverState
    /// The picture's own WORDS, written into the delivered file; nil is none.
    public var title: String?
    public var caption: String?
    /// Nil for the first entry of a capture, 2, 3… for a copy (`addVariant`).
    public var variant: Int?
    /// Everything else the web app writes on a picture — `border`, `keystone`,
    /// `lens`, `lensProfile`, `detail`, `vignette`, `repair`, `layers`, and
    /// anything a later build adds — read and written verbatim. A known
    /// field's "nothing" (null, or an empty list for the two lists) is not kept.
    public var carried: [String: JSONValue]

    public init(id: String, ref: SavedMediaRef, develop: DevelopSettings? = nil, grade: RollGrade? = nil,
                framing: Framing? = nil, aspect: String = "original", rendition: String? = nil, deliver: DeliverState = .auto,
                title: String? = nil, caption: String? = nil, variant: Int? = nil, carried: [String: JSONValue] = [:]) {
        self.id = id; self.ref = ref; self.develop = develop; self.grade = grade; self.framing = framing
        self.aspect = aspect; self.rendition = rendition; self.deliver = deliver
        self.title = title; self.caption = caption; self.variant = variant; self.carried = carried
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

/// The keys `readPicture` interprets; every other key is carried.
private let pictureKeys: Set<String> = ["id", "ref", "develop", "grade", "framing", "aspect", "rendition", "deliver", "title", "caption", "variant"]
/// The carried fields whose "nothing" the web writes as null.
private let nullWhenNothing = ["border", "keystone", "lens", "detail", "vignette"]
/// The carried fields whose "nothing" the web writes as an empty list.
private let emptyWhenNothing = ["repair", "layers"]

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
    // v5 and earlier held one long edge and one quality: they become the only target.
    out.targets = readTargets(o["targets"], legacyLongEdge: o["longEdge"]?.finiteNumber, legacyQuality: o["quality"]?.finiteNumber)
    // `originals`, written by v1–v3, is left behind on purpose (v4).
    out.replace = o["replace"]?.boolValue == true
    out.hdr = o["hdr"]?.boolValue == true
    let stops = o["hdrStops"]?.finiteNumber ?? Double(RollExport.default.hdrStops)
    out.hdrStops = Int(min(Double(RollExport.hdrStopsLimits.max), max(Double(RollExport.hdrStopsLimits.min), stops)).rounded())
    if let m = o["metadata"], m.objectValue != nil { out.metadata = m }
    if let w = o["watermark"], w.objectValue != nil { out.watermark = w }
    return out
}

private func readFraming(_ raw: JSONValue?) -> Framing? {
    guard let raw, raw != .null else { return nil }
    let f = normaliseFraming(raw)
    return isDefaultFraming(f) ? nil : f
}

/// A picture's words as stored: trimmed, an empty one left out.
public func wordsOf(title: String?, caption: String?) -> (title: String?, caption: String?) {
    let t = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let c = (caption ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return (t.isEmpty ? nil : t, c.isEmpty ? nil : c)
}

private func readPicture(_ raw: JSONValue, rollGrade: RollGrade?) -> RollPicture? {
    guard let o = raw.objectValue, let ref = readMediaRef(o["ref"]) else { return nil }
    var carried: [String: JSONValue] = [:]
    for (key, value) in o where !pictureKeys.contains(key) {
        if nullWhenNothing.contains(key) && value == .null { continue }
        if emptyWhenNothing.contains(key) && (value == .null || value == .array([])) { continue }
        carried[key] = value
    }
    let aspect = o["aspect"]?.stringValue.flatMap { isStoredAspect($0) ? $0 : nil } ?? "original"
    let grade: RollGrade?
    if o["grade"] != nil { grade = readRollGrade(o["grade"]) } else { grade = rollGrade }
    // Absent — every roll written before it existed — and anything unknown read as `auto`.
    let deliver = (o["deliver"]?.stringValue).flatMap { DeliverState(rawValue: $0) } ?? .auto
    let words = wordsOf(title: o["title"]?.stringValue, caption: o["caption"]?.stringValue)
    var variant: Int? = nil
    if let v = o["variant"]?.finiteNumber, v == v.rounded(), v >= 2 { variant = Int(v) }
    return RollPicture(
        id: (o["id"]?.stringValue).flatMap { $0.isEmpty ? nil : $0 } ?? newRollId(),
        ref: ref,
        develop: developOrNull(o["develop"]),
        grade: grade,
        framing: readFraming(o["framing"]),
        aspect: aspect,
        rendition: (o["rendition"]?.stringValue).flatMap { $0.isEmpty ? nil : $0 },
        deliver: deliver,
        title: words.title,
        caption: words.caption,
        variant: variant,
        carried: carried
    )
}

// The aspect ids a roll may store — `original`, a preset, or a FREE zone's
// `free:<ratio>` — are `isStoredAspect`'s (`Develop/CropAspect.swift`), over
// the table in `Develop/AspectTable.swift`.

/// A stored or received roll read onto the current shape, or nil when what
/// arrived is not a roll at all. A roll written before v5 hands its one look to
/// every picture that carries none; one written before v6 keeps its one long
/// edge and quality as its only target.
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

extension ExportSize {
    public var json: JSONValue {
        .object(["mode": .string(mode.rawValue), "value": .number(value)])
    }
}

extension ExportTarget {
    public var json: JSONValue {
        .object(["name": .string(name), "size": size?.json ?? .null, "quality": .number(quality),
                 "sharpen": .string(sharpen.rawValue), "watermark": .bool(watermark)])
    }
}

extension RollExport {
    public var json: JSONValue {
        var o: [String: JSONValue] = [
            "targets": .array(targets.map(\.json)), "replace": .bool(replace), "hdr": .bool(hdr), "hdrStops": .number(Double(hdrStops)),
        ]
        if let metadata { o["metadata"] = metadata }
        if let watermark { o["watermark"] = watermark }
        return .object(o)
    }
}

extension Framing {
    public var json: JSONValue {
        .object(["scale": .number(scale), "x": .number(x), "y": .number(y), "rotation": .number(rotation),
                 "flipX": .bool(flipX), "flipY": .bool(flipY), "fit": .string(fit.rawValue)])
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
            "deliver": .string(deliver.rawValue),
        ]
        if let title { o["title"] = .string(title) }
        if let caption { o["caption"] = .string(caption) }
        if let variant { o["variant"] = .number(Double(variant)) }
        // What the web app writes for an untouched field, so a roll made here
        // reads as one made there: null for the records, an empty list for the lists.
        for key in nullWhenNothing { o[key] = carried[key] ?? .null }
        for key in emptyWhenNothing { o[key] = carried[key] ?? .array([]) }
        for (key, value) in carried where !nullWhenNothing.contains(key) && !emptyWhenNothing.contains(key) { o[key] = value }
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

/// The roll with one picture's words replaced — trimmed, an emptied one taken
/// off the picture rather than stored blank. The same roll back when nothing
/// changed.
public func setPictureWords(_ roll: RollDoc, _ id: String, title: String? = nil, caption: String? = nil, now: Double = nowMillis()) -> RollDoc {
    guard let i = roll.pictures.firstIndex(where: { $0.id == id }) else { return roll }
    let picture = roll.pictures[i]
    let next = wordsOf(title: title ?? picture.title, caption: caption ?? picture.caption)
    if next.title == picture.title && next.caption == picture.caption { return roll }
    var out = roll
    out.pictures[i].title = next.title
    out.pictures[i].caption = next.caption
    out.updatedAt = now
    return out
}

// MARK: - what was done to a picture

public enum PictureEdit: String, CaseIterable, Sendable {
    case develop, look, crop, border, perspective, lens, detail, vignette, repair, layers
}

private func number(_ o: [String: JSONValue], _ key: String, _ fallback: Double) -> Double {
    o[key]?.finiteNumber ?? fallback
}

/// The web's `isDefaultKeystone`, on the record as carried.
func isDefaultKeystone(_ raw: JSONValue?) -> Bool {
    guard let k = raw?.objectValue else { return true }
    return number(k, "vertical", 0) == 0 && number(k, "horizontal", 0) == 0 && number(k, "rotation", 0) == 0
        && number(k, "aspect", 0) == 0 && number(k, "scale", 1) == 1
}

/// The web's `isDefaultLens`.
func isDefaultLens(_ raw: JSONValue?) -> Bool {
    guard let l = raw?.objectValue else { return true }
    return number(l, "distortion", 0) == 0 && number(l, "distortion2", 0) == 0 && number(l, "chromaRed", 0) == 0
        && number(l, "chromaBlue", 0) == 0 && number(l, "vignette", 0) == 0
}

/// The web's `isDefaultDetail`.
func isDefaultDetail(_ raw: JSONValue?) -> Bool {
    guard let d = raw?.objectValue else { return true }
    return number(d, "luminance", 0) == 0 && number(d, "colour", 0) == 0 && number(d, "defringe", 0) == 0
        && number(d, "sharpen", 0) == 0 && number(d, "texture", 0) == 0 && number(d, "clarity", 0) == 0 && number(d, "dehaze", 0) == 0
}

/// The web's `isDefaultPostVignette`.
func isDefaultPostVignette(_ raw: JSONValue?) -> Bool {
    guard let v = raw?.objectValue else { return true }
    return number(v, "amount", 0) == 0
}

/// Everything the author did to ONE picture — the one answer to "is it
/// edited?" that the filmstrip's dot, the roll's progress and the remove
/// confirmation all read. A value dragged back to its default is no edit; an
/// ASPECT other than the picture's own is a crop on its own. WHICH FILE the
/// picture is developed from (`rendition`) is a choice of bytes, not an edit,
/// and a lens's measured profile is calibration.
public func pictureEdits(_ p: RollPicture) -> [PictureEdit] {
    var out: [PictureEdit] = []
    if !isDefaultDevelop(p.develop) { out.append(.develop) }
    if p.grade != nil { out.append(.look) }
    if let f = p.framing, !isDefaultFraming(f) { out.append(.crop) } else if p.aspect != "original" { out.append(.crop) }
    if let border = p.carried["border"], border.objectValue != nil { out.append(.border) }
    if !isDefaultKeystone(p.carried["keystone"]) { out.append(.perspective) }
    if !isDefaultLens(p.carried["lens"]) { out.append(.lens) }
    if !isDefaultDetail(p.carried["detail"]) { out.append(.detail) }
    if !isDefaultPostVignette(p.carried["vignette"]) { out.append(.vignette) }
    if let repair = p.carried["repair"]?.arrayValue, !repair.isEmpty { out.append(.repair) }
    if let layers = p.carried["layers"]?.arrayValue, !layers.isEmpty { out.append(.layers) }
    return out
}

public func isEdited(_ p: RollPicture) -> Bool {
    !pictureEdits(p).isEmpty
}

/// What the gallery card says: "18 of 42 developed" — `isEdited`, counted over
/// the pictures still in the roll's work: an ignored picture is in neither
/// number, and `ignored` says how many were set aside.
public func rollProgress(_ roll: RollDoc) -> (total: Int, developed: Int, ignored: Int) {
    let live = roll.pictures.filter { !isIgnored($0) }
    return (live.count, live.filter(isEdited).count, roll.pictures.count - live.count)
}

// MARK: - delivery

public func isIgnored(_ p: RollPicture) -> Bool {
    p.deliver == .ignore
}

/// Whether the picture leaves in an export: the author's call, else the roll's rule — edited ones leave.
public func delivers(_ p: RollPicture) -> Bool {
    p.deliver == .yes || (p.deliver == .auto && isEdited(p))
}

/// The state after one "send ↔ hold" gesture: the OTHER answer, stored as
/// `auto` when that is what the rule already says. An ignored picture comes
/// back into the work on `auto`.
public func toggledDelivery(_ p: RollPicture) -> DeliverState {
    if isIgnored(p) { return .auto }
    let leaving = !delivers(p)
    return leaving == isEdited(p) ? .auto : (leaving ? .yes : .no)
}

/// The Export tab's table filters. An ignored picture answers none of them.
public enum DeliveryFilter: String, CaseIterable, Sendable {
    case all, edited, leaving, held
}

public func matchesDeliveryFilter(_ p: RollPicture, _ filter: DeliveryFilter) -> Bool {
    if isIgnored(p) { return false }
    switch filter {
    case .all: return true
    case .edited: return isEdited(p)
    case .leaving: return delivers(p)
    case .held: return !delivers(p)
    }
}

/// One delivery state written onto several pictures; the same roll back when nothing changes.
public func setDelivery(_ roll: RollDoc, _ ids: [String], _ state: DeliverState, now: Double = nowMillis()) -> RollDoc {
    var changed = false
    var out = roll
    for i in out.pictures.indices where ids.contains(out.pictures[i].id) && out.pictures[i].deliver != state {
        out.pictures[i].deliver = state
        changed = true
    }
    if !changed { return roll }
    out.updatedAt = now
    return out
}

// MARK: - variants

/// 1 for the first entry of a capture, 2, 3… for its copies.
public func variantNumber(_ p: RollPicture) -> Int {
    if let v = p.variant, v >= 2 { return v }
    return 1
}

/// `DJI_0101.JPG` for the first, `DJI_0101.JPG · 2` for a copy.
public func pictureLabel(_ p: RollPicture) -> String {
    let n = variantNumber(p)
    return n > 1 ? "\(p.ref.name) · \(n)" : p.ref.name
}

/// The sub-folder a copy's file leaves into — `Variant 2` — or "" for the first.
public func variantFolder(_ p: RollPicture) -> String {
    let n = variantNumber(p)
    return n > 1 ? "Variant \(n)" : ""
}

/// How a variant starts: as the source picture stands, or as shot.
public enum VariantStart: String, Sendable {
    case clone, fresh
}

/// A new variant of picture `fromId`, placed right after the last entry of
/// its capture and numbered one past the highest there. `clone` copies every
/// field, its words included, the delivery back on the rule; `fresh` starts
/// as shot, keeping only what belongs to the FILE — the rendition, a RAW base
/// with its measured gain, the lens's profile. The roll unchanged when
/// `fromId` names nothing.
public func addVariant(_ roll: RollDoc, _ fromId: String, _ start: VariantStart, newId: String = newRollId(), now: Double = nowMillis()) -> RollDoc {
    guard let from = roll.pictures.first(where: { $0.id == fromId }) else { return roll }
    let family = roll.pictures.filter { sameMediaRef($0.ref, from.ref) }
    let number = (family.map(variantNumber).max() ?? 1) + 1
    var made: RollPicture
    if start == .clone {
        made = from
        made.id = newId
        made.deliver = .auto
    } else {
        made = createRollPicture(from.ref, id: newId)
        if let d = from.develop, isRawDevelop(d) {
            var base = DevelopSettings.default
            base.base = d.base
            base.rawGain = d.rawGain
            made.develop = base
        }
        made.rendition = from.rendition
        if let profile = from.carried["lensProfile"] { made.carried["lensProfile"] = profile }
    }
    made.variant = number
    let last = roll.pictures.lastIndex { sameMediaRef($0.ref, from.ref) } ?? -1
    var out = roll
    out.pictures.insert(made, at: last + 1)
    out.updatedAt = now
    return out
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

/// A file's text into a roll — a NEW roll, with a fresh id, fresh timestamps,
/// fresh PICTURE ids (thumbnails and previews are keyed by picture id alone)
/// and the importing source — or the reason it is not one. Never throws on
/// junk; every refusal is something a person can act on.
public func parseRollFile(_ text: String, sourceId: String = defaultSourceId, now: Double = nowMillis(),
                          makeId: () -> String = newRollId) -> Result<RollDoc, RollFileError> {
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
    var doc = createRollDoc(name: read.name, sourceId: sourceId, now: now, id: makeId())
    doc.pictures = read.pictures.map { picture in
        var copy = picture
        copy.id = makeId()
        return copy
    }
    doc.export = read.export
    return .success(doc)
}
