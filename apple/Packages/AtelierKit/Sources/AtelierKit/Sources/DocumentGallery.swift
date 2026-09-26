// What every document gallery shares — the Studio's projects, Trips' trips and
// the Develop tool's rolls. Port of `src/shared/sources/document-gallery.ts`:
// which sources can hold a kind of document, what an instance's list looked
// like when it was last asked, and the groups a gallery draws, one per source,
// merging the mirrors here with what exists only there.
//
// The web reads the source list and the connection store from module state;
// here both are arguments — the `SourceRegistry` the app mirrors its
// connections into, and a lookup of a connection's capabilities sheet. The
// list-fetching, busy map and verbs are the app's (the web's React half,
// `use-document-gallery.ts`).

import Foundation

/// One document as an instance lists it.
public struct RemoteDocRow<D> {
    public var doc: D
    public var etag: String
    public var updatedAt: String

    public init(doc: D, etag: String, updatedAt: String) { self.doc = doc; self.etag = etag; self.updatedAt = updatedAt }
}

extension RemoteDocRow: Equatable where D: Equatable {}
extension RemoteDocRow: Sendable where D: Sendable {}

/// What this device knows about one instance's list of documents.
public enum RemoteList<Row> {
    case loading
    case ok(rows: [Row])
    case failed(text: String, login: String?)

    /// The web's `status` word — `loading` · `ok` · `failed`.
    public var status: String {
        switch self {
        case .loading: return "loading"
        case .ok: return "ok"
        case .failed: return "failed"
        }
    }
}

extension RemoteList: Equatable where Row: Equatable {}
extension RemoteList: Sendable where Row: Sendable {}

/// A source as a sentence names it: "this browser", or the instance's label —
/// its id when this session does not know it.
public func sourceLabel(_ id: String, registry: SourceRegistry = SourceRegistry()) -> String {
    id == defaultSourceId ? "this browser" : (registry.sourceById(id)?.label ?? id)
}

/// The sources that can HOLD documents of `kind`: this device, plus every
/// connected instance whose bucket keeps that kind (`bucketHolds`) — an
/// instance that only knows trips and projects is not offered for a roll.
/// `capabilities` looks up a connection's stored sheet by source id.
public func documentSourcesFor(_ kind: String, registry: SourceRegistry,
                               capabilities: (String) -> WinnowCapabilities?) -> [SourceInfo] {
    registry.listSources().filter { s in
        s.capabilities.documents && (s.id == defaultSourceId || bucketHolds(capabilities(s.id), kind))
    }
}

/// A connected instance that draws NO group at all, because its stored
/// capabilities sheet says it cannot keep this kind of document.
public struct AbsentSource: Equatable, Sendable {
    public var sourceId: String
    /// One line, or nil while there is nothing honest to say yet.
    public var text: String?

    public init(sourceId: String, text: String?) { self.sourceId = sourceId; self.text = text }
}

/// What re-asking an instance for its capabilities came to.
public enum CapabilityProbe: Equatable, Sendable {
    /// Asked, and the fresh sheet was read.
    case read
    /// Asked, and it would not answer.
    case refused(problem: String)
}

/// The connected instances `documentSourcesFor(kind)` leaves out, and what a
/// gallery may say about each. Leaving them out is right — a PUT of a `roll`
/// to a bucket that keeps trips and projects answers 400 — but doing it
/// SILENTLY cost the maintainer a roll that existed on one machine only. So
/// an absence speaks, and only once it is worth believing: nothing while the
/// sheet is merely old and being re-asked; the instance's own version once a
/// fresh sheet still lacks the kind; and "could not be asked" when it would
/// not answer — a sheet nobody could refresh is not evidence of anything.
public func absentSources(_ connections: [String], _ presentSourceIds: [String], _ noun: String,
                          _ probes: [String: CapabilityProbe]) -> [AbsentSource] {
    let present = Set(presentSourceIds)
    return connections.filter { !present.contains($0) }.map { id in
        switch probes[id] {
        case nil:
            return AbsentSource(sourceId: id, text: nil)
        case .read?:
            return AbsentSource(sourceId: id,
                                text: "\(id) does not keep \(noun)s — asked again just now, so this is its own version and not a stale answer here.")
        case .refused(let problem)?:
            return AbsentSource(sourceId: id, text: "\(id) could not be asked what it keeps: \(problem)")
        }
    }
}

public struct DocumentGroup<D> {
    public var id: String
    /// The documents mirrored on this device.
    public var items: [D]
    /// The instance's list as last asked; nil for this device.
    public var list: RemoteList<RemoteDocRow<D>>?
    /// What exists only there: listed by the instance, not mirrored here.
    public var remoteOnly: [RemoteDocRow<D>]

    public init(id: String, items: [D], list: RemoteList<RemoteDocRow<D>>?, remoteOnly: [RemoteDocRow<D>]) {
        self.id = id; self.items = items; self.list = list; self.remoteOnly = remoteOnly
    }
}

extension DocumentGroup: Equatable where D: Equatable {}

/// One group per source: the local ones from `groupBySource`, plus every
/// connected instance with a bucket even when nothing of it is mirrored yet,
/// so its header can say "checking…" or why it could not answer. A document
/// the instance lists and this device mirrors is one card, never two. `id` and
/// `sourceId` read a document's own fields (a kernel document is not an object
/// with those keys by shape).
public func groupDocuments<D>(_ docs: [D], id: (D) -> String, sourceId: (D) -> String?, remoteSourceIds: [String],
                              remoteLists: [String: RemoteList<RemoteDocRow<D>>]) -> [DocumentGroup<D>] {
    var base = groupBySource(docs, sourceId: sourceId)
    let seen = Set(base.map(\.id))
    for remote in remoteSourceIds where !seen.contains(remote) {
        base.append(SourceGroup(id: remote, items: []))
    }
    return base.map { g in
        let list = remoteLists[g.id]
        let mirrored = Set(g.items.map(id))
        var remoteOnly: [RemoteDocRow<D>] = []
        if case .ok(let rows)? = list { remoteOnly = rows.filter { !mirrored.contains(id($0.doc)) } }
        return DocumentGroup(id: g.id, items: g.items, list: list, remoteOnly: remoteOnly)
    }
}
