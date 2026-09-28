// The open Studio project — the native twin of the web's `StudioEditor.tsx`
// state: the composition (`StudioEdit`, one value), the session around it
// (the tab, the selection, the folds, the wipe, the preview speed, the
// sheets), the media open on the stage, the history and the autosave.
//
// Every write of the composition goes through ONE funnel, `update`, which is
// what the history watches (`History/History.swift`: a stack of whole
// values, two edits inside 700 ms under one label merged into one step) and
// what arms the autosave — debounced 800 ms, as the web's, written to the
// shell (`StudioStore.saved`) and from there pushed to an instance on idle.
// ⌘Z is native: every step is registered on the window's `UndoManager`, and
// the editor's own buttons call the same two functions.
//
// The media half — which clip or still is open, its telemetry, its trim, its
// frames and the stage render — is `StudioEditor+Media.swift`.

import CoreImage
import Foundation
import ImageIO
import Observation
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

@MainActor
@Observable
final class StudioEditor {
    let store: StudioStore
    let library: StudioLibrary
    let projectId: String
    /// The document generation the editor was seeded from.
    let generation: Int

    /// The composition — written only through `update`.
    private(set) var edit: StudioEdit

    // MARK: the session (never in the document)

    /// The inspector's tab.
    var tab: StudioTab = .overlay
    /// On a phone: the inspector drawer is up.
    var inspectorOpen = false
    /// The element picked on the stage or in the list.
    private(set) var selectedId: String?
    /// The palette's fold — owned here, because the inspector unmounts its
    /// tabs and a palette re-collapsing on every trip to Style is maddening.
    var paletteOpen: Bool
    var listOpen = true
    /// "Reset deck" is waiting for its confirmation.
    var resettingDeck = false
    /// The A/B wipe is on.
    private(set) var compareOn = false
    /// Where the divider sits, 0…1 across the picture.
    private(set) var split = 0.5
    /// ↻ — the trimmed range loops instead of stopping on the out point.
    var loop = false
    /// The preview speed: a viewing choice, never the composition's.
    private(set) var previewSpeed: PreviewSpeed = .rate(1)
    var settingsOpen = false
    var developOpen = false
    /// The clip's instant the develop sheet opened on (a photograph has one).
    private(set) var developAt: Double = 0
    /// A text field of the editor has the keyboard: every key is its own.
    var textEditing = false
    private(set) var saveState: StudioSaveState = .saved
    /// The trim bar's gestures have been used once: the hint under it goes.
    private(set) var trimLearned: Bool

    // MARK: the media on the stage (`StudioEditor+Media.swift`)

    /// The media open on the stage (by asset id); written by `setActive` alone.
    var activeId: String?
    /// The media the project was saved on, while it is still on its way back
    /// from its instance: opened when it lands, unless the person has moved
    /// to another meanwhile (`mediaChanged`).
    @ObservationIgnored var awaitingActive: String?
    /// The open media's files as they were when it was loaded — a change (its
    /// `.srt` arriving, a file found again) is what loads it afresh.
    @ObservationIgnored var loadedFiles = ""
    /// The clip's telemetry as parsed, rates derived against the file's own seconds.
    var rawCues: [Cue] = []
    /// The cadence measured from the clip's own telemetry.
    var timing: TimeScaleReading = .realtime
    /// What the stage and every readout draw from: the clip's cues re-timed by
    /// the scale in force, or the photograph's ONE cue from its EXIF.
    var cues: [Cue] = []
    /// A still's EXIF — nil until read (an empty record is a still that says nothing).
    var photoExif: ExifData?
    /// A still's own pixel size, upright.
    var photoSize: CGSize?
    var photoProblem: String?
    /// The open clip's facts, once the container has been read.
    var clipWidth: Int?
    var clipHeight: Int?
    var clipCodec: String?
    var clipFps: Double?
    /// The clip's `.srt` has been read (with or without cues in it).
    var srtRead = false
    /// The open media's partial hash — the develop's guard.
    var activeHash: String?
    /// The in/out handles of the open clip.
    var range = fullRange(0)
    /// The looks that will not grade here, by layer id.
    var lookMissing: [String: String] = [:]

    let playback = StudioPlayback()
    let stage = StageRenderer()
    @ObservationIgnored let grader = FrameGrader()
    /// The painter the stage renders burn in with — one consumer, serial jobs.
    @ObservationIgnored let painter = OverlayPainter()
    /// The painter the main actor measures with (hit test, outline, re-anchor).
    @ObservationIgnored let measurer = OverlayPainter()
    @ObservationIgnored let tap = ClipFrameTap()
    /// The picture the stage composes over: a still at the stage budget, or
    /// the clip's last frame.
    @ObservationIgnored var source: CIImage?
    /// Which instant of the media `source` is.
    @ObservationIgnored var sourceTime: Double = 0
    @ObservationIgnored var primed = false
    /// The stage's pixels, set by the view.
    @ObservationIgnored var renderSize = CGSize(width: 1280, height: 720)
    /// The look + the open media's develop baked into ONE cube.
    @ObservationIgnored var stageCube: CubeLut?
    @ObservationIgnored var lookKey = ""
    @ObservationIgnored var lookTask: Task<Void, Never>?
    @ObservationIgnored var mediaTask: Task<Void, Never>?
    @ObservationIgnored var hashTask: Task<Void, Never>?

    // MARK: history and saving

    private(set) var history: HistoryState<StudioEdit>
    @ObservationIgnored weak var undoManager: UndoManager?
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var saveOwed = false

    nonisolated static let trimLearnedKey = "atelier.learned.studio.trim"
    /// The web's `SAVE_DEBOUNCE_MS`.
    nonisolated static let saveDebounceNanos: UInt64 = 800_000_000

    init(store: StudioStore, open: StudioOpenProject) {
        self.store = store
        library = open.library
        projectId = open.doc.id
        generation = open.generation
        let seeded = StudioEdit(open.doc)
        edit = seeded
        history = newHistory(seeded)
        // The palette starts unfolded only when there is nothing on the frame yet.
        paletteOpen = open.doc.elements.isEmpty
        trimLearned = UserDefaults.standard.bool(forKey: StudioEditor.trimLearnedKey)
        let clips = open.library.clips
        let saved = open.doc.media.activeId
        activeId = saved.flatMap { id in clips.first { $0.id == id }?.id } ?? clips.first?.id
        awaitingActive = saved != nil && activeId != saved ? saved : nil
        store.pendingSave = { [weak self] in await self?.flushSave() }
        store.discardPendingSave = { [weak self] in self?.dropPendingSave() }
    }

    // MARK: - reading

    var clips: [Asset] { library.clips }

    var active: Asset? {
        let list = clips
        if let activeId, let hit = list.first(where: { $0.id == activeId }) { return hit }
        return list.first
    }

    var activeIndex: Int {
        guard let active else { return -1 }
        return clips.firstIndex { $0.id == active.id } ?? -1
    }

    var isPhoto: Bool { active?.kind == .photo }
    var activeVideo: SavedMediaRef? { active?.parts.video }
    var activeSrt: SavedMediaRef? { active?.parts.srt }
    var activeImage: SavedMediaRef? { isPhoto ? active?.parts.image : nil }
    /// The file whose develop, hash and name are the open media's.
    var activeFile: SavedMediaRef? { activeImage ?? activeVideo }

    /// The element picked, while it is still on the frame.
    var selectedElement: OverlayElement? {
        guard let selectedId else { return nil }
        return edit.elements.first { $0.id == selectedId }
    }

    /// The scene the selected element lives in.
    var selectedScene: OverlayScene? { findScene(edit.scenes, selectedElement?.sceneId) }

    /// Today the introduction alone.
    var introScene: OverlayScene? { edit.scenes.first }

    /// The reconciliation the shell found when the project opened.
    var reconciliation: Reconciliation? {
        guard let open = store.open, open.doc.id == projectId else { return nil }
        return open.reconciliation
    }

    /// An override belongs to the clip it was typed for.
    var overridden: Bool { overrideApplies(edit.timeScale, activeId) }
    /// The cadence correction in force.
    var scale: Double { resolveTimeScale(edit.timeScale, timing, activeId) }
    var realtimeRate: Double { realtimePlaybackRate(scale) }

    /// The open media's stored develop, unless it was set on ANOTHER file of
    /// the same name (both hashes known and differing).
    var activeDevelop: DevelopSettings? {
        guard let id = active?.id else { return nil }
        return restoreDevelop(edit.develops[id], activeHash)
    }

    var canUndo: Bool { AtelierKit.canUndo(history) }
    var canRedo: Bool { AtelierKit.canRedo(history) }

    // MARK: - the ONE funnel

    /// Every write of the composition. The same value back is no write and no step.
    func update(_ change: (inout StudioEdit) -> Void) {
        var next = edit
        change(&next)
        guard next != edit else { return }
        let before = edit
        edit = next
        remember(next)
        settle(from: before)
    }

    /// What a new composition asks of the rest: the readouts, the look, a
    /// render and a save.
    private func settle(from before: StudioEdit) {
        if before.timeScale != edit.timeScale {
            recomputeCues()
            applyRate()
        }
        if before.lutStack != edit.lutStack || before.output != edit.output || before.film != edit.film
            || before.develops != edit.develops {
            refreshLook()
        }
        if let id = selectedId, !edit.elements.contains(where: { $0.id == id }) { selectedId = nil }
        requestRender()
        scheduleSave()
    }

    // MARK: - undo and redo

    private func remember(_ next: StudioEdit) {
        let now = nowMillis()
        let label = "edit"
        // The kernel's own merge rule, read before it runs: a merged step is
        // no new undo action on the window.
        let merges = label == history.label && now - history.at <= coalesceMs
        history = AtelierKit.record(history, next, RecordOptions(now: now, label: label))
        if !merges { registerUndoStep() }
    }

    /// A sheet holding its own draft owns the keyboard while it is up: its
    /// Cancel is what steps ITS work back.
    private var historyEnabled: Bool { !developOpen && !settingsOpen }

    func undo() {
        guard historyEnabled else { return }
        if let manager = undoManager, manager.canUndo {
            manager.undo()
        } else {
            performUndo()
        }
    }

    func redo() {
        guard historyEnabled else { return }
        if let manager = undoManager, manager.canRedo {
            manager.redo()
        } else {
            performRedo()
        }
    }

    private func registerUndoStep() {
        guard let manager = undoManager else { return }
        manager.registerUndo(withTarget: self) { target in
            MainActor.assumeIsolated { target.performUndo() }
        }
        manager.setActionName("Edit")
    }

    func performUndo() {
        guard AtelierKit.canUndo(history) else { return }
        history = AtelierKit.undo(history)
        restore(history.present)
        if let manager = undoManager, manager.isUndoing {
            manager.registerUndo(withTarget: self) { target in
                MainActor.assumeIsolated { target.performRedo() }
            }
        }
    }

    func performRedo() {
        guard AtelierKit.canRedo(history) else { return }
        history = AtelierKit.redo(history)
        restore(history.present)
        if let manager = undoManager, manager.isRedoing {
            manager.registerUndo(withTarget: self) { target in
                MainActor.assumeIsolated { target.performUndo() }
            }
        }
    }

    /// A composition put back — not an edit. The trim handles are live state
    /// derived from `trims` only when a clip opens, so a restore re-derives
    /// them for the open clip, or the bar keeps the cut it stepped away from.
    private func restore(_ step: StudioEdit) {
        let before = edit
        edit = step
        if let id = active?.id, playback.duration > 0 {
            range = restoreTrim(step.trims[id], playback.duration, frameStep)
        }
        settle(from: before)
    }

    // MARK: - the deck

    /// Pick an element — from the list or on the stage. The settings only
    /// exist on the Overlay tab, so a pick from another tab comes back to it.
    func select(_ id: String?) {
        selectedId = id
        if id != nil { tab = .overlay }
        requestRender()
    }

    /// A TAP on an element (not a drag): on a phone it also raises the
    /// inspector, or its settings would be behind a strip cell.
    func activate(_ id: String, compact: Bool) {
        select(id)
        if compact { inspectorOpen = true }
    }

    func addElement(_ element: OverlayElement) {
        var added: OverlayElement?
        update { e in
            let result = studioAddElement(element, elements: e.elements, scenes: e.scenes)
            e.elements = result.elements
            e.scenes = result.scenes
            added = result.added
        }
        selectedId = added?.id
        // Touching the deck answers the reset question.
        resettingDeck = false
        requestRender()
    }

    func removeElement(_ id: String) {
        update { e in e.elements.removeAll { $0.id == id } }
        if selectedId == id { selectedId = nil }
        resettingDeck = false
    }

    func toggleVisible(_ id: String) {
        update { e in
            guard let i = e.elements.firstIndex(where: { $0.id == id }) else { return }
            e.elements[i].visible.toggle()
        }
    }

    /// A drag on the stage: the element's new anchor.
    func moveElement(_ id: String, to point: AtelierKit.Point) {
        update { e in
            guard let i = e.elements.firstIndex(where: { $0.id == id }) else { return }
            e.elements[i].x = point.x
            e.elements[i].y = point.y
        }
    }

    /// Bring forward / send backward — the draw order (a native addition).
    func reorderElements(_ offsets: IndexSet, _ destination: Int) {
        update { e in e.elements.move(fromOffsets: offsets, toOffset: destination) }
    }

    /// Replace the deck with the starter preset — the only destructive add.
    func loadDefaultDeck() {
        let deck = defaultElementsPreset()
        update { e in e.elements = deck }
        selectedId = deck.first?.id
        resettingDeck = false
    }

    /// Drop a scene and everything that lived in it.
    func removeScene(_ id: String) {
        update { e in
            let result = studioRemoveScene(id, elements: e.elements, scenes: e.scenes)
            e.elements = result.elements
            e.scenes = result.scenes
        }
    }

    /// An element's binding for the panels. Re-anchoring keeps the element
    /// where it sits on screen: the new anchor is the handle, and (x, y) is
    /// recomputed so the box does not jump.
    func elementBinding(_ id: String) -> Binding<OverlayElement> {
        Binding(
            get: { [weak self] in
                self?.edit.elements.first { $0.id == id } ?? OverlayPanels.freshElement(.text)
            },
            set: { [weak self] next in self?.writeElement(id, next) }
        )
    }

    private func writeElement(_ id: String, _ next: OverlayElement) {
        guard let current = edit.elements.first(where: { $0.id == id }) else { return }
        var element = next
        if next.anchor != current.anchor, let size = renderedSize {
            let cue = findCue(cues, sourceTime)
            if let moved = measurer.reanchorInPlace(current, size: size, cue: cue, anchor: next.anchor,
                                                    theme: edit.theme, timeShift: edit.timeShift) {
                element.x = moved.x
                element.y = moved.y
            }
        }
        update { e in
            guard let i = e.elements.firstIndex(where: { $0.id == id }) else { return }
            e.elements[i] = element
        }
    }

    /// A scene's binding for its panel.
    func sceneBinding(_ id: String) -> Binding<OverlayScene> {
        Binding(
            get: { [weak self] in
                self?.edit.scenes.first { $0.id == id } ?? createIntroScene(end: 3)
            },
            set: { [weak self] next in
                self?.update { e in
                    guard let i = e.scenes.firstIndex(where: { $0.id == id }) else { return }
                    e.scenes[i] = next
                }
            }
        )
    }

    /// The outro's binding — read only while there is one.
    var outroBinding: Binding<OutroCard> {
        Binding(
            get: { [weak self] in self?.edit.outro ?? createOutroCard("Merci") },
            set: { [weak self] next in self?.update { $0.outro = next } }
        )
    }

    /// intro · footage · closing card: a card titled with the project's name.
    func addOutro() {
        let headline = edit.name.trimmingCharacters(in: .whitespacesAndNewlines)
        update { $0.outro = createOutroCard(headline.isEmpty ? "Merci" : headline) }
    }

    func removeOutro() {
        update { $0.outro = nil }
    }

    /// The editor on screen for the first time: open the media it remembers.
    func start() {
        loadActive()
    }

    /// A binding into the composition, written through the funnel.
    func binding<V>(_ path: WritableKeyPath<StudioEdit, V>) -> Binding<V> {
        Binding(
            get: { [weak self] in self?.edit[keyPath: path] ?? StudioEditor.placeholder(path) },
            set: { [weak self] value in self?.update { $0[keyPath: path] = value } }
        )
    }

    /// Never read in practice (the editor outlives its views) — the value a
    /// binding falls back on once its editor is gone.
    private static func placeholder<V>(_ path: WritableKeyPath<StudioEdit, V>) -> V {
        StudioEdit(createProjectDoc("", aspectPresets[0].id, [], .default, now: 0, id: "gone"))[keyPath: path]
    }

    // MARK: - the wipe and the preview speed

    func setCompare(_ on: Bool) {
        compareOn = on
        requestRender()
    }

    func setSplit(_ value: Double) {
        split = min(1, max(0, value))
        requestRender()
    }

    func setPreviewSpeed(_ speed: PreviewSpeed) {
        previewSpeed = speed
        applyRate()
    }

    func applyRate() {
        playback.setRate(previewRate(previewSpeed, realtimeRate: realtimeRate))
    }

    // MARK: - settings and the project file

    /// The settings sheet's Apply: a manual cadence names the clip it was set for.
    func applySettings(name: String, aspectId: String, timeShift: TimeShift, timeScale: TimeScaleSetting) {
        var scaleSetting = timeScale
        if scaleSetting.mode == .manual { scaleSetting.clipId = active?.id }
        update { e in
            e.name = name
            e.aspectId = aspectId
            e.timeShift = timeShift
            e.timeScale = scaleSetting
        }
        settingsOpen = false
    }

    /// The project file composed from the LIVE state plus the sheet's draft —
    /// no waiting for the autosave, no stale copy of an unapplied draft.
    func projectFileText(name: String, aspectId: String, timeShift: TimeShift) -> String {
        let portable = edit.portable(aspectId: aspectId, timeShift: timeShift)
        return serializeProjectFile(toProjectFile(portable, name: name))
    }

    /// Adopt an imported file's portable half; the incoming deck has other
    /// ids, so whatever was selected is gone.
    func importProjectFile(_ file: ProjectFile) {
        update { e in e.adopt(file) }
        selectedId = nil
        settingsOpen = false
    }

    // MARK: - the develop sheet

    func openDevelop() {
        developAt = sourceTime
        developOpen = true
    }

    /// Done: the open media's correction written; nil is as shot.
    func setActiveDevelop(_ next: DevelopSettings?) {
        guard let id = active?.id else { return }
        let hash = activeHash
        update { e in e.develops = writeDevelop(e.develops, id, next, hash) }
    }

    /// The sheet's one batch verb: the same numbers onto every OTHER media of
    /// the project, each under its OWN hash as the hashes land.
    func applyDevelopToOthers(_ settings: DevelopSettings) {
        let others = clips.filter { $0.id != active?.id }
        for asset in others {
            guard let ref = asset.kind == .photo ? asset.parts.image : asset.parts.video,
                  let url = library.url(for: ref) else { continue }
            let id = asset.id
            Task { [weak self] in
                let hash = await Task.detached(priority: .utility) { StudioMediaFiles.hash(ref, at: url) }.value
                self?.update { e in e.develops = writeDevelop(e.develops, id, settings, hash) }
            }
        }
    }

    // MARK: - the trim hint

    func learnTrim() {
        guard !trimLearned else { return }
        trimLearned = true
        UserDefaults.standard.set(true, forKey: StudioEditor.trimLearnedKey)
    }

    // MARK: - saving

    /// Something the document holds changed: saved after the debounce.
    func scheduleSave() {
        saveState = .unsaved
        saveOwed = true
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: StudioEditor.saveDebounceNanos)
            guard !Task.isCancelled else { return }
            await self?.performSave()
        }
    }

    /// A save that is owed is written NOW — leaving, a push, the background.
    func flushSave() async {
        guard saveOwed else { return }
        saveTask?.cancel()
        saveTask = nil
        await performSave()
    }

    /// The document is being replaced or deleted: what was about to be saved
    /// is the edit being dropped.
    func dropPendingSave() {
        saveTask?.cancel()
        saveTask = nil
        saveOwed = false
        saveState = .saved
    }

    private func performSave() async {
        guard saveOwed else { return }
        saveOwed = false
        saveState = .saving
        // The media list is the working set — the clips' files — hashed once
        // per file for the session.
        var parts: [SavedMediaRef] = []
        for asset in clips {
            if let v = asset.parts.video { parts.append(v) }
            if let s = asset.parts.srt { parts.append(s) }
            if let i = asset.parts.image { parts.append(i) }
        }
        let entries = parts.compactMap { ref in library.url(for: ref).map { StudioMediaEntry(ref: ref, url: $0, locator: nil) } }
        let working = await Task.detached(priority: .utility) { StudioMediaFiles.hashed(entries) }.value
        let image = stage.image
        let thumbnail = await Task.detached(priority: .utility) { image.flatMap { StudioEditor.thumbnailJPEG($0) } }.value
        // Built on the stored copy even when another project has opened
        // meanwhile (a save owed at the moment the editor was left).
        guard let base = store.stored(projectId) else { return }
        // A media on its way back from its instance, refused or out of reach
        // keeps its ref: this device not having it yet is no reason to drop it.
        let files = filesKeepingRecovery(working, saved: base.media.files, library.recovery)
        let duration = playback.duration > 0 ? playback.duration : nil
        let doc = edit.applied(to: base, files: files, activeId: active?.id, thumbnail: thumbnail,
                               duration: duration, now: nowMillis())
        store.saved(doc)
        if store.storageFailed {
            saveState = .storageError
        } else {
            saveState = saveOwed ? .unsaved : .saved
        }
    }

    /// The stage downscaled to 480 px wide, a JPEG at 0.72 — the gallery's
    /// card, drawn without touching the media.
    nonisolated static func thumbnailJPEG(_ image: CGImage) -> Data? {
        let width = 480
        let height = max(1, Int((Double(image.height) / Double(max(1, image.width)) * Double(width)).rounded()))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let small = ctx.makeImage() else { return nil }
        let out = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else {
            return nil
        }
        let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: 0.72]
        CGImageDestinationAddImage(destination, small, options as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return out as Data
    }

    /// The editor left the screen (back to the projects, another tool): the
    /// owed save written, the player paused — the editor itself stays with the
    /// open project, so coming back resumes where it was.
    func suspend() {
        if saveOwed { Task { await self.flushSave() } }
        playback.pause()
    }

    /// The editor is going away for good (another project opened, this one
    /// replaced or deleted): the owed save written, the player stopped.
    func close() {
        suspend()
        mediaTask?.cancel()
        lookTask?.cancel()
        hashTask?.cancel()
        tap.detach()
        playback.stop()
    }
}
