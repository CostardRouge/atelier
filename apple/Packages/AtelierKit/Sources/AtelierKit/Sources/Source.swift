// The source model — where projects, state and (later) scheduled work live.
// Port of `src/shared/sources/source.ts`.
//
// A source is NOT a media pool. `local` is source #1 — on the web this
// browser, its File System Access layer and its IndexedDB stores; here the
// app's own container — and a Winnow instance is its PEER, never its
// replacement (`docs/winnow-bridge.md` §3). The invariants this file holds
// (bridge §3.2, `architecture.md` «The source seam»):
//
// - A document belongs to EXACTLY ONE source, and its media live in that same
//   source. Crossing sources is an explicit export/import through the portable
//   files — never a merge. That limit is what removes sync and merge entirely.
// - A source id is never the only identity: a document must stay openable
//   with plain local files, which is what the content hash guarantees.
// - A source that cannot be reached (or is simply not registered here) still
//   shows its documents, greyed with the reason — never hidden.
//
// The web keeps the remote list as module state (`setRemoteSources` mirrored
// in by `winnow/store.ts`, `listSources()` reading nothing). A kernel has no
// module state: the list is a VALUE, `SourceRegistry`, that the app owns and
// mirrors its connections into — the same three verbs, the same order (local
// first, then what was connected). The media/document adapters behind a remote
// source are deliberately not typed here, as on the web: an interface nothing
// implements would only be a guess.

import Foundation

/// What a source can do — mirrored on the wire by a Winnow instance's
/// `/api/capabilities` (bridge §3.5). `local` answers honestly: it holds media
/// and documents, and a browser tab cannot run reminders, so `scheduling` is
/// false rather than a button that would not work. A UI reads these rather
/// than offering a verb that cannot work.
public struct SourceCapabilities: Equatable, Sendable {
    /// Can list media and hand over bytes.
    public var media: Bool
    /// Can persist project/trip/roll documents.
    public var documents: Bool
    /// Can run scheduled work and notify — later, and never in a browser tab.
    public var scheduling: Bool

    public init(media: Bool, documents: Bool, scheduling: Bool) {
        self.media = media; self.documents = documents; self.scheduling = scheduling
    }
}

public enum SourceKind: String, CaseIterable, Sendable {
    case local, winnow
}

public struct SourceInfo: Equatable, Sendable {
    /// Stable id, stored in documents (`ProjectDoc.sourceId`, `TripDoc.sourceId`).
    public var id: String
    /// What the gallery prints — the origin as-is, never prettified.
    public var label: String
    public var kind: SourceKind
    public var capabilities: SourceCapabilities

    public init(id: String, label: String, kind: SourceKind, capabilities: SourceCapabilities) {
        self.id = id; self.label = label; self.kind = kind; self.capabilities = capabilities
    }
}

/// Source #1 — this device and the folders it is shown. The web's `LOCAL_SOURCE`.
public let localSource = SourceInfo(
    id: "local",
    label: "local",
    kind: .local,
    capabilities: SourceCapabilities(media: true, documents: true, scheduling: false)
)

// The id a document with no `sourceId` belongs to — everything written before
// the field existed lives on this device, the web's `DEFAULT_SOURCE_ID` — is
// `defaultSourceId`, declared in `Roll.swift` (the roll reader needed it
// first); `localSource.id` is that same string, pinned by the spec.

/// Every source a session knows — the web's module-level list as a value.
/// Storage-free: it holds what the app mirrors in, it never reads it from
/// anywhere.
public struct SourceRegistry: Equatable, Sendable {
    /// Remote sources registered by their own store; `local` is never among them.
    public private(set) var remote: [SourceInfo]

    public init(remote: [SourceInfo] = []) {
        self.remote = remote.filter { $0.id != localSource.id }
    }

    public mutating func setRemoteSources(_ sources: [SourceInfo]) {
        remote = sources.filter { $0.id != localSource.id }
    }

    /// Every source this session knows: local first, then what was connected.
    public func listSources() -> [SourceInfo] {
        [localSource] + remote
    }

    public func sourceById(_ id: String) -> SourceInfo? {
        listSources().first { $0.id == id }
    }
}

public struct SourceGroup<T> {
    /// The source id — resolve it with `SourceRegistry.sourceById`, which may return nil.
    public var id: String
    public var items: [T]

    public init(id: String, items: [T]) { self.id = id; self.items = items }
}

extension SourceGroup: Equatable where T: Equatable {}
extension SourceGroup: Sendable where T: Sendable {}

/// Documents grouped by the source they belong to, for a gallery that shows
/// provenance. `local` always leads, even empty; other sources follow in
/// first-seen order. A document naming a source this session does not know
/// still gets its group — shown with the reason, never hidden — and one with
/// no `sourceId` (written before the field existed) files under this device.
/// `sourceId` reads the item's own field, since a kernel document is not an
/// object with a `sourceId` key by shape.
public func groupBySource<T>(_ items: [T], sourceId: (T) -> String?) -> [SourceGroup<T>] {
    var order: [String] = [defaultSourceId]
    var buckets: [String: [T]] = [defaultSourceId: []]
    for item in items {
        let id = sourceId(item) ?? defaultSourceId
        if buckets[id] == nil {
            order.append(id)
            buckets[id] = [item]
        } else {
            buckets[id]?.append(item)
        }
    }
    return order.compactMap { id in
        let bucket = buckets[id] ?? []
        if bucket.isEmpty && id != defaultSourceId { return nil }
        return SourceGroup(id: id, items: bucket)
    }
}
