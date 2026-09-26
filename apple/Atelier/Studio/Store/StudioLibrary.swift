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

    /// A file received from Photos: copied into the container, kept there.
    func add(receivedCopy url: URL) {
        guard let copied = StudioMediaFiles.copyIntoContainer(url) else {
            notice = "\(url.lastPathComponent) could not be kept on this device."
            return
        }
        if insert(StudioMediaEntry(ref: StudioMediaFiles.mediaRef(of: copied.url), url: copied.url,
                                   locator: copied.locator)) {
            regroup()
            onLocatorsChanged?(locators)
        }
    }

    /// The project's folder listed again (a re-point): its files replace the
    /// last folder's, the loose files stay.
    func replaceFolder(_ listed: [StudioMediaEntry], scope: URL?) {
        entries.removeAll { $0.locator == nil }
        for entry in listed { insert(entry) }
        if let scope { scopes.append(scope) }
        regroup()
    }

    /// Take a capture off the project — every file of it. A copy the app made
    /// is removed from disk; a file of the person's is left where it is.
    func remove(_ asset: Asset) {
        let keys = Set(assetFiles(asset.parts).map(fileIdentity))
        let leaving = entries.filter { keys.contains(fileIdentity($0.ref)) }
        entries.removeAll { keys.contains(fileIdentity($0.ref)) }
        for entry in leaving {
            if case .container? = entry.locator { try? FileManager.default.removeItem(at: entry.url) }
        }
        regroup()
        onLocatorsChanged?(locators)
    }

    /// Close every scope — the project is closing.
    func release() {
        for url in scopes { url.stopAccessingSecurityScopedResource() }
        scopes = []
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
