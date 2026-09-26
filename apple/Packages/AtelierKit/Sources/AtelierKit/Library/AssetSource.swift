// Which source an asset in the pool came from — the pool's answer to
// `groupBySource` for documents. Port of `src/shared/library/asset-source.ts`.
//
// The pool holds one flat list of files and never asks where they came from;
// reading that back per asset is what lets the Library keep a folder's files
// and an instance's files apart — the maintainer's *"pas de mélange"* —
// without the pool learning a second shape.
//
// The web reads provenance from its identity registry (`mediaOrigin(file)`,
// filled by `materialize`). Here the kernel's handle IS the record: a
// `SavedMediaRef` carries `assetId = "<host>/<id>"` only when a source vouched
// for the file (`materialize`, `rowMediaRef`), and a file the person opened
// from a disk never has one — so the host of that id is the source, and the
// id itself is the remote id. A `.srt` fetched beside its clip shares the
// clip's identity; the MAIN file speaks, as on the web.

import Foundation

/// The file that speaks for an asset: its picture, else its clip, else its log.
public func assetMainFile(_ asset: Asset) -> SavedMediaRef? {
    asset.parts.image ?? asset.parts.video ?? asset.parts.srt
}

/// `"<host>/<id>"` as the source vouched it, or nil for a local file.
public func assetRemoteId(_ asset: Asset) -> String? {
    guard let id = assetMainFile(asset)?.assetId, !id.isEmpty else { return nil }
    return id
}

/// The source id a source vouched this asset with, or `local` for a file the
/// person opened.
public func assetSourceId(_ asset: Asset) -> String {
    guard let id = assetRemoteId(asset), let slash = id.firstIndex(of: "/"), slash != id.startIndex else {
        return defaultSourceId
    }
    return String(id[..<slash])
}

/// One source's share of the pool, in pool order.
public struct SourceAssets: Equatable, Sendable {
    public var sourceId: String
    public var assets: [Asset]

    public init(sourceId: String, assets: [Asset]) { self.sourceId = sourceId; self.assets = assets }
}

public struct AssetsBySource: Equatable, Sendable {
    /// Files the person opened from disk — no source vouched for them.
    public var local: [Asset]
    /// Fetched from a source, in the order each source first appears.
    public var remote: [SourceAssets]

    public init(local: [Asset] = [], remote: [SourceAssets] = []) { self.local = local; self.remote = remote }

    /// One source's assets, or none.
    public func assets(of sourceId: String) -> [Asset] {
        remote.first { $0.sourceId == sourceId }?.assets ?? []
    }
}

/// Split the pool by provenance, keeping pool order inside each group.
public func splitAssetsBySource(_ assets: [Asset]) -> AssetsBySource {
    var out = AssetsBySource()
    for asset in assets {
        let id = assetSourceId(asset)
        if id == defaultSourceId {
            out.local.append(asset)
        } else if let i = out.remote.firstIndex(where: { $0.sourceId == id }) {
            out.remote[i].assets.append(asset)
        } else {
            out.remote.append(SourceAssets(sourceId: id, assets: [asset]))
        }
    }
    return out
}
