// The ways a picture gets onto the roll — the web's Add menu (`RollEditor.tsx`,
// `use-roll-folders.ts`): pictures from Photos (their bytes COPIED into the
// app's container, the one way a Photos pick survives tomorrow without library
// permission), files from Files or the Finder (remembered by bookmark, never
// copied), a whole folder (remembered as ONE bookmark and each picture's path
// in it — the web's remembered folder handle), and a drop of either. A
// picture the roll already holds is FOUND AGAIN — its bytes now in hand —
// never added twice, and the status line says which: `found 2 again · added 3`.
//
// A day from a Winnow waits for the app's Winnow client (`PARITY.md`).

import Foundation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

extension RollEditor {
    /// What one add came to, said once for the whole gesture.
    private func say(found: Int, added: Int, failed: Int = 0) {
        var parts: [String] = []
        if found > 0 { parts.append("found \(found) again") }
        if added > 0 { parts.append("added \(added)") }
        if failed > 0 { parts.append("\(failed) could not be read") }
        notice = parts.isEmpty ? "nothing new" : parts.joined(separator: " · ")
    }

    private func tally(_ results: [RollStore.Added]) {
        var found = 0, added = 0, failed = 0
        var firstAdded: String?
        for r in results {
            switch r {
            case .added(let id):
                added += 1
                if firstAdded == nil { firstAdded = id }
            case .found: found += 1
            case .already: break
            case .failed: failed += 1
            }
        }
        adoptStoreChange()
        pool.retry(pictures.map(\.id))
        say(found: found, added: added, failed: failed)
        if openId == nil { open(firstAdded ?? pictures.first?.id) }
        if found > 0 { requestRender() }
    }

    /// Pictures picked in Photos.
    func addFromPhotos(_ items: [PhotosPickerItem]) async {
        let stamp = Int(Date().timeIntervalSince1970)
        var results: [RollStore.Added] = []
        for (i, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else {
                results.append(.failed)
                continue
            }
            let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            results.append(store.addPicture(to: rollId, data: data, name: "IMG_\(stamp)_\(i + 1).\(ext)"))
        }
        tally(results)
    }

    /// Files picked in Files or the Finder, or dropped — a folder among them
    /// is read as a folder.
    func addFiles(_ urls: [URL]) {
        var results: [RollStore.Added] = []
        var photos: [URL] = []
        for url in urls {
            if (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
                results += folderResults(url)
            } else {
                photos.append(url)
            }
        }
        let refs = photos.map(RollStore.mediaRef(of:))
        let chosen = photoFiles(refs)
        for ref in chosen {
            guard let url = photos.first(where: { $0.lastPathComponent == ref.name }) else { continue }
            results.append(store.addPicture(to: rollId, url: url))
        }
        if results.isEmpty && urls.count > 0 {
            notice = "no photographs in what was given"
            return
        }
        tally(results)
    }

    /// A folder picked: its photographs — a RAW yielding to its own JPEG, as
    /// the Library reads a capture — found again or added.
    func addFolder(_ url: URL) {
        let results = folderResults(url)
        if results.isEmpty {
            notice = "no photographs in what was given"
            return
        }
        tally(results)
    }

    private func folderResults(_ folder: URL) -> [RollStore.Added] {
        let scoped = folder.startAccessingSecurityScopedResource()
        defer { if scoped { folder.stopAccessingSecurityScopedResource() } }
        guard let bookmark = RollStore.makeBookmark(folder) else { return [.failed] }
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]
        let listed = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: keys,
                                                                   options: [.skipsHiddenFiles])) ?? []
        let files = listed.filter { (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true }
        let refs = files.map(RollStore.mediaRef(of:))
        return photoFiles(refs).map { ref in
            store.addPicture(to: rollId, folder: bookmark, path: ref.name, ref: ref)
        }
    }
}
