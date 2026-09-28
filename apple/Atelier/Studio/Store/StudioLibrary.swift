// The media ONE open project reaches on this device — the native stand-in for
// the web's shared Library as the Studio reads it (`useActiveAsset
// (STUDIO_KINDS)`): the files gathered when the project opened (its folder,
// listed again, and its loose files, resolved from the side table), plus what
// the person adds while editing, grouped into captures by the kernel's
// `buildAssets` (`DJI_0001.MP4` + `DJI_0001.SRT` one `video+telemetry` asset,
// a RAW + its JPEG one photo).
//
// Every file is read WHERE IT IS, under its security scope, held open for as
// long as the project is: a folder's scope covers every file listed in it.
// `release()` closes them all when the project closes. A Photos pick is
// copied into the app's container first (`StudioMediaFiles`), the one way it
// survives tomorrow. Nothing here writes the document: the editor's autosave
// rebuilds `media.files` from the clips, the web's rule — a project's media
// list is its working set, not the folder listing.
//
// The shell's LIBRARY feeds it (`adopt`): each file of an asset the person
// put to work comes in by what its location IS — a file pointed at by its
// bookmark, a file of a folder by the folder's bookmark and its path, a
// Photos copy copied into the container under its own name, and a file an
// instance handed over held for the SESSION only (`fetched`), its ref kept
// as the Library holds it (the original's hash, the asset id) so the project
// names it by content and the export finds its capture. What the project
// names on an instance and this device lost with the last session is
// fetched back when it opens; `recovery` is where each capture stands.

import Foundation
import Observation
import AtelierKit

@MainActor
@Observable
final class StudioLibrary {
    let projectId: String
    private(set) var entries: [StudioMediaEntry] = []
    /// The files grouped into captures.
    private(set) var assets: [Asset] = []
    /// The last add that could not be read, said once.
    var notice: String?
    /// The captures the project names on an instance and this device lost
    /// with the last session — being fetched back, refused, or out of reach
    /// (`StudioStore+Recovery.swift`).
    var recovery: [StudioRecoveryItem] = []

    /// Security scopes held open while the project is: the folder's, and each
    /// loose file's.
    @ObservationIgnored private var scopes: [URL] = []
    /// Called with the loose files' locators whenever they change — the store
    /// writes the side table.
    @ObservationIgnored var onLocatorsChanged: (([PictureLocator]) -> Void)?

    init(projectId: String, entries: [StudioMediaEntry] = [], scopes: [URL] = []) {
        self.projectId = projectId
        self.scopes = scopes
        self.entries = []
        for entry in entries { insert(entry) }
        regroup()
    }

    /// What the Studio edits: clips with or without telemetry, and stills.
    var clips: [Asset] { usableAssets(studioKinds, assets) }

    /// Where a part's bytes are.
    func url(for ref: SavedMediaRef?) -> URL? {
        guard let ref else { return nil }
        let key = fileIdentity(ref)
        return entries.first { fileIdentity($0.ref) == key }?.url
    }

    /// The loose files' locators, in the order they were added.
    var locators: [PictureLocator] { entries.compactMap(\.locator) }

    // MARK: - adding

    /// Files (or a folder) pointed at in Files or the Finder, or dropped:
    /// remembered by bookmark, never copied. A second copy of one already here
    /// (same name, size and date) is ignored, as the web's library dedupes.
    func add(urls: [URL]) {
        var added = 0
        var failed: [String] = []
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            let isFolder = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
            if isFolder {
                guard let bookmark = RollStore.makeBookmark(url) else {
                    if scoped { url.stopAccessingSecurityScopedResource() }
                    failed.append(url.lastPathComponent)
                    continue
                }
                let listed = StudioMediaFiles.list(folder: url)
                for entry in listed {
                    let path = relativePath(entry.url, in: url)
                    if insert(StudioMediaEntry(ref: entry.ref, url: entry.url, locator: .folder(bookmark, path))) {
                        added += 1
                    }
                }
                if scoped { scopes.append(url) }
                continue
            }
            guard classifyPart(url.lastPathComponent) != .other else {
                if scoped { url.stopAccessingSecurityScopedResource() }
                continue
            }
            guard let bookmark = RollStore.makeBookmark(url) else {
                if scoped { url.stopAccessingSecurityScopedResource() }
                failed.append(url.lastPathComponent)
                continue
            }
            if insert(StudioMediaEntry(ref: StudioMediaFiles.mediaRef(of: url), url: url, locator: .bookmark(bookmark))) {
                added += 1
                if scoped { scopes.append(url) }
            } else if scoped {
                url.stopAccessingSecurityScopedResource()
            }
        }
        notice = failed.isEmpty ? nil : "\(failed.joined(separator: ", ")) could not be read."
        if added > 0 {
            regroup()
            onLocatorsChanged?(locators)
        }
    }

    /// A file received from Photos — or a Library session copy, `ref` as the
    /// Library holds it: copied into the container under its own name and
    /// date, kept there.
    func add(receivedCopy url: URL, ref: SavedMediaRef? = nil) {
        if let ref, contains(ref) { return }
        guard let copied = StudioMediaFiles.copyIntoContainer(url, name: ref?.name, modified: ref?.lastModified) else {
            notice = "\(ref?.name ?? url.lastPathComponent) could not be kept on this device."
            return
        }
        let kept = ref ?? StudioMediaFiles.mediaRef(of: copied.url)
        if insert(StudioMediaEntry(ref: kept, url: copied.url, locator: copied.locator)) {
            regroup()
            onLocatorsChanged?(locators)
        } else {
            StudioMediaFiles.removeCopy(copied.url)
        }
    }

    // MARK: - from the shell's Library

    /// Every file of an asset the Library hands over, each by what its
    /// location IS: a bookmark through `add(urls:)`, a folder's file with its
    /// folder's locator, a Photos copy into the container, a fetched file for
    /// the session. True when something joined the project.
    @discardableResult
    func adopt(_ files: [LibraryEntry]) -> Bool {
        let before = entries.count
        var pointed: [URL] = []
        var failed: [String] = []
        var locatorsMoved = false
        for file in files where !contains(file.ref) {
            switch file.location {
            case .bookmark(let bookmark):
                if let url = try? RollStore.resolveBookmark(bookmark) {
                    pointed.append(url)
                } else {
                    failed.append(file.ref.name)
                }
            case .folder(let bookmark, let path):
                if addFolderFile(path, of: bookmark, ref: file.ref) {
                    locatorsMoved = true
                } else {
                    failed.append(file.ref.name)
                }
            case .session(let path):
                let url = URL(fileURLWithPath: path)
                if file.ref.assetId != nil {
                    // An instance's file: the session's, fetched again tomorrow.
                    if !addFetched(url, ref: file.ref) { failed.append(file.ref.name) }
                } else {
                    add(receivedCopy: url, ref: file.ref)
                }
            }
        }
        if !pointed.isEmpty { add(urls: pointed) }
        if locatorsMoved { onLocatorsChanged?(locators) }
        if entries.count != before { regroup() }
        if !failed.isEmpty {
            let said = "\(failed.joined(separator: ", ")) could not be read."
            notice = notice.map { "\($0) \(said)" } ?? said
        }
        return entries.count != before
    }

    /// A file of a folder the person pointed at, remembered as the folder's
    /// bookmark and its path — the locator the folder listing records.
    private func addFolderFile(_ path: String, of bookmark: Data, ref: SavedMediaRef) -> Bool {
        guard let folder = try? RollStore.resolveBookmark(bookmark) else { return false }
        let scoped = folder.startAccessingSecurityScopedResource()
        let url = folder.appendingPathComponent(path)
        guard FileManager.default.fileExists(atPath: url.path),
              insert(StudioMediaEntry(ref: ref, url: url, locator: .folder(bookmark, path))) else {
            if scoped { folder.stopAccessingSecurityScopedResource() }
            return false
        }
        if scoped { scopes.append(folder) }
        return true
    }

    /// A file an instance handed over (through the Library), held for this
    /// session under its ref — no locator: the ref's `assetId` is its address.
    @discardableResult
    func addFetched(_ url: URL, ref: SavedMediaRef) -> Bool {
        if contains(ref) { return true }
        guard let held = StudioMediaFiles.holdForSession(url, name: ref.name, modified: ref.lastModified) else {
            return false
        }
        guard insert(StudioMediaEntry(ref: ref, url: held, locator: nil, fetched: true)) else {
            StudioMediaFiles.removeCopy(held)
            return false
        }
        regroup()
        return true
    }

    /// Whether a file of that identity is already the project's.
    func contains(_ ref: SavedMediaRef) -> Bool {
        let key = fileIdentity(ref)
        return entries.contains { fileIdentity($0.ref) == key }
    }

    /// The project's folder listed again (a re-point): its files replace the
    /// last folder's, the loose files stay.
    func replaceFolder(_ listed: [StudioMediaEntry], scope: URL?) {
        entries.removeAll { $0.locator == nil && !$0.fetched }
        for entry in listed { insert(entry) }
        if let scope { scopes.append(scope) }
        regroup()
    }

    /// Take a capture off the project — every file of it. A copy the app made
    /// (a Photos pick's, a fetched file's) is removed from disk; a file of the
    /// person's is left where it is.
    func remove(_ asset: Asset) {
        let keys = Set(assetFiles(asset.parts).map(fileIdentity))
        let leaving = entries.filter { keys.contains(fileIdentity($0.ref)) }
        entries.removeAll { keys.contains(fileIdentity($0.ref)) }
        for entry in leaving {
            if case .container? = entry.locator { StudioMediaFiles.removeCopy(entry.url) }
            if entry.fetched { StudioMediaFiles.removeCopy(entry.url) }
        }
        regroup()
        onLocatorsChanged?(locators)
    }

    /// Close every scope and let the session's fetched files go — the project
    /// is closing; they are fetched back (or taken from the Library again)
    /// when it next opens.
    func release() {
        for url in scopes { url.stopAccessingSecurityScopedResource() }
        scopes = []
        for entry in entries where entry.fetched { StudioMediaFiles.removeCopy(entry.url) }
    }

    @discardableResult
    private func insert(_ entry: StudioMediaEntry) -> Bool {
        let key = fileIdentity(entry.ref)
        if entries.contains(where: { fileIdentity($0.ref) == key }) { return false }
        entries.append(entry)
        return true
    }

    private func regroup() {
        assets = buildAssets(entries.map(\.ref))
    }

    /// `file`'s path inside `folder`, as the folder's locator keeps it.
    private func relativePath(_ file: URL, in folder: URL) -> String {
        let base = folder.standardizedFileURL.path
        let full = file.standardizedFileURL.path
        guard full.hasPrefix(base) else { return file.lastPathComponent }
        return String(full.dropFirst(base.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}
