// A pack kept on a connected Winnow, so a phone grades with looks bought on a
// Mac. Port of `src/shared/lut/pack-remote.ts`; the HTTP client is the app's,
// handed in as a `PackRemoteClient` (the eight calls of the web's
// `WinnowClient` this module makes, nothing else).
//
// Two buckets, on purpose (`docs/lut-packs.md` §4):
// - the pack's INDEX — names, the tree, what is hidden, the thumbnails — is a
//   `lutpack` DOCUMENT, small and versioned like a trip;
// - each LATTICE is a FILE keyed by the SHA-256 of the ENCODED lattice itself
//   — `PackLook.blob`, never `PackLook.hash`, which is the `.cube` text's. The
//   instance hashes the body it is given and refuses a path that disagrees
//   (the 400 every look got on the first real push), so the key is MEASURED
//   from the bytes as they travel, never carried over.
//
// Rules kept:
// - A push writes the lattices FIRST and the index LAST: an index published
//   before its bytes offers looks that 404. A delete is the exact mirror —
//   the index first, then the bytes — because an index naming a gone lattice
//   404s on every picture, while an index that dropped a look whose bytes
//   linger only wastes space the next forget reclaims.
// - No sync engine: a pack is pushed and pulled when the author asks, a
//   lattice fetched on first use (`PackVault`). Atelier never writes to an
//   instance on its own.

import Foundation

/// The document kind Winnow lists a pack index by.
public let packKind = "lutpack"
/// The pack document's own version, beside the body, as every document has.
public let packDocVersion = 1
/// What a lattice is sent as — bytes Winnow never reads (`PackCodec.swift`).
public let packLatticeType = "application/octet-stream"
/// The app namespace the web client writes under (its `DOCS_APP`).
private let packDocsApp = "atelier"

/// The part of a Winnow client a pack needs — the app implements it over its
/// own HTTP client. Failures are the app's own errors, thrown through; the two
/// "not there" answers the pack logic READS are values, never errors:
/// `getAppFile` answers nil for a blob this account does not hold (a 404), and
/// `docEtag` nil for a document that was never pushed or is gone (a 404 — the
/// web's `currentEtag`, which is what makes a first push a create with no
/// `If-Match`).
public protocol PackRemoteClient: Sendable {
    /// The ids of the blobs this account already holds for the app — never bytes.
    func listAppFiles(_ app: String) async throws -> [String]
    /// Store a blob under its own hash; the instance refuses a body that does
    /// not hash to `id`, and `maxBytes` (the instance's per-file cap) is checked
    /// before anything travels.
    func putAppFile(_ app: String, _ id: String, _ bytes: [UInt8], mediaType: String, maxBytes: Int?) async throws
    func getAppFile(_ app: String, _ id: String) async throws -> [UInt8]?
    /// Forget a blob there; absent is not an error.
    func deleteAppFile(_ app: String, _ id: String) async throws
    func docEtag(_ app: String, _ id: String) async throws -> String?
    /// Create or replace (`ifMatch` nil for a create); `maxBytes` is the
    /// instance's document cap.
    func putDoc(_ app: String, _ id: String, _ body: JSONValue, ifMatch: String?, maxBytes: Int?) async throws
    func deleteDoc(_ app: String, _ id: String, ifMatch: String?) async throws
    /// The BODY (`doc`) of every document of one kind this account holds there.
    func listDocs(_ app: String, kind: String) async throws -> [JSONValue]
}

/// An instance this device is connected to that can keep a pack.
public struct PackHost: Sendable {
    /// The source id — the instance's host, what the sheet prints.
    public var sourceId: String
    public var client: any PackRemoteClient
    /// The document cap, checked before a PUT.
    public var maxDocBytes: Int?
    /// The per-file cap, checked before a lattice is sent.
    public var maxFileBytes: Int?

    public init(sourceId: String, client: any PackRemoteClient, maxDocBytes: Int? = nil, maxFileBytes: Int? = nil) {
        self.sourceId = sourceId; self.client = client; self.maxDocBytes = maxDocBytes; self.maxFileBytes = maxFileBytes
    }
}

/// What a connection's capabilities sheet says about keeping a pack — the
/// facts the web's `packHosts` reads off `getWinnowConnection`, mirrored in by
/// the app from its own connection store.
public struct PackHostCandidate: Equatable, Sendable {
    public var sourceId: String
    /// `capabilities.documents.bucket`.
    public var documentsBucket: Bool
    /// `capabilities.documents.kinds`.
    public var documentKinds: [String]
    /// `capabilities.files.bucket` — absence is "no" (`hasFileBucket`).
    public var filesBucket: Bool
    public var maxDocBytes: Int?
    public var maxFileBytes: Int?

    public init(sourceId: String, documentsBucket: Bool, documentKinds: [String], filesBucket: Bool,
                maxDocBytes: Int? = nil, maxFileBytes: Int? = nil) {
        self.sourceId = sourceId; self.documentsBucket = documentsBucket; self.documentKinds = documentKinds
        self.filesBucket = filesBucket; self.maxDocBytes = maxDocBytes; self.maxFileBytes = maxFileBytes
    }
}

/// True for an instance that can hold a pack: a document bucket that lists
/// `lutpack` AND the file bucket. One that predates either is not offered,
/// rather than failing after the first upload.
public func canKeepPack(_ candidate: PackHostCandidate) -> Bool {
    candidate.documentsBucket && candidate.documentKinds.contains(packKind) && candidate.filesBucket
}

/// The instances that can keep a pack, in the connections' order. `client`
/// builds the client for a source id; a connection with none is left out (the
/// web asserts one exists).
public func packHosts(_ candidates: [PackHostCandidate],
                      client: (String) -> (any PackRemoteClient)?) -> [PackHost] {
    candidates.filter(canKeepPack).compactMap { c in
        guard let made = client(c.sourceId) else { return nil }
        return PackHost(sourceId: c.sourceId, client: made, maxDocBytes: c.maxDocBytes, maxFileBytes: c.maxFileBytes)
    }
}

/// The host of one source id, or nil when it cannot keep a pack.
public func packHost(_ sourceId: String, in hosts: [PackHost]) -> PackHost? {
    hosts.first { $0.sourceId == sourceId }
}

// MARK: - pushing

public struct PushProgress: Equatable, Sendable {
    /// Looks sent so far, of those that had to be sent.
    public var done: Int
    public var total: Int
    /// Bytes written this push — nothing when the instance already held them.
    public var bytes: Int

    public init(done: Int, total: Int, bytes: Int) {
        self.done = done; self.total = total; self.bytes = bytes
    }
}

public struct PushPackResult: Equatable, Sendable {
    /// Lattices the instance already held, by blob.
    public var reused: Int
    public var sent: Int
    public var bytes: Int
    /// Source hashes of looks whose bytes this device does not hold, so
    /// nothing could be sent — said, never dropped from the index.
    public var missingLocally: [String]
    /// The index AS PUSHED — each sent look's `blob` filled in. The caller
    /// saves it, so the next push knows what the instance calls those bytes
    /// without reading 40 MB back out of the vault to hash it again.
    public var index: LutPackIndex

    public init(reused: Int, sent: Int, bytes: Int, missingLocally: [String], index: LutPackIndex) {
        self.reused = reused; self.sent = sent; self.bytes = bytes
        self.missingLocally = missingLocally; self.index = index
    }
}

/// A string that is present and not empty.
private func remoteText(_ s: String?) -> String? {
    guard let s, !s.isEmpty else { return nil }
    return s
}

/// Push a pack: its lattices first, then its index.
///
/// `latticeFor` is asked by the look's `hash`, because that is what the local
/// vault is keyed on. What comes back is hashed AGAIN, and that second number
/// is the id it is stored under there — the only one the instance accepts.
public func pushPack(
    _ host: PackHost,
    _ index: LutPackIndex,
    latticeFor: (String) async throws -> [UInt8]?,
    onProgress: ((PushProgress) -> Void)? = nil
) async throws -> PushPackResult {
    var hashes: [String] = []
    var seenHashes = Set<String>()
    for look in index.looks {
        guard let hash = remoteText(look.hash), !seenHashes.contains(hash) else { continue }
        seenHashes.insert(hash)
        hashes.append(hash)
    }
    var there = Set(try await host.client.listAppFiles(packDocsApp))

    // What the index already says the instance calls a look's bytes, kept only
    // where the instance really holds it. A look pushed by an older build
    // carries nothing, and is read and hashed below rather than assumed.
    var blobs: [String: String] = [:]
    for look in index.looks {
        if let hash = remoteText(look.hash), let blob = remoteText(look.blob), there.contains(blob) {
            blobs[hash] = blob
        }
    }
    let wanted = hashes.filter { blobs[$0] == nil }

    var missingLocally: [String] = []
    var sent = 0
    var bytes = 0
    for hash in wanted {
        onProgress?(PushProgress(done: sent, total: wanted.count, bytes: bytes))
        guard let lattice = try await latticeFor(hash) else {
            missingLocally.append(hash)
            continue
        }
        // MEASURED from the bytes that are about to travel.
        let blob = sha256Hex(lattice)
        blobs[hash] = blob
        // Another look encodes to the same lattice, or the instance held it
        // under its true id all along: nothing to write.
        if there.contains(blob) { continue }
        try await host.client.putAppFile(packDocsApp, blob, lattice, mediaType: packLatticeType,
                                         maxBytes: host.maxFileBytes)
        there.insert(blob)
        sent += 1
        bytes += lattice.count
    }
    onProgress?(PushProgress(done: sent, total: wanted.count, bytes: bytes))

    // The index carries no bytes and is written last, carrying the blobs —
    // what another device reads to fetch them.
    var pushed = index
    pushed.looks = index.looks.map { look in
        guard let hash = remoteText(look.hash), let blob = blobs[hash], !blob.isEmpty, blob != look.blob else {
            return look
        }
        var next = look
        next.blob = blob
        return next
    }
    try await putPackDoc(host, pushed)
    return PushPackResult(
        reused: hashes.count - sent - missingLocally.count,
        sent: sent,
        bytes: bytes,
        missingLocally: missingLocally,
        index: pushed
    )
}

/// Write the index alone — what a hide/show change costs. The etag dance is
/// deliberately skipped (the CURRENT etag is sent, not a remembered one): a
/// pack is a library one device owns and edits, so a refused write would only
/// ask the author about a thing they have not changed anywhere else.
public func putPackDoc(_ host: PackHost, _ index: LutPackIndex) async throws {
    let current = try await host.client.docEtag(packDocsApp, index.id)
    let body: JSONValue = .object([
        "kind": .string(packKind),
        "version": .number(Double(packDocVersion)),
        "doc": index.json,
    ])
    try await host.client.putDoc(packDocsApp, index.id, body, ifMatch: current, maxBytes: host.maxDocBytes)
}

// MARK: - reading

/// Every pack this account keeps on that instance; a document that is not an
/// index is left out.
public func fetchRemotePacks(_ host: PackHost) async throws -> [LutPackIndex] {
    try await host.client.listDocs(packDocsApp, kind: packKind).compactMap(migratePackIndex)
}

/// One lattice from the instance, or nil when it does not hold that blob — the
/// look's `blob`, never its `hash`.
public func fetchRemoteLattice(_ host: PackHost, _ blob: String) async throws -> [UInt8]? {
    try await host.client.getAppFile(packDocsApp, blob)
}

// MARK: - forgetting

/// Forget a pack there: its index FIRST, then the lattices no other pack
/// names. `keptElsewhere` holds BLOBS — the file store's vocabulary.
public func deleteRemotePack(_ host: PackHost, _ index: LutPackIndex, _ keptElsewhere: Set<String>) async throws {
    let current = try await host.client.docEtag(packDocsApp, index.id)
    try await host.client.deleteDoc(packDocsApp, index.id, ifMatch: current)
    var seen = Set<String>()
    for look in index.looks {
        guard let blob = remoteText(look.blob), !seen.contains(blob) else { continue }
        seen.insert(blob)
        if keptElsewhere.contains(blob) { continue }
        try await host.client.deleteAppFile(packDocsApp, blob)
    }
}

/// Forget SOME of a pack's looks there: the index WITHOUT them (`next`, from
/// `withoutLooks` — the very index this device saves, or the two copies start
/// disagreeing), then the blobs the caller established are free (`freedBlobs`).
public func deleteRemoteLooks(_ host: PackHost, _ next: LutPackIndex, _ blobs: [String]) async throws {
    try await putPackDoc(host, next)
    var seen = Set<String>()
    for blob in blobs where !seen.contains(blob) {
        seen.insert(blob)
        try await host.client.deleteAppFile(packDocsApp, blob)
    }
}
