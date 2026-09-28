// The trips this device keeps, and the ONE that is open — the native twin of
// the web's `RoadTripTool.tsx` document plumbing (its `handleChange` funnel,
// the 800 ms debounced `putTrip`, `useDocumentSync`, `useHistory`) and of the
// thumbs store beside it. The screens read and write a trip through here and
// nowhere else.
//
// Rules kept (`roadtrip.md`, `docs/roadtrip-persistence.md`):
// - LOCAL NOW, REMOTE ON IDLE: every change lands on screen at once, on disk
//   after 800 ms of quiet (the web's `SAVE_DEBOUNCE_MS`), and — for a trip
//   kept on an instance — marks its record dirty only once the local write
//   landed, so a push never carries a trip older than the screen
//   (`DocumentSync`'s `beforeFlush` flushes the debounce first).
// - A refused local write is SAID (`storageFailed`, the web's banner), never
//   swallowed; the edits stay on screen.
// - Undo is a stack of whole DOCUMENTS recorded by watching this one funnel
//   (the kernel's `History`), labelled by the screen the edit came from so a
//   gesture on one piece never merges with the trip-wide change after it; a
//   restore goes back out through the funnel, so it saves and marks the trip
//   dirty exactly as an edit does. The window's `UndoManager` carries the
//   same steps, so ⌘Z is native.
// - A document replaced UNDER the tool (take theirs, keep as local, a resume
//   that found a newer copy) is NOT an edit: the history starts again from it
//   and a write the debounce still holds is dropped.
// - Opening a trip keeps the copy in memory when it is as new as the listed
//   one — the gallery lists what the disk held, and the open trip may carry
//   edits the debounce has not written yet.
// - The hooks go with their posts: deleting a post or a trip deletes its
//   thumbnails, and `sweepThumbs` prunes what a delete made elsewhere left.

import CoreGraphics
import Foundation
import Observation
import AtelierKit

@MainActor
@Observable
final class TripsStore {
    /// The web's `SAVE_DEBOUNCE_MS`.
    static let saveDebounceNanos: UInt64 = 800_000_000

    /// The mirrors on this device, most recently updated first.
    private(set) var trips: [TripDoc] = []
    /// The trip open in the tool, with every edit on it — ahead of the disk
    /// by at most one debounce.
    private(set) var open: TripDoc?
    /// A local write was refused (the disk is full, the container is read-only).
    private(set) var storageFailed = false
    /// Bumped whenever a thumbnail is written or removed, so a row re-reads it.
    private(set) var thumbsVersion = 0
    /// The open trip's undo stack; nil while none is open.
    private(set) var history: HistoryState<TripDoc>?

    @ObservationIgnored let documents: DocumentStore<TripDoc>
    @ObservationIgnored let thumbs: TripThumbs
    /// The kernel's store over the same files, for its move and push drivers.
    @ObservationIgnored let disk: TripDiskStore
    /// The open trip's record and the instance's pill.
    let sync: DocumentSync<TripDoc>
    /// The window's, when a screen hands it over: ⌘Z walks the same steps.
    @ObservationIgnored weak var undoManager: UndoManager?
    /// Told when the trip is replaced under the tool or deleted, so a screen
    /// can leave a piece that no longer exists.
    @ObservationIgnored var onReplaced: ((TripDoc) -> Void)?
    @ObservationIgnored var onDeleted: (() -> Void)?

    @ObservationIgnored private var pending: TripDoc?
    @ObservationIgnored private var saveTask: Task<Void, Never>?

    init(root: URL = DocumentStore<TripDoc>.defaultRoot, connections: ConnectionStore) {
        documents = DocumentStore<TripDoc>(root: root)
        thumbs = TripThumbs(root: root)
        disk = TripDiskStore(root: root)
        sync = DocumentSync<TripDoc>(store: DocumentStore<TripDoc>(root: root), connections: connections)
        wireSync()
        reload()
    }

    /// A store over a sync machine of the caller's — previews and specs.
    init(root: URL, sync: DocumentSync<TripDoc>) {
        documents = DocumentStore<TripDoc>(root: root)
        thumbs = TripThumbs(root: root)
        disk = TripDiskStore(root: root)
        self.sync = sync
        wireSync()
        reload()
    }

    private func wireSync() {
        sync.current = { [weak self] in self?.open }
        sync.beforeFlush = { [weak self] in
            guard let self else { return }
            await self.flush()
        }
        sync.onDiscardPending = { [weak self] in self?.dropPending() }
        sync.onReplace = { [weak self] doc in self?.replaceOpen(doc) }
        sync.onDeleted = { [weak self] in self?.openWasDeleted() }
    }

    // MARK: - reading

    /// Re-read the mirrors from disk. The open trip keeps its in-memory copy.
    func reload() {
        var listed = documents.list()
        if let open, let i = listed.firstIndex(where: { $0.id == open.id }), listed[i].updatedAt <= open.updatedAt {
            listed[i] = open
        }
        trips = listed
    }

    func trip(_ id: String) -> TripDoc? {
        if let open, open.id == id { return open }
        return trips.first { $0.id == id }
    }

    // MARK: - opening

    /// Open a trip: the copy in memory when it is as new as `doc`, else `doc`;
    /// then, for a trip kept on an instance, ask whether it moved there
    /// (`DocumentSync.resume`) — a clean mirror is replaced silently.
    func openTrip(_ doc: TripDoc) async {
        let chosen: TripDoc
        if let open, open.id == doc.id, open.updatedAt >= doc.updatedAt {
            chosen = open
        } else {
            // The trip being left: what the debounce holds written, and pushed.
            if open != nil { await sync.flushAll() }
            chosen = doc
        }
        open = chosen
        history = newHistory(chosen)
        undoManager?.removeAllActions(withTarget: self)
        if let resumed = await sync.resume(chosen), resumed.replaced, open?.id == chosen.id {
            replaceOpen(resumed.doc)
        }
    }

    /// A trip the gallery just created (and, on an instance, pushed): open it
    /// with the record the push wrote.
    func adoptCreated(_ doc: TripDoc) {
        open = doc
        history = newHistory(doc)
        undoManager?.removeAllActions(withTarget: self)
        sync.adopt(doc)
        reload()
    }

    /// Leave the trip: what the debounce holds is written and pushed first.
    func close() async {
        await sync.flushAll()
        open = nil
        history = nil
        sync.clear()
        undoManager?.removeAllActions(withTarget: self)
        reload()
    }

    // MARK: - the ONE funnel

    /// Every edit of the open trip. `label` is the screen it came from
    /// (`trip`, `post:<id>`): two edits inside 700 ms under one label are one
    /// undo step. The same trip back is no write and no step.
    func change(_ doc: TripDoc, label: String = "trip") {
        guard let current = open, current.id == doc.id, doc != current else { return }
        write(doc)
        remember(doc, label: label)
    }

    /// One piece rewritten, the trip stamped — the web's `updatePost`.
    func updatePost(_ post: TripPost, now: Double = nowMillis()) {
        guard var doc = open, let i = doc.posts.firstIndex(where: { $0.id == post.id }) else { return }
        doc.posts[i] = post
        doc.updatedAt = now
        change(doc, label: "post:\(post.id)")
    }

    /// Delete one piece, and its hook with it.
    func deletePost(_ postId: String, now: Double = nowMillis()) {
        guard var doc = open, doc.posts.contains(where: { $0.id == postId }) else { return }
        doc.posts.removeAll { $0.id == postId }
        doc.updatedAt = now
        change(doc)
        thumbs.delete([postId])
        thumbsVersion += 1
    }

    /// The trip on screen now, on disk after the debounce.
    private func write(_ doc: TripDoc) {
        open = doc
        if let i = trips.firstIndex(where: { $0.id == doc.id }) { trips[i] = doc }
        pending = doc
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: TripsStore.saveDebounceNanos)
            guard !Task.isCancelled else { return }
            await self?.flush()
        }
    }

    /// Write what the debounce holds, now. For a trip kept on an instance the
    /// mirror moved: its record is dirty from here, pushed after the idle delay.
    func flush() async {
        saveTask?.cancel()
        saveTask = nil
        guard let doc = pending else { return }
        pending = nil
        let ok = documents.put(doc)
        storageFailed = !ok
        if ok { sync.edited(doc) }
    }

    private func dropPending() {
        pending = nil
        saveTask?.cancel()
        saveTask = nil
    }

    /// The document replaced UNDER the tool — not an edit: the history starts
    /// again from it and a held write is dropped rather than landing over it.
    func replaceOpen(_ doc: TripDoc) {
        dropPending()
        open = doc
        history = newHistory(doc)
        undoManager?.removeAllActions(withTarget: self)
        reload()
        onReplaced?(doc)
    }

    private func openWasDeleted() {
        let posts = open?.posts.map(\.id) ?? []
        dropPending()
        open = nil
        history = nil
        thumbs.delete(posts)
        thumbsVersion += 1
        reload()
        onDeleted?()
    }

    // MARK: - deleting a trip here

    /// A trip kept on this device, gone with its record and its hooks. A trip
    /// kept on an instance goes through the gallery (`DocumentGalleryModel.
    /// remove`), which deletes there first; `sweepThumbs` then prunes.
    func deleteLocal(_ id: String) {
        let posts = trip(id)?.posts.map(\.id) ?? []
        if open?.id == id {
            dropPending()
            open = nil
            history = nil
            sync.clear()
        }
        documents.delete(id)
        thumbs.delete(posts)
        thumbsVersion += 1
        reload()
    }

    /// Prune every thumbnail no stored trip's post names any more.
    func sweepThumbs() {
        var kept: Set<String> = []
        for doc in documents.list() { for post in doc.posts { kept.insert(post.id) } }
        if let open { for post in open.posts { kept.insert(post.id) } }
        thumbs.prune(keeping: kept)
        thumbsVersion += 1
    }

    // MARK: - the hooks' thumbnails

    /// Keep a post's hook, as drawn — `TripThumbs.jpeg(from:)` of the stage's
    /// own frame.
    func putThumb(_ postId: String, jpeg: Data) {
        if thumbs.put(postId, jpeg) { thumbsVersion += 1 }
    }

    /// Keep a post's hook from the frame the stage just drew — a picture of
    /// the BADGE, taken where it costs nothing extra.
    func keepThumb(_ postId: String, frame: CGImage) {
        guard let jpeg = TripThumbs.jpeg(from: frame) else { return }
        putThumb(postId, jpeg: jpeg)
    }

    func thumb(_ postId: String) -> Data? { thumbs.get(postId) }

    func thumbs(_ postIds: [String]) -> [String: Data] { thumbs.get(postIds) }

    // MARK: - undo and redo

    var canUndo: Bool { history.map { AtelierKit.canUndo($0) } ?? false }
    var canRedo: Bool { history.map { AtelierKit.canRedo($0) } ?? false }

    private func remember(_ doc: TripDoc, label: String) {
        guard let current = history else {
            history = newHistory(doc)
            return
        }
        let now = nowMillis()
        // The kernel's merge rule, read before it runs: a merged step is no
        // new action on the window.
        let merges = label == current.label && now - current.at <= coalesceMs
        history = AtelierKit.record(current, doc, RecordOptions(now: now, label: label))
        if !merges { registerUndoStep() }
    }

    /// Close the current step — a gesture ended, a sheet closed.
    func sealHistory() {
        if let current = history { history = AtelierKit.seal(current) }
    }

    func undo() {
        if let manager = undoManager, manager.canUndo {
            manager.undo()
        } else {
            performUndo()
        }
    }

    func redo() {
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
        guard let current = history, AtelierKit.canUndo(current) else { return }
        let stepped = AtelierKit.undo(current)
        history = stepped
        write(stepped.present)
        if let manager = undoManager, manager.isUndoing {
            manager.registerUndo(withTarget: self) { target in
                MainActor.assumeIsolated { target.performRedo() }
            }
        }
    }

    func performRedo() {
        guard let current = history, AtelierKit.canRedo(current) else { return }
        let stepped = AtelierKit.redo(current)
        history = stepped
        write(stepped.present)
        if let manager = undoManager, manager.isRedoing {
            manager.registerUndo(withTarget: self) { target in
                MainActor.assumeIsolated { target.performUndo() }
            }
        }
    }
}
