// What a roll ASKS Winnow about its culling, and what it keeps of the answer —
// the pure half of `src/tools/develop/use-roll-culling.ts` (item 33 of
// `docs/lightroom-gaps.md`: picks, stars and labels READ live and filtered on,
// never stored on the roll, never written).
//
// - **One list request per two hundred pictures**, per connected instance:
//   the rows the roll's refs name (`assetsByIds`), which carry the culling
//   already joined. Nothing but those rows — no bytes, no thumbnail.
// - **An answer is believed for a minute** (`cullFreshMs`): the maintainer
//   culls in Winnow and develops here, so a return to the app asks again what
//   is older than that. An id the instance no longer holds is kept as "no
//   culling", so it is not asked again at once.
// - A picture from this device, or on an instance that is not connected, has
//   no answer — which is not unrated.
//
// The web keeps the answers in module state keyed `host/id` (the assetId
// spelling); here that map is a value the app holds and these functions read
// and return.

import Foundation

/// How long an answer is believed before a return to the app asks again.
public let cullFreshMs: Double = 60_000
/// Ids per list request: a URL of a few kilobytes, inside any proxy's limit.
public let cullChunk = 200

/// One picture's answer, and when it was had.
public struct KeptCulling: Equatable, Sendable {
    /// Nil where the instance said nothing, or no longer holds the asset.
    public var culling: Culling?
    public var at: Double

    public init(culling: Culling?, at: Double) { self.culling = culling; self.at = at }
}

/// What the roll asks about, by host, in the order the strip first names each
/// host — only connected instances, each id once. Keyed on the refs alone: an
/// edit to a develop must ask nothing.
public func cullingWanted(_ pictures: [RollPicture], connected: (String) -> Bool) -> [(host: String, ids: [Int])] {
    var order: [String] = []
    var byHost: [String: [Int]] = [:]
    for p in pictures {
        guard let split = splitAssetId(p.ref.assetId), split.host != defaultSourceId, connected(split.host) else { continue }
        if byHost[split.host] == nil {
            order.append(split.host)
            byHost[split.host] = []
        }
        if !(byHost[split.host] ?? []).contains(split.id) { byHost[split.host]?.append(split.id) }
    }
    return order.map { (host: $0, ids: byHost[$0] ?? []) }
}

/// The ids of `host` whose answer is missing or older than `maxAge`.
public func staleCullIds(_ host: String, _ ids: [Int], kept: [String: KeptCulling], now: Double, maxAge: Double) -> [Int] {
    ids.filter { id in
        guard let k = kept["\(host)/\(id)"] else { return true }
        return now - k.at > maxAge
    }
}

/// `ids` cut into requests of at most `size`.
public func cullChunks(_ ids: [Int], size: Int = cullChunk) -> [[Int]] {
    guard size > 0, !ids.isEmpty else { return ids.isEmpty ? [] : [ids] }
    var out: [[Int]] = []
    var i = 0
    while i < ids.count {
        out.append(Array(ids[i..<Swift.min(ids.count, i + size)]))
        i += size
    }
    return out
}

/// What one answer adds to the kept map: every row's culling, and "none" for
/// an id asked for that the instance did not send back.
public func keptAfterAnswer(_ host: String, asked: [Int], rows: [WinnowAssetRow], at: Double) -> [String: KeptCulling] {
    var out: [String: KeptCulling] = [:]
    var seen = Set<Int>()
    for row in rows {
        seen.insert(row.id)
        out["\(host)/\(row.id)"] = KeptCulling(culling: cullingFromRow(row), at: at)
    }
    for id in asked where !seen.contains(id) {
        out["\(host)/\(id)"] = KeptCulling(culling: nil, at: at)
    }
    return out
}

/// Winnow's word on each picture it answered for, by picture id. A picture
/// absent here has none.
public func cullingByPicture(_ pictures: [RollPicture], kept: [String: KeptCulling]) -> [String: Culling] {
    var out: [String: Culling] = [:]
    for p in pictures {
        guard let split = splitAssetId(p.ref.assetId), let c = kept["\(split.host)/\(split.id)"]?.culling else { continue }
        out[p.id] = c
    }
    return out
}
