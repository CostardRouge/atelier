// Turning listed files into `SavedMediaRef`s that carry a content hash — port
// of `src/shared/projects/media-identity.ts`.
//
// The hash itself is pure (`Lib/PartialHash.swift`, Winnow's `content_hash`);
// this is the thin layer that decides WHEN to pay for it. It reads 128 KiB per
// file at most, but a project folder can hold fifty clips, so the result is
// memoised by the cheap identity the library already uses (`fileIdentity`:
// `name__size__lastModified`): a folder is hashed once per session, and
// reopening a project is free.
//
// Rules kept (`studio.md`, «Media identity is id → hash → name»):
// - A file a SOURCE handed over is vouched for with the source's identity
//   (`KnownIdentity`), consulted BEFORE any hashing: a file fetched from
//   Winnow is usually a proxy, and hashing its own bytes would give the
//   proxy's identity, which is nobody's `content_hash`.
// - Failure is not fatal: a read that throws (a permission revoked
//   mid-listing, a file gone between the listing and the slice) yields a ref
//   WITHOUT a hash, never an error — matching then falls back to the name,
//   which is what every document written before hashes does anyway.
// - `findMedia` is lazy: the name lookup runs first and reads nothing; only
//   when the name has changed does it hash the SAME-SIZE candidates.
//
// The web's module state (the registry, the memo) is a class here —
// `MediaIdentities.shared` behind the web's free functions, or an instance of
// the app's own. The web's `File` is the library's handle, a `SavedMediaRef`
// (`Library/Assets.swift`), and its bytes are read through `open`, which the
// app answers with a `HashableBlob` over the file (two reads, never a load).
// The web's `MediaOrigin` also carries the closures that fetch the original,
// its head and the companion; the kernel's origin is facts only
// (`Media/MediaOrigin.swift`), and — as `WinnowIdentity` does — the EXIF the
// source parsed and the original's URL ride BESIDE it here.

import Foundation

/// What a source told us about a file it handed over — the web's `KnownIdentity`.
public struct KnownIdentity: Equatable, Sendable {
    /// Id in the source that holds it (`<host>/<id>` for a Winnow asset).
    public var assetId: String?
    /// The ORIGINAL's partial content hash, when the source knows it.
    public var hash: String?
    /// Where this file came from, when a source handed it over.
    public var origin: MediaOrigin?
    /// What the source parsed of the CAPTURE's EXIF (the web's `origin.exif`),
    /// merged UNDER the file's own by `mergeExif`.
    public var exif: ExifData?
    /// Where the capture's own bytes are, when this file is its proxy (what the
    /// web's `origin.fetchOriginal` fetches); nil when it IS the original.
    public var originalUrl: String?

    public init(assetId: String? = nil, hash: String? = nil, origin: MediaOrigin? = nil, exif: ExifData? = nil,
                originalUrl: String? = nil) {
        self.assetId = assetId; self.hash = hash; self.origin = origin; self.exif = exif
        self.originalUrl = originalUrl
    }
}

extension KnownIdentity {
    /// What a file fetched from an instance is vouched for with
    /// (`Sources/Winnow/Materialize.swift`), as the registry keeps it.
    public init(_ identity: WinnowIdentity) {
        self.init(assetId: identity.assetId, hash: identity.hash, origin: identity.origin, exif: identity.exif,
                  originalUrl: identity.originalUrl)
    }
}

extension WinnowIdentity {
    /// This identity as the registry keeps it.
    public var asKnown: KnownIdentity { KnownIdentity(self) }
}

/// The registry of vouched identities and the memo of computed hashes.
public final class MediaIdentities: @unchecked Sendable {
    public static let shared = MediaIdentities()

    private let lock = NSLock()
    private var known: [String: KnownIdentity] = [:]
    /// Keyed by `fileIdentity`; a failed read is memoised too, as nil.
    private var hashes: [String: HashMemo] = [:]

    private struct HashMemo { var hash: String? }

    public init() {}

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    /// Vouch for `file` with what its source said about it.
    public func register(_ file: SavedMediaRef, _ identity: KnownIdentity) {
        let key = fileIdentity(file)
        locked { known[key] = identity }
    }

    /// What a source vouched for `file` with, or nil for a file opened by hand.
    public func identity(of file: SavedMediaRef) -> KnownIdentity? {
        let key = fileIdentity(file)
        return locked { known[key] }
    }

    /// Where `file` came from, or nil for a file the person opened themselves.
    public func origin(of file: SavedMediaRef?) -> MediaOrigin? {
        guard let file else { return nil }
        return identity(of: file)?.origin
    }

    /// The file's partial content hash, or nil when it could not be read. A
    /// file a source vouched for answers with the source's hash and reads
    /// nothing; any other is read once per identity, whatever handle it
    /// arrives through.
    public func hash(of file: SavedMediaRef, open: (SavedMediaRef) throws -> HashableBlob) -> String? {
        let key = fileIdentity(file)
        if let vouched = identity(of: file)?.hash, !vouched.isEmpty { return vouched }
        if let memo = locked({ hashes[key] }) { return memo.hash }
        let computed: String?
        do {
            computed = try partialHash(open(file))
        } catch {
            computed = nil
        }
        return locked {
            // A concurrent reader may have landed first; its answer stands.
            if let memo = hashes[key] { return memo.hash }
            hashes[key] = HashMemo(hash: computed)
            return computed
        }
    }

    /// A `SavedMediaRef` for `file`, carrying its hash (and source id) when
    /// known — never a hash key holding nothing.
    public func hashedRef(_ file: SavedMediaRef, open: (SavedMediaRef) throws -> HashableBlob) -> SavedMediaRef {
        var ref = SavedMediaRef(name: file.name, size: file.size, lastModified: file.lastModified)
        if let assetId = identity(of: file)?.assetId, !assetId.isEmpty { ref.assetId = assetId }
        if let hash = hash(of: file, open: open), !hash.isEmpty { ref.hash = hash }
        return ref
    }

    /// The same, for a whole listing; order is preserved.
    public func hashedRefs(_ files: [SavedMediaRef], open: (SavedMediaRef) throws -> HashableBlob) -> [SavedMediaRef] {
        files.map { hashedRef($0, open: open) }
    }

    /// The file among `files` that IS `ref` — resolved name first (free), then
    /// by hash among the same-size candidates only (a renamed file keeps its
    /// size, which usually leaves one, and often none).
    public func find(_ ref: SavedMediaRef, in files: [SavedMediaRef],
                     open: (SavedMediaRef) throws -> HashableBlob) -> SavedMediaRef? {
        let wanted = ref.name.lowercased()
        if let byName = files.first(where: { $0.name.lowercased() == wanted }) { return byName }
        guard let hash = ref.hash, !hash.isEmpty else { return nil }
        for file in files where file.size == ref.size {
            if self.hash(of: file, open: open) == hash { return file }
        }
        return nil
    }
}

// MARK: - the web's names, over the shared registry

public func registerMediaIdentity(_ file: SavedMediaRef, _ identity: KnownIdentity) {
    MediaIdentities.shared.register(file, identity)
}

public func knownIdentity(_ file: SavedMediaRef) -> KnownIdentity? {
    MediaIdentities.shared.identity(of: file)
}

/// Where `file` came from, or nil for a file the user opened themselves.
public func mediaOrigin(_ file: SavedMediaRef?) -> MediaOrigin? {
    MediaIdentities.shared.origin(of: file)
}

public func mediaHash(_ file: SavedMediaRef, open: (SavedMediaRef) throws -> HashableBlob) -> String? {
    MediaIdentities.shared.hash(of: file, open: open)
}

public func hashedMediaRef(_ file: SavedMediaRef, open: (SavedMediaRef) throws -> HashableBlob) -> SavedMediaRef {
    MediaIdentities.shared.hashedRef(file, open: open)
}

public func hashedMediaRefs(_ files: [SavedMediaRef], open: (SavedMediaRef) throws -> HashableBlob) -> [SavedMediaRef] {
    MediaIdentities.shared.hashedRefs(files, open: open)
}

public func findMedia(_ ref: SavedMediaRef, _ files: [SavedMediaRef],
                      open: (SavedMediaRef) throws -> HashableBlob) -> SavedMediaRef? {
    MediaIdentities.shared.find(ref, in: files, open: open)
}
