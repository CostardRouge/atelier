// The Studio's documents on this device — the native twin of the web's
// `StudioTool.tsx` (the shell that owns documents and navigation) over the
// suite's generic document plumbing:
//
// - projects on disk through `DocumentStore<ProjectDoc>`
//   (`Application Support/Atelier/projects/<id>.json`, the web's own JSON,
//   read and migrated by the kernel), with a side table of the project's
//   LOOSE media files (`<id>.locators.json`, `StudioMediaFiles`);
// - the gallery's lists, groups and cross-source verbs through
//   `DocumentGalleryModel<ProjectDoc>` (create THERE first, delete with the
//   revision held, move, fetch-then-open);
// - a project kept on a Winnow through `DocumentSync<ProjectDoc>` — LOCAL
//   NOW, REMOTE ON IDLE: the editor's 800 ms autosave lands here, the record
//   goes dirty, the push follows after the idle delay, on leaving, and on the
//   pill's "Save now".
//
// Opening is the web's `openProject`: ask the instance first (`resume`), list
// the project's folder again (its bookmark is `media.dirHandle`) and its loose
// files, reconcile the saved refs id → hash → name, and ABSORB a rename once
// (`adoptRenames`, persisted) rather than re-detecting it forever — then find
// what it names on an instance again, from the Library or from the instance
// itself (`StudioStore+Recovery.swift`). Another tool hands a project over
// through `openHandedOver` (the web's `#/studio/open/<id>`). The shell only
// knows documents; the editor only knows clips.

import Foundation
import Observation
import AtelierKit

/// The project open in the editor, and what opening it found.
struct StudioOpenProject {
    var doc: ProjectDoc
    /// How the saved media refs met the files found — nil when the project had none.
    var reconciliation: Reconciliation?
    /// Bumped when the document is REPLACED under the editor (take theirs,
    /// keep as local): the editor seeds itself from the document when it
    /// opens, so it must start again to see the new copy.
    var generation: Int
    /// The media this device reaches for it.
    let library: StudioLibrary
}

/// What the creation sheet hands over.
struct NewProjectChoices {
    var name: String
    var aspectId: String
    /// Reuse another project's overlays, look and settings.
    var templateId: String?
    /// The media folder picked in the sheet, if any.
    var folder: NewProjectFolder?
    /// Where the project is kept — this device, or a connected instance.
    var sourceId: String
}

/// A folder picked for a new project: remembered (its bookmark), never copied.
struct NewProjectFolder {
    let url: URL
    let bookmark: Data
    let entries: [StudioMediaEntry]
    /// The files' refs, hashed.
    let refs: [SavedMediaRef]
    /// The folder's security scope is open and passes to the project.
    let scoped: Bool
}

@MainActor
@Observable
final class StudioStore {
    static let shared = StudioStore(connections: ConnectionStore.shared)

    @ObservationIgnored let documents: DocumentStore<ProjectDoc>
    let gallery: DocumentGalleryModel<ProjectDoc>
    let sync: DocumentSync<ProjectDoc>

    /// The project in the editor, or nil.
    private(set) var open: StudioOpenProject?
    /// The project being opened right now (its card says so).
    private(set) var opening: String?
    /// The project last opened here — its card says `open`, its verb `Resume`.
    private(set) var lastOpenedId: String?
    /// A local write was refused (a full disk, a revoked container).
    private(set) var storageFailed = false
    /// The open project was deleted under the editor (the pill's "Delete here").
    private(set) var closedByDelete = false
    /// A project another tool handed over (`openHandedOver`), opened and
    /// waiting for the gallery to push its editor — consumed on arrival, as
    /// the web's `#/studio/open/<id>` rewrites itself.
    private(set) var handedOver: String?

    /// The editor of the open project, kept while the project is open so that
    /// coming back from the gallery resumes where it was (the playhead, the
    /// selection, the history) — made and handed back by `StudioEditorView`.
    @ObservationIgnored var liveEditor: StudioEditor?
    /// The editor's pending local save, flushed before a push.
    @ObservationIgnored var pendingSave: (() async -> Void)?
    /// The editor's pending local save, DROPPED: the document is being replaced.
    @ObservationIgnored var discardPendingSave: (() -> Void)?

    init(root: URL = DocumentStore<ProjectDoc>.defaultRoot, connections: ConnectionStore) {
        let store = DocumentStore<ProjectDoc>(root: root)
        documents = store
        gallery = DocumentGalleryModel(store: store, connections: connections)
        sync = DocumentSync(store: store, connections: connections)
        sync.current = { [weak self] in self?.open?.doc }
        sync.beforeFlush = { [weak self] in await self?.pendingSave?() }
        sync.onDiscardPending = { [weak self] in self?.discardPendingSave?() }
        sync.onReplace = { [weak self] doc in self?.replaceUnderEditor(doc) }
        sync.onDeleted = { [weak self] in self?.deletedUnderEditor() }
    }

    // MARK: - the gallery

    /// Re-read the mirrors and every instance's list.
    func refresh() async {
        await gallery.refresh()
    }

    /// Create a project — on its source FIRST — and open it.
    func create(_ choices: NewProjectChoices) async -> Bool {
        gallery.notice = nil
        let template = choices.templateId.flatMap { id in gallery.docs?.first { $0.id == id } }
        // A picked template wins; with none, the factory deck. The web's
        // committed house style is not carried by this build — said in the
        // creation sheet ("Blank"), never applied silently.
        var doc = createProjectDoc(choices.name, choices.aspectId, defaultElementsPreset(), .default,
                                   template: template)
        doc.sourceId = choices.sourceId
        // A template carries no in/out points and no develop: both belong to
        // the footage.
        doc.media = ProjectMedia(dirHandle: choices.folder?.bookmark, files: choices.folder?.refs ?? [],
                                 activeId: nil, trims: [:], develops: [:])
        guard await gallery.createOn(doc, verb: "created") else {
            if let folder = choices.folder, folder.scoped { folder.url.stopAccessingSecurityScopedResource() }
            return false
        }
        sync.adopt(doc)
        let scopes = choices.folder.flatMap { $0.scoped ? [$0.url] : nil } ?? []
        let library = StudioLibrary(projectId: doc.id, entries: choices.folder?.entries ?? [], scopes: scopes)
        adopt(StudioOpenProject(doc: doc, reconciliation: nil, generation: nextGeneration, library: library))
        return true
    }

    /// A project file becomes a NEW project — the common case is a settings
    /// file someone sent. Replacing the open project's settings is the
    /// settings sheet's.
    func importProject(from url: URL, to sourceId: String) async {
        gallery.notice = nil
        let scoped = url.startAccessingSecurityScopedResource()
        let data = try? Data(contentsOf: url)
        if scoped { url.stopAccessingSecurityScopedResource() }
        guard let data, let text = String(data: data, encoding: .utf8) else {
            gallery.notice = "This file could not be read."
            return
        }
        switch parseProjectFile(text) {
        case .failure(let error):
            gallery.notice = error.message
        case .success(let file):
            let name = importedProjectName(file, fileName: url.lastPathComponent)
            var doc = applyProjectFile(createProjectDoc(name, file.settings.aspectId, [], .default), file)
            doc.sourceId = gallery.documentSources.contains { $0.id == sourceId } ? sourceId : defaultSourceId
            if await gallery.createOn(doc, verb: "imported") { await gallery.refresh() }
        }
    }

    /// A new LOCAL project from another's portable half — a template is from no source.
    func duplicate(_ source: ProjectDoc) async {
        let doc = createProjectDoc("\(source.name) (template)", source.settings.aspectId, [], .default,
                                   template: source)
        storageFailed = !documents.put(doc)
        await gallery.refresh()
    }

    /// Delete here, and there when it is kept on an instance.
    func remove(_ doc: ProjectDoc, etagHint: String? = nil) async {
        let loose = looseLocators(doc.id)
        if await gallery.remove(doc, etagHint: etagHint) {
            deleteSidecars(doc.id, loose)
            if open?.doc.id == doc.id { close() }
            if lastOpenedId == doc.id { lastOpenedId = nil }
        }
    }

    func move(_ doc: ProjectDoc, to target: String) async {
        await gallery.moveTo(doc, target)
        if open?.doc.id == doc.id, let moved = documents.get(doc.id) {
            open?.doc = moved
            sync.adopt(moved)
        }
    }

    // MARK: - opening

    /// Open a project: ask its instance first, find its media again, absorb a
    /// rename once. True once it is ready for the editor.
    func openProject(_ stored: ProjectDoc) async -> Bool {
        if let current = open, current.doc.id == stored.id {
            // Already loaded — back to the editor, no re-reconcile.
            lastOpenedId = stored.id
            return true
        }
        opening = stored.id
        defer { opening = nil }
        closedByDelete = false
        guard let resumed = await sync.resume(stored) else { return false }
        let doc = resumed.doc
        let gathered = await gather(doc)
        let refs = await Task.detached(priority: .userInitiated) { StudioMediaFiles.hashed(gathered.entries) }.value
        let reconciliation = doc.media.files.isEmpty ? nil : reconcileMedia(doc.media.files, refs)
        var opened = doc
        if let reconciliation, let media = adoptRenames(doc.media, reconciliation) {
            opened.media = media
            opened.updatedAt = nowMillis()
            storageFailed = !documents.put(opened)
        }
        let library = StudioLibrary(projectId: opened.id, entries: gathered.entries, scopes: gathered.scopes)
        adopt(StudioOpenProject(doc: opened, reconciliation: reconciliation, generation: nextGeneration,
                                library: library))
        // What it names on an instance and this device lost with the last
        // session: taken from the Library, else fetched back — now, when it
        // is opened, and only from an instance connected here.
        recoverRemoteMedia()
        return true
    }

    // MARK: - a project handed over by another tool

    /// The seam another tool hands a project over by — the web's
    /// `#/studio/open/<id>`, which Trips navigates to after sending a badge
    /// into a project. Opens the project with that id exactly as its card
    /// would (its instance asked first, its media found again, a rename
    /// absorbed), and leaves it waiting in `handedOver` for the gallery to
    /// push its editor; a project already open is revealed, never listed
    /// again. False when no project here has that id. The caller then moves
    /// the shell to the Studio (`shellNavigate(.studio)`); neither tool reaches
    /// into the other's state.
    @discardableResult
    func openHandedOver(_ projectId: String) async -> Bool {
        guard let doc = stored(projectId) ?? gallery.docs?.first(where: { $0.id == projectId }) else { return false }
        guard await openProject(doc) else { return false }
        handedOver = projectId
        return true
    }

    /// The project handed over, taken once by the screen that shows it.
    func takeHandOff() -> String? {
        let id = handedOver
        handedOver = nil
        return id
    }

    /// A project kept there and not here yet: pull, mirror, then open.
    func openRemote(_ row: RemoteDocRow<ProjectDoc>) async -> Bool {
        let doc = gallery.mirrorRemote(row)
        return await openProject(doc)
    }

    /// The folder listed again and the loose files resolved — under their
    /// security scopes, which the library then holds.
    private func gather(_ doc: ProjectDoc) async -> (entries: [StudioMediaEntry], scopes: [URL]) {
        var scopes: [URL] = []
        var folder: URL?
        if let bookmark = doc.media.dirHandle, let url = try? RollStore.resolveBookmark(bookmark) {
            if url.startAccessingSecurityScopedResource() { scopes.append(url) }
            folder = url
        }
        var loose: [(locator: PictureLocator, url: URL)] = []
        for locator in looseLocators(doc.id) {
            guard let url = StudioMediaFiles.resolve(locator) else { continue }
            if case .container = locator {
                loose.append((locator, url))
                continue
            }
            // A file inside a folder: the folder's scope covers it.
            let scopeURL: URL
            if case .folder(let bookmark, _) = locator, let parent = try? RollStore.resolveBookmark(bookmark) {
                scopeURL = parent
            } else {
                scopeURL = url
            }
            if scopeURL.startAccessingSecurityScopedResource() { scopes.append(scopeURL) }
            loose.append((locator, url))
        }
        let listedFolder = folder
        let looseFiles = loose
        let entries = await Task.detached(priority: .userInitiated) { () -> [StudioMediaEntry] in
            var out = listedFolder.map { StudioMediaFiles.list(folder: $0) } ?? []
            for item in looseFiles where FileManager.default.fileExists(atPath: item.url.path) {
                out.append(StudioMediaEntry(ref: StudioMediaFiles.mediaRef(of: item.url), url: item.url,
                                            locator: item.locator))
            }
            return out
        }.value
        return (entries, scopes)
    }

    // MARK: - the open project's bound half

    /// Drop the missing media from the open project's known list, so it stops
    /// asking — no folder listed again, no permission asked.
    func forgetMissing() {
        // What is being fetched back, refused or out of reach is not missing
        // on purpose: it stays on the list (`StudioStore+Recovery.swift`).
        guard var current = open, let reconciliation = current.reconciliation,
              let pruned = forgetMissingMedia(current.doc.media, reconciliation,
                                              keeping: current.library.recovery) else { return }
        current.doc.media = pruned.media
        current.doc.updatedAt = nowMillis()
        current.reconciliation = pruned.reconciliation
        write(current.doc)
        open = current
    }

    /// Point the open project at another folder, then reconcile again.
    func repoint(_ folder: URL) async {
        guard var current = open else { return }
        let scoped = folder.startAccessingSecurityScopedResource()
        guard let bookmark = RollStore.makeBookmark(folder) else {
            if scoped { folder.stopAccessingSecurityScopedResource() }
            current.library.notice = "\(folder.lastPathComponent) could not be remembered."
            return
        }
        let listed = await Task.detached(priority: .userInitiated) { StudioMediaFiles.list(folder: folder) }.value
        let refs = await Task.detached(priority: .userInitiated) { StudioMediaFiles.hashed(listed) }.value
        guard let live = open, live.doc.id == current.doc.id else {
            if scoped { folder.stopAccessingSecurityScopedResource() }
            return
        }
        current = live
        let reconciliation = current.doc.media.files.isEmpty ? nil : reconcileMedia(current.doc.media.files, refs)
        current.library.replaceFolder(listed, scope: scoped ? folder : nil)
        var media = reconciliation.flatMap { adoptRenames(current.doc.media, $0) } ?? current.doc.media
        media.dirHandle = bookmark
        current.doc.media = media
        current.doc.updatedAt = nowMillis()
        current.reconciliation = reconciliation
        write(current.doc)
        open = current
    }

    /// The editor's autosave landed: kept here now, and — for a project kept
    /// on an instance — dirty from now, pushed after the idle delay.
    func saved(_ doc: ProjectDoc) {
        write(doc)
        if open?.doc.id == doc.id {
            open?.doc = doc
            sync.edited(doc)
        } else if isRemoteSource(doc.sourceId), let rec = documents.getSyncRecord(doc.id) {
            // An owed save written after another project opened: dirty on
            // disk, its revision kept, pushed when it is opened again.
            documents.putSyncRecord(reduceSync(rec, .edited(now: nowMillis())))
        }
    }

    /// The stored copy of a project — what a save written after the editor
    /// lost the stage builds on.
    func stored(_ id: String) -> ProjectDoc? {
        if let current = open, current.doc.id == id { return current.doc }
        return documents.get(id)
    }

    private func write(_ doc: ProjectDoc) {
        storageFailed = !documents.put(doc)
    }

    /// Nothing open any more: the editor closed, the scopes closed.
    func close() {
        liveEditor?.close()
        liveEditor = nil
        open?.library.release()
        open = nil
        sync.clear()
        pendingSave = nil
        discardPendingSave = nil
    }

    private var nextGeneration: Int { (open?.generation ?? 0) + 1 }

    /// A reconciliation counted again for the open project — still the one
    /// whose media `library` holds, or nothing.
    func setReconciliation(_ reconciliation: Reconciliation?, for library: StudioLibrary) {
        guard var current = open, current.library === library else { return }
        current.reconciliation = reconciliation
        open = current
    }

    private func adopt(_ project: StudioOpenProject) {
        liveEditor?.close()
        liveEditor = nil
        if let previous = open, previous.library !== project.library { previous.library.release() }
        project.library.onLocatorsChanged = { [weak self] locators in
            self?.setLooseLocators(project.doc.id, locators)
        }
        open = project
        lastOpenedId = project.doc.id
    }

    /// The server's copy or a local one replaced the document under the editor.
    private func replaceUnderEditor(_ doc: ProjectDoc) {
        guard var current = open else { return }
        // The document the editor seeded itself from is gone: a new
        // generation makes a new editor.
        liveEditor?.close()
        liveEditor = nil
        current.doc = doc
        current.generation += 1
        open = current
    }

    private func deletedUnderEditor() {
        let id = open?.doc.id
        close()
        closedByDelete = true
        if let id { deleteSidecars(id, looseLocators(id)) }
    }

    // MARK: - the side table of loose files

    private func locatorsURL(_ id: String) -> URL {
        documents.directory.appendingPathComponent("\(DocumentStore<ProjectDoc>.fileStem(id)).locators.json")
    }

    func looseLocators(_ id: String) -> [PictureLocator] {
        guard let data = try? Data(contentsOf: locatorsURL(id)),
              let decoded = try? JSONDecoder().decode([PictureLocator].self, from: data) else { return [] }
        return decoded
    }

    func setLooseLocators(_ id: String, _ locators: [PictureLocator]) {
        try? FileManager.default.createDirectory(at: documents.directory, withIntermediateDirectories: true)
        guard let data = try? JSONEncoder().encode(locators) else { return }
        try? data.write(to: locatorsURL(id), options: .atomic)
    }

    /// The side table and the copies the app made for a project that is gone.
    private func deleteSidecars(_ id: String, _ loose: [PictureLocator]) {
        try? FileManager.default.removeItem(at: locatorsURL(id))
        for case .container(let path) in loose {
            StudioMediaFiles.removeCopy(StudioMediaFiles.containerDirectory.appendingPathComponent(path))
        }
    }
}
