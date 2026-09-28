// The project file — a Studio project's PORTABLE half on disk as JSON,
// `<name>.atelier.json`. Port of `src/shared/projects/project-file.ts`, pure:
// building, serialising, parsing and applying; picking and saving the file
// are the app's.
//
// It is the same split the document makes (`ProjectTypes.swift`): everything
// reusable with any media travels — the format and the capture-time shift,
// the overlay elements, the guides, the grade stack (an uploaded `.cube`
// inlined, so a shared look grades identically), the film texture, the title
// theme, the intro scenes, the outro card, the export matrix. Nothing bound
// to one machine or one footage does: no folder, no media list, no trims, no
// develops, no thumbnail, no document id, no source — and not the cadence
// correction, which is measured against ONE clip and would misapply to
// another. A project file is a template you can mail, not a backup.
//
// THE FOUR PLACES (`studio.md`): anything added to the portable half must
// land in `ProjectPortable`, `toProjectFile`, `parseProjectFile` and
// `applyProjectFile` — the last was forgotten once on the web and the gallery
// import silently dropped intros. Here the four are this file's four
// functions, over the one `ProjectPortable` record.
//
// `version` is the ProjectDoc version the file was written at, so an older
// file replays the same migration chain a stored document does. A file from a
// NEWER version is refused rather than half-read. The text comes off a
// stranger's disk: parsing never throws, and every refusal is a sentence a
// person can act on.

import Foundation

/// Marks the file as ours; a stray `.json` is rejected on it.
public let projectFileKind = "atelier/studio-project"

/// Double extension: recognisable at a glance, still a plain `.json`.
public let projectFileExtension = ".atelier.json"

/// What the web's file picker accepts — the app's picker takes `.json` files.
public let projectFileAccept = ".json,application/json"

/// The portable half of a project — what a project file carries.
public struct ProjectPortable: Equatable, Sendable {
    public var settings: ProjectSettings
    public var elements: [OverlayElement]
    /// Stored elements this build cannot read, carried in place (`UnreadElement`).
    public var unreadElements: [UnreadElement]
    public var guides: GuidesState
    public var lutStack: [SavedLutLayer]
    public var outputTransform: OutputTransform
    public var lutFilm: FilmTexture?
    public var theme: StyleTheme?
    public var scenes: [OverlayScene]
    public var outro: OutroCard?
    public var exportPrefs: ExportPrefs

    public init(settings: ProjectSettings, elements: [OverlayElement], unreadElements: [UnreadElement] = [],
                guides: GuidesState, lutStack: [SavedLutLayer], outputTransform: OutputTransform,
                lutFilm: FilmTexture?, theme: StyleTheme?, scenes: [OverlayScene], outro: OutroCard?,
                exportPrefs: ExportPrefs) {
        self.settings = settings; self.elements = elements; self.unreadElements = unreadElements
        self.guides = guides; self.lutStack = lutStack; self.outputTransform = outputTransform
        self.lutFilm = lutFilm; self.theme = theme; self.scenes = scenes; self.outro = outro
        self.exportPrefs = exportPrefs
    }
}

extension ProjectDoc {
    /// The document's portable half (place one of four).
    public var portable: ProjectPortable {
        ProjectPortable(settings: settings, elements: elements, unreadElements: unreadElements, guides: guides,
                        lutStack: lutStack, outputTransform: outputTransform, lutFilm: lutFilm, theme: theme,
                        scenes: scenes, outro: outro, exportPrefs: exportPrefs)
    }
}

/// A project file: the portable half, plus what says whose and when.
public struct ProjectFile: Equatable, Sendable {
    /// Always `projectFileKind`.
    public var kind: String
    /// ProjectDoc version this was written at — drives the migration on read.
    public var version: Int
    /// The project's name when it was exported; informative, never binding.
    public var name: String
    /// ISO timestamp, for the human reading the file.
    public var exportedAt: String
    public var settings: ProjectSettings
    public var elements: [OverlayElement]
    public var unreadElements: [UnreadElement]
    public var guides: GuidesState
    public var lutStack: [SavedLutLayer]
    public var outputTransform: OutputTransform
    public var lutFilm: FilmTexture?
    public var theme: StyleTheme?
    public var scenes: [OverlayScene]
    public var outro: OutroCard?
    public var exportPrefs: ExportPrefs

    public init(version: Int = projectDocVersion, name: String, exportedAt: String, portable p: ProjectPortable) {
        kind = projectFileKind
        self.version = version; self.name = name; self.exportedAt = exportedAt
        settings = p.settings; elements = p.elements; unreadElements = p.unreadElements; guides = p.guides
        lutStack = p.lutStack; outputTransform = p.outputTransform; lutFilm = p.lutFilm; theme = p.theme
        scenes = p.scenes; outro = p.outro; exportPrefs = p.exportPrefs
    }

    /// The file's portable half.
    public var portable: ProjectPortable {
        ProjectPortable(settings: settings, elements: elements, unreadElements: unreadElements, guides: guides,
                        lutStack: lutStack, outputTransform: outputTransform, lutFilm: lutFilm, theme: theme,
                        scenes: scenes, outro: outro, exportPrefs: exportPrefs)
    }
}

/// Why a text is not a project file — a sentence a person can act on.
public struct ProjectFileError: Error, Equatable, Sendable {
    public var message: String
    public init(_ message: String) { self.message = message }
}

/// `new Date(ms).toISOString()`.
private func projectFileIsoString(_ ms: Double) -> String {
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return iso.string(from: Date(timeIntervalSince1970: ms / 1000))
}

// MARK: - place two: building

/// Build the file from a portable half (the editor's live state, or a
/// document's) and the project's name (place two of four).
public func toProjectFile(_ source: ProjectPortable, name: String, exportedAt: Double = nowMillis()) -> ProjectFile {
    // The cadence correction stays home: measured against ONE clip's
    // telemetry (and carrying that clip's id), travelling with a template it
    // could only misapply. `parseProjectFile` drops it on the way in too.
    var portable = source
    portable.settings.timeScale = nil
    return ProjectFile(version: projectDocVersion, name: name, exportedAt: projectFileIsoString(exportedAt),
                       portable: portable)
}

/// The file of a whole document.
public func toProjectFile(_ doc: ProjectDoc, exportedAt: Double = nowMillis()) -> ProjectFile {
    toProjectFile(doc.portable, name: doc.name, exportedAt: exportedAt)
}

extension ProjectFile {
    /// The file as JSON — the portable half and the four header fields, never
    /// a bound one (no `sourceId`, no `media`, no `thumbnail`, no `id`).
    public var json: JSONValue {
        .object([
            "kind": .string(kind),
            "version": .number(Double(version)),
            "name": .string(name),
            "exportedAt": .string(exportedAt),
            "settings": settings.json,
            "elements": projectElementsJSON(elements, unreadElements),
            "guides": guides.json,
            "lutStack": .array(lutStack.map(\.json)),
            "outputTransform": .string(outputTransform.rawValue),
            "lutFilm": lutFilm?.json ?? .null,
            "theme": theme?.json ?? .null,
            "scenes": .array(scenes.map(\.json)),
            "outro": outro?.json ?? .null,
            "exportPrefs": exportPrefs.json,
        ])
    }
}

/// Indented on purpose: the file is meant to be readable and diffable.
public func serializeProjectFile(_ file: ProjectFile) -> String {
    file.json.serialized(pretty: true) + "\n"
}

/// `Vol du soir` → `vol-du-soir.atelier.json`: accents stripped (NFD, the
/// combining marks dropped), lowercased, every run of anything but `a-z0-9`
/// one dash, the ends trimmed of dashes, then the first 60 characters.
public func projectFileName(_ name: String) -> String {
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
            // A leading run is trimmed; a trailing one is never written.
            pendingDash = true
        }
    }
    slug = String(slug.prefix(60))
    return "\(slug.isEmpty ? "project" : slug)\(projectFileExtension)"
}

// MARK: - place three: parsing

/// JavaScript's `Number(x) || 0` over a JSON value: a number, a numeric
/// string, a boolean; anything else (and NaN) is 0.
private func projectFileNumber(_ v: JSONValue?) -> Double {
    guard let v else { return 0 }
    switch v {
    case .number(let n): return n.isFinite ? n : 0
    case .bool(let b): return b ? 1 : 0
    case .string(let s):
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return 0 }
        guard let n = Double(t), n.isFinite else { return 0 }
        return n
    default: return 0
    }
}

/// JavaScript's `${n}`: an integer-valued number prints without `.0`.
private func projectFileNumberText(_ x: Double) -> String {
    if x.isFinite, x == x.rounded(), abs(x) < 1e15 { return String(Int64(x)) }
    return "\(x)"
}

/// Read a file's text into a project file, or explain why it is not one
/// (place three of four). Never throws: the input may be anything at all.
public func parseProjectFile(_ text: String) -> Result<ProjectFile, ProjectFileError> {
    guard let raw = JSONValue.parse(text) else { return .failure(ProjectFileError("That file is not valid JSON.")) }
    guard let o = raw.objectValue else {
        return .failure(ProjectFileError("That file is not an Atelier project file."))
    }
    guard o["kind"]?.stringValue == projectFileKind else {
        return .failure(ProjectFileError("That file is not an Atelier project file (wrong or missing kind)."))
    }
    // `typeof raw.version === 'number'` — JSON carries no NaN.
    let version = o["version"]?.finiteNumber ?? 0
    if version > Double(projectDocVersion) {
        return .failure(ProjectFileError(
            "This file was written by a newer version of Atelier (format \(projectFileNumberText(version)), "
                + "this one reads up to \(projectDocVersion)). Update the app first."
        ))
    }
    guard o["elements"]?.arrayValue != nil else {
        return .failure(ProjectFileError("The file has no overlay elements list."))
    }
    guard let rawSettings = o["settings"]?.objectValue, let aspectId = rawSettings["aspectId"]?.stringValue else {
        return .failure(ProjectFileError("The file has no project format."))
    }

    // Shape is sound; anything optional a past version did not write is
    // filled with the same default a migrated document gets. The settings
    // take the format and the shift, never the cadence.
    var timeShift = TimeShift.noShift
    if let shift = rawSettings["timeShift"]?.objectValue {
        timeShift = TimeShift(minutes: projectFileNumber(shift["minutes"]), days: projectFileNumber(shift["days"]))
    }
    var exportPrefs = ExportPrefs(fileName: nil, variants: defaultVariants())
    if let prefs = o["exportPrefs"]?.objectValue, let variants = prefs["variants"]?.arrayValue {
        exportPrefs = ExportPrefs(fileName: prefs["fileName"]?.stringValue,
                                  variants: variants.compactMap { readExportVariant($0) })
    }
    let list = readProjectElements(o["elements"])

    // Replay the document migrations: an older file must land on the current
    // shape exactly as an older stored project does.
    let shell = ProjectDoc(
        version: Int(min(max(version.rounded(.down), -1e9), 1e9)),
        id: "file", name: "", createdAt: 0, updatedAt: 0,
        settings: ProjectSettings(aspectId: aspectId, timeShift: timeShift),
        elements: list.elements,
        unreadElements: list.unread,
        guides: readGuidesState(o["guides"]),
        lutStack: readLutStack(o["lutStack"]),
        outputTransform: (o["outputTransform"]?.stringValue).flatMap(OutputTransform.init(rawValue:)) ?? .none,
        lutFilm: filmTextureOrNull(o["lutFilm"]),
        theme: readStyleTheme(o["theme"]),
        scenes: readOverlayScenes(o["scenes"]),
        outro: readOutroCard(o["outro"]),
        exportPrefs: exportPrefs
    )
    let migrated = migrateProjectDoc(shell)
    return .success(ProjectFile(
        version: projectDocVersion,
        name: o["name"]?.stringValue ?? "",
        exportedAt: o["exportedAt"]?.stringValue ?? "",
        portable: migrated.portable
    ))
}

// MARK: - place four: applying

/// Replace a document's portable half with the file's. The bound half — id,
/// source, media folder and list, trims, develops, thumbnail, creation date —
/// and the project's own NAME are kept: importing settings into "Vol du soir"
/// must not rename it after whoever exported the file.
public func applyProjectFile(_ doc: ProjectDoc, _ file: ProjectFile, now: Double = nowMillis()) -> ProjectDoc {
    var next = doc
    next.updatedAt = now
    next.settings = file.settings
    next.elements = file.elements
    next.unreadElements = file.unreadElements
    next.guides = file.guides
    next.lutStack = file.lutStack
    next.outputTransform = file.outputTransform
    next.lutFilm = file.lutFilm
    next.theme = file.theme
    // Scenes were forgotten here on the web when v12 added them, so a file
    // imported as a NEW project silently lost its intro. The outro joins both.
    next.scenes = file.scenes
    next.outro = file.outro
    next.exportPrefs = file.exportPrefs
    return next
}
