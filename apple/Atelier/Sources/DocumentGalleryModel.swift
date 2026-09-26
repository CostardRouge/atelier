// The half of a document gallery the three tools share — the native twin of
// the web's `use-document-gallery.ts` (D2 of `docs/develop-tool.md`): the
// mirrors on this device beside every instance's list, the groups a gallery
// draws (one per source, `groupDocuments`), the instances it leaves out and
// what it may say about each (`absentSources`), and the verbs that cross a
// source — create THERE first, delete there with the revision held, move,
// fetch-then-open.
//
// Rules kept (`architecture.md`, `roadtrip.md` «The mirror's bookkeeping»):
// - A new document on an instance is written THERE first; nothing is kept
//   here if the instance refused, and the sentence says so.
// - A delete of a kept document is refused while the instance cannot be
//   reached — no tombstones; a row already gone there is exactly what remains
//   to delete here.
// - A gallery re-asks an instance's capabilities ONLY where the stored sheet
//   is what leaves it out — a healthy gallery makes no request at all — and
//   an absence SPEAKS once the answer is worth believing.

import Foundation
import Observation
import AtelierKit

@MainActor
@Observable
final class DocumentGalleryModel<D: StoredDocument> {
    /// The mirrors on this device, newest first; nil until read.
    private(set) var docs: [D]?
    /// Each instance's list, as last asked.
    private(set) var remoteLists: [String: RemoteList<RemoteDocRow<D>>] = [:]
    /// What a card is doing right now, by document id ("deleting on …").
    private(set) var busy: [String: String] = [:]
    /// The last refusal, in a sentence; nil when there is none.
    var notice: String?

    @ObservationIgnored let store: DocumentStore<D>
    @ObservationIgnored let connections: ConnectionStore
    @ObservationIgnored var clock: () -> Double = nowMillis

    init(store: DocumentStore<D> = DocumentStore(), connections: ConnectionStore) {
        self.store = store
        self.connections = connections
    }

    /// The sources that can hold this kind — the create and import pickers.
    var documentSources: [SourceInfo] { connections.documentSources(for: D.bucketKind) }

    var remoteSourceIds: [String] { documentSources.map(\.id).filter(isRemoteSource) }

    var groups: [DocumentGroup<D>] {
        guard let docs else { return [] }
        return groupDocuments(docs, id: { $0.id }, sourceId: { $0.sourceId }, remoteSourceIds: remoteSourceIds,
                              remoteLists: remoteLists)
    }

    /// Connected instances that draw no group, each with its line or nil.
    var absent: [AbsentSource] { connections.absences(for: D.bucketKind, noun: D.noun) }

    /// Nothing here and nothing there.
    var nothingAnywhere: Bool {
        docs != nil && groups.allSatisfy { $0.items.isEmpty && $0.remoteOnly.isEmpty }
    }

    /// Every instance has answered with its list.
    var allListed: Bool {
        remoteSourceIds.allSatisfy { if case .ok? = remoteLists[$0] { return true } else { return false } }
    }

    private func setBusy(_ id: String, _ text: String?) {
        busy[id] = text
    }

    /// Re-read the mirrors and re-ask every instance; then, for an instance
    /// the stored sheet leaves out, ask it once what it keeps today.
    func refresh() async {
        docs = store.list()
        await withTaskGroup(of: Void.self) { group in
            for id in remoteSourceIds {
                guard let remote = connections.remote(for: id, kind: D.bucketKind) else { continue }
                remoteLists[id] = .loading
                group.addTask {
                    let listed: RemoteList<RemoteDocRow<D>>
                    do {
                        listed = .ok(rows: try await DocumentRemote<D>.list(remote))
                    } catch {
                        let said = explainFailure(failureOf(error), remote)
                        listed = .failed(text: deviceWords(said.text), login: said.login)
                    }
                    await self.setList(id, listed)
                }
            }
        }
        let before = Set(remoteSourceIds)
        await connections.probeHidden(kind: D.bucketKind)
        // A sheet the probe replaced may have brought an instance in: list it.
        if Set(remoteSourceIds) != before { await refresh() }
    }

    private func setList(_ id: String, _ list: RemoteList<RemoteDocRow<D>>) {
        remoteLists[id] = list
    }

    /// Write a new document where it is KEPT first — one gesture, one request,
    /// the result said. `verb` ends the sentence: "nothing was created".
    func createOn(_ doc: D, verb: String) async -> Bool {
        if !isRemoteSource(doc.sourceId) {
            store.put(doc)
            docs = store.list()
            return true
        }
        guard let remote = connections.remote(for: doc.sourceId, kind: D.bucketKind) else {
            notice = "\(doc.sourceId) is not connected — nothing was \(verb)."
            return false
        }
        let rec = await DocumentRemote<D>.pushNew(remote, doc, nil, store: store, now: clock(), clock: clock)
        if rec.status != .synced {
            store.deleteSyncRecord(doc.id)
            let why = rec.error.map { ": \($0)" } ?? ""
            notice = "Could not save to \(remote.label)\(why) — nothing was \(verb)."
            return false
        }
        store.put(doc)
        docs = store.list()
        return true
    }

    /// Delete here and there; refused while the instance cannot be reached.
    func remove(_ doc: D, etagHint: String? = nil) async -> Bool {
        notice = nil
        if isRemoteSource(doc.sourceId) {
            guard let remote = connections.remote(for: doc.sourceId, kind: D.bucketKind) else {
                notice = "Connect \(doc.sourceId) to delete this \(D.noun) — it is kept there."
                return false
            }
            setBusy(doc.id, "deleting on \(remote.label)…")
            let etag = etagHint ?? store.getSyncRecord(doc.id)?.etag
            do {
                try await DocumentRemote<D>.deleteRemote(remote, doc.id, etag)
            } catch {
                let failure = failureOf(error)
                // Already gone there: deleting the mirror is exactly what remains.
                if failure.kind != .notfound {
                    setBusy(doc.id, nil)
                    let said = explainFailure(failure, remote)
                    notice = failure.kind == .unreachable
                        ? "Connect to \(remote.label) to delete this \(D.noun) — it is kept there."
                        : "Could not delete on \(remote.label): \(deviceWords(said.text))"
                    return false
                }
            }
        }
        store.delete(doc.id)
        setBusy(doc.id, nil)
        await refresh()
        return true
    }

    func moveTo(_ doc: D, _ targetSourceId: String) async {
        notice = nil
        setBusy(doc.id, "moving to \(connections.label(targetSourceId))…")
        let outcome = await DocumentRemote<D>.move(doc, to: targetSourceId, store: store,
                                                    remoteFor: { self.connections.remote(for: $0, kind: D.bucketKind) },
                                                    now: clock(), clock: clock)
        setBusy(doc.id, nil)
        if case .failed(let error) = outcome { notice = error }
        await refresh()
    }

    /// A document only there: mirror it, then hand it back to open.
    func mirrorRemote(_ row: RemoteDocRow<D>) -> D {
        notice = nil
        DocumentRemote<D>.mirror(row.doc.sourceId, row.doc, row.etag, store: store, now: clock())
        docs = store.list()
        return row.doc
    }
}
