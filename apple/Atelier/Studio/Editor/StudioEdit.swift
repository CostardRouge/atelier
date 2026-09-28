// The COMPOSITION a Studio project holds — what one step of undo holds and
// what the autosave writes. The web's editor keeps a dozen `useState` values
// and assembles the document on save; its history watches the autosave's own
// dependency list as ONE object (`studio.md`, «Undo and redo over the editing
// state»). Here that object is a value from the start, so what steps back is
// exactly what lands in the document, compared by `==`.
//
// What a step deliberately leaves out, as on the web: the media that is OPEN
// (switching clips is navigation, not an edit) and the session around the
// composition — the preview speed, the export's progress, the selection.

import Foundation
import AtelierKit

struct StudioEdit: Equatable {
    var elements: [OverlayElement]
    /// Stored elements this build cannot read, carried in place.
    var unreadElements: [UnreadElement]
    var guides: GuidesState
    var theme: StyleTheme?
    var scenes: [OverlayScene]
    var outro: OutroCard?
    var name: String
    var aspectId: String
    var timeShift: TimeShift
    var timeScale: TimeScaleSetting
    /// In/out points per clip, keyed by base name.
    var trims: [String: SavedTrim]
    /// Each media's own correction, keyed by base name, guarded by its hash.
    var develops: [String: SavedDevelop]
    var exportFileName: String
    var variants: [ExportVariant]
    var lutStack: [SavedLutLayer]
    var output: OutputTransform
    var film: FilmTexture?

    /// The editor opening on a document: an EMPTY deck opens on the starter
    /// preset, as the web's does.
    init(_ doc: ProjectDoc) {
        elements = doc.elements.isEmpty ? defaultElementsPreset() : doc.elements
        unreadElements = doc.unreadElements
        guides = doc.guides
        theme = doc.theme
        scenes = doc.scenes
        outro = doc.outro
        name = doc.name
        aspectId = doc.settings.aspectId
        timeShift = doc.settings.timeShift ?? .noShift
        timeScale = doc.settings.timeScale ?? .auto
        trims = doc.media.trims
        develops = doc.media.develops
        exportFileName = doc.exportPrefs.fileName ?? ""
        variants = doc.exportPrefs.variants.isEmpty ? defaultVariants() : doc.exportPrefs.variants
        lutStack = doc.lutStack
        output = doc.outputTransform
        film = doc.lutFilm
    }

    /// The grade as the look panel edits it — nil when it is no look.
    var grade: RollGrade? {
        get {
            storedLook(RollGrade(layers: lutStack, output: output, film: film?.json))
        }
        set {
            lutStack = newValue?.layers ?? []
            output = newValue?.output ?? .none
            film = filmTextureOrNull(newValue?.film)
        }
    }

    /// The export matrix as the document keeps it.
    var exportPrefs: ExportPrefs {
        let trimmed = exportFileName.trimmingCharacters(in: .whitespacesAndNewlines)
        return ExportPrefs(fileName: trimmed.isEmpty ? nil : trimmed, variants: variants)
    }

    /// The portable half, from the LIVE composition — what a project file
    /// carries — with `settings` as a draft may override them.
    func portable(aspectId: String? = nil, timeShift: TimeShift? = nil) -> ProjectPortable {
        let settings = ProjectSettings(aspectId: aspectId ?? self.aspectId, timeShift: timeShift ?? self.timeShift)
        return ProjectPortable(settings: settings, elements: elements, unreadElements: unreadElements,
                               guides: guides, lutStack: lutStack, outputTransform: output, lutFilm: film,
                               theme: theme, scenes: scenes, outro: outro, exportPrefs: exportPrefs)
    }

    /// Adopt an imported file's portable half. The name, the media and the
    /// cadence are the project's own and stay.
    mutating func adopt(_ file: ProjectFile) {
        aspectId = file.settings.aspectId
        timeShift = file.settings.timeShift ?? .noShift
        elements = file.elements
        unreadElements = file.unreadElements
        guides = file.guides
        theme = file.theme
        scenes = file.scenes
        outro = file.outro
        exportFileName = file.exportPrefs.fileName ?? ""
        variants = file.exportPrefs.variants
        lutStack = file.lutStack
        output = file.outputTransform
        film = file.lutFilm
    }

    /// The document this composition writes, over the bound half of `base`
    /// (its folder, its source, its id — the shell's, which may have changed
    /// under the editor: a re-pointed folder, the missing media forgotten).
    func applied(to base: ProjectDoc, files: [SavedMediaRef], activeId: String?, thumbnail: Data?,
                 duration: Double?, now: Double) -> ProjectDoc {
        var doc = base
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        doc.name = trimmedName.isEmpty ? base.name : trimmedName
        doc.updatedAt = now
        doc.settings.aspectId = aspectId
        doc.settings.timeShift = timeShift
        doc.settings.timeScale = timeScale
        doc.elements = elements
        doc.unreadElements = unreadElements
        doc.guides = guides
        doc.lutStack = lutStack
        doc.outputTransform = output
        doc.lutFilm = film
        doc.theme = theme
        doc.scenes = scenes
        doc.outro = outro
        // The stored matrix's own carried keys stay; the fields are the edit's.
        doc.exportPrefs.fileName = exportPrefs.fileName
        doc.exportPrefs.variants = variants
        if !files.isEmpty { doc.media.files = files }
        doc.media.activeId = activeId
        doc.media.trims = trims
        doc.media.develops = develops
        if let thumbnail { doc.thumbnail = thumbnail }
        if let duration, duration > 0 { doc.durationSeconds = duration }
        return doc
    }
}
