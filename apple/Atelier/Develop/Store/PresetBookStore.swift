// The personal PRESET BOOK — one list of named lights, the same in every
// Develop surface (`develop-roll.md`, D4), kept on this device or on a Winnow.
// The native twin of the web's `use-preset-book.ts` over `preset-book.ts` and
// `preset-book-remote.ts`. The kernel's `PresetBook` is the document; this
// store keeps it as ONE file beside the rolls (`Application Support/Atelier/
// presets.json`), written through with a roll's debounce and flushed with them,
// and — when the book is kept on an instance — its sync record beside it
// (`presets.sync.json`), never on it.
//
// Rules kept from the web:
// - The book's id is minted like any document's — a UUID, never a fixed name —
//   so a second device FINDS it by listing its kind (`presets`) there.
// - A preset is a COPY of numbers, applied and never followed, and never a
//   material (`withoutBase`); saving under a taken name replaces it in place; a
//   preset of zeros with no look is refused.
// - LOCAL NOW, REMOTE ON IDLE, like every document (`DocSync.swift`'s reducer).
//   The book is not a document a tool opens and closes, so it has a small
//   machine of its own: on the first look (`resume`), the instance is asked
//   whether the book moved — a clean copy takes the server's, a dirty one
//   MERGES (`mergeBooks`) and pushes; a 412 on a push is merged the same way
//   and pushed again, once. A list of names always merges, so no conflict is
//   ever handed to a person — never shown.
// - A book the instance no longer holds (another device took it home) stays
//   here, kept on this device.
// - Moving the book is always the person's gesture (`keepOn`): Atelier never
//   writes to an instance on its own. Onto an instance that already holds this
//   account's book, the two are merged onto that row; back to this device, the
//   copy there is deleted first, refused while it cannot be reached.

import Foundation
import Observation
import AtelierKit

@MainActor
@Observable
final class PresetBookStore {
    private(set) var book: PresetBook
    /// The book's sync record while it is kept on an instance; nil here.
    private(set) var record: SyncRecord?
    /// A move to another source is under way.
    private(set) var moving = false

    private let url: URL
    @ObservationIgnored private let recordURL: URL
    @ObservationIgnored private var pending: Task<Void, Never>?
    @ObservationIgnored private var pushTimer: Task<Void, Never>?
    @ObservationIgnored private var pushing = false
    @ObservationIgnored private var resumed = false
    /// The app's connections — nil for a store that never talks to an
    /// instance (a preview, a spec on a temporary folder).
    @ObservationIgnored private weak var connections: ConnectionStore?

    init(root: URL? = nil, connections: ConnectionStore? = nil) {
        let folder = root ?? RollStore.defaultRoot()
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent("presets.json")
        url = file
        recordURL = folder.appendingPathComponent("presets.sync.json")
        let stored = (try? Data(contentsOf: file)).flatMap { JSONValue.parse($0) }
        let read = readPresetBook(stored) ?? createPresetBook(newRollId())
        book = read
        // The app's book talks to the app's instances; a store over a folder
        // of its own talks to nobody unless it is handed some.
        self.connections = connections ?? (root == nil ? ConnectionStore.shared : nil)
        if isRemoteSource(read.sourceId) {
            record = (try? Data(contentsOf: recordURL)).flatMap { readSyncRecord(JSONValue.parse($0)) }
        }
    }

    var presets: [DevelopPreset] { book.presets }

    /// Where the book is kept, as a sentence names it: "on this device", "on winnow.example".
    var keptOn: String {
        isRemoteSource(book.sourceId) ? "on \(book.sourceId)" : "on this device"
    }

    /// The sources that can keep the book — this device, and every connected
    /// instance whose bucket keeps `presets`.
    var sources: [SourceInfo] {
        connections?.documentSources(for: presetBookKind) ?? [localSource]
    }

    /// How the book stands against its instance, in the pill's words; nil here.
    func status(now: Double = nowMillis()) -> String? {
        guard let record, isRemoteSource(book.sourceId) else { return nil }
        return pillText(record, sourceLabel: book.sourceId, now: now)
    }

    /// The instance the book is kept on, ready to talk to — or nil.
    private var remote: RemoteSource? {
        connections?.remote(for: book.sourceId, kind: presetBookKind)
    }

    // MARK: - the list

    /// Save the numbers under `name` — the list rules are the kernel's; a look
    /// (a `SavedGrade` as written) rides with the light when given. Returns
    /// false when nothing was saved (a blank name, an as-shot develop with no look).
    @discardableResult
    func save(name: String, settings: DevelopSettings?, look: JSONValue? = nil) -> Bool {
        let next = savePresetInBook(book, name, settings, newRollId(), look: look)
        if next == book { return false }
        commit(next)
        return true
    }

    func remove(_ id: String) {
        let next = removePresetFromBook(book, id)
        if next == book { return }
        commit(next)
    }

    /// Who signs a delivered picture — read by the export, written to the book,
    /// and so to every device that finds it.
    func setIdentity(_ identity: DeliveryIdentity) {
        let next = withIdentity(book, identity)
        if next == book { return }
        commit(next)
    }

    // MARK: - here

    /// The book written here, and marked dirty for its instance when it is kept on one.
    private func commit(_ next: PresetBook) {
        book = next
        persist()
        guard isRemoteSource(next.sourceId) else { return }
        let now = nowMillis()
        let rec = record?.id == next.id ? record : nil
        setRecord(reduceSync(rec ?? newSyncRecord(id: next.id, sourceId: next.sourceId, now: now), .edited(now: now)))
        schedulePush()
    }

    private func persist() {
        pending?.cancel()
        let text = book.json.serialized(pretty: true)
        let target = url
        pending = Task { [weak self] in
            try? await Task.sleep(nanoseconds: RollStore.saveDebounceNanos)
            guard !Task.isCancelled else { return }
            try? text.write(to: target, atomically: true, encoding: .utf8)
            self?.pending = nil
        }
    }

    /// Write now — the app is going to the background — and push what is owed.
    func flush() {
        if let task = pending {
            task.cancel()
            pending = nil
            try? book.json.serialized(pretty: true).write(to: url, atomically: true, encoding: .utf8)
        }
        if record?.dirtyAt != nil { Task { await pushBook(force: true) } }
    }

    /// The one writer of the record: memory and the sidecar together.
    private func setRecord(_ next: SyncRecord?) {
        record = next
        if let next {
            try? next.json.serialized(pretty: true).write(to: recordURL, atomically: true, encoding: .utf8)
        } else {
            try? FileManager.default.removeItem(at: recordURL)
        }
    }

    // MARK: - there

    private func schedulePush() {
        pushTimer?.cancel()
        let delay = UInt64((remoteIdleMs + 50) * 1_000_000)
        pushTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: delay)
            guard !Task.isCancelled else { return }
            await self?.pushBook(force: false)
        }
    }

    /// The first look at the book: ask its instance whether it moved. Asked
    /// once per launch, never at launch — the first screen that reads the
    /// book asks.
    func resume() async {
        guard !resumed else { return }
        resumed = true
        guard isRemoteSource(book.sourceId) else { return }
        let rec = record ?? newSyncRecord(id: book.id, sourceId: book.sourceId, now: nowMillis())
        setRecord(rec)
        guard let remote else { return }
        let pulled = await pullBook(remote, book.id, rec.etag)
        switch pulled {
        case .current:
            if rec.dirtyAt != nil { await pushBook(force: true) }
        case .fetched(let doc, let etag, _):
            if rec.dirtyAt == nil {
                book = doc
                persist()
                setRecord(reduceSync(rec, .pulled(etag: etag, now: nowMillis())))
            } else {
                mergeFrom(doc, etag)
                await pushBook(force: true)
            }
        case .failed(let kind, let message, let theirs):
            if kind == .notfound {
                keepHere()
            } else if let live = record {
                setRecord(reduceSync(live, .pushFailed(kind: kind, message: message, theirs: theirs)))
            }
        }
    }

    /// Push the book when it is due. A 412 is merged and pushed again, once —
    /// and a record left in `conflict` is healed the same way on the next
    /// trigger: a list of names always merges.
    func pushBook(force: Bool) async {
        guard !pushing, let start = record, let remote else { return }
        var merge = start.status == .conflict
        if !merge && !shouldFlush(start, now: nowMillis(), idleMs: force ? 0 : remoteIdleMs) { return }
        pushing = true
        defer {
            pushing = false
            // An edit that landed while the push was out is still owed a push.
            if record?.status == .dirty { schedulePush() }
        }
        for attempt in 0..<2 {
            if merge {
                let pulled = await pullBook(remote, book.id, nil)
                switch pulled {
                case .failed(let kind, let message, let theirs):
                    if kind == .notfound {
                        keepHere()
                    } else if let live = record {
                        setRecord(reduceSync(live, .pushFailed(kind: kind, message: message, theirs: theirs)))
                    }
                    return
                case .fetched(let doc, let etag, _):
                    mergeFrom(doc, etag)
                case .current:
                    break
                }
            }
            guard let live = record, book.sourceId == remote.sourceId else { return }
            setRecord(reduceSync(live, .pushStarted(now: nowMillis())))
            let outcome = await pushBookOnce(remote, book, live.etag)
            if case .failed(let failure) = outcome, failure.kind == .conflict, attempt == 0 {
                merge = true
                continue
            }
            if let after = record { setRecord(reduceSync(after, outcomeEvent(outcome, now: nowMillis()))) }
            return
        }
    }

    /// The server's copy merged under ours, kept here, owed a push over its etag.
    private func mergeFrom(_ server: PresetBook, _ etag: String) {
        let merged = mergeBooks(book, server)
        book = merged
        persist()
        let now = nowMillis()
        var base = reduceSync(record ?? newSyncRecord(id: merged.id, sourceId: merged.sourceId, now: now),
                              .pulled(etag: etag, now: now))
        base.id = merged.id
        setRecord(reduceSync(base, .edited(now: now)))
    }

    /// The instance no longer holds the book — another device took it home.
    /// This device keeps its copy, here, and says so by where it is kept.
    private func keepHere() {
        var next = book
        next.sourceId = defaultSourceId
        next.updatedAt = nowMillis()
        book = next
        persist()
        setRecord(nil)
    }

    /// Keep the book on another source — the person's gesture. A sentence
    /// when it could not, nil when done.
    func keepOn(_ target: String) async -> String? {
        guard target != book.sourceId else { return nil }
        if pushing { return "Your presets are being saved — try again in a moment." }
        pushTimer?.cancel()
        let origin: RemoteSource? = isRemoteSource(book.sourceId) ? remote : nil
        if isRemoteSource(book.sourceId) && origin == nil {
            return "Connect \(book.sourceId) to move your presets away from it."
        }
        moving = true
        defer { moving = false }
        var next: PresetBook
        var nextRecord: SyncRecord?
        if isRemoteSource(target) {
            guard let there = connections?.remote(for: target, kind: presetBookKind) else {
                return "\(target) cannot keep presets."
            }
            var existing: (book: PresetBook, etag: String)?
            do {
                existing = try await listRemoteBooks(there).first
            } catch {
                return "Could not reach \(there.label): \(deviceWords(failureOf(error).message))"
            }
            var moved = book
            moved.sourceId = target
            next = existing.map { mergeBooks(moved, $0.book) } ?? moved
            let outcome = await pushBookOnce(there, next, existing?.etag)
            switch outcome {
            case .failed(let failure):
                return "Could not save your presets to \(there.label): \(deviceWords(failure.message))"
            case .ok(let etag):
                let now = nowMillis()
                nextRecord = reduceSync(newSyncRecord(id: next.id, sourceId: target, now: now), .pushOk(etag: etag, now: now))
            }
        } else {
            next = book
            next.sourceId = defaultSourceId
            next.updatedAt = nowMillis()
        }
        if let origin {
            do {
                try await origin.client.deleteDoc(docsApp, book.id, ifMatch: record?.etag)
            } catch {
                let failure = failureOf(error)
                if failure.kind != .notfound {
                    return "Could not remove your presets from \(origin.label) (\(deviceWords(failure.message))) — nothing moved here."
                }
            }
        }
        book = next
        persist()
        setRecord(nextRecord)
        return nil
    }

    // MARK: - the wire (`preset-book-remote.ts`)

    /// The server's copy unless ours is still it. Never throws.
    private func pullBook(_ remote: RemoteSource, _ id: String, _ ifNoneMatch: String?) async -> PullOutcome<PresetBook> {
        do {
            let result = try await remote.client.getDoc(docsApp, id, ifNoneMatch: ifNoneMatch)
            guard case .row(let row) = result else { return .current }
            let doc = try bookFromWire(row.doc, id, remote.sourceId)
            return .fetched(doc: doc, etag: row.etag, updatedAt: row.updatedAt)
        } catch let error as WireDocError {
            return .failed(kind: .protocol, message: error.message, theirs: nil)
        } catch {
            let failure = failureOf(error)
            return .failed(kind: failure.kind, message: failure.message, theirs: failure.theirs)
        }
    }

    /// One guarded PUT. Never throws.
    private func pushBookOnce(_ remote: RemoteSource, _ book: PresetBook, _ etag: String?) async -> PushOutcome {
        await putDocOnce(remote, kind: presetBookKind, id: book.id, version: book.version, wireDoc: bookToWire(book), etag: etag)
    }

    /// The books this account keeps there, newest first — how a second device
    /// finds the book the first one put there. A row that is not a book is skipped.
    private func listRemoteBooks(_ remote: RemoteSource) async throws -> [(book: PresetBook, etag: String)] {
        let rows = try await remote.client.listDocs(docsApp, presetBookKind)
        let sorted = rows.sorted { $0.updatedAt > $1.updatedAt }
        return sorted.compactMap { row -> (book: PresetBook, etag: String)? in
            guard let book = try? bookFromWire(row.doc, row.id, remote.sourceId) else { return nil }
            return (book: book, etag: row.etag)
        }
    }
}
