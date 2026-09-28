// Capability matching — which assets a tool can actually use. Port of
// `src/shared/library/capabilities.ts`.
//
// A tool declares the `AssetKind`s it accepts; the library projects its pool
// down to that. The one non-trivial rule (`architecture.md`): an asset that
// holds a video PLUS telemetry still satisfies a tool that only wants `video`
// (it just ignores the sidecar), so a LUT tool sees DJI clips too.

import Foundation

/// True when `asset` can be used by a tool accepting `accepts`.
public func assetUsableBy(_ accepts: [AssetKind], _ asset: Asset) -> Bool {
    if accepts.contains(asset.kind) { return true }
    // A video+telemetry asset can stand in for a plain `video` request.
    if asset.kind == .videoTelemetry && accepts.contains(.video) { return true }
    return false
}

/// The subset of `assets` usable by a tool accepting `accepts`.
public func usableAssets(_ accepts: [AssetKind], _ assets: [Asset]) -> [Asset] {
    assets.filter { assetUsableBy(accepts, $0) }
}

/// The usable assets that are also currently selected — what a tool should
/// act on. Preserves the order of `assets`.
public func selectedUsableAssets(_ accepts: [AssetKind], _ assets: [Asset], _ selection: Set<String>) -> [Asset] {
    assets.filter { selection.contains($0.id) && assetUsableBy(accepts, $0) }
}
