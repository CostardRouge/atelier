// Rolls KEPT ON A WINNOW — the Develop tool's side of the suite's document
// plumbing (`Sources/DocumentStore.swift`, `DocumentSync.swift`,
// `DocumentGalleryModel.swift`), the native twin of the web's
// `RollGallery.tsx` + `DevelopTool.tsx` over `use-document-gallery.ts`,
// `use-document-sync.tsx` and `roll-remote.ts`.
//
// `RollStore` stays what the editor reads and writes — the rolls in memory,
// written through with the web's 800 ms debounce, their locators, marks and
// thumbnails beside them. This class is the BRIDGE between it and the shared
// machinery, over the same files (`rolls/<id>.json`, plus the sync sidecar
// `<id>.sync.json` the web keeps in its `sync` store):
//
// - **The gallery** lists this device's rolls (from `RollStore`'s memory,
//   which may hold an edit the debounce has not written yet) beside every
//   connected instance's list, one group per source even with one source; a
//   roll only there is a greyed card that MIRRORS on open. A new or imported
//   roll kept on an instance is written THERE first — nothing is kept here if
//   it refused, and the sentence says so; a delete there is refused while the
//   instance cannot be reached; a move writes the target first and deletes
//   the origin's copy after. A move goes through the portable file, like the
//   web's `moveRoll`, so the pictures get fresh ids — and what this device
//   keeps under a picture's id (its locator, its mark, its thumbnail) follows.
// - **The open roll** is LOCAL NOW, REMOTE ON IDLE: every write `RollStore`
//   lands marks it dirty (`onWritten` → `edited`), the push follows after the
//   idle delay, on leaving, when the app leaves the foreground, and on the
//   pill's "Save now"; opening asks the instance whether the roll moved
//   (`resume`), and a clean mirror takes a newer copy silently. Every copy
//   replaced UNDER the editor (the instance's, or kept as local) restarts its
//   history (`RollEditor.restart`), as the web's `replaceOpen` does.
// - A roll that is NOT open and gets written (an export's marks never do; a
//   Library verb might) goes dirty on disk, its revision kept, and is pushed
//   when it is next opened — the Studio's rule for an owed save.

import Foundation
import Observation
import AtelierKit

@MainActor
@Observable
final class RollDocuments {
    @ObservationIgnored let rolls: RollStore
    @ObservationIgnored let connections: ConnectionStore
    @ObservationIgnored let documents: DocumentStore<RollDoc>
    let gallery: DocumentGalleryModel<RollDoc>
    let sync: DocumentSync<RollDoc>

    /// The roll open in the editor, or nil.
    private(set) var openId: String?
    /// The roll being opened right now — its card says so.
    private(set) var opening: String?
    /// The open roll was deleted under the editor (the pill's "Delete here").
    private(set) var closedByDelete = false
    /// The editor of the open roll, told when the roll is replaced under it.
    @ObservationIgnored weak var editor: RollEditor?

    init(rolls: RollStore, connections: ConnectionStore) {
        self.rolls = rolls
        self.connections = connections
        let store = DocumentStore<RollDoc>(root: rolls.rootDirectory)
        documents = store
        gallery = DocumentGalleryModel(store: store, connections: connections)
        sync = DocumentSync(store: store, connections: connections)
        sync.current = { [weak self] in
            guard let self, let id = self.openId else { return nil }
            return self.rolls.roll(id)
        }
        sync.beforeFlush = { [weak self] in self?.rolls.flush() }
        sync.onDiscardPending = { [weak self] in
            guard let self, let id = self.openId else { return }
            self.rolls.discardPending(id)
        }
        sync.onReplace = { [weak self] doc in self?.replaced(doc) }
        sync.onDeleted = { [weak self] in self?.deletedUnderEditor() }
        rolls.onWritten = { [weak self] doc in self?.written(doc) }
    }

    // MARK: - the gallery

    /// The sources that can keep a roll — the new-roll and import pickers.
    var documentSources: [SourceInfo] { gallery.documentSources }

    /// Connected instances that draw no group, each with its line once worth saying.
    var absent: [AbsentSource] { gallery.absent }

    /// One group per source: this device's rolls from memory, each instance's
    /// list as last asked, a roll only there as `remoteOnly`.
    var groups: [AtelierKit.DocumentGroup<RollDoc>] {
        groupDocuments(rolls.rolls, id: { $0.id }, sourceId: { $0.sourceId },
                       remoteSourceIds: gallery.remoteSourceIds, remoteLists: gallery.remoteLists)
    }

    /// Nothing here, and every instance answered with nothing.
    var nothingAnywhere: Bool {
        groups.allSatisfy { $0.items.isEmpty && $0.remoteOnly.isEmpty } && gallery.allListed
    }

    /// Re-ask every instance's list (and, where the stored sheet leaves one
    /// out, what it keeps today). The mirrors are `RollStore`'s.
    func refresh() async {
        rolls.flush()
        await gallery.refresh()
    }

    /// A sentence while a card is busy — opening, deleting there, moving.
    func busyLine(_ id: String) -> String? {
        if opening == id { return "opening…" }
        return gallery.busy[id]
    }

    /// A new roll, kept where it was asked — on an instance, written THERE
    /// first. `ticked` are the Library's pictures it starts with. The roll,
    /// or nil when the instance refused (`gallery.notice` says why).
    func create(name: String, sourceId: String, ticked: [DroppedAsset]) async -> RollDoc? {
        gallery.notice = nil
        let target = documentSources.contains { $0.id == sourceId } ? sourceId : defaultSourceId
        var doc = createRollDoc(name: name, sourceId: target)
        var located: [(id: String, dropped: DroppedAsset)] = []
        for dropped in ticked {
            guard classifyPart(dropped.ref.name) == .image,
                  !doc.pictures.contains(where: { sameMediaRef($0.ref, dropped.ref) }) else { continue }
            let id = newRollId()
            doc = addPictures(doc, [dropped.ref]) { id }
            located.append((id, dropped))
        }
        if isRemoteSource(target) {
            guard await gallery.createOn(doc, verb: "created") else { return nil }
            rolls.adopt(doc)
        } else {
            rolls.insert(doc)
        }
        for item in located { rolls.locate(item.dropped, rollId: doc.id, pictureId: item.id) }
        return doc
    }

    /// A `.roll.json` becomes a NEW roll kept on `sourceId` — written there
    /// first when it is an instance. Nil when it was refused (said).
    func importRoll(text: String, to sourceId: String) async -> RollDoc? {
        gallery.notice = nil
        let target = documentSources.contains { $0.id == sourceId } ? sourceId : defaultSourceId
        if !isRemoteSource(target) {
            switch rolls.importRoll(text: text) {
            case .failure(let error):
                gallery.notice = error.message
                return nil
            case .success(let doc):
                return doc
            }
        }
        let file: RollFile
        switch readRollFile(text) {
        case .failure(let error):
            gallery.notice = error.message
            return nil
        case .success(let read):
            file = read
        }
        let doc = rollDocFromFile(file, sourceId: target)
        guard await gallery.createOn(doc, verb: "imported") else { return nil }
        rolls.adopt(doc)
        return doc
    }

    /// Delete here, and there when it is kept on an instance — refused while
    /// the instance cannot be reached.
    func remove(_ doc: RollDoc, etagHint: String? = nil) async {
        if isRemoteSource(doc.sourceId) {
            rolls.discardPending(doc.id)
            guard await gallery.remove(doc, etagHint: etagHint) else { return }
        } else {
            documents.deleteSyncRecord(doc.id)
        }
        if openId == doc.id { closeOpen() }
        rolls.delete(doc.id)
    }

    /// Keep a roll on another source. The target is written and acknowledged
    /// first; the origin's copy goes after, so a failure moves nothing.
    func move(_ doc: RollDoc, to target: String) async {
        rolls.flush()
        let current = rolls.roll(doc.id) ?? doc
        await gallery.moveTo(current, target)
        guard let moved = documents.get(doc.id), moved.sourceId == target else { return }
        // Through the portable file: fresh picture ids, in the same order.
        var renamed: [String: String] = [:]
        for (old, new) in zip(current.pictures, moved.pictures) where old.id != new.id { renamed[old.id] = new.id }
        rolls.remapPictures(doc.id, renamed)
        rolls.adopt(moved)
        if openId == doc.id {
            sync.adopt(moved)
            editor?.restart(from: moved)
        }
    }

    /// A roll only there: mirrored here, then handed back to open.
    func mirror(_ row: RemoteDocRow<RollDoc>) -> RollDoc {
        let doc = gallery.mirrorRemote(row)
        rolls.adopt(doc)
        return doc
    }

    // MARK: - the open roll

    /// The editor opened `id`: ask its instance whether it moved. A clean
    /// mirror takes a newer copy silently; a dirty one is a conflict the pill
    /// says. Nothing is asked for a roll kept on this device.
    func opened(_ id: String, editor: RollEditor) async {
        closedByDelete = false
        self.editor = editor
        openId = id
        guard let doc = rolls.roll(id) else { return }
        guard isRemoteSource(doc.sourceId) else {
            sync.adopt(doc)
            return
        }
        opening = id
        defer { if opening == id { opening = nil } }
        guard let resumed = await sync.resume(doc), openId == id else { return }
        if resumed.replaced { replaced(resumed.doc) }
    }

    /// The editor went away: what is owed goes up, then the machine rests —
    /// unless another roll was opened meanwhile.
    func closed(_ id: String) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            await self.sync.flushAll()
            guard self.openId == id else { return }
            self.openId = nil
            self.editor = nil
            self.sync.clear()
        }
    }

    /// The pill's reading of the open roll's instance, for the editor's bar.
    var showsPill: Bool { sync.showsPill }

    // MARK: - what the store and the machine report

    /// A write landed on disk. The open roll goes dirty and is pushed after
    /// the idle delay; another roll kept on an instance goes dirty on disk,
    /// its revision kept, and is pushed when it is next opened.
    private func written(_ doc: RollDoc) {
        guard isRemoteSource(doc.sourceId) else { return }
        if doc.id == openId {
            sync.edited(doc)
        } else if let record = documents.getSyncRecord(doc.id) {
            documents.putSyncRecord(reduceSync(record, .edited(now: nowMillis())))
        }
    }

    /// The instance's copy, or the roll kept as local, replaced the open one.
    private func replaced(_ doc: RollDoc) {
        rolls.adopt(doc)
        editor?.restart(from: doc)
    }

    /// "Delete here": the mirror is gone (the machine deleted its files).
    private func deletedUnderEditor() {
        guard let id = openId else { return }
        closeOpen()
        rolls.delete(id)
        closedByDelete = true
    }

    private func closeOpen() {
        openId = nil
        editor = nil
        sync.clear()
    }
}
