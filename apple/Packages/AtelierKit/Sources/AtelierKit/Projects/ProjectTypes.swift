// The Studio's PROJECT document — port of `src/shared/projects/project-types.ts`
// (v16): every field, the migration chain from v1, a reader over the web's
// `unknown` and a writer on the web's JSON shape, so a project kept on a Winnow
// opens on the phone, on the Mac and in the browser alike.
//
// A project splits in two halves (`studio.md`, «Project model»):
// - the PORTABLE half (the template): overlay elements, guides, the grade,
//   the title theme, the intro scenes, the outro card, the export matrix —
//   reusable with any media, and exactly what `.atelier.json` carries
//   (`ProjectFile.swift`);
// - the BOUND half (the instance): the source it lives in (`sourceId`, v14),
//   the media folder, the media LIST (refs, never bytes), the active clip, the
//   per-clip trims (v8) and the per-media develops (v15).
//
// Rules kept:
// - `readProjectDoc` is the web store's `getProject`: whatever was stored is
//   read, then `migrateProjectDoc` replays the chain from the stored version,
//   so a v1 document reopens on today's shape and grades, reads and exports
//   exactly as it did. A document with NO version runs no step at all — the
//   web's `undefined < n` is false for every step — and one from a NEWER
//   version is read, never migrated, its version kept.
// - Every reader clamps and falls back as the web's readers do; what the web
//   leaves `undefined` and resolves at use (`timeShift`, `timeScale`) stays nil
//   here, and what its migration fills (`theme`, `scenes`, `outro`, a variant's
//   cadence and speed) reads straight onto the filled value.
// - A key this build does not know is CARRIED — on the document, its settings,
//   its media and each export variant — and written back verbatim. So is an
//   overlay element this build cannot read (a kind a newer build added): the
//   element model refuses it (`Overlay/OverlayTypes.swift`), so the document
//   keeps its raw JSON IN PLACE (`UnreadElement`) and writes it back where it
//   stood. A project edited on the phone never loses what the web wrote.
// - `SavedMediaRef` is `Roll.swift`'s and the aspect presets are
//   `Develop/AspectTable.swift`'s — one of each, never a second.
//
// The two machine-bound fields are the app's: the web's `dirHandle` is a File
// System Access handle, here the folder's SECURITY-SCOPED BOOKMARK (`Data`,
// opaque to the kernel); the web's `thumbnail` is a Blob, here the baked JPEG's
// bytes. Both are written as base64 in THIS device's copy (`json`) and never
// leave it: `toWireDoc` and the project file drop them, as on the web.
//
// Left to the app: IndexedDB (`project-store.ts` — `ProjectStore` in
// `ProjectRemote.swift` is the seam), `savedMediaRef(file)` (a listed file IS a
// `SavedMediaRef` here), `structuredClone` (value semantics copy deeply).

import Foundation

/// Bumped with a migration in `migrateProjectDoc`, never without.
public let projectDocVersion = 16

// MARK: - the record

public struct ProjectSettings: Equatable, Sendable {
    /// Composition aspect — an `aspectPresets` id.
    public var aspectId: String
    /// Correction applied to the clip's capture time before any clock, date or
    /// timestamp element renders it — a property of the FOOTAGE, never of a
    /// badge. Nil on a document from before v5 that the chain has not reached.
    public var timeShift: TimeShift?
    /// How fast the clip plays against life (`auto` follows the telemetry). A
    /// property of the footage like the shift, and — measured against ONE clip
    /// — never in the project file.
    public var timeScale: TimeScaleSetting?
    /// Keys this build does not interpret, written back verbatim.
    public var carried: [String: JSONValue] = [:]

    public init(aspectId: String, timeShift: TimeShift? = nil, timeScale: TimeScaleSetting? = nil) {
        self.aspectId = aspectId; self.timeShift = timeShift; self.timeScale = timeScale
    }
}

/// The pre-v4 single-look grade, kept so old documents still parse.
public struct SavedLut: Equatable, Sendable {
    public var selected: String
    public var customName: String?
    public var customText: String?
    public var intensity: Double

    public init(selected: String, customName: String? = nil, customText: String? = nil, intensity: Double = 1) {
        self.selected = selected; self.customName = customName; self.customText = customText; self.intensity = intensity
    }

    /// What a new project writes: no look.
    public static let none = SavedLut(selected: "none")
}

public struct ExportPrefs: Equatable, Sendable {
    /// Custom base file name, or nil to use the source clip's name.
    public var fileName: String?
    public var variants: [ExportVariant]
    /// Keys this build does not interpret, written back verbatim.
    public var carried: [String: JSONValue] = [:]

    public init(fileName: String? = nil, variants: [ExportVariant]) {
        self.fileName = fileName; self.variants = variants
    }
}

public struct ProjectMedia: Equatable, Sendable {
    /// The media folder's security-scoped bookmark — the web's directory
    /// handle, opaque to the kernel and meaningless on any other device. Nil
    /// when no folder was picked (or on a copy pulled with no mirror).
    public var dirHandle: Data?
    public var files: [SavedMediaRef]
    /// Base name (asset id) of the clip that was active when last saved.
    public var activeId: String?
    /// In/out points per clip, keyed by base name — only for the clips that
    /// are actually trimmed, each guarded by the duration it was set against.
    public var trims: [String: SavedTrim]
    /// Each media's own correction, keyed by base name like the trims and
    /// guarded by the media's hash (`MediaDevelop.swift`). Only corrected media
    /// have an entry.
    public var develops: [String: SavedDevelop]
    /// Keys this build does not interpret, written back verbatim.
    public var carried: [String: JSONValue] = [:]

    public init(dirHandle: Data? = nil, files: [SavedMediaRef] = [], activeId: String? = nil,
                trims: [String: SavedTrim] = [:], develops: [String: SavedDevelop] = [:]) {
        self.dirHandle = dirHandle; self.files = files; self.activeId = activeId; self.trims = trims
        self.develops = develops
    }

    /// No folder, no media — what a new project and a template copy start with.
    public static let empty = ProjectMedia()
}

/// An entry of a stored element list this build cannot read — a kind a newer
/// build added, or junk — kept verbatim so writing the list back is the
/// identity. It stands where it stood: after the readable element whose id
/// was before it (nil = at the head of the list), and at the END when that
/// element has since gone.
public struct UnreadElement: Equatable, Sendable {
    /// The id of the readable element it followed; nil = at the head.
    public var after: String?
    public var json: JSONValue

    public init(after: String?, json: JSONValue) { self.after = after; self.json = json }
}

public struct ProjectDoc: Equatable, Sendable {
    public var version: Int
    public var id: String
    public var name: String
    public var createdAt: Double
    public var updatedAt: Double
    public var settings: ProjectSettings
    // --- portable half ----------------------------------------------------------
    public var elements: [OverlayElement]
    /// The stored elements this build cannot read, carried in place.
    public var unreadElements: [UnreadElement]
    public var guides: GuidesState
    /// Legacy single-look grade; migrated into `lutStack` on read (v4).
    public var lut: SavedLut
    /// The grade: LUT layers in application order, each with strength + switch.
    public var lutStack: [SavedLutLayer]
    /// The delivery stage baked after the stack; `none` leaves the looks as authored.
    public var outputTransform: OutputTransform
    /// The film TEXTURE — grain and halation — drawn after the cube, or nil.
    public var lutFilm: FilmTexture?
    /// Title-style theme (preset + tweaks), or nil for element styles as-is.
    public var theme: StyleTheme?
    /// The intro scenes: a shared window, an optional scrim, solo.
    public var scenes: [OverlayScene]
    /// The closing card appended after the footage, or nil for none.
    public var outro: OutroCard?
    /// The export matrix: custom base name + the deliverables one press makes.
    public var exportPrefs: ExportPrefs
    // --- bound half -------------------------------------------------------------
    /// The source this project belongs to — `local` for this device. Never
    /// portable: a template comes from no source.
    public var sourceId: String
    public var media: ProjectMedia
    // --- baked gallery facts (usable without the media) ------------------------
    /// The baked gallery JPEG — this device's, never on the wire.
    public var thumbnail: Data?
    public var durationSeconds: Double?
    /// Keys this build does not interpret, written back verbatim.
    public var carried: [String: JSONValue] = [:]

    public init(version: Int = projectDocVersion, id: String, name: String, createdAt: Double, updatedAt: Double,
                settings: ProjectSettings, elements: [OverlayElement] = [], unreadElements: [UnreadElement] = [],
                guides: GuidesState = .default, lut: SavedLut = .none, lutStack: [SavedLutLayer] = [],
                outputTransform: OutputTransform = .none, lutFilm: FilmTexture? = nil, theme: StyleTheme? = nil,
                scenes: [OverlayScene] = [], outro: OutroCard? = nil, exportPrefs: ExportPrefs,
                sourceId: String = defaultSourceId, media: ProjectMedia = .empty, thumbnail: Data? = nil,
                durationSeconds: Double? = nil) {
        self.version = version; self.id = id; self.name = name; self.createdAt = createdAt; self.updatedAt = updatedAt
        self.settings = settings; self.elements = elements; self.unreadElements = unreadElements; self.guides = guides
        self.lut = lut; self.lutStack = lutStack; self.outputTransform = outputTransform; self.lutFilm = lutFilm
        self.theme = theme; self.scenes = scenes; self.outro = outro; self.exportPrefs = exportPrefs
        self.sourceId = sourceId; self.media = media; self.thumbnail = thumbnail; self.durationSeconds = durationSeconds
    }
}

// MARK: - creating

/// A fresh document; pass `template` to copy its portable half (never its
/// media, its trims or its develops — those are the footage's).
public func createProjectDoc(_ name: String, _ aspectId: String, _ elements: [OverlayElement], _ guides: GuidesState,
                             template: ProjectDoc? = nil, now: Double = nowMillis(),
                             id: String = UUID().uuidString.lowercased()) -> ProjectDoc {
    var doc = ProjectDoc(
        id: id, name: name, createdAt: now, updatedAt: now,
        settings: ProjectSettings(aspectId: aspectId, timeShift: .noShift, timeScale: .auto),
        elements: elements, guides: guides,
        exportPrefs: ExportPrefs(fileName: nil, variants: defaultVariants()),
        // The only source that exists here; a remote one hands its own id in.
        sourceId: defaultSourceId
    )
    if let template {
        doc.elements = template.elements
        doc.unreadElements = template.unreadElements
        doc.guides = template.guides
        doc.lut = template.lut
        doc.lutStack = template.lutStack
        doc.outputTransform = template.outputTransform
        doc.lutFilm = template.lutFilm
        doc.theme = template.theme
        doc.scenes = template.scenes
        doc.outro = template.outro
        doc.exportPrefs = template.exportPrefs
    }
    return doc
}

// MARK: - migrating

/// Bring a document up to the current version. v1 → v2 adds the title-style
/// theme (nil: element styles as-is); v2 → v3 the export matrix (one
/// source-faithful variant); v3 → v4 turns the single look into a one-layer
/// stack, so an old project grades identically on reopen; v4 → v5 adds the
/// capture-time correction, zeroed; v5 → v6 the output transform, `none` — an
/// existing grade must never re-encode itself behind the user's back; v6 → v7
/// an explicit `source` cadence on every variant; v7 → v8 the per-clip trims,
/// empty; v8 → v9 the safe zone's quarter-turn, on `auto` (editor chrome that
/// never reaches a pixel); v9 → v10 the cadence correction, on `auto` — the
/// one step that deliberately changes what a reopened project shows, a
/// slow-motion clip's speeds being a measurement corrected, not a choice;
/// v10 → v11 an explicit speed of 1; v11 → v12 the scene list, empty; v12 →
/// v13 the outro, none; v13 → v14 files the document under the local source;
/// v14 → v15 the per-media develops, empty; v15 → v16 the film texture, none.
///
/// On a typed document the steps whose default the READER already gives (a
/// theme, a list, a transform, a cadence) are satisfied by construction; what
/// remains are the three that depend on the version: the v4 stack from the
/// legacy look (only when the stack is empty), and the v5 shift and v10 scale
/// that a newer document may leave absent. Idempotent.
public func migrateProjectDoc(_ doc: ProjectDoc) -> ProjectDoc {
    if doc.version >= projectDocVersion { return doc }
    var migrated = doc
    if migrated.version < 4 && migrated.lutStack.isEmpty {
        // A v3 document's grade IS its single look.
        migrated.lutStack = savedLutAsStack(migrated.lut)
    }
    if migrated.version < 5 && migrated.settings.timeShift == nil {
        // No correction was possible before v5: clocks read identically.
        migrated.settings.timeShift = .noShift
    }
    if migrated.version < 10 && migrated.settings.timeScale == nil {
        // `auto`, not `manual: 1`: an old project's speeds were not a choice.
        migrated.settings.timeScale = .auto
    }
    migrated.version = projectDocVersion
    return migrated
}

/// The v3 single-look grade as a one-layer stack (empty when it graded nothing).
public func savedLutAsStack(_ lut: SavedLut?) -> [SavedLutLayer] {
    guard let lut, lut.selected != "none" else { return [] }
    let isCustom = lut.selected == "custom"
    if isCustom && (lut.customText ?? "").isEmpty { return [] }
    return [SavedLutLayer(
        id: "migrated-\(lut.selected)",
        source: isCustom ? "custom" : "builtin:\(lut.selected)",
        name: isCustom ? (lut.customName ?? "Custom look") : lut.selected,
        customText: isCustom ? lut.customText : nil,
        intensity: lut.intensity,
        enabled: true
    )]
}

// MARK: - reading

private let projectDocKeys: Set<String> = [
    "version", "id", "name", "createdAt", "updatedAt", "settings", "elements", "guides", "lut", "lutStack",
    "outputTransform", "lutFilm", "theme", "scenes", "outro", "exportPrefs", "sourceId", "media", "thumbnail",
    "durationSeconds",
]
private let projectSettingsKeys: Set<String> = ["aspectId", "timeShift", "timeScale"]
private let exportPrefsKeys: Set<String> = ["fileName", "variants"]
private let projectMediaKeys: Set<String> = ["dirHandle", "files", "activeId", "trims", "develops"]

/// The web's `version` as the migration compares it: `v < n` for a whole `n`
/// is `floor(v) < n`, so a fractional version steps exactly as there.
private func storedProjectVersion(_ raw: JSONValue?) -> Int? {
    guard let v = raw?.finiteNumber else { return nil }
    return Int(min(max(v.rounded(.down), -1e9), 1e9))
}

/// A stored shift read back — nil when absent (the web resolves `undefined`
/// as no shift at use); a missing or non-finite part is 0.
private func readProjectTimeShift(_ raw: JSONValue?) -> TimeShift? {
    guard let o = raw?.objectValue else { return nil }
    return TimeShift(minutes: o["minutes"]?.finiteNumber ?? 0, days: o["days"]?.finiteNumber ?? 0)
}

/// A stored settings record read back. A missing format takes the creation
/// modal's first preset — the web never stores a project without one.
public func readProjectSettings(_ raw: JSONValue?) -> ProjectSettings {
    let o = raw?.objectValue ?? [:]
    var settings = ProjectSettings(
        aspectId: o["aspectId"]?.stringValue ?? aspectPresets[0].id,
        timeShift: readProjectTimeShift(o["timeShift"]),
        timeScale: readTimeScaleSetting(o["timeScale"])
    )
    settings.carried = o.filter { !projectSettingsKeys.contains($0.key) }
    return settings
}

/// A stored pre-v4 look read back; anything that is not a record is no look.
public func readSavedLut(_ raw: JSONValue?) -> SavedLut {
    guard let o = raw?.objectValue else { return .none }
    return SavedLut(
        selected: o["selected"]?.stringValue ?? "none",
        customName: o["customName"]?.stringValue,
        customText: o["customText"]?.stringValue,
        intensity: o["intensity"]?.finiteNumber ?? 1
    )
}

/// A stored grade stack read back through the one layer reader
/// (`Lut/SavedGrade.swift`): a layer without an id and a source is dropped,
/// the rest kept as written.
public func readLutStack(_ raw: JSONValue?) -> [SavedLutLayer] {
    guard let list = raw?.arrayValue else { return [] }
    return gradeOrNull(.object(["layers": .array(list)]))?.layers ?? []
}

/// The export matrix read back — the one source-faithful variant when there
/// is none (v3's default), unreadable variants left out.
public func readExportPrefs(_ raw: JSONValue?) -> ExportPrefs {
    guard let o = raw?.objectValue else { return ExportPrefs(fileName: nil, variants: defaultVariants()) }
    var prefs = ExportPrefs(
        fileName: o["fileName"]?.stringValue,
        variants: o["variants"]?.arrayValue.map { $0.compactMap { readExportVariant($0) } } ?? defaultVariants()
    )
    prefs.carried = o.filter { !exportPrefsKeys.contains($0.key) }
    return prefs
}

/// The bound half read back. A trim whose three numbers are not all there is
/// dropped (it would reopen the whole clip anyway); develops go through
/// `normaliseDevelops`, so a foreign value lands clamped or not at all.
public func readProjectMedia(_ raw: JSONValue?) -> ProjectMedia {
    guard let o = raw?.objectValue else { return .empty }
    var trims: [String: SavedTrim] = [:]
    for (key, value) in o["trims"]?.objectValue ?? [:] {
        if let trim = readSavedTrim(value) { trims[key] = trim }
    }
    var media = ProjectMedia(
        dirHandle: (o["dirHandle"]?.stringValue).flatMap { Data(base64Encoded: $0) },
        files: (o["files"]?.arrayValue ?? []).compactMap(readMediaRef),
        activeId: o["activeId"]?.stringValue,
        trims: trims,
        develops: normaliseDevelops(o["develops"])
    )
    media.carried = o.filter { !projectMediaKeys.contains($0.key) }
    return media
}

/// A stored element list read back: the elements this build reads, and every
/// other entry carried where it stood.
public func readProjectElements(_ raw: JSONValue?) -> (elements: [OverlayElement], unread: [UnreadElement]) {
    var elements: [OverlayElement] = []
    var unread: [UnreadElement] = []
    for item in raw?.arrayValue ?? [] {
        if let el = readOverlayElement(item) {
            elements.append(el)
        } else {
            unread.append(UnreadElement(after: elements.last?.id, json: item))
        }
    }
    return (elements, unread)
}

/// The element list as the web stores it: every readable element, and each
/// carried one back in its place.
public func projectElementsJSON(_ elements: [OverlayElement], _ unread: [UnreadElement]) -> JSONValue {
    var out: [JSONValue] = []
    var placed = [Bool](repeating: false, count: unread.count)
    func place(after id: String?) {
        for (i, u) in unread.enumerated() where !placed[i] && u.after == id {
            out.append(u.json)
            placed[i] = true
        }
    }
    place(after: nil)
    for el in elements {
        out.append(el.json)
        place(after: el.id)
    }
    // An entry whose neighbour has since gone keeps its place in the file at the end.
    for (i, u) in unread.enumerated() where !placed[i] { out.append(u.json) }
    return .array(out)
}

/// A stored or received project read onto the current shape, or nil when
/// what arrived is not a project at all (not a record, or no id). The web
/// store's `getProject`: read, then `migrateProjectDoc`.
public func readProjectDoc(_ raw: JSONValue?, now: Double = nowMillis()) -> ProjectDoc? {
    guard let o = raw?.objectValue, let id = o["id"]?.stringValue, !id.isEmpty else { return nil }
    let list = readProjectElements(o["elements"])
    var doc = ProjectDoc(
        // No version at all runs no step, as on the web.
        version: storedProjectVersion(o["version"]) ?? projectDocVersion,
        id: id,
        name: o["name"]?.stringValue ?? "",
        createdAt: o["createdAt"]?.finiteNumber ?? now,
        updatedAt: o["updatedAt"]?.finiteNumber ?? now,
        settings: readProjectSettings(o["settings"]),
        elements: list.elements,
        unreadElements: list.unread,
        guides: readGuidesState(o["guides"]),
        lut: readSavedLut(o["lut"]),
        lutStack: readLutStack(o["lutStack"]),
        // An unknown transform reads as none, the way every other reader reads junk.
        outputTransform: (o["outputTransform"]?.stringValue).flatMap(OutputTransform.init(rawValue:)) ?? .none,
        lutFilm: filmTextureOrNull(o["lutFilm"]),
        theme: readStyleTheme(o["theme"]),
        scenes: readOverlayScenes(o["scenes"]),
        outro: readOutroCard(o["outro"]),
        exportPrefs: readExportPrefs(o["exportPrefs"]),
        // Everything written before sources existed lives on this device.
        sourceId: (o["sourceId"]?.stringValue).flatMap { $0.isEmpty ? nil : $0 } ?? defaultSourceId,
        media: readProjectMedia(o["media"]),
        thumbnail: (o["thumbnail"]?.stringValue).flatMap { Data(base64Encoded: $0) },
        durationSeconds: o["durationSeconds"]?.finiteNumber
    )
    doc.carried = o.filter { !projectDocKeys.contains($0.key) }
    return migrateProjectDoc(doc)
}

/// The pure half of the store's `listProjects`: every stored document read
/// and migrated, what is not a project left out, most recently updated first
/// (a stable order among equals, as `Array.prototype.sort` is).
public func readProjectList(_ stored: [JSONValue], now: Double = nowMillis()) -> [ProjectDoc] {
    let docs = stored.compactMap { readProjectDoc($0, now: now) }
    return docs.enumerated().sorted { a, b in
        if a.element.updatedAt != b.element.updatedAt { return a.element.updatedAt > b.element.updatedAt }
        return a.offset < b.offset
    }.map(\.element)
}

// MARK: - writing

extension ProjectSettings {
    /// `timeShift` and `timeScale` written only when present, as the web's
    /// `JSON.stringify` leaves an `undefined` out.
    public var json: JSONValue {
        var o = carried
        o["aspectId"] = .string(aspectId)
        if let timeShift {
            o["timeShift"] = .object(["minutes": .number(timeShift.minutes), "days": .number(timeShift.days)])
        }
        if let timeScale { o["timeScale"] = timeScale.json }
        return .object(o)
    }
}

extension SavedLut {
    public var json: JSONValue {
        .object([
            "selected": .string(selected),
            "customName": customName.map { .string($0) } ?? .null,
            "customText": customText.map { .string($0) } ?? .null,
            "intensity": .number(intensity),
        ])
    }
}

extension ExportPrefs {
    public var json: JSONValue {
        var o = carried
        o["fileName"] = fileName.map { .string($0) } ?? .null
        o["variants"] = .array(variants.map(\.json))
        return .object(o)
    }
}

extension ProjectMedia {
    /// The bound half as this device keeps it — the bookmark as base64. The
    /// wire drops `dirHandle` (`toWireDoc`).
    public var json: JSONValue {
        var o = carried
        o["dirHandle"] = dirHandle.map { .string($0.base64EncodedString()) } ?? .null
        o["files"] = .array(files.map(\.json))
        o["activeId"] = activeId.map { .string($0) } ?? .null
        o["trims"] = .object(trims.mapValues(\.json))
        o["develops"] = .object(develops.mapValues(\.json))
        return .object(o)
    }
}

extension ProjectDoc {
    /// The document as THIS device keeps it — both halves, the bookmark and
    /// the thumbnail as base64. What travels is `toWireDoc`'s and the file's.
    public var json: JSONValue {
        var o = carried
        o["version"] = .number(Double(version))
        o["id"] = .string(id)
        o["name"] = .string(name)
        o["createdAt"] = .number(createdAt)
        o["updatedAt"] = .number(updatedAt)
        o["settings"] = settings.json
        o["elements"] = projectElementsJSON(elements, unreadElements)
        o["guides"] = guides.json
        o["lut"] = lut.json
        o["lutStack"] = .array(lutStack.map(\.json))
        o["outputTransform"] = .string(outputTransform.rawValue)
        o["lutFilm"] = lutFilm?.json ?? .null
        o["theme"] = theme?.json ?? .null
        o["scenes"] = .array(scenes.map(\.json))
        o["outro"] = outro?.json ?? .null
        o["exportPrefs"] = exportPrefs.json
        o["sourceId"] = .string(sourceId)
        o["media"] = media.json
        o["thumbnail"] = thumbnail.map { .string($0.base64EncodedString()) } ?? .null
        o["durationSeconds"] = durationSeconds.map { .number($0) } ?? .null
        return .object(o)
    }
}
