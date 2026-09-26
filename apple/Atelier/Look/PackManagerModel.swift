// "Your packs" — importing a pack into this device's vault, and what the
// vault weighs. The state of the web's `LutPackImportModal.tsx`; the sheet is
// `PackManagerView.swift`.
//
// The gesture is deliberately TWO steps, as on the web: pick the folder (or
// the zip it came in), then LOOK at what was read — the categories, the
// cameras, the counts — and name the pack before a byte is stored. The
// preview is built from the paths alone (`importPreview`).
//
// The import is a TASK (`TaskRegistry`, `tasks.md` T5) with NO Cancel: the
// vault is written look by look and the index last, and stopping half-way
// would leave a pack the index does not describe. The sheet keeps its line
// ("Reading 3 of 25…"); the pill draws the bar.

import Foundation
import Observation
import AtelierKit

/// One `.cube` of a picked pack: a file inside a picked folder, or an entry
/// of the zip it arrived in.
enum PackSourceFile: Sendable {
    case file(URL)
    case zip(PackZip, PackZip.Entry)

    /// What reading it costs — the file's size, the entry's inflated size.
    var size: Int {
        switch self {
        case .file(let url):
            let values = try? url.resourceValues(forKeys: [.fileSizeKey])
            return values?.fileSize ?? 0
        case .zip(_, let entry):
            return entry.size
        }
    }

    /// Its bytes, read once — blocking; the import calls it off the main actor.
    func read() throws -> [UInt8] {
        switch self {
        case .file(let url): return [UInt8](try Data(contentsOf: url))
        case .zip(let archive, let entry): return try archive.bytes(entry)
        }
    }
}

/// A picked folder or zip, read and waiting to be named.
struct PickedPack {
    let rootName: String
    /// The picked URL, whose security scope is held until the import ends.
    let scope: URL
    let files: [(path: String, file: PackSourceFile)]

    var bytes: Int { files.reduce(0) { $0 + $1.file.size } }
}

@MainActor
@Observable
final class PackManagerModel {
    private(set) var picked: PickedPack?
    var name = ""
    var author = ""
    var link = ""
    private(set) var progress: ImportProgress?
    private(set) var failed: [ImportFailure] = []
    /// What the last import wrote — looks, bytes, looks already here.
    private(set) var done: (looks: Int, stored: Int, reused: Int)?
    private(set) var error: String?
    /// The vault's measured sizes — re-read whenever the packs change.
    private(set) var sizes: LatticeSizes = [:]
    @ObservationIgnored private var scoped: URL?

    var importing: Bool { progress != nil }

    // MARK: - the pick

    /// A folder or a zip from Files — read, its `.cube` files listed, nothing stored.
    func pick(_ url: URL) {
        error = nil
        done = nil
        failed = []
        release()
        let scoped = url.startAccessingSecurityScopedResource()
        do {
            let read = try PackManagerModel.read(url)
            let files = cubeEntries(read.files)
            guard !files.isEmpty else {
                if scoped { url.stopAccessingSecurityScopedResource() }
                picked = nil
                error = read.files.isEmpty ? "Nothing could be read in that folder." : "No .cube file in that folder."
                return
            }
            if scoped { self.scoped = url }
            picked = PickedPack(rootName: read.rootName, scope: url, files: files)
            if name.isEmpty { name = prettyName(read.rootName.isEmpty ? "Pack" : read.rootName) }
        } catch {
            if scoped { url.stopAccessingSecurityScopedResource() }
            self.error = String(describing: error)
        }
    }

    /// Another folder, or none.
    func discardPick() {
        picked = nil
        release()
    }

    private func release() {
        scoped?.stopAccessingSecurityScopedResource()
        scoped = nil
    }

    /// Every file under a folder (paths relative to it), or a zip's entries.
    private static func read(_ url: URL) throws -> (rootName: String, files: [(path: String, file: PackSourceFile)]) {
        let values = try? url.resourceValues(forKeys: [.isDirectoryKey])
        if values?.isDirectory == true {
            let base = url.standardizedFileURL.path
            var files: [(path: String, file: PackSourceFile)] = []
            if let walker = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.isRegularFileKey]) {
                for case let item as URL in walker {
                    let isFile = (try? item.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile ?? false
                    guard isFile else { continue }
                    let path = item.standardizedFileURL.path
                    guard path.hasPrefix(base) else { continue }
                    var relative = String(path.dropFirst(base.count))
                    while relative.hasPrefix("/") { relative.removeFirst() }
                    files.append((relative, .file(item)))
                }
            }
            return (url.lastPathComponent, files)
        }
        let archive = try PackZip(url: url)
        let listed = archive.cubeFiles()
        return (listed.rootName, listed.files.map { ($0.path, PackSourceFile.zip(archive, $0.entry)) })
    }

    /// What the sheet lists before anything is stored.
    var preview: [(folder: String, looks: Int)] {
        importPreview(picked?.files.map(\.path) ?? [])
    }

    // MARK: - the import

    func run(_ library: LookLibrary) async {
        guard let picked, progress == nil else { return }
        error = nil
        let total = picked.files.count
        progress = ImportProgress(done: 0, total: total, file: "")
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let packName = trimmed.isEmpty ? prettyName(picked.rootName.isEmpty ? "Pack" : picked.rootName) : trimmed
        let trimmedLink = link.trimmingCharacters(in: .whitespacesAndNewlines)
        let options = PackImportOptions(
            id: "pk_\(UUID().uuidString.lowercased())",
            name: packName,
            author: author.trimmingCharacters(in: .whitespacesAndNewlines),
            url: trimmedLink.isEmpty ? nil : trimmedLink
        )
        let handle = TaskRegistry.shared.startTask(label: "Importing \(packName)", progress: 0, detail: "\(total) looks")
        let result = await library.importPack(picked.files, options, read: { file in
            try await Task.detached(priority: .userInitiated) { try file.read() }.value
        }, onProgress: { [weak self] p in
            let share = Double(p.done) / Double(max(1, p.total))
            handle.update(TaskPatch(progress: share, detail: "\(min(p.done + 1, p.total)) of \(p.total)"))
            // Only while the import runs: the last call can land after it ended.
            let owner = self
            Task { @MainActor in
                if owner?.progress != nil { owner?.progress = p }
            }
        })
        handle.done()
        failed = result.failed
        done = (result.index.looks.count, result.stored, result.reused)
        progress = nil
        self.picked = nil
        release()
        await measure(library)
    }

    /// The vault's sizes, measured again — after an import, a forget, a new list.
    func measure(_ library: LookLibrary) async {
        sizes = await library.latticeSizes()
    }

    /// The import's own report is about a vault that has since changed.
    func forgetReport() {
        done = nil
    }
}
