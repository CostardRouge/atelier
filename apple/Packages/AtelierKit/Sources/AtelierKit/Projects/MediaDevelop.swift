// A picture's own correction, as a PROJECT keeps it — port of
// `src/shared/projects/media-develop.ts`, pure.
//
// Per media, keyed by base name like the trims, and guarded by the media's
// content hash the way a trim is guarded by its duration: a develop set on one
// file must not be restored onto a same-named other. Bound half, never the
// portable file — a template is from no picture (`docs/photo-develop.md` §5.3,
// `studio.md` «A media's DEVELOP is bound-half»).
//
// Rules kept: only corrected media have an entry (as shot = no entry); the
// hash is stamped when it was known and an unknown hash on EITHER side keeps
// the develop, exactly as a trim keeps its range when the duration matches;
// a restored develop is re-read through `developOrNull`, so a hand-edited or
// foreign value lands clamped, never as a NaN in a bake.

import Foundation

public struct SavedDevelop: Equatable, Sendable {
    /// Who wrote an entry when it was not the Studio.
    public enum Via: String, Sendable {
        /// The hook's correction sent across the Trips bridge (`hook-scene.ts`).
        case roadtrip
    }

    public var settings: DevelopSettings
    /// The media's partial content hash when it was known at write time (the
    /// same hash `SavedMediaRef.hash` carries). Nil when it could not be read;
    /// a develop without one restores by name alone, as every trim does.
    public var hash: String?
    /// `roadtrip` marks an entry the bridge wrote: a send replaces only an
    /// entry it wrote itself, and an unlink takes only that one back out. An
    /// entry the author set in the Studio carries no mark, so a Studio edit of
    /// a sent develop makes it theirs (`writeDevelop` writes none).
    public var via: Via?

    public init(settings: DevelopSettings, hash: String? = nil, via: Via? = nil) {
        self.settings = settings; self.hash = hash; self.via = via
    }
}

/// What to persist for a media — nil when it is back to as shot.
public func saveDevelop(_ settings: DevelopSettings?, _ hash: String?) -> SavedDevelop? {
    guard let settings, !isDefaultDevelop(settings) else { return nil }
    if let hash, !hash.isEmpty { return SavedDevelop(settings: settings, hash: hash) }
    return SavedDevelop(settings: settings)
}

/// The project's develops map with `key`'s correction written — or removed
/// when it is back to as shot. The same map comes back when there was nothing
/// to remove. The one writer both the open media (Done) and the batch verb
/// (every other media, each under its own hash) go through.
public func writeDevelop(_ develops: [String: SavedDevelop], _ key: String, _ settings: DevelopSettings?,
                         _ hash: String?) -> [String: SavedDevelop] {
    var out = develops
    if let saved = saveDevelop(settings, hash) {
        out[key] = saved
        return out
    }
    if develops[key] == nil { return develops }
    out[key] = nil
    return out
}

/// The develop to apply to a media, or nil when there is none — or when the
/// saved one was set against a DIFFERENT file of the same name: both hashes
/// known and disagreeing means another take.
public func restoreDevelop(_ saved: SavedDevelop?, _ hash: String?) -> DevelopSettings? {
    guard let saved else { return nil }
    if let theirs = saved.hash, !theirs.isEmpty, let ours = hash, !ours.isEmpty, theirs != ours { return nil }
    return developOrNull(saved.settings.json)
}

/// A stored map read back safely — entries with nothing in them are dropped,
/// an empty hash is no hash, and only the one known `via` is kept.
public func normaliseDevelops(_ raw: JSONValue?) -> [String: SavedDevelop] {
    guard let o = raw?.objectValue else { return [:] }
    var out: [String: SavedDevelop] = [:]
    for (key, value) in o {
        guard let v = value.objectValue, let settings = developOrNull(v["settings"]) else { continue }
        var saved = SavedDevelop(settings: settings)
        if let hash = v["hash"]?.stringValue, !hash.isEmpty { saved.hash = hash }
        if v["via"]?.stringValue == SavedDevelop.Via.roadtrip.rawValue { saved.via = .roadtrip }
        out[key] = saved
    }
    return out
}

extension SavedDevelop {
    /// `hash` and `via` written only when present, as the web's spreads leave them out.
    public var json: JSONValue {
        var o: [String: JSONValue] = ["settings": settings.json]
        if let hash { o["hash"] = .string(hash) }
        if let via { o["via"] = .string(via.rawValue) }
        return .object(o)
    }
}
