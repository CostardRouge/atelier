// The rolls this device keeps, and where each picture's BYTES are.
//
// A roll is the web app's document (`AtelierKit.RollDoc`, v6), written as the
// same JSON under Application Support — so a roll made here is one the web
// app reads, and the reverse. What the document never holds is the picture:
// like the web (a folder handle in IndexedDB, a Winnow asset id), this store
// keeps a SIDE TABLE per roll saying how THIS device reaches each file — a
// copy in the app's own container when the bytes arrived as a one-shot
// transfer (a Photos pick), a security-scoped bookmark when the person pointed
// at a file. Neither travels with the roll.
//
// Beside each roll, three more things that are this device's and never the
// document's (`develop-roll.md`): the locators (`<id>.locators.json`), the
// export MARKS — which pictures left since they last changed
// (`<id>.marks.json`, `export-marks.ts`: a mark on the document would be a
// write the undo stack records) — and the filmstrip's thumbnails
// (`thumbs/<picture id>.jpg`, the web's `roll-thumbs` store), pruned with the
// roll so nothing else ever has to.
//
// Writes are LOCAL NOW: debounced 800 ms (the web's `SAVE_DEBOUNCE_MS`) and
// flushed when the app leaves the foreground. A refused write is SAID
// (`storageFailed`), never swallowed — the web's banner, word for word, in
// the editor.

import Foundation
import Observation
import AtelierKit

/// How this device reaches a picture's bytes. Beside the roll, never in it.
enum PictureLocator: Codable, Equatable {
    /// A copy in the app's container, relative to its media folder.
    case container(String)
    /// A file the person pointed at, remembered through a security-scoped bookmark.
    case bookmark(Data)
    /// A file inside a FOLDER the person picked: the folder's bookmark and the
    /// file's path inside it — the web's remembered folder handle, re-read.
    case folder(Data, String)
}

/// Where a picture's bytes are READ now: its locator, or a file the roll
/// fetched from an instance for this session (never stored).
enum PictureBytesSource {
    case locator(PictureLocator)
    case file(URL)
}

enum PictureError: LocalizedError {
    case noLocator
    case undecodable

    var errorDescription: String? {
        switch self {
        case .noLocator: return "This device does not know where the picture's file is."
        case .undecodable: return "This picture is in a format the device cannot decode."
        }
    }
}

@MainActor
@Observable
final class RollStore {
    private(set) var rolls: [RollDoc] = []
    /// A local write was refused (the disk is full, the container is read-only).
    private(set) var storageFailed = false
    /// roll id → picture id → locator.
    @ObservationIgnored private var locators: [String: [String: PictureLocator]] = [:]
    /// roll id → export marks, read once.
    @ObservationIgnored private var marksCache: [String: ExportMarks] = [:]
    private let root: URL
    @ObservationIgnored private var pendingSaves: [String: Task<Void, Never>] = [:]
    /// Told each time a roll's JSON LANDS on disk — the sources' bridge
    /// (`RollDocuments`) marks a roll kept on a Winnow dirty from there, the
    /// web's `edited` after `putRoll`.
    @ObservationIgnored var onWritten: ((RollDoc) -> Void)?
    /// Files the roll FETCHED from an instance for this session (roll id →
    /// picture id → a file under the temporary folder) — never persisted,
    /// never a locator: a remote picture is re-fetched from its ref's own
    /// asset id (`develop-media.md`, `RollEditor+Winnow.swift`).
    private(set) var sessionFiles: [String: [String: URL]] = [:]

    /// The web's `SAVE_DEBOUNCE_MS`.
    static let saveDebounceNanos: UInt64 = 800_000_000

    init(root: URL? = nil) {
        self.root = root ?? RollStore.defaultRoot()
        load()
    }

    nonisolated static func defaultRoot() -> URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("Atelier", isDirectory: true)
    }

    private var rollsDirectory: URL { root.appendingPathComponent("rolls", isDirectory: true) }
    /// Where a container copy lives. Read off the main actor by `bytes(of:mediaDirectory:)`.
    var mediaDirectory: URL { root.appendingPathComponent("media", isDirectory: true) }
    /// Where the filmstrip's thumbnails are kept, one JPEG per picture id.
    var thumbsDirectory: URL { root.appendingPathComponent("thumbs", isDirectory: true) }
    /// The folder the preset book sits in, beside the rolls.
    var rootDirectory: URL { root }

    private func rollURL(_ id: String) -> URL { rollsDirectory.appendingPathComponent("\(id).json") }
    private func locatorsURL(_ id: String) -> URL { rollsDirectory.appendingPathComponent("\(id).locators.json") }
    private func marksURL(_ id: String) -> URL { rollsDirectory.appendingPathComponent("\(id).marks.json") }
    func thumbURL(_ pictureId: String) -> URL { thumbsDirectory.appendingPathComponent("\(pictureId).jpg") }

    private func load() {
        let fm = FileManager.default
        try? fm.createDirectory(at: rollsDirectory, withIntermediateDirectories: true)
        try? fm.createDirectory(at: mediaDirectory, withIntermediateDirectories: true)
        try? fm.createDirectory(at: thumbsDirectory, withIntermediateDirectories: true)
        var found: [RollDoc] = []
        let urls = (try? fm.contentsOfDirectory(at: rollsDirectory, includingPropertiesForKeys: nil)) ?? []
        for url in urls {
            let name = url.lastPathComponent
            guard name.hasSuffix(".json"), !name.hasSuffix(".locators.json"), !name.hasSuffix(".marks.json"),
                  !name.hasSuffix(".sync.json") else { continue }
            guard let data = try? Data(contentsOf: url), let doc = readRollDoc(JSONValue.parse(data)) else { continue }
            found.append(doc)
            if let table = try? Data(contentsOf: locatorsURL(doc.id)),
               let decoded = try? JSONDecoder().decode([String: PictureLocator].self, from: table) {
                locators[doc.id] = decoded
            }
        }
        rolls = found.sorted { $0.updatedAt > $1.updatedAt }
    }

    // MARK: - rolls

    func roll(_ id: String) -> RollDoc? {
        rolls.first { $0.id == id }
    }

    @discardableResult
    func create(name: String) -> RollDoc {
        let doc = createRollDoc(name: name)
        rolls.insert(doc, at: 0)
        persist(doc)
        return doc
    }

    /// A roll made elsewhere — a `.roll.json` import — kept here from now on.
    func insert(_ doc: RollDoc) {
        rolls.removeAll { $0.id == doc.id }
        rolls.insert(doc, at: 0)
        persist(doc)
    }

    /// The whole roll replaced by `doc`, as given — the editor's ONE funnel
    /// (every kernel edit already stamps `updatedAt`) and an undo's restore,
    /// which must land the older document exactly as it was. Debounced to disk.
    func put(_ doc: RollDoc) {
        guard let i = rolls.firstIndex(where: { $0.id == doc.id }) else { return }
        if rolls[i] == doc { return }
        rolls[i] = doc
        persist(doc)
    }

    /// One change to one roll, written through — debounced to disk.
    func update(_ id: String, _ change: (inout RollDoc) -> Void) {
        guard let i = rolls.firstIndex(where: { $0.id == id }) else { return }
        var next = rolls[i]
        change(&next)
        if next == rolls[i] { return }
        next.updatedAt = nowMillis()
        rolls[i] = next
        persist(next)
    }

    func rename(_ id: String, to name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        update(id) { $0.name = trimmed }
    }

    func delete(_ id: String) {
        pendingSaves[id]?.cancel()
        pendingSaves[id] = nil
        let pictureIds = roll(id)?.pictures.map(\.id) ?? []
        rolls.removeAll { $0.id == id }
        let table = locators[id] ?? [:]
        locators[id] = nil
        sessionFiles[id] = nil
        marksCache[id] = nil
        let fm = FileManager.default
        try? fm.removeItem(at: rollURL(id))
        try? fm.removeItem(at: locatorsURL(id))
        try? fm.removeItem(at: marksURL(id))
        // The thumbnails go with the roll: nothing else will ever prune them.
        for pictureId in pictureIds { try? fm.removeItem(at: thumbURL(pictureId)) }
        for case .container(let path) in table.values where !containerCopyInUse(path) {
            try? fm.removeItem(at: mediaDirectory.appendingPathComponent(path))
        }
    }

    private func containerCopyInUse(_ path: String) -> Bool {
        locators.values.contains { table in
            table.values.contains { if case .container(let p) = $0 { return p == path } else { return false } }
        }
    }

    private func persist(_ doc: RollDoc) {
        pendingSaves[doc.id]?.cancel()
        let url = rollURL(doc.id)
        let text = doc.json.serialized(pretty: true)
        pendingSaves[doc.id] = Task { [weak self] in
            try? await Task.sleep(nanoseconds: RollStore.saveDebounceNanos)
            guard !Task.isCancelled, let self else { return }
            self.pendingSaves[doc.id] = nil
            if self.write(text, to: url) { self.onWritten?(doc) }
        }
    }

    @discardableResult
    private func write(_ text: String, to url: URL) -> Bool {
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
            if storageFailed { storageFailed = false }
            return true
        } catch {
            storageFailed = true
            return false
        }
    }

    /// Write everything still pending, now — the app is going to the background.
    func flush() {
        let owed = pendingSaves
        pendingSaves = [:]
        for (id, task) in owed {
            task.cancel()
            guard let doc = roll(id) else { continue }
            if write(doc.json.serialized(pretty: true), to: rollURL(id)) { onWritten?(doc) }
        }
    }

    /// A write the debounce still holds for `id`, dropped — the document is
    /// being replaced under it (the instance's copy taken, kept as local).
    func discardPending(_ id: String) {
        pendingSaves[id]?.cancel()
        pendingSaves[id] = nil
    }

    /// A roll written to disk by someone else — the sources' mirror, a roll
    /// created or moved THERE first — taken into memory as it is and never
    /// written again here: a write would mark a clean mirror dirty.
    func adopt(_ doc: RollDoc) {
        discardPending(doc.id)
        rolls.removeAll { $0.id == doc.id }
        rolls.append(doc)
        rolls.sort { $0.updatedAt > $1.updatedAt }
    }

    /// A roll whose pictures were given fresh ids — a move goes through the
    /// portable file, as the web's `moveRoll` does: what this device keeps
    /// under a picture's id (its locator, its export mark, its thumbnail)
    /// follows it, old id → new.
    func remapPictures(_ rollId: String, _ renamed: [String: String]) {
        guard !renamed.isEmpty else { return }
        if let table = locators[rollId] {
            var next: [String: PictureLocator] = [:]
            for (id, locator) in table { next[renamed[id] ?? id] = locator }
            locators[rollId] = next
            persistLocators(rollId)
        }
        let kept = marks(rollId)
        if !kept.isEmpty {
            var next: ExportMarks = [:]
            for (id, mark) in kept { next[renamed[id] ?? id] = mark }
            marksCache[rollId] = next
            try? next.json.serialized(pretty: false).write(to: marksURL(rollId), atomically: true, encoding: .utf8)
        }
        let fm = FileManager.default
        for (old, new) in renamed where old != new {
            try? fm.moveItem(at: thumbURL(old), to: thumbURL(new))
        }
    }

    private func persistLocators(_ rollId: String) {
        guard let table = locators[rollId], let data = try? JSONEncoder().encode(table) else { return }
        try? data.write(to: locatorsURL(rollId), options: .atomic)
    }

    // MARK: - the roll file

    /// A `.roll.json` read into a NEW roll — fresh id, fresh timestamps, a
    /// fresh id for every picture (`rollDocFromFile`), kept on this device —
    /// or the reason it is not one, in words a person can act on. Importing a
    /// backup twice makes two rolls; it never replaces one.
    func importRoll(text: String) -> Result<RollDoc, RollFileError> {
        switch readRollFile(text) {
        case .failure(let error):
            return .failure(error)
        case .success(let file):
            let doc = rollDocFromFile(file, sourceId: defaultSourceId)
            insert(doc)
            return .success(doc)
        }
    }

    /// The roll as its file carries it: indented, diffable, the web's bytes.
    func fileText(_ id: String) -> String? {
        roll(id).map { serializeRollFile(toRollFile($0)) }
    }

    // MARK: - export marks

    /// When each picture last LEFT, on this device.
    func marks(_ rollId: String) -> ExportMarks {
        if let hit = marksCache[rollId] { return hit }
        let read = (try? Data(contentsOf: marksURL(rollId))).flatMap { JSONValue.parse($0) }
        let marks = readExportMarks(read)
        marksCache[rollId] = marks
        return marks
    }

    /// Record pictures that landed — keyed on each picture AS IT WAS RENDERED.
    /// Never an edit, never undone.
    func recordExported(_ rollId: String, _ pictures: [RollPicture], at: Double = nowMillis()) {
        let next = withExported(marks(rollId), pictures, at: at)
        marksCache[rollId] = next
        try? next.json.serialized(pretty: false).write(to: marksURL(rollId), atomically: true, encoding: .utf8)
    }

    // MARK: - pictures

    func locator(_ rollId: String, _ pictureId: String) -> PictureLocator? {
        locators[rollId]?[pictureId]
    }

    /// What can be said about a picture's bytes from this store alone: in
    /// hand (a locator, or a file fetched for the session), kept on an
    /// instance, or a file of this machine not open right now. What the roll's
    /// own fetch is doing (fetching, failed, gone) is `RollEditor+Winnow`'s.
    func availability(_ rollId: String, _ picture: RollPicture) -> PictureAvailability {
        if locators[rollId]?[picture.id] != nil || sessionFiles[rollId]?[picture.id] != nil { return .ready }
        if let host = splitAssetId(picture.ref.assetId)?.host, host != defaultSourceId {
            return .unconnected(sourceId: host)
        }
        return .local
    }

    // MARK: - files fetched for the session

    /// Where a picture's bytes are read now: its locator, else a file fetched
    /// for the session.
    func bytesSource(_ rollId: String, _ pictureId: String) -> PictureBytesSource? {
        if let locator = locators[rollId]?[pictureId] { return .locator(locator) }
        if let url = sessionFiles[rollId]?[pictureId] { return .file(url) }
        return nil
    }

    /// The file fetched for `pictureId` this session, if any.
    func sessionFile(_ rollId: String, _ pictureId: String) -> URL? {
        sessionFiles[rollId]?[pictureId]
    }

    /// Hold a fetched file for pictures of a roll (a picture and its variants).
    func holdSession(_ rollId: String, _ pictureIds: [String], _ url: URL) {
        for id in pictureIds { sessionFiles[rollId, default: [:]][id] = url }
    }

    /// Let go of pictures' fetched files; the files a picture no longer uses
    /// are returned, for the caller to delete when they are its own.
    @discardableResult
    func releaseSession(_ rollId: String, _ pictureIds: [String]) -> [URL] {
        var dropped: [URL] = []
        for id in pictureIds {
            if let url = sessionFiles[rollId]?.removeValue(forKey: id) { dropped.append(url) }
        }
        let still = Set((sessionFiles[rollId] ?? [:]).values)
        return dropped.filter { !still.contains($0) }
    }

    /// Every fetched file of a roll let go — the editor closed.
    @discardableResult
    func releaseAllSession(_ rollId: String) -> [URL] {
        let all = Array(Set((sessionFiles[rollId] ?? [:]).values))
        sessionFiles[rollId] = nil
        return all
    }

    /// The same locator for another picture id — a VARIANT shares its file.
    func shareLocator(_ rollId: String, from: String, to: String) {
        guard let locator = locators[rollId]?[from] else { return }
        locators[rollId, default: [:]][to] = locator
        persistLocators(rollId)
    }

    /// Hand `locator` to every picture of the roll that is `ref` and has none
    /// on this device yet — a roll imported from a file, or a picture whose
    /// folder is reopened, is FOUND AGAIN rather than added twice (variants
    /// included: they share the file). Returns how many were found.
    private func relink(_ rollId: String, _ ref: SavedMediaRef, _ locator: PictureLocator) -> Int {
        guard let doc = roll(rollId) else { return 0 }
        var found = 0
        for picture in doc.pictures where sameMediaRef(picture.ref, ref) {
            if locators[rollId]?[picture.id] == nil {
                locators[rollId, default: [:]][picture.id] = locator
                found += 1
            }
        }
        if found > 0 { persistLocators(rollId) }
        return found
    }

    /// What adding one file came to.
    enum Added {
        /// A new picture on the roll.
        case added(String)
        /// A picture the roll already held, its bytes now in hand.
        case found(String)
        /// The roll already held it, bytes and all.
        case already(String)
        case failed
    }

    /// A picture whose bytes ARRIVED (a Photos pick, a drop): copied into the
    /// container, because nothing else lets the roll reach it again tomorrow.
    @discardableResult
    func addPicture(to rollId: String, data: Data, name: String, modified: Date = Date()) -> Added {
        let ref = SavedMediaRef(name: name, size: data.count, lastModified: modified.timeIntervalSince1970 * 1000)
        return addPicture(to: rollId, data: data, ref: ref)
    }

    /// The same, for a file whose ref is already known — the Library's, with
    /// its content hash or the source's asset id — so the roll names the
    /// media by what it IS rather than by its name alone.
    @discardableResult
    func addPicture(to rollId: String, data: Data, ref: SavedMediaRef) -> Added {
        guard let doc = roll(rollId) else { return .failed }
        let name = ref.name
        let path = "\(UUID().uuidString.lowercased())-\(RollStore.safeFileName(name))"
        if let existing = doc.pictures.first(where: { sameMediaRef($0.ref, ref) }) {
            if locators[rollId]?[existing.id] != nil { return .already(existing.id) }
            guard (try? data.write(to: mediaDirectory.appendingPathComponent(path), options: .atomic)) != nil else { return .failed }
            _ = relink(rollId, ref, .container(path))
            return .found(existing.id)
        }
        do {
            try data.write(to: mediaDirectory.appendingPathComponent(path), options: .atomic)
        } catch {
            return .failed
        }
        let id = newRollId()
        locators[rollId, default: [:]][id] = .container(path)
        update(rollId) { $0 = addPictures($0, [ref]) { id } }
        persistLocators(rollId)
        return .added(id)
    }

    /// A picture the person POINTED AT, in Files or the Finder: remembered by
    /// bookmark, never copied — the file stays theirs, where it is.
    @discardableResult
    func addPicture(to rollId: String, url: URL) -> Added {
        addPicture(to: rollId, url: url, ref: nil)
    }

    /// The same, the file named by the ref the Library already holds for it
    /// (its hash computed there), else by its name, size and date.
    @discardableResult
    func addPicture(to rollId: String, url: URL, ref known: SavedMediaRef?) -> Added {
        guard let doc = roll(rollId) else { return .failed }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let ref = known ?? RollStore.mediaRef(of: url)
        guard let bookmark = RollStore.makeBookmark(url) else { return .failed }
        return add(rollId, doc, ref, .bookmark(bookmark))
    }

    /// A picture found inside a folder the person picked — remembered as the
    /// folder's bookmark and its path, so reopening the folder is one bookmark.
    @discardableResult
    func addPicture(to rollId: String, folder: Data, path: String, ref: SavedMediaRef) -> Added {
        guard let doc = roll(rollId) else { return .failed }
        return add(rollId, doc, ref, .folder(folder, path))
    }

    private func add(_ rollId: String, _ doc: RollDoc, _ ref: SavedMediaRef, _ locator: PictureLocator) -> Added {
        if let existing = doc.pictures.first(where: { sameMediaRef($0.ref, ref) }) {
            if locators[rollId]?[existing.id] != nil { return .already(existing.id) }
            _ = relink(rollId, ref, locator)
            return .found(existing.id)
        }
        let id = newRollId()
        locators[rollId, default: [:]][id] = locator
        update(rollId) { $0 = addPictures($0, [ref]) { id } }
        persistLocators(rollId)
        return .added(id)
    }

    /// A file's reference as the roll keeps it: its name, size and date.
    nonisolated static func mediaRef(of url: URL) -> SavedMediaRef {
        let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        let modified = values?.contentModificationDate ?? Date()
        return SavedMediaRef(name: url.lastPathComponent, size: values?.fileSize ?? 0,
                             lastModified: (modified.timeIntervalSince1970 * 1000).rounded())
    }

    func removePicture(_ rollId: String, _ pictureId: String) {
        let locator = locators[rollId]?[pictureId]
        locators[rollId]?[pictureId] = nil
        update(rollId) { $0 = removePictures($0, [pictureId]) }
        persistLocators(rollId)
        try? FileManager.default.removeItem(at: thumbURL(pictureId))
        if case .container(let path)? = locator, !containerCopyInUse(path) {
            try? FileManager.default.removeItem(at: mediaDirectory.appendingPathComponent(path))
        }
    }

    /// The bytes behind a locator or a session file. Blocking: call it off the main actor.
    nonisolated static func bytes(of source: PictureBytesSource, mediaDirectory: URL) throws -> Data {
        switch source {
        case .locator(let locator): return try bytes(of: locator, mediaDirectory: mediaDirectory)
        case .file(let url): return try Data(contentsOf: url)
        }
    }

    /// Where an EXISTING picture's bytes are, from the Library's handle — a
    /// roll created with the Library's ticked pictures already on it. A file
    /// pointed at keeps its bookmark; a session copy of this device's (a
    /// Photos pick) is copied into the container, the one way the roll reaches
    /// it tomorrow; a file FETCHED from an instance is not: the roll fetches it
    /// again from its ref's asset id (`develop-media.md`). True when a locator
    /// was written.
    @discardableResult
    func locate(_ dropped: DroppedAsset, rollId: String, pictureId: String) -> Bool {
        let locator: PictureLocator
        switch dropped.location {
        case .bookmark(let bookmark):
            locator = .bookmark(bookmark)
        case .folder(let bookmark, let path):
            locator = .folder(bookmark, path)
        case .session(let path):
            if RollStore.isRemote(dropped.ref) { return false }
            let name = "\(UUID().uuidString.lowercased())-\(RollStore.safeFileName(dropped.ref.name))"
            guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
                  (try? data.write(to: mediaDirectory.appendingPathComponent(name), options: .atomic)) != nil else { return false }
            locator = .container(name)
        }
        locators[rollId, default: [:]][pictureId] = locator
        persistLocators(rollId)
        return true
    }

    /// A ref an instance vouched for — the roll reaches its bytes by fetching.
    nonisolated static func isRemote(_ ref: SavedMediaRef) -> Bool {
        guard let host = splitAssetId(ref.assetId)?.host else { return false }
        return host != defaultSourceId
    }

    /// A picture reached by its ref alone — an instance's, fetched when it is
    /// looked at: on the roll, with no locator. One already held is found.
    @discardableResult
    func addRef(to rollId: String, _ ref: SavedMediaRef) -> Added {
        guard let doc = roll(rollId) else { return .failed }
        if let existing = doc.pictures.first(where: { sameMediaRef($0.ref, ref) }) { return .already(existing.id) }
        let id = newRollId()
        update(rollId) { $0 = addPictures($0, [ref]) { id } }
        return .added(id)
    }

    /// The bytes behind a locator. Blocking: call it off the main actor.
    nonisolated static func bytes(of locator: PictureLocator, mediaDirectory: URL) throws -> Data {
        switch locator {
        case .container(let path):
            return try Data(contentsOf: mediaDirectory.appendingPathComponent(path))
        case .bookmark(let bookmark):
            var stale = false
            #if os(macOS)
            let url = try URL(resolvingBookmarkData: bookmark, options: .withSecurityScope, relativeTo: nil, bookmarkDataIsStale: &stale)
            #else
            let url = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
            #endif
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            return try Data(contentsOf: url)
        case .folder(let bookmark, let path):
            let folder = try resolveBookmark(bookmark)
            let scoped = folder.startAccessingSecurityScopedResource()
            defer { if scoped { folder.stopAccessingSecurityScopedResource() } }
            return try Data(contentsOf: folder.appendingPathComponent(path))
        }
    }

    nonisolated static func resolveBookmark(_ bookmark: Data) throws -> URL {
        var stale = false
        #if os(macOS)
        return try URL(resolvingBookmarkData: bookmark, options: .withSecurityScope, relativeTo: nil, bookmarkDataIsStale: &stale)
        #else
        return try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        #endif
    }

    /// A bookmark of a folder or a file the person pointed at.
    nonisolated static func makeBookmark(_ url: URL) -> Data? {
        #if os(macOS)
        return try? url.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil)
        #else
        return try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        #endif
    }

    nonisolated static func safeFileName(_ name: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
        let cleaned = name.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" }
        return String(cleaned)
    }
}
